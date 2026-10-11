const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');
const { serveStatic } = require('@hono/node-server/serve-static');
const { runTask, checkAccountCookie } = require('./capcut-run');
const { scrape } = require('./scrape-capcut');
const { UA: BOT_UA } = require('./browser');
const { chromium } = require('playwright');
const sec = require('./security');

const DIR = __dirname;

const _envFile = path.join(DIR, '.env');
if (fs.existsSync(_envFile)) {
  for (const line of fs.readFileSync(_envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const TASKS_FILE = path.join(DIR, 'tasks.json');
const TEMPLATES_FILE = path.join(DIR, 'templates.json');
const TEMPLATE_INFO_FILE = path.join(DIR, 'template-info.json');
const TASKS_DIR = path.join(DIR, 'tasks');
const UPLOAD_DIR = path.join(DIR, 'uploads');
const CACHE_DIR = path.join(DIR, 'cache');
const DEBUG_DIR = path.join(DIR, 'debug');
const STORAGE_DIR = path.join(DIR, 'storage');
const INFO_STORAGE_DIR = path.join(STORAGE_DIR, 'info');
const MEDIA_STORAGE_DIR = path.join(STORAGE_DIR, 'media');
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const PORT = process.env.PORT || 3000;
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY || '1', 10) || 1);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 9;

async function fetchWithTimeout(url, opts = {}, ms = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function loadTemplates() {
  try {
    const raw = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : Object.values(raw);
    return list.filter(t => t && t.id);
  } catch (e) {
    console.error('gagal baca templates.json:', e.message);
    return [];
  }
}

let tasks = [];
if (fs.existsSync(TASKS_FILE)) {
  try { tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch (e) { tasks = []; }
}
if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(INFO_STORAGE_DIR)) fs.mkdirSync(INFO_STORAGE_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_STORAGE_DIR)) fs.mkdirSync(MEDIA_STORAGE_DIR, { recursive: true });

let running = 0;
const queue = [];

function saveTasks() {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

function uid() {
  return crypto.randomUUID();
}

function clientIp(c) {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return String(fwd).split(',')[0].trim();
  const socket = c.env && c.env.incoming && c.env.incoming.socket;
  return (socket && socket.remoteAddress) || 'unknown';
}

function hostBase(c) {
  const proto = c.req.header('x-forwarded-proto')
    || ((c.env && c.env.incoming && c.env.incoming.socket && c.env.incoming.socket.encrypted) ? 'https' : 'http');
  const host = c.req.header('x-forwarded-host') || c.req.header('host');
  return `${proto}://${host}`;
}

function taskWithHost(task, c) {
  const t = JSON.parse(JSON.stringify(task));
  delete t.images_local;
  if (t.result) {
    const id = t.id;
    const rewrite = (v) => {
      if (typeof v !== 'string' || !v) return v;
      if (/^\/api\/files\//.test(v)) return hostBase(c) + v;
      if (/^https?:\/\//.test(v)) return v;
      const base = String(v).split(/[\\/]/).pop();
      return hostBase(c) + `/api/files/${id}/${base}`;
    };
    t.result.file = rewrite(t.result.file);
    t.result.video_url = rewrite(t.result.video_url);
    t.result.download_url = rewrite(t.result.download_url);
  }
  return JSON.parse(JSON.stringify(t).replace(/\/root\/web/g, '[server]'));
}

async function downloadImage(url, file) {
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
  if (!res.ok) throw new Error('gagal download image: HTTP ' + res.status);
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) throw new Error('bukan image: ' + ct);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return file;
}

async function prepareTask(task) {
  if (task.images_local && task.images_local.length) return;
  const dir = path.join(TASKS_DIR, task.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const local = [];
  for (let i = 0; i < task.images.length; i++) {
    const ext = task.images[i].match(/\.(jpe?g|png|webp|heic|heif)/i)?.[1] || 'jpeg';
    const file = path.join(dir, `img${i + 1}.${ext}`);
    await downloadImage(task.images[i], file);
    local.push(file);
  }
  task.images_local = local;
  saveTasks();
}

async function saveResultFile(task, urls, outFile) {
  const candidates = Array.isArray(urls) ? urls.filter(Boolean) : (urls ? [urls] : []);
  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'referer': 'https://www.capcut.com/' },
        redirect: 'follow',
      }, 120000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ct = res.headers.get('content-type') || '';
      if (ct && !ct.includes('video') && !ct.includes('octet-stream') && !/\.(mp4|mov|webm)$/i.test(url)) {
        throw new Error('bukan konten video: ' + ct.slice(0, 60));
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error('file terlalu kecil: ' + buf.length + ' bytes');
      fs.writeFileSync(outFile, buf);
      task.result.file = `/api/files/${task.id}/result.mp4`;
      task.result.video_url = task.result.file;
      task.result.download_url = task.result.file;
      console.log(`[worker] video hasil ${task.id} tersimpan lokal (${buf.length} bytes)`);
      return true;
    } catch (e) {
      console.log(`[worker] coba simpan hasil ${task.id} dari ${url.slice(0, 60)} gagal: ${e.message}`);
    }
  }
  return false;
}

async function ensureTemplateInfo(templateId) {
  const cache = loadTemplateInfo();
  let info = isCacheValid(cache[templateId]) ? cache[templateId] : null;
  if (!info) {
    const stored = loadStoredInfo(templateId);
    if (stored) info = stored;
  }
  if (!info) {
    info = await scrape(templateId);
    info.id = templateId;
    info._cached_at = new Date().toISOString();
    cache[templateId] = info;
  }
  try { info = await ensureLocalTemplateMedia(templateId, info); } catch (e) {
    console.error(`[media] lokalize ${templateId} gagal: ${e.message}`);
  }
  cache[templateId] = info;
  saveTemplateInfo(cache);
  return info;
}

async function getTemplateExampleVideo(templateId) {
  const info = await ensureTemplateInfo(templateId);
  return (info.example_video && (info.example_video.origin_url || info.example_video.url)) || '';
}

async function downloadTemplateAudio(templateId) {
  const local = mediaPaths(templateId).video;
  if (fs.existsSync(local) && fs.statSync(local).size > 1000) return local;
  const cacheFile = path.join(CACHE_DIR, `tmpl_${templateId}.mp4`);
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 1000) return cacheFile;
  const url = await getTemplateExampleVideo(templateId);
  if (!url) throw new Error('tidak ada example video untuk template ini');
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'referer': 'https://www.capcut.com/' },
    redirect: 'follow',
  }, 120000);
  if (!res.ok) throw new Error('gagal download example video: HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('example video terlalu kecil: ' + buf.length + ' bytes');
  fs.writeFileSync(cacheFile, buf);
  return cacheFile;
}

async function preloadTemplateAudio(templateId) {
  try {
    const file = await downloadTemplateAudio(templateId);
    console.log(`[preload] audio template ${templateId} siap (${file})`);
  } catch (e) {
    console.log(`[preload] gagal siapkan audio template ${templateId}: ${e.message}`);
  }
}

const AUDIO_MIN_DB = parseFloat(process.env.AUDIO_MIN_DB || '-45', 10);

async function audioLoudnessDb(file) {
  try {
    const { stdout, stderr } = await execFileAsync('ffmpeg', [
      '-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
    ]);
    const m = (stdout + stderr).match(/max_volume: (-?\d+(\.\d+)?) dB/);
    if (!m) return -Infinity;
    return parseFloat(m[1]);
  } catch (e) {
    console.log(`[audio] volumedetect gagal ${file}: ${e.message.split('\n')[0]}`);
    return -Infinity;
  }
}

async function ensureAudio(file, templateId) {
  try {
    const db = await audioLoudnessDb(file);
    if (db > AUDIO_MIN_DB) {
      console.log(`[audio] ada suara asli (${db} dB) -> skip: ${file}`);
      return false;
    }
    console.log(`[audio] video senyap/tanpa audio (${db === -Infinity ? 'no audio' : db + ' dB'}) -> tambah audio template`);
    const audioFile = await downloadTemplateAudio(templateId);
    const tmp = file + '.tmp.mp4';
    await execFileAsync('ffmpeg', [
      '-y', '-i', file, '-i', audioFile,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', tmp,
    ]);
    fs.renameSync(tmp, file);
    console.log('[audio] audio dari template ditambahkan: ' + file);
    return true;
  } catch (e) {
    const tmp = file + '.tmp.mp4';
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    console.log('[audio] auto-audio gagal: ' + e.message);
    return false;
  }
}

function processQueue() {
  while (running < CONCURRENCY && queue.length) {
    const task = queue.shift();
    if (!task) continue;
    running++;
    runWorker(task).finally(() => {
      running--;
      processQueue();
    });
  }
}

async function runWorker(task) {
  task.status = 'processing';
  task.started_at = new Date().toISOString();
  saveTasks();
  try {
    await prepareTask(task);
    console.log(`[worker] mulai task ${task.id} (${task.ip})`);
    const outFile = path.join(TASKS_DIR, task.id, 'result.mp4');
    const res = await runTask({
      templateId: task.template_id,
      images: task.images_local,
      outFile,
      log: (m) => console.log(`[${task.id}] ${m}`),
    });
    task.result = {
      video_url: null,
      download_url: null,
      file: null,
      draft_id: res.draftId,
      file_id: res.fileId,
    };
    if (res.file) {
      task.result.file = `/api/files/${task.id}/result.mp4`;
      task.result.video_url = task.result.file;
      task.result.download_url = task.result.file;
    } else {
      await saveResultFile(task, [res.downloadUrl, res.videoUrl], outFile);
    }
    if (task.result.file) {
      const audioFixed = await ensureAudio(outFile, task.template_id);
      if (audioFixed) console.log(`[worker] auto-audio: audio ditambahkan ke task ${task.id}`);
    }
    task.status = res.done && task.result.file ? 'completed' : 'failed';
    if (task.status === 'failed') {
      task.error = res.error || (res.done ? 'render berhasil tapi gagal simpan video ke lokal' : 'gagal render / tidak ada video');
    }
  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
    console.log(`[worker] GAGAL ${task.id}: ${err.message}`);
  } finally {
    task.finished_at = new Date().toISOString();
    saveTasks();
  }
}

function enqueue(task) {
  queue.push(task);
  processQueue();
}

function listTemplates() {
  return loadTemplates().map(t => ({
    id: String(t.id),
    title: t.title || 'Untitled',
    photos_required: t.photos_required != null ? t.photos_required : 3,
  }));
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

const CAPCUT_API = 'https://edit-api-sg.capcut.com';
const CAPCUT_TS_PATH = '/lv/v1/cc_web/replicate/search_templates';
const SEARCH_CORS_PROXY = 'https://tunaikan.angelinaaa.dpdns.org/';
const REQUESTS_FILE = path.join(DIR, 'template-requests.json');

const searchCooldown = new Map();

/* hasil search/fyp di-cache sebentar agar paging tidak hit remote tiap ganti halaman */
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const FYP_CACHE_TTL = 2 * 60 * 1000;
const searchResultCache = new Map();
const fypResultCache = { items: null, at: 0 };
function cachedSearch(query) {
  const hit = searchResultCache.get(query);
  return hit && Date.now() - hit.at < SEARCH_CACHE_TTL ? hit.items : null;
}
function storeSearch(query, items) {
  if (searchResultCache.size > 30) {
    const oldest = searchResultCache.keys().next().value;
    if (oldest !== undefined) searchResultCache.delete(oldest);
  }
  searchResultCache.set(query, { items, at: Date.now() });
}

function paginate(items, page, perPage) {
  const total = items.length;
  const total_pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.max(1, Math.min(parseInt(page, 10) || 1, total_pages));
  const start = (p - 1) * perPage;
  return { templates: items.slice(start, start + perPage), total, total_pages, page: p, per_page: perPage };
}

/* cek apakah template benar bisa dirender dari CapCut Web (bukan app-only / sudah dihapus) */
async function templateRenderable(id) {
  const cache = loadTemplateInfo();
  let info = cache[id] || loadStoredInfo(id);
  if (info) {
    if (info.ccweb_available === false) return { ok: false, reason: 'app-only' };
    if (isCacheValid(info) && info.title) return { ok: true, info };
  }
  try {
    const scraped = await scrape(id);
    if (scraped.ccweb_available === false) return { ok: false, reason: 'app-only' };
    return { ok: true, info: scraped };
  } catch (e) {
    return { ok: false, reason: 'notfound' };
  }
}

/* selain sesi yang sudah verifikasi manusia, wajib captcha single-use */
function humanRequired(c, captchaToken, action) {
  const web = c.get('web');
  if (web && sec.isHuman(web.token)) return null;
  if (captchaToken) {
    const cap = sec.consumeCaptcha(captchaToken, clientIp(c), action);
    return cap.ok ? null : cap.reason;
  }
  return 'missing';
}

async function capcutTemplateSearch(query, count = 20) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = crypto.createHash('md5').update(`9e2c|${CAPCUT_TS_PATH.slice(-7)}|7|5.8.0|${ts}||11ac`).digest('hex').toLowerCase();
  const url = SEARCH_CORS_PROXY + CAPCUT_API + CAPCUT_TS_PATH;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'app-sdk-version': '127.0.0',
      loc: 'id',
      pf: '7',
      appvr: '5.8.0',
      'sign-ver': '1',
      'device-time': ts,
      sign,
    },
    body: JSON.stringify({ query, scene: 1, enter_from: 'template_editor', sdk_version: '127.0.0', count, cursor: '0', cc_web_version: 0 }),
  });
  const j = await r.json().catch(() => null);
  if (!j || j.ret !== '0') throw new Error((j && (j.errmsg ? 'CapCut: ' + j.errmsg : 'CapCut ret ' + j.ret)) || 'respons CapCut tidak valid');
  const vt = j.data.video_templates || [];
  return vt.filter(Boolean).map((t) => ({
    id: String(t.web_id || t.id),
    title: t.title || 'Untitled',
    author: (t.author && t.author.name) || '',
    username: (t.author && t.author.unique_id) || '',
    cover: t.cover_url || '',
    duration: t.duration || 0,
    is_free: !!t.is_free,
    stats: { usage: t.usage_amount || 0, play: t.play_amount || 0, like: t.like_count || 0 },
    link: SEARCH_CORS_PROXY + 'https://www.capcut.com/template-detail/' + String(t.web_id || t.id),
  }));
}

/* ---------- remote (Browserless + residential proxy Indonesia) ---------- */
function buildRemoteBrowserEndpoint() {
  const configuredEndpoint = process.env.BROWSERLESS_WS_ENDPOINT;
  const token = process.env.BROWSERLESS_TOKEN;
  if (!configuredEndpoint && !token) return '';

  // Endpoint custom boleh diatur lewat BROWSERLESS_WS_ENDPOINT.
  // Jika menggunakan Browserless Cloud, tambahkan permintaan proxy residential Indonesia.
  const rawEndpoint = configuredEndpoint || 'wss://production-sfo.browserless.io';
  let endpoint;
  try {
    endpoint = new URL(rawEndpoint);
  } catch (err) {
    throw new Error('BROWSERLESS_WS_ENDPOINT tidak valid. Gunakan URL WebSocket Browserless yang benar.');
  }

  if (token) endpoint.searchParams.set('token', token);

  // Parameter proxy ini untuk Browserless Cloud yang mendukung residential proxy.
  // Endpoint self-hosted/custom tidak diubah otomatis.
  if (endpoint.hostname.endsWith('browserless.io')) {
    endpoint.searchParams.set('proxy', process.env.BROWSERLESS_PROXY || 'residential');
    endpoint.searchParams.set('proxyCountry', process.env.BROWSERLESS_PROXY_COUNTRY || 'ID');
    endpoint.searchParams.set('proxySticky', process.env.BROWSERLESS_PROXY_STICKY || 'true');
  }

  return endpoint.toString();
}

const REMOTE_BROWSER = buildRemoteBrowserEndpoint();
let remoteBusy = false;
let lastRemoteHit = 0;
const REMOTE_GAP_MS = 8000;

function mapSearchItem(id, t) {
  const author = t.author || {};
  return {
    id,
    title: t.title || 'Untitled',
    author: author.name || '',
    username: author.unique_id || t.username || '',
    cover: t.cover_url || (t.example_video && t.example_video.cover_url) || '',
    avatar: author.avatar || '',
    video: (t.example_video && t.example_video.url) || '',
    duration: t.duration || 0,
    is_free: !!t.is_free,
    stats: { usage: t.usage_amount != null ? t.usage_amount : (t.usage_count || 0), play: t.play_amount || 0, like: t.like_count || 0 },
    link: 'https://www.capcut.com/template-detail/' + id,
  };
}

async function remoteCtx() {
  if (!REMOTE_BROWSER) {
    throw new Error('Browserless belum dikonfigurasi. Tambahkan BROWSERLESS_TOKEN di Environment Variables Render.');
  }
  const browser = await chromium.connectOverCDP(REMOTE_BROWSER, { timeout: 60000 });
  let ctx;
  try { ctx = browser.contexts()[0] || (await browser.newContext()); } catch (e) {
    ctx = await browser.newContext();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'storage_state.json'), 'utf8'));
    const cookies = (raw.cookies || []).filter((c) => String(c.domain || '').includes('capcut.com'));
    const added = await ctx.cookies();
    if (!added.length || cookies.some((c) => !added.some((a) => a.name === c.name))) {
      await ctx.addCookies(cookies);
    }
  } catch (e) {}
  return { browser, ctx };
}

async function remoteSearch(query, count = 20) {
  const { browser, ctx } = await remoteCtx();
  const page = await ctx.newPage();
  try { await page.setViewportSize({ width: 1600, height: 1000 }); } catch (e) {}
  const seen = new Set();
  const out = [];
  const onResp = async (r) => {
    if (!String(r.url()).includes('/search_templates')) return;
    try {
      const j = await r.json();
      for (const t of ((j.data && j.data.video_templates) || [])) {
        if (!t) continue;
        const id = String(t.web_id || t.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(mapSearchItem(id, t));
      }
    } catch (e) {}
  };
  page.on('response', onResp);
  try {
    await page.goto('https://www.capcut.com/template-explorer?enter_from=page_header', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(9000);
    try { await page.keyboard.press('Escape'); } catch (e) {}
    const box = page.locator('input[placeholder="Search templates"]').first();
    let used = false;
    try { await box.waitFor({ state: 'visible', timeout: 25000 }); used = true; } catch (e) {}
    if (used) {
      await box.click().catch(() => {});
      await box.fill(query).catch(() => {});
    } else {
      await page.evaluate((q) => {
        const el = document.querySelector('input[placeholder="Search templates"]');
        if (el) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          if (setter) setter.call(el, q);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, query).catch(() => {});
    }
    await page.keyboard.press('Enter').catch(() => {});
    if (!used) await page.keyboard.press('Enter').catch(() => {});
    const deadline = Date.now() + 45000;
    const t0 = Date.now();
    let gained = 0, stall = 0;
    while (Date.now() < deadline && out.length < count) {
      try { await page.waitForTimeout(900); } catch (e) { break; }
      try { await page.mouse.wheel(0, 3200); } catch (e) { break; }
      if (out.length !== gained) { gained = out.length; stall = 0; }
      else if (out.length > 0) {
        stall++;
        if (stall >= 8 || (stall >= 3 && Date.now() - t0 > 25000)) break;
      }
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  if (!out.length) throw new Error('remote search tidak mengembalikan hasil');
  return out.slice(0, Math.min(count, 100));
}

async function remoteFyp(count = 20) {
  const { browser, ctx } = await remoteCtx();
  const page = await ctx.newPage();
  try { await page.setViewportSize({ width: 1600, height: 1000 }); } catch (e) {}
  try {
    await page.goto('https://www.capcut.com/template', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    let cards = [];
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try { await page.waitForTimeout(2500); } catch (e) { break; }
      cards = await page.locator('a[href*="/template-detail/"]').evaluateAll((as) => {
        const out = [];
        const shown = new Set();
        for (const a of as) {
          const href = String(a.href);
          const parts = href.split('/').filter(Boolean);
          const id = parts.pop();
          if (!/^\d{6,}$/.test(id) || shown.has(id)) continue;
          shown.add(id);
          const img = a.querySelector('img');
          const v = a.querySelector('video source');
          const usageEl = a.querySelector('._S7HdC');
          const durEl = a.querySelector('.WM4mcE');
          out.push({
            id,
            author: parts[parts.length - 1] || '',
            title: (a.getAttribute('aria-label') || '').replace(/^View template:\s*/i, '').trim(),
            cover: img ? img.src : '',
            video: v ? v.src : '',
            usage_text: usageEl ? usageEl.textContent.trim() : '',
            duration_text: durEl ? durEl.textContent.trim() : '',
          });
        }
        return out;
      }).catch(() => []);
      if (cards.length) break;
    }
    if (!cards.length) throw new Error('fyp remote kosong');
    return cards.slice(0, Math.min(count, 120));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function withRemoteLock(fn, label) {
  if (remoteBusy) throw new Error('cari lagi nanti — search/fyp sedang berjalan');
  remoteBusy = true;
  try {
    const gap = Math.max(0, REMOTE_GAP_MS - (Date.now() - lastRemoteHit));
    if (gap) await new Promise((r) => setTimeout(r, gap));
    const res = await fn();
    lastRemoteHit = Date.now();
    console.log(`[remote] ${label} → ${Array.isArray(res) ? res.length : ''} hasil`);
    return res;
  } finally {
    remoteBusy = false;
  }
}

function loadRequests() {
  try { return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8')); } catch (e) { return []; }
}

function saveRequests(reqs) {
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(reqs, null, 2));
}

function loadTemplateInfo() {
  try {
    const raw = JSON.parse(fs.readFileSync(TEMPLATE_INFO_FILE, 'utf8'));
    const ids = new Set(listTemplates().map((t) => String(t.id)));
    for (const k of Object.keys(raw)) if (!ids.has(String(k))) delete raw[k];
    return raw;
  } catch (e) { return {}; }
}

function saveTemplateInfo(info) {
  fs.writeFileSync(TEMPLATE_INFO_FILE, JSON.stringify(info, null, 2));
  try {
    fs.mkdirSync(INFO_STORAGE_DIR, { recursive: true });
    const seen = {};
    for (const [id, entry] of Object.entries(info)) {
      if (!entry || !id) continue;
      seen[id] = 1;
      try { fs.writeFileSync(path.join(INFO_STORAGE_DIR, `${String(id).replace(/[^a-z0-9_-]/gi, '')}.json`), JSON.stringify(entry, null, 2)); } catch (e) {}
    }
    for (const f of fs.readdirSync(INFO_STORAGE_DIR)) {
      if (!seen[f.replace(/\.json$/, '')]) {
        try { fs.unlinkSync(path.join(INFO_STORAGE_DIR, f)); } catch (e) {}
      }
    }
  } catch (e) {
    console.error('gagal simpan info ke storage:', e.message);
  }
}

function loadStoredInfo(id) {
  try {
    const p = path.join(INFO_STORAGE_DIR, `${String(id).replace(/[^a-z0-9_-]/gi, '')}.json`);
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return j && j.id ? j : null;
    }
  } catch (e) {}
  return null;
}

function mediaPaths(id) {
  const safe = String(id).replace(/[^a-z0-9_-]/gi, '') || String(id).replace(/\D/g, '');
  const dir = path.join(MEDIA_STORAGE_DIR, safe);
  return {
    dir,
    video: path.join(dir, 'example.mp4'),
    cover: path.join(dir, 'cover.jpg'),
    coverSmall: path.join(dir, 'cover_small.jpg'),
  };
}

async function downloadToFile(url, file) {
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'referer': 'https://www.capcut.com/' }, redirect: 'follow' }, 120000);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('file terlalu kecil: ' + buf.length);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

async function ensureLocalTemplateMedia(id, info) {
  if (!info || !id) return info;
  const m = mediaPaths(id);
  const already = (info.example_video && String(info.example_video.url).startsWith('/api/media/')) && fs.existsSync(m.video);
  const coversOk = !info.cover_url || String(info.cover_url).startsWith('/api/media/') || fs.existsSync(m.cover);
  if (already && coversOk) return info;

  const oldEx = info.example_video && (info.example_video.origin_url || info.example_video.url);
  const oldCover = info.cover_url;
  const oldCoverSmall = info.cover_url_small;
  const ops = [];
  if (oldEx && !fs.existsSync(m.video)) ops.push(downloadToFile(oldEx, m.video).catch(() => {}));
  if (oldCover && !fs.existsSync(m.cover)) ops.push(downloadToFile(oldCover, m.cover).catch(() => {}));
  if (oldCoverSmall && String(oldCoverSmall) !== String(oldCover) && !fs.existsSync(m.coverSmall)) {
    ops.push(downloadToFile(oldCoverSmall, m.coverSmall).catch(() => {}));
  }
  await Promise.all(ops);

  if (fs.existsSync(m.video) && oldEx && info.example_video) {
    const { origin_url, ...rest } = info.example_video;
    info.example_video = { ...rest, url: `/api/media/${path.basename(m.dir)}/example.mp4`, origin_url: oldEx };
  }
  if (fs.existsSync(m.cover) && oldCover) info.cover_url = `/api/media/${path.basename(m.dir)}/cover.jpg`;
  if (fs.existsSync(m.coverSmall) && oldCoverSmall) info.cover_url_small = `/api/media/${path.basename(m.dir)}/cover_small.jpg`;
  info._localized = new Date().toISOString();
  return info;
}

function isCacheValid(entry) {
  if (!entry || !entry._cached_at) return false;
  return (Date.now() - new Date(entry._cached_at).getTime()) < CACHE_TTL_MS;
}

const app = new Hono();

app.use('*', async (c, next) => {
  const t0 = Date.now();
  const ip = clientIp(c);
  const ua = (c.req.header('user-agent') || '').replace(/[\s\x00-\x1f]+/g, ' ').trim().slice(0, 90);
  await next();
  const status = c.res && typeof c.res.status === 'number' ? c.res.status : 200;
  console.log(`[req] ${c.req.method} ${c.req.path} ${status} ${Date.now() - t0}ms ip=${ip} ua=${ua || '-'}`);
});

const WEB_EXEMPT = (p) =>
  p.startsWith('/api/admin') || p.startsWith('/v1') || p === '/docs' || p === '/admin';

app.use('/api/*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Origin, x-requested-with');
  c.header('Access-Control-Max-Age', '86400');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  return next();
});

async function webGuard(c, next) {
  if (WEB_EXEMPT(c.req.path)) return next();
  if (c.req.method === 'OPTIONS') return next();
  const ip = clientIp(c);
  const r = sec.ensureWeb(ip, c.req.header('cookie'));
  if (!r.ok) {
    if (r.reason === 'ip-diff') return c.json({ error: 'sesi tidak valid untuk IP ini' }, 403);
    return c.json({ error: 'sesi kedaluwarsa' }, 401);
  }
  if (r.fresh) c.header('set-cookie', sec.cookieSet(sec.COOKIE_NAME, r.token, 86400));
  c.set('web', { token: r.token, session: r.session });
  return next();
}
app.use('*', webGuard);

/* deklarasi helper admin password */
const ADMIN_PASS =
  process.env.ADMIN_PASS ||
  (fs.existsSync(path.join(DIR, 'admin-pass.txt'))
    ? fs.readFileSync(path.join(DIR, 'admin-pass.txt'), 'utf8').trim()
    : null) ||
  (() => {
    const p = crypto.randomBytes(8).toString('hex');
    try { fs.writeFileSync(path.join(DIR, 'admin-pass.txt'), p, { mode: 0o600 }); } catch (e) {}
    console.log('### ADMIN_PASS tidak di-set — buat otomatis, lihat /root/web/admin-pass.txt');
    return p;
  })();
(async () => {
  if (process.argv[2] !== '--info') return;
  console.log('ADMIN_PASS = ' + ADMIN_PASS);
})();

async function adminGuard(c, next) {
  const p = c.req.path;
  if (p === '/api/admin/login' || p === '/api/admin/logout' || p === '/api/admin/session') return next();
  const ip = clientIp(c);
  const r = sec.admSession(ip, c.req.header('cookie'));
  if (r === true) return next();
  if (r === 'ip-diff') return c.json({ error: 'sesi admin tidak valid untuk IP ini' }, 403);
  return c.json({ error: 'belum login' }, 401);
}
app.use('/api/admin/*', adminGuard);

function apiKeyFrom(c) {
  return c.req.header('x-api-key') || c.req.query('api_key');
}

async function v1Guard(c, next) {
  const key = sec.findKey(apiKeyFrom(c));
  if (key) { c.set('apikey', key); return next(); }
  if (c.req.method !== 'GET') return next();
  const g = sec.globalLimit();
  c.header('X-GenCap-Limit', 'global:6');
  c.header('X-RateLimit-Remaining', String(g.ok ? g.remaining : 0));
  if (!g.ok) {
    c.header('Retry-After', String(g.retry));
    return c.json({ error: `limit global tercapai (6/menit dipakai bareng) — tunggu ${g.retry}s`, retry_after: g.retry }, 429);
  }
  return next();
}
app.use('/v1/*', v1Guard);

app.use('/api/files/uploads/*', serveStatic({ root: UPLOAD_DIR, rewriteRequestPath: (p) => p.replace(/^\/api\/files\/uploads/, '') }));
app.use('/api/files/*', serveStatic({ root: TASKS_DIR, rewriteRequestPath: (p) => p.replace(/^\/api\/files/, '') }));

app.onError((err, c) => {
  console.error(`[http] error ${c.req.method} ${c.req.path}: ${err.message}`);
  return c.json({ error: err.message }, 500);
});

app.notFound((c) => c.json({ error: 'route tidak ditemukan' }, 404));

app.on(['POST', 'GET'], '/api/search-templates', async (c) => {
  let query = '';
  let count = 20;
  let page = 1;
  let perPage = 20;
  let captchaToken = null;
  if (c.req.method === 'POST') {
    const body = await c.req.json().catch(() => ({}));
    query = String(body.query || '').trim();
    count = Number(body.count) || 20;
    page = Number(body.page) || 1;
    perPage = Number(body.per_page) || 20;
    captchaToken = String(body.captcha_token || '');
  } else {
    query = String(c.req.query('q') || '').trim();
    count = Number(c.req.query('count')) || 20;
    page = Number(c.req.query('page')) || 1;
    perPage = Number(c.req.query('per_page')) || 20;
    captchaToken = String(c.req.query('captcha_token') || '');
  }
  if (!query) return c.json({ error: 'isi kata kunci pencarian (?q= atau body query)' }, 400);
  const ip = clientIp(c);
  const hr = humanRequired(c, captchaToken, 'search');
  if (hr) return c.json({ error: 'verifikasi manusia diperlukan sebelum mencari', need_captcha: true, reason: hr }, 403);

  const rl = sec.rateLimit(ip, 'search', 4, 60 * 1000);
  if (!rl.ok) {
    c.header('Retry-After', String(rl.retry));
    return c.json({ error: `terlalu banyak pencarian (maks 4/menit) — tunggu ${rl.retry}s`, retry_after: rl.retry }, 429);
  }
  const last = searchCooldown.get(ip) || 0;
  if (Date.now() - last < 2500) return c.json({ error: 'tunggu sebentar sebelum mencari lagi', wait: 2500 - (Date.now() - last) }, 429);
  searchCooldown.set(ip, Date.now());

  perPage = Math.max(1, Math.min(perPage, 100));
  let items = cachedSearch(query);
  if (!items) {
    const target = Math.max(perPage, Math.min(count, 100));
    try {
      try {
        items = await withRemoteLock(() => remoteSearch(query, target), `search "${query}"`);
      } catch (eRemote) {
        console.error(`[remote] search "${query}" gagal, fallback API lama:`, eRemote.message.slice(0, 80));
        items = await capcutTemplateSearch(query, target);
      }
    } catch (e) {
      return c.json({ error: 'pencarian gagal: ' + e.message }, 502);
    }
    storeSearch(query, items);
  }
  const pg = paginate(items, page, perPage);
  return c.json({ ok: true, query, ...pg });
});

app.get('/api/fyp', async (c) => {
  const count = Number(c.req.query('count')) || 20;
  const page = Number(c.req.query('page')) || 1;
  const perPage = Number(c.req.query('per_page')) || 20;
  const captchaToken = String(c.req.query('captcha_token') || '');
  const ip = clientIp(c);
  const hr = humanRequired(c, captchaToken, 'search');
  if (hr) return c.json({ error: 'verifikasi manusia diperlukan sebelum melihat For You', need_captcha: true, reason: hr }, 403);

  const rl = sec.rateLimit(ip, 'fyp', 4, 60 * 1000);
  if (!rl.ok) {
    c.header('Retry-After', String(rl.retry));
    return c.json({ error: `terlalu sering buka For You (maks 4/menit) — tunggu ${rl.retry}s`, retry_after: rl.retry }, 429);
  }

  const pc = Math.max(1, Math.min(perPage, 100));
  let items = (fypResultCache.items && Date.now() - fypResultCache.at < FYP_CACHE_TTL) ? fypResultCache.items : null;
  if (!items) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        items = await withRemoteLock(() => remoteFyp(Math.min(count, 120)), `fyp${attempt > 1 ? '-retry' : ''}`);
        fypResultCache.items = items;
        fypResultCache.at = Date.now();
        break;
      } catch (e) {
        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        return c.json({ error: 'fyp gagal: ' + e.message }, 502);
      }
    }
  }
  const pg = paginate(items, page, pc);
  return c.json({ ok: true, ...pg });
});

app.post('/api/template-requests', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const t = body.template;
  if (!t || !t.id || !t.title) return c.json({ error: 'template tidak lengkap' }, 400);
  const ip = clientIp(c);

  const hr = humanRequired(c, String(body.captcha_token || ''), 'request');
  if (hr) return c.json({ error: 'verifikasi manusia diperlukan sebelum mengirim request', need_captcha: true, reason: hr }, 403);

  const rl = sec.rateLimit(ip, 'req', 6, 2 * 60 * 1000);
  if (!rl.ok) {
    c.header('Retry-After', String(rl.retry));
    return c.json({ error: `terlalu banyak request — tunggu ${rl.retry}s`, retry_after: rl.retry }, 429);
  }

  const id = String(t.id);
  const info = loadTemplateInfo()[id] || loadStoredInfo(id);
  if (info && info.ccweb_available === false) {
    return c.json({ error: 'template ini hanya tersedia di aplikasi CapCut — tidak bisa diminta render' }, 409);
  }

  const dayStart = new Date().setHours(0, 0, 0, 0);
  const reqs = loadRequests();
  const today = reqs.filter((r) => r.requested_at && new Date(r.requested_at).getTime() >= dayStart && r.ip === ip);
  if (today.length >= 5) return c.json({ error: 'maks 5 request per hari per IP' }, 429);
  const item = {
    id: crypto.randomUUID(),
    requested_at: new Date().toISOString(),
    ip,
    template: {
      id,
      title: String(t.title).slice(0, 160),
      cover: String(t.cover || ''),
      author: String(t.author || ''),
      username: String(t.username || ''),
      link: String(t.link || ''),
    },
  };
  reqs.push(item);
  saveRequests(reqs);
  console.log(`[request-template] ip=${ip} id=${item.template.id} "${item.template.title}"`);
  notifyRequest(item).catch((e) => console.error('[bot] notif gagal:', e.message));
  return c.json({ ok: true, message: 'Request terkirim ke owner — akan dicek secepatnya' });
});

app.get('/api/template-info', async (c) => {
  const cache = loadTemplateInfo();
  let updated = false;
  for (const t of listTemplates()) {
    if (isCacheValid(cache[t.id])) continue;
    const stored = loadStoredInfo(t.id);
    if (stored) {
      cache[t.id] = stored;
      updated = true;
      continue;
    }
    try {
      const info = await scrape(t.id);
      info.id = t.id;
      info.photos_required = t.photos_required;
      info._cached_at = new Date().toISOString();
      cache[t.id] = info;
      updated = true;
    } catch (e) {
      // biarkan entry lama jika ada; skip jika belum ada
    }
  }
  if (updated) saveTemplateInfo(cache);
  return c.json({ count: Object.keys(cache).length, templates: cache });
});

app.get('/api/template-info/:id', async (c) => {
  const id = String(c.req.param('id')).replace(/\D/g, '');
  if (!id) return c.json({ error: 'id template tidak valid' }, 400);
  const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true';
  const inCatalog = listTemplates().some((t) => String(t.id) === String(id));
  const cache = loadTemplateInfo();
  if (isCacheValid(cache[id]) && !refresh) {
    try { await ensureLocalTemplateMedia(id, cache[id]); } catch (e) {}
    if (cache[id] && cache[id]._localized) saveTemplateInfo(cache);
    return c.json({ template: { ...cache[id], in_catalog: inCatalog }, cached: true });
  }
  if (!refresh) {
    const stored = loadStoredInfo(id);
    if (stored) {
      try { await ensureLocalTemplateMedia(id, stored); } catch (e) {}
      cache[id] = stored;
      saveTemplateInfo(cache);
      return c.json({ template: { ...stored, in_catalog: inCatalog }, cached: true, fromStorage: true });
    }
  }
  try {
    const info = await scrape(id);
    info.id = id;
    info._cached_at = new Date().toISOString();
    try { await ensureLocalTemplateMedia(id, info); } catch (e) {}
    cache[id] = info;
    saveTemplateInfo(cache);
    return c.json({ template: { ...info, in_catalog: inCatalog }, cached: false });
  } catch (e) {
    return c.json({ error: 'info template tidak ditemukan: ' + e.message }, 404);
  }
});

const MEDIA_ALLOW = { 'example.mp4': 'video/mp4', 'cover.jpg': 'image/jpeg', 'cover_small.jpg': 'image/jpeg' };
app.get('/api/media/:id/:file', (c) => {
  const id = String(c.req.param('id')).replace(/[^a-z0-9_-]/gi, '');
  const file = String(c.req.param('file'));
  const mime = MEDIA_ALLOW[file];
  if (!id || !mime) return c.json({ error: 'media tidak valid' }, 404);
  const fp = path.join(MEDIA_STORAGE_DIR, id, file);
  if (!fs.existsSync(fp)) return c.json({ error: 'media tidak ditemukan' }, 404);
  const st = fs.statSync(fp);
  const range = c.req.header('range');
  let start = 0, end = st.size - 1;
  if (range) {
    const m = String(range).match(/bytes=(\d*)-(\d*)/);
    if (m) {
      if (m[1] !== '') start = parseInt(m[1], 10);
      if (m[2] !== '') end = parseInt(m[2], 10);
    }
    if (start > end || start >= st.size) return c.body(null, 416, { 'Content-Range': `bytes */${st.size}` });
    end = Math.min(end, st.size - 1);
  }
  const len = end - start + 1;
  const buf = fs.readFileSync(fp).subarray(start, end + 1);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(len),
    'Cache-Control': 'public, max-age=86400',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  return c.body(ab, range ? 206 : 200, headers);
});

app.get('/list', (c) => {
  const templates = listTemplates();
  return c.json({ count: templates.length, templates });
});

app.get('/api/templates', (c) => {
  const info = loadTemplateInfo();
  const templates = listTemplates().map((t) => {
    const inf = info[String(t.id)] || loadStoredInfo(String(t.id));
    const out = { ...t };
    if (inf && inf.ccweb_available === false) out.ccweb_available = false;
    return out;
  });
  return c.json({ count: templates.length, templates });
});

async function parseCreate(c) {
  const ct = c.req.header('content-type') || '';
  let template_id;
  let images = null;
  let files = [];
  let captcha_token = null;
  const cl = parseInt(c.req.header('content-length') || '0', 10);
  if (cl > MAX_UPLOAD_BYTES) return { err: 'upload terlalu besar', code: 413 };
  if (ct.includes('multipart/form-data')) {
    const parsed = await c.req.parseBody({ all: true });
    template_id = parsed['template_id'];
    captcha_token = parsed['captcha_token'];
    const imgs = parsed['images'];
    files = Array.isArray(imgs) ? imgs : (imgs ? [imgs] : []);
  } else {
    const body = await c.req.json().catch(() => ({}));
    template_id = body.template_id;
    images = body.images;
    captcha_token = body.captcha_token;
  }
  return { template_id, images, files, captcha_token };
}

async function finishCreate(c, ip, { template_id, images, files }) {
  const tpl = listTemplates().find(t => String(t.id) === String(template_id));
  if (!tpl) return c.json({ error: `template tidak terdaftar: ${template_id}` }, 400);

  const avail = await templateRenderable(String(tpl.id));
  if (!avail.ok) {
    if (avail.reason === 'app-only') {
      return c.json({ error: 'template ini hanya tersedia di aplikasi CapCut — tidak bisa dirender via web' }, 409);
    }
    return c.json({ error: 'template tidak ditemukan di CapCut Web (mungkin dihapus/private) — coba template lain' }, 409);
  }

  const task = {
    id: uid(),
    ip,
    template_id: String(tpl.id),
    template_title: tpl.title,
    photos_required: tpl.photos_required,
    images: [],
    images_local: [],
    status: 'queued',
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    result: null,
    error: null,
  };

  if (files.length) {
    if (files.length !== tpl.photos_required) {
      return c.json({ error: `template ini butuh ${tpl.photos_required} foto, dikirim ${files.length}` }, 400);
    }
    const dir = path.join(TASKS_DIR, task.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const mimeExt = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg' };
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const buf = Buffer.from(await f.arrayBuffer());
      const ext = mimeExt[f.type] || (f.name ? (String(f.name).match(/\.(jpe?g|png|webp|gif|heic|heif)/i)?.[1] || 'jpeg') : 'jpeg');
      const file = path.join(dir, `img${i + 1}.${ext}`);
      fs.writeFileSync(file, buf);
      task.images.push(f.name || `img${i + 1}.${ext}`);
      task.images_local.push(file);
    }
  } else {
    if (!Array.isArray(images)) return c.json({ error: 'kirim file gambar (form-data, field "images") atau array URL' }, 400);
    if (images.length !== tpl.photos_required) {
      return c.json({ error: `template ini butuh ${tpl.photos_required} foto, dikirim ${images.length}` }, 400);
    }
    for (const u of images) {
      if (!/^https?:\/\//.test(u)) return c.json({ error: 'URL image tidak valid: ' + String(u).slice(0, 80) }, 400);
    }
    task.images = images;
  }

  tasks.push(task);
  saveTasks();
  preloadTemplateAudio(String(tpl.id));
  enqueue(task);
  return c.json({ task: taskWithHost(task, c) }, 201);
}

app.post('/api/tasks', async (c) => {
  const ip = clientIp(c);
  const lr = sec.webLimit(ip);
  if (!lr.ok) {
    c.header('Retry-After', String(lr.retry));
    return c.json({ error: `terlalu banyak permintaan (maks 3 per 2 menit per IP) — tunggu ${lr.retry} detik`, retry_after: lr.retry }, 429);
  }
  let p;
  try {
    p = await parseCreate(c);
    if (p.err) return c.json({ error: p.err }, p.code);
  } catch (e) { return c.json({ error: e.message }, 400); }

  const token = p.captcha_token || null;
  const cap = sec.humanOrCaptcha(c.get('web') && c.get('web').token, token, ip, 'create');
  if (!cap.ok) return c.json({ error: `verifikasi manusia gagal (captcha): ${cap.reason}` }, 403);

  try {
    return await finishCreate(c, ip, p);
  } catch (err) {
    console.error(`[http] POST /api/tasks error: ${err.message}`);
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/captcha', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let action = String(body.action || c.req.query('action') || 'create');
  if (!['human', 'create', 'search', 'request'].includes(action)) action = 'create';
  const token = sec.issueCaptcha(clientIp(c), action);
  return c.json({ token, ttl: 300, action });
});

app.get('/api/verify/human', (c) => {
  const web = c.get('web');
  return c.json({ human: !!(web && sec.isHuman(web.token)) });
});

app.post('/api/verify/human', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const web = c.get('web');
  if (web && sec.isHuman(web.token)) return c.json({ ok: true, already: true });
  const cap = sec.consumeCaptcha(String(body.token || ''), clientIp(c), 'human');
  if (!cap.ok) return c.json({ error: `verifikasi captcha gagal: ${cap.reason}` }, 403);
  if (web) sec.setHuman(web.token);
  return c.json({ ok: true });
});

app.get('/api/tasks', (c) => {
  return c.json({ count: tasks.length, tasks: tasks.map(t => taskWithHost(t, c)) });
});

app.get('/api/tasks/:id', (c) => {
  const task = tasks.find(t => t.id === c.req.param('id'));
  if (!task) return c.json({ error: 'task tidak ditemukan' }, 404);
  return c.json({ task: taskWithHost(task, c) });
});

/* ================= Public API /v1 ================= */
app.get('/v1/templates', (c) => {
  const templates = listTemplates();
  return c.json({ count: templates.length, templates });
});

app.get('/v1/templates/:id/info', async (c) => {
  const id = String(c.req.param('id')).replace(/\D/g, '');
  if (!id) return c.json({ error: 'id template tidak valid' }, 400);
  const cache = loadTemplateInfo();
  if (isCacheValid(cache[id])) return c.json({ template: cache[id], cached: true });
  try {
    const info = await scrape(id);
    info.id = id; info._cached_at = new Date().toISOString();
    cache[id] = info; saveTemplateInfo(cache);
    return c.json({ template: info, cached: false });
  } catch (e) {
    return c.json({ error: 'info template tidak ditemukan: ' + e.message }, 404);
  }
});

app.get('/v1/tasks/:id', (c) => {
  const task = tasks.find(t => t.id === c.req.param('id'));
  if (!task) return c.json({ error: 'task tidak ditemukan' }, 404);
  return c.json({ task: taskWithHost(task, c) });
});

app.post('/v1/tasks', async (c) => {
  const key = c.get('apikey');
  const ip = clientIp(c);
  if (!key) {
    const g = sec.globalPostLimit();
    if (!g.ok) {
      c.header('Retry-After', String(g.retry));
      return c.json({ error: `limit global generate tercapai (2/menit dipakai bareng) — tunggu ${g.retry} detik`, retry_after: g.retry }, 429);
    }
  }
  let p;
  try {
    p = await parseCreate(c);
    if (p.err) return c.json({ error: p.err }, p.code);
  } catch (e) { return c.json({ error: e.message }, 400); }
  try {
    return await finishCreate(c, ip, p);
  } catch (err) {
    console.error(`[http] POST /v1/tasks error: ${err.message}`);
    return c.json({ error: err.message }, 500);
  }
});

/* ================= Admin API (khusus owner) ================= */
app.post('/api/admin/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!ADMIN_PASS || String(body.password) !== String(ADMIN_PASS)) {
    return c.json({ error: 'password salah' }, 401);
  }
  const ip = clientIp(c);
  const t = sec.loginAdmin(ip);
  c.header('set-cookie', sec.cookieSet(sec.ADM_COOKIE, t, 86400));
  return c.json({ ok: true, loggedIn: true });
});

app.post('/api/admin/logout', (c) => {
  sec.logoutAdmin(c.req.header('cookie'));
  c.header('set-cookie', sec.cookieSet(sec.ADM_COOKIE, '', 0));
  return c.json({ ok: true });
});

app.get('/api/admin/session', (c) => {
  const ip = clientIp(c);
  const r = sec.admSession(ip, c.req.header('cookie'));
  return c.json({ loggedIn: r === true });
});

app.get('/api/admin/keys', (c) => {
  return c.json({ keys: sec.listKeys() });
});

app.post('/api/admin/keys', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { key, rec } = sec.createKey(body);
  return c.json({ key, key_id: rec.id }, 201);
});

app.post('/api/admin/keys/:id/revoke', (c) => {
  const r = sec.revokeKey(c.req.param('id'));
  if (!r) return c.json({ error: 'key tidak ditemukan' }, 404);
  return c.json({ ok: true, revoked: r.id });
});

/* ================= Docs & Admin HTML ================= */
const DOCS_HTML = fs.existsSync(path.join(DIR, 'assets/docs.html'))
  ? fs.readFileSync(path.join(DIR, 'assets/docs.html'), 'utf8')
  : '<h1>docs belum siap</h1>';
const ADMIN_HTML = fs.existsSync(path.join(DIR, 'assets/admin.html'))
  ? fs.readFileSync(path.join(DIR, 'assets/admin.html'), 'utf8')
  : '<h1>admin belum siap</h1>';

app.get('/docs', (c) => c.html(DOCS_HTML));
app.get('/admin', (c) => c.html(ADMIN_HTML));

const FRONTEND_DIR = path.join(DIR, 'frontend', 'dist');
const FE_INDEX = path.join(FRONTEND_DIR, 'index.html');
const hasFrontend = fs.existsSync(FE_INDEX);

if (hasFrontend) {
  app.use('*', serveStatic({ root: FRONTEND_DIR }));
  app.get('*', (c) => {
    const p = c.req.path;
    if (p.startsWith('/api/') || p.startsWith('/list') || p.startsWith('/v1') || p === '/docs' || p === '/admin') return c.json({ error: 'route tidak ditemukan' }, 404);
    return c.html(fs.readFileSync(FE_INDEX, 'utf8'));
  });
}

/* ================= Auto-sync storage template (video + info) ================= */
const SYNC_GAP_MS = 2000;
let storageSyncing = false;
let storageFp = '';

function storageFingerprint() {
  return listTemplates().map((t) => String(t.id)).sort().join('|');
}

function resetTemplateStorage() {
  let n = 0;
  for (const sub of [INFO_STORAGE_DIR, MEDIA_STORAGE_DIR]) {
    if (!fs.existsSync(sub)) continue;
    for (const f of fs.readdirSync(sub)) {
      try { fs.rmSync(path.join(sub, f), { recursive: true, force: true }); n++; } catch (e) {}
    }
  }
  return n;
}

async function syncTemplateStorage() {
  if (storageSyncing) return { ok: false, error: 'sync sedang berjalan', baru: 0, gagal: 0, sudah_ada: 0 };
  storageSyncing = true;
  try {
    const list = listTemplates();
    console.log(`[storage] sync mulai: ${list.length} template (jeda 2 detik per template)`);
    const cache = loadTemplateInfo();
    let did = 0, fail = 0, fresh = 0;
    for (const t of list) {
      const id = String(t.id);
      const m = mediaPaths(id);
      const haveVid = fs.existsSync(m.video) && fs.statSync(m.video).size > 1000;
      const haveCover = fs.existsSync(m.cover);
      let info = isCacheValid(cache[id]) ? cache[id] : loadStoredInfo(id);
      if (haveVid && haveCover && info) { fresh++; continue; }
      try {
        const urlBasi = !haveVid && info && !info._no_video && info.example_video && (info.example_video.origin_url || info.example_video.url);
        if (urlBasi) info = null;
        if (!info) {
          info = await scrape(id);
          if (!info) throw new Error('scrape kosong');
          info.id = id;
          info._cached_at = new Date().toISOString();
        }
        await ensureLocalTemplateMedia(id, info);
        info.photos_required = t.photos_required != null ? t.photos_required : info.photos_required;
        if (!info._cached_at) info._cached_at = new Date().toISOString();
        const nowVid = fs.existsSync(m.video) && fs.statSync(m.video).size > 1000;
        if (!nowVid && !(info.example_video && (info.example_video.origin_url || info.example_video.url))) {
          info._no_video = true;
        }
        cache[id] = info;
        did++;
        console.log(`[storage] ${id} ${nowVid ? 'video+info' : 'info'}${info.title ? ' | ' + String(info.title).slice(0, 40) : ''}`);
      } catch (e) {
        fail++;
        console.log(`[storage] ${id} gagal: ${e.message.slice(0, 90)}`);
      }
      await new Promise((r) => setTimeout(r, SYNC_GAP_MS));
    }
    saveTemplateInfo(cache);
    const res = { ok: true, baru: did, gagal: fail, sudah_ada: fresh };
    console.log(`[storage] sync selesai: ${JSON.stringify(res)}`);
    return res;
  } finally {
    storageSyncing = false;
  }
}

function startStorageSyncJobs() {
  storageFp = storageFingerprint();
  setTimeout(() => { syncTemplateStorage().catch(() => {}); }, 120 * 1000).unref();
  setInterval(() => {
    try {
      const fp = storageFingerprint();
      if (fp !== storageFp) {
        storageFp = fp;
        console.log('[storage] templates.json berubah — sync template baru...');
        syncTemplateStorage().catch(() => {});
      }
    } catch (e) { console.error('[storage] watcher error:', e.message); }
  }, 5 * 60 * 1000).unref();
}

if (require.main === module) {
  if (process.argv[2] === '--reset-storage') {
    (async () => {
      const n = resetTemplateStorage();
      console.log(`[storage] reset: hapus ${n} item storage`);
      const res = await syncTemplateStorage();
      console.log('[storage] selesai CLI:', JSON.stringify(res));
      process.exit(0);
    })().catch((e) => { console.error('[storage] CLI gagal:', e.message); process.exit(1); });
    return;
  }
  const server = serve({ fetch: app.fetch, port: Number(PORT) }, (info) => {
    console.log(`capcut-api (hono) jalan di http://localhost:${info.port}`);
    console.log(`  GET  /list`);
    console.log(`  GET  /api/templates`);
    console.log(`  POST /api/tasks  (multipart form-data: template_id + files field "images" x3)`);
    console.log(`  GET  /api/tasks`);
    console.log(`  GET  /api/tasks/:id`);
    console.log(`  GET  /api/template-info`);
    console.log(`  GET  /docs   (API docs)`);
    console.log(`  GET  /admin  (kelola API key, owner)`);
    console.log(`  GET /v1/*    (public API; key=unlimited, tanpa key global 6/mnt)`);
    console.log(`  concurrency: ${CONCURRENCY}`);
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 120000;
  server.timeout = 180000;

  startStorageSyncJobs();

  const pending = [];
  const nowIso = new Date().toISOString();
  for (const t of tasks) {
    if (t.status === 'processing') {
      t.status = 'failed';
      t.error = `dibatalkan: server restart saat render sedang berjalan (${nowIso})`;
    } else if (t.status === 'queued') {
      pending.push(t);
    }
  }
  if (pending.length || tasks.some(t => t.status === 'failed' && t.error && t.error.startsWith('dibatalkan: server restart'))) saveTasks();
  for (const t of pending) enqueue(t);
}

function markInterruptedOnShutdown() {
  let dirty = false;
  const nowIso = new Date().toISOString();
  for (const t of tasks) {
    if (t.status === 'processing') {
      t.status = 'failed';
      t.error = `dibatalkan: server restart saat render sedang berjalan (${nowIso})`;
      dirty = true;
    }
  }
  if (dirty) saveTasks();
}

process.on('SIGINT', () => { try { markInterruptedOnShutdown(); } catch (e) {} process.exit(130); });
process.on('SIGTERM', () => { try { markInterruptedOnShutdown(); } catch (e) {} process.exit(143); });

process.on('uncaughtException', (err) => {
  try { fs.appendFileSync(path.join(DIR, 'server.log'), `[uncaughtException ${new Date().toISOString()}] ${err.stack || err.message}\n`); } catch (e) {}
  console.error('uncaughtException:', err);
});

process.on('unhandledRejection', (err) => {
  try { fs.appendFileSync(path.join(DIR, 'server.log'), `[unhandledRejection ${new Date().toISOString()}] ${err && (err.stack || err.message)}\n`); } catch (e) {}
  console.error('unhandledRejection:', err);
});

let notifyRequest = () => {};
let applyRequestAction = async () => ({ ok: false, error: 'bot nonaktif' });
let sendOwner = async () => {};
/* ---------- Telegram Bot ---------- */
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OWNER_TG_IDS = (process.env.OWNER_TG_ID || '')
  .split(',')
  .map((s) => String(s).trim())
  .filter(Boolean);

if (BOT_TOKEN && OWNER_TG_IDS.length) {
  const BOT_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
  let botOffset = 0;

  async function botCall(method, body = {}) {
    const r = await fetch(`${BOT_API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55000),
    });
    return r.json().catch(() => null);
  }

  const answerCallbackQuery = (id, text = '') => botCall('answerCallbackQuery', { callback_query_id: id, text });
  const sendChatAction = (chatId, action = 'typing') => botCall('sendChatAction', { chat_id: chatId, action });
  const sendMessage = (chatId, text, opts = {}) =>
    botCall('sendMessage', { chat_id: chatId, text, ...opts });
  const editMessageText = (chatId, messageId, text) =>
    botCall('editMessageText', { chat_id: chatId, message_id: messageId, text });
  const editMessageCaption = (chatId, messageId, text) =>
    botCall('editMessageCaption', { chat_id: chatId, message_id: messageId, caption: text });
  const editMessageReplyMarkup = (chatId, messageId) =>
    botCall('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: '' });

  async function botSendMedia(method, mediaUrl, chatId, caption, markup, localFile) {
    let buf;
    if (localFile) {
      buf = fs.readFileSync(localFile);
    } else {
      const dl = await fetch(mediaUrl, { headers: { 'User-Agent': BOT_UA }, signal: AbortSignal.timeout(45000) });
      if (!dl.ok) throw new Error('download media ' + dl.status);
      buf = Buffer.from(await dl.arrayBuffer());
    }
    const fd = new FormData();
    fd.append('chat_id', chatId);
    fd.append(method === 'sendVideo' ? 'video' : 'photo', new Blob([buf]), method === 'sendVideo' ? 'preview.mp4' : 'preview.jpg');
    fd.append('caption', caption);
    if (markup) fd.append('reply_markup', markup);
    const res = await fetch(`${BOT_API}/${method}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(65000) });
    const raw = await res.text();
    let body = null;
    try { body = JSON.parse(raw); } catch (e) {}
    if (body && !body.ok) console.error(`[bot] ${method} gagal: ${body.description || raw.slice(0, 200)}`);
    return body;
  }

  function formatUptime(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }

  async function sendInfo(chatId) {
    const tpl = listTemplates();
    const cache = loadTemplateInfo();
    const reqs = loadRequests();
    const pending = reqs.filter((r) => !r.status);
    const live = tasks.filter((t) => t.status === 'queued' || t.status === 'processing');
    const okToday = tasks.filter((t) => t.status === 'completed' && new Date(t.finished_at || 0).toDateString() === new Date().toDateString());
    const usage = Object.values(cache).reduce((s, i) => s + Number((i.stats || {})['Pemakaian (usage)'] || 0), 0);
    const text = [
      `📊 GenCap Web Info`,
      `🌐 cc.septia.eu.cc`,
      `-`,
      `🧩 Template: ${tpl.length}`,
      `👥 Total usage: ${usage.toLocaleString('id')}`,
      `⚙️ Task aktif: ${live.length}${live.length ? ' (' + live.map((t) => t.status).join(', ') + ')' : ''}`,
      `✅ Selesai hari ini: ${okToday.length}`,
      `📥 Request pending: ${pending.length}`,
      `-`,
      `⏱ Uptime: ${formatUptime(process.uptime())}`,
      `🕒 WIB: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
    ].join('\n');
    await sendMessage(chatId, text);
  }

  const keyboardMarkup = (uuid) => JSON.stringify({
    inline_keyboard: [[
      { text: '✅ Setuju', callback_data: `req:${uuid}:approve` },
      { text: '❌ Ditolak', callback_data: `req:${uuid}:reject` },
    ]],
  });

  notifyRequest = async (item) => {
    for (const owner of OWNER_TG_IDS) {
      const t = item.template;
      const caption = [
        `🆕 Permintaan Template`,
        `-`,
        `ID: ${t.id}`,
        `Judul: ${t.title}`,
        t.author ? `Author: ${t.author}` : null,
        `CapCut: ${t.link || 'https://www.capcut.com/template-detail/' + t.id}`,
        `-`,
        `IP: ${item.ip}`,
        `Waktu: ${new Date(item.requested_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
      ].filter(Boolean).join('\n');

      let info = null;
      let localVideo = null, localCover = null;
      try {
        info = await scrape(t.id);
        if (info) {
          const cache = loadTemplateInfo();
          info.id = t.id;
          if (!info.photos_required) info.photos_required = 3;
          info._cached_at = new Date().toISOString();
          await ensureLocalTemplateMedia(t.id, info).catch(() => {});
          cache[t.id] = info;
const kept = {};
    for (const t of list) { const k = String(t.id); if (cache[k]) kept[k] = cache[k]; }
    saveTemplateInfo(kept);
          const m = mediaPaths(t.id);
          if (fs.existsSync(m.video)) localVideo = m.video;
          if (fs.existsSync(m.cover)) localCover = m.cover;
        }
      } catch (e) {}
      const videoUrl = info && info.example_video && (info.example_video.origin_url || info.example_video.url);
      const coverUrl = (info && (info.cover_url || info.cover_url_small)) || t.cover;

      let sent = false;
      if (videoUrl || localVideo) {
        try {
          const r = await botSendMedia('sendVideo', videoUrl || '', owner, caption, keyboardMarkup(item.id), localVideo);
          sent = !!r && r.ok;
        } catch (e) {
          console.error('[bot] sendVideo gagal:', e.message);
        }
      }
      if (!sent && (coverUrl || localCover)) {
        try {
          const r = await botSendMedia('sendPhoto', coverUrl || '', owner, caption, keyboardMarkup(item.id), localCover);
          sent = !!r && r.ok;
        } catch (e) {
          console.error('[bot] sendPhoto gagal:', e.message);
        }
      }
      if (!sent) {
        await sendMessage(owner, caption, { reply_markup: keyboardMarkup(item.id) });
      }
      console.log(`[bot] notif request ${item.id} ke ${owner}${videoUrl && sent ? ' (video)' : sent ? ' (foto)' : ' (teks)'}`);
    }
  };

  applyRequestAction = async (uuid, action, reviewer) => {
    const reqs = loadRequests();
    const req = reqs.find((r) => r.id === uuid);
    if (!req) return { ok: false, error: 'Request tidak ditemukan.' };
    if (req.status) return { ok: false, error: 'Sudah diproses sebelumnya.', status: req.status };
    req.status = action === 'approve' ? 'approved' : 'rejected';
    req.status_at = new Date().toISOString();
    if (reviewer) req.reviewed_by = reviewer;
    if (action === 'approve') {
      let info = null;
      try { info = await scrape(req.template.id); } catch (e) {}
      const frag = (info && info.photos_required) || (info && info.fragment_count) || 3;
      const ttl = (info && info.title) || req.template.title || `Template ${req.template.id}`;
      const realId = (info && info.id) || req.template.id;
      const raw = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
      if (!raw[realId]) {
        raw[realId] = { id: realId, title: ttl, photos_required: frag };
        fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(raw, null, 2));
      }
      if (info) {
        const cache = loadTemplateInfo();
        info.id = realId;
        info.photos_required = frag;
        info.title = ttl;
        info._cached_at = new Date().toISOString();
        await ensureLocalTemplateMedia(realId, info).catch(() => {});
        cache[realId] = info;
        saveTemplateInfo(cache);
      }
      console.log(`[bot] DISETUJUI template ${req.template.id} -> templates.json (${frag} foto)`);
    } else {
      console.log(`[bot] DITOLAK template ${req.template.id}`);
    }
    saveRequests(reqs);
    return { ok: true, req };
  };

  async function processCallback(query) {
    const m = String(query.data || '').match(/^req:([a-f0-9-]+):(approve|reject)$/);
    if (!m) return;
    const uuid = m[1], action = m[2];
    if (!OWNER_TG_IDS.includes(String(query.from.id))) {
      return answerCallbackQuery(query.id, 'Hanya owner yang bisa menindak ini.');
    }
    const res = await applyRequestAction(uuid, action, query.from.id);
    if (!res.ok) {
      await answerCallbackQuery(query.id, res.error || 'gagal');
      return;
    }
    const req = res.req;

    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    const newMsg = `${action === 'approve' ? '✅ Disetujui — sudah masuk katalog.' : '❌ Ditolak owner.'}\n\n${req.template.title} (${req.template.id})`;
    if (query.message.video || query.message.photo) await editMessageCaption(chatId, msgId, newMsg);
    else await editMessageText(chatId, msgId, newMsg);
    await editMessageReplyMarkup(chatId, msgId);
    await answerCallbackQuery(query.id, action === 'approve' ? 'Template ditambahkan ✓' : 'Template ditolak');
    if (action === 'approve') {
      await sendMessage(chatId, `🟢 Template ${req.template.title} sudah aktif di web — muat ulang halaman untuk melihatnya.`);
    }
  }

  async function poll() {
    try {
      const r = await fetch(`${BOT_API}/getUpdates?offset=${botOffset}&timeout=30`);
      const data = await r.json();
      if (data && data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          botOffset = Math.max(botOffset, update.update_id + 1);
          if (update.callback_query) await processCallback(update.callback_query);
          const msg = update.message;
          if (msg && String(msg.text || '') === '/info' && OWNER_TG_IDS.includes(String(msg.from.id))) {
            await sendInfo(msg.chat.id);
          }
          if (msg && String(msg.text || '') === '/cekcookie' && OWNER_TG_IDS.includes(String(msg.from.id))) {
            await sendChatAction(msg.chat.id);
            try {
              const r = await checkAccountCookie();
              const line = [
                '🍪 Cek Cookie CapCut',
                `Status: ${r.ok ? '✅ Aman (login OK)' : '⚠️ Kadaluarsa / tidak login'}`,
                `Sesi domain: ${r.sessions}`,
                `Cookie: ${r.cookiesBefore} → ${r.cookiesAfter}`,
                `Dinavigasi: ${!r.navError ? 'OK' : 'gagal: ' + r.navError.slice(0, 60)}`,
                `Cek: ${new Date(r.at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
              ].join('\n');
              await sendMessage(msg.chat.id, line);
            } catch (e) {
              await sendMessage(msg.chat.id, 'Gagal cek cookie: ' + e.message.slice(0, 120));
            }
          }
        }
      }
    } catch (e) {
      console.error('[bot] poll error:', e.message);
    }
    setTimeout(poll, 1000);
  }
  poll();

  sendOwner = async (text) => { for (const owner of OWNER_TG_IDS) await sendMessage(owner, text).catch(() => {}); };

  setInterval(() => { for (const owner of OWNER_TG_IDS) sendInfo(owner).catch(() => {}); }, 5 * 60 * 60 * 1000);
  setTimeout(() => { for (const owner of OWNER_TG_IDS) sendInfo(owner).catch(() => {}); }, 60 * 1000);
  console.log(`[bot] Telegram bot aktif, owner: ${OWNER_TG_IDS.join(',')}`);
}

function cleanDebugDir() {
  if (!fs.existsSync(DEBUG_DIR)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(DEBUG_DIR)) {
    try { fs.rmSync(path.join(DEBUG_DIR, f), { recursive: true, force: true }); n++; } catch (e) {}
  }
  return n;
}

function cleanCacheOlder(ms) {
  if (!fs.existsSync(CACHE_DIR)) return { n: 0, bytes: 0 };
  const cutoff = Date.now() - ms;
  let n = 0, bytes = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const p = path.join(CACHE_DIR, f);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs < cutoff) { bytes += st.size; fs.unlinkSync(p); n++; }
    } catch (e) {}
  }
  return { n, bytes };
}

function cleanOldTasks(keep = 5) {
  if (!fs.existsSync(TASKS_DIR)) return { deleted: 0, remaining: 0, busy: 0 };
  const busy = new Set(tasks.filter((t) => t && (t.status === 'queued' || t.status === 'processing')).map((t) => t.id));
  const dirs = fs.readdirSync(TASKS_DIR)
    .map((name) => path.join(TASKS_DIR, name))
    .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } })
    .filter((p) => !busy.has(path.basename(p)))
    .sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (e) { return 0; } });
  let deleted = 0;
  for (const p of dirs.slice(keep)) {
    try { fs.rmSync(p, { recursive: true, force: true }); deleted++; } catch (e) {}
  }
  return { deleted, remaining: Math.min(dirs.length, keep), busy: busy.size };
}

async function maintenanceJob() {
  try {
    const d = cleanDebugDir();
    const c = cleanCacheOlder(THREE_DAYS_MS);
    const t = cleanOldTasks(5);
    console.log(`[auto] maintenance: debug ${d} file dihapus, cache ${c.n} (${(c.bytes / 1048576).toFixed(1)}MB), tasks del ${t.deleted} (sisa ${t.remaining}, aktif ${t.busy})`);
  } catch (e) {
    console.error('[auto] maintenance gagal:', e.message);
  }
}

async function accountCheckJob() {
  try {
    const r = await checkAccountCookie();
    console.log(`[auto] cek cookie CapCut: ${r.ok ? 'OK' : 'KADALUARSA'} (login=${r.loggedIn}, sesi=${r.sessions}, cookies ${r.cookiesBefore}->${r.cookiesAfter})`);
    if (!r.ok) {
      await sendOwner(`⚠️ Cookie CapCut bermasalah (login=${r.loggedIn}, sesi=${r.sessions}). Login ulang diperlukan — jalankan render sekali saja, atau perbarui storage_state.json.`);
    } else if (r.cookiesBefore !== r.cookiesAfter) {
      console.log('[auto] storage_state.json diperbarui (cookie refresh)');
    }
  } catch (e) {
    console.error('[auto] cek cookie gagal:', e.message);
  }
}

setInterval(maintenanceJob, THREE_DAYS_MS).unref();
setTimeout(maintenanceJob, 30 * 1000).unref();
setInterval(accountCheckJob, THREE_DAYS_MS).unref();
setTimeout(accountCheckJob, 3 * 60 * 1000).unref();

module.exports = { ensureAudio, audioLoudnessDb, downloadTemplateAudio, notifyRequest, applyRequestAction };
