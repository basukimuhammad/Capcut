#!/usr/bin/env node
const { pathToFileURL } = require('url');

const { UA } = require('./browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(html, id) {
  const m = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>(.*?)<\\/script>`, 's'));
  if (!m) throw new Error(`script#${id} tidak ditemukan di HTML`);
  return JSON.parse(m[1]);
}

/**
 * CapCut kadang Serving halaman dengan layout lain (loaderData = template_layout + template_page)
 * sehingga initTemplateDetail tidak ada, walau HTTP 200. Variasinya datang dari sisi CDN/AB-test,
 * jadi percobaan ulang biasanya dapat versi SSR yang lengkap.
 */
function pickTemplateDetail(router) {
  const ld = router.loaderData || {};
  const exact = ld['(locale$)/templates/(id)/page'];
  if (exact && exact.initTemplateDetail) return exact.initTemplateDetail;
  for (const v of Object.values(ld)) {
    if (v && typeof v === 'object' && v.initTemplateDetail) return v.initTemplateDetail;
  }
  return null;
}

async function fetchHtml(url, attempt) {
  const target = attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}_r=${attempt}-${Date.now()}`;
  const res = await fetch(target, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
  return res.text();
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function fmtDate(ts) {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function pickTitle(t) {
  const st = String(t.short_title || '').trim();
  if (st) return st;
  const raw = String(t.title || '').trim();
  return raw.replace(/\s*free template to use\s*$/i, '').trim() || raw;
}

function canonicalId(t, urlOrId) {
  const webId = String(t.web_id || '').trim();
  if (/^\d+$/.test(webId)) return webId;
  const m = String(urlOrId).match(/templates\/(\d+)/);
  if (m) return m[1];
  return String(urlOrId).replace(/[^\d]/g, '');
}

async function scrape(urlOrId, { download = false, tries = 3 } = {}) {
  const url = /^https?:/.test(urlOrId)
    ? urlOrId
    : `https://www.capcut.com/templates/${urlOrId.replace(/[^\d]/g, '')}`;

  let t = null;
  let lastErr = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const html = await fetchHtml(url, attempt);
      const router = extractJson(html, '__MODERN_ROUTER_DATA__');
      t = pickTemplateDetail(router);
      if (!t) throw new Error('Template tidak ditemukan atau tidak valid');
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < tries - 1) {
        const wait = 400 * (attempt + 1) + Math.floor(Math.random() * 400);
        console.warn(`[scrape] percobaan ${attempt + 1}/${tries} gagal (${e.message}), ulang ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  if (!t) throw lastErr;

  const id = canonicalId(t, urlOrId);
  const seg = t.draft_seg_info || {};
  const videoSlots = Number(seg.video_seg_len) || 0;
  const photosRequired = Math.min(videoSlots || Number(t.fragment_count) || 3, 9);

  const stats = [
    ['Pemakaian (usage)', t.usage_amount],
    ['Tayangan (play)', t.play_amount],
    ['Like', t.like_count],
    ['Favorit', t.favorite_count],
    ['Share', t.share_count],
    ['Komentar', t.interaction?.comment_count],
  ].filter(([, v]) => v != null);

  const info = {
    id,
    title: pickTitle(t),
    short_title: String(t.short_title || '').trim() || null,
    url: `https://www.capcut.com/templates/${id}`,
    duration_second: Math.round(t.duration / 1000),
    duration_text: fmtDuration(t.duration),
    fragment_count: t.fragment_count,
    video_slots: videoSlots || null,
    text_slots: seg.text_seg_len != null ? Number(seg.text_seg_len) : null,
    photos_required: photosRequired,
    create_time: fmtDate(t.create_time),
    is_multi_lang: t.is_multi_lang,
    stats: Object.fromEntries(stats),
    author: t.author
      ? {
          uid: t.author.uid,
          web_uid: t.author.web_uid,
          unique_id: t.author.unique_id,
          name: t.author.name,
          description: t.author.description,
          avatar_url: t.author.avatar_url,
          url: `https://www.capcut.com/@${t.author.unique_id}`,
        }
      : null,
    cover_url: t.optimized_cover_url?.cover_url_medium || t.cover_url,
    cover_url_small: t.optimized_cover_url?.cover_url_small || null,
    example_video: {
      url: t.video_url,
      mime_type: 'video/mp4',
      source: 'video_url (preview / contoh video)',
    },
    template_url: t.template_url,
    ccweb_available: !!t.ccweb_available,
  };

  if (download) {
    const out = `capcut_${t.id}.mp4`;
    const v = await fetch(t.video_url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
    if (!v.ok) throw new Error(`Gagal download video: HTTP ${v.status}`);
    const buf = Buffer.from(await v.arrayBuffer());
    require('fs').writeFileSync(out, buf);
    info.example_video.downloaded = out;
  }

  return info;
}

async function main() {
  const args = process.argv.slice(2);
  const dl = args.includes('--download');
  const target = args.find((a) => !a.startsWith('--'));

  if (!target) {
    console.log('Usage: node scrape-capcut.js <URL_ATAU_ID_TEMPLATE> [--download]');
    process.exit(1);
  }

  const info = await scrape(target, { download: dl });
  console.log(JSON.stringify(info, null, 2));
}

if (require.main === module) main().catch((e) => { console.error('Error:', e.message); process.exit(1); });

module.exports = { scrape };
