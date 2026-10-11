const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { deleteTask } = require('./cc-api');
const {
  UA, viewport: BROWSER_VIEWPORT, headless: BROWSER_HEADLESS, storageState: STORAGE_STATE,
  maxMemoryMb: CHROMIUM_MAX_MB, minFreeMb: MIN_FREE_MB, launchArgs, editor: EDITOR, timeouts: T,
} = require('./browser');

let onLog = null;
const log = (m) => { if (onLog) onLog(m); };

let sharedBrowser = null;
let launching = null;

function chromiumRssMb() {
  try {
    if (!sharedBrowser || !sharedBrowser.isConnected()) return 0;
    const pid = sharedBrowser.process().pid;
    const statm = fs.readFileSync(`/proc/${pid}/statm`, 'utf8');
    const pages = parseInt(statm.split(' ')[1], 10);
    return (pages * 4) / 1024;
  } catch (e) {
    return 0;
  }
}

function systemFreeMb() {
  try {
    const mem = fs.readFileSync('/proc/meminfo', 'utf8');
    const m = mem.match(/MemAvailable:\s+(\d+)/);
    return m ? parseInt(m[1], 10) / 1024 : Infinity;
  } catch (e) {
    return Infinity;
  }
}

async function killBrowser(reason) {
  log('### tutup browser: ' + reason);
  try { await sharedBrowser.close(); } catch (e) {}
  sharedBrowser = null;
}

async function ensureBrowserHealthy() {
  if (launching) return;
  if (!sharedBrowser || !sharedBrowser.isConnected()) return;
  const rss = chromiumRssMb();
  if (rss > CHROMIUM_MAX_MB) {
    await killBrowser(`RSS chromium ${Math.round(rss)}MB > ${CHROMIUM_MAX_MB}MB`);
    return;
  }
  const free = systemFreeMb();
  if (free < MIN_FREE_MB) {
    await killBrowser(`RAM sistem tersisa ${Math.round(free)}MB < ${MIN_FREE_MB}MB`);
  }
}

async function getBrowser() {
  await ensureBrowserHealthy();
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  if (launching) return launching;
  launching = chromium.launch({
    headless: BROWSER_HEADLESS,
    args: launchArgs,
  });
  try {
    sharedBrowser = await launching;
    log('### browser chromium (persistent) siap');
  } catch (e) {
    launching = null;
    throw e;
  } finally {
    launching = null;
  }
  return sharedBrowser;
}

function editorUrl(templateId) {
  return `${EDITOR.base}${EDITOR.path.replace('%ID%', templateId)}`;
}

async function dismissAll(page, max = 12) {
  let closed = false;
  for (let k = 0; k < max; k++) {
    let hit = false;
    try {
      const btn = page.getByRole('button', { name: 'OK', exact: true }).first();
      if (await btn.count()) { await btn.click({ timeout: 2000 }); hit = true; }
    } catch (e) {}
    if (!hit) break;
    closed = true;
    await page.waitForTimeout(500);
  }
  return closed;
}

async function settleUploadDialogs(page) {
  // JANGAN pernah klik "Batch replace"/"Replace" — itu menimpakan 1 foto ke semua slot
  // dan menghapus hasil upload per-slot. cukup tutup/ack dialog.
  const labels = ['ok', 'done', 'confirm', 'got it', 'understood', 'close'];
  for (let k = 0; k < 60; k++) {
    const name = await page.evaluate((labels) => {
      for (const l of labels) {
        const b = [...document.querySelectorAll('button')].find((x) => {
          const t = (x.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
          return t === l && x.offsetWidth && !/batch\s*replace/.test(t);
        });
        if (b) return l;
      }
      return null;
    }, labels).catch(() => null);
    if (!name) break;
    const clicked = await page.evaluate((name) => {
      const b = [...document.querySelectorAll('button')].find((x) => {
        const t = (x.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return t === name && x.offsetWidth && !/batch\s*replace/.test(t);
      });
      if (!b) return false;
      b.scrollIntoView({ block: 'center', inline: 'center' }).catch(() => {});
      b.click();
      return true;
    }, name).catch(() => false);
    if (!clicked) break;
    log(`   dialog "${name}" ditutup (#${k + 1})`);
    await page.waitForTimeout(400);
  }
  // sisa dialog stubborn: tekan Escape beberapa kali untuk menutup dialog apapun yang menghalangi
  for (let k = 0; k < 12; k++) {
    const stuck = await page.evaluate(() => {
      // cek ada dialog/modal yang pakai tombol batch replace atau modal overlay aktif
      const hasModal = document.querySelector('[class*="modal"], [role="dialog"], .ant-modal, .cd-modal') || document.querySelector('.segment-item input[type=file]') === null; // dummy
      const b = [...document.querySelectorAll('button')].find((x) => {
        const t = (x.innerText || '').trim();
        if (/batch\s*replace/i.test(t)) return true;
        if (/replace\s*all|apply|confirm|ok/i.test(t) && x.offsetWidth > 50) return true;
        return false;
      });
      return !!b;
    }).catch(() => false);
    // pakai heuristic sederhana: lihat ada button yg kemungkinan dialog
    const hasDlg = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some(x => {
        const t = (x.innerText || '').trim().toLowerCase();
        return (t === 'ok' || t === 'done' || t === 'confirm' || t === 'got it' || /batch\s*replace/.test(t)) && x.offsetWidth > 40;
      });
    }).catch(() => false);
    if (!hasDlg) break;
    await page.keyboard.press('Escape').catch(() => {});
    log(`   tutup dialog paksa via Escape (#${k + 1})`);
    await page.waitForTimeout(500);
  }
}

async function clickButton(page, text, opts = {}) {
  return page.evaluate(({ text, opts }) => {
    const buttons = [...document.querySelectorAll('button')].filter(b => b.offsetWidth && (b.innerText || '').trim().toLowerCase() === text.toLowerCase());
    let t = buttons.find(b => {
      const r = b.getBoundingClientRect();
      if (opts.minY != null && r.y <= opts.minY) return false;
      if (opts.maxY != null && r.y >= opts.maxY) return false;
      if (opts.maxX != null && r.x >= opts.maxX) return false;
      return true;
    });
    if (!t && buttons.length) t = buttons[buttons.length - 1];
    if (t) { t.click(); return true; }
    return false;
  }, { text, opts });
}

async function clickAny(page, text, opts = {}) {
  const pt = await page.evaluate(({ text, opts }) => {
    const search = text.toLowerCase();
    const all = [...document.querySelectorAll('button, [role="button"], li, .export-item, .download-item, [class*="download"], [class*="Download"]')];
    const seen = new Set();
    const cands = [];
    for (const el of all) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const exact = t.toLowerCase() === search;
      const cont = opts.contains && t.toLowerCase().includes(search);
      if (!exact && !cont) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width && r.height)) continue;
      if (r.x < 0 || r.right > window.innerWidth || r.y < 0 || r.bottom > window.innerHeight) continue;
      if (opts.minY != null && r.y <= opts.minY) continue;
      if (opts.maxY != null && r.y >= opts.maxY) continue;
      if (opts.minX != null && r.x <= opts.minX) continue;
      if (opts.maxX != null && r.x >= opts.maxX) continue;
      if (opts.minH != null && r.height < opts.minH) continue;
      cands.push({ el, x: r.x + r.width / 2, y: r.y + r.height / 2, len: t.length, w: r.width, h: r.height });
    }
    if (!cands.length) return null;
    const topCands = cands.filter((cb) => {
      const at = document.elementFromPoint(cb.x, cb.y);
      return at && (at === cb.el || cb.el.contains(at) || (at.closest && at.closest('button,[role="button"]') === cb.el));
    });
    const pool = topCands.length ? topCands : cands;
    pool.sort((a, b) => (opts.big ? (b.h * b.w) - (a.h * a.w) : a.len - b.len) || (b.h * b.w) - (a.h * a.w));
    const t = pool[0];
    return t ? { x: t.x, y: t.y } : null;
  }, { text, opts }).catch(() => null);
  if (!pt) return false;
  try { await page.mouse.click(pt.x, pt.y); return true; } catch (e) { return false; }
}

async function dumpModal(page, label) {
  try {
    const base = path.join(__dirname, 'debug');
    fs.mkdirSync(base, { recursive: true });
    const shot = path.join(base, `export-${label}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    log('### DEBUG screenshot: ' + shot);
    const info = await page.evaluate(() => {
      const rows = [];
      for (const el of document.querySelectorAll('button, [role="button"], li, [class*="export"], [class*="download"]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 60) continue;
        const r = el.getBoundingClientRect();
        if (!(r.width && r.height)) continue;
        rows.push(`${el.tagName.toLowerCase()} y=${Math.round(r.y)} x=${Math.round(r.x)} w=${Math.round(r.width)} cls=${(el.className || '').toString().slice(0, 36)} [${t}]`);
      }
      return rows;
    }).catch(() => []);
    log('### DEBUG visible elemen (modal):');
    info.slice(0, 32).forEach(l => log('   ' + l));
  } catch (e) {
    log('### DEBUG gagal: ' + e.message.slice(0, 100));
  }
}

async function uploadSlots(page, images) {
  const slots = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('.segment-item')) {
      if (el.querySelector('input[type=file]')) n++
    }
    return n
  }).catch(() => 0)
  const total = slots > 0 ? slots : images.length
  log(`  slot foto terdeteksi: ${total}`)
  // urutan foto harus sesuai slot 1..n (pakai foto yang tersedia)
  const limit = total
  for (let r = 0; r < 3; r++) {
    let up = 0
    for (let i = 0; i < limit; i++) {
      if (i >= images.length) continue
      try {
        const input = page.locator('.segment-item').nth(i).locator('input[type=file]')
        if (await input.count({ timeout: 2500 })) {
          const f = i < images.length ? images[i] : images[images.length - 1]
          await input.setInputFiles(f, { timeout: 20000 })
          up++
          log(`  slot ${i+1}/${total} upload (round ${r+1})`)
          await page.waitForTimeout(2000)
        }
      } catch (e) {}
      await settleUploadDialogs(page)
      await page.waitForTimeout(800)
    }
    await page.waitForTimeout(14000)
    const filled = await page.evaluate((c) => {
      const els = [...document.querySelectorAll('.segment-item')].slice(0,c)
      return els.map(el => !el.querySelector('input[type=file]'))
    }, total).catch(() => [])
    const ok = filled.filter(Boolean).length
    log(`  round ${r+1}: ${ok}/${total} slot terisi`)
    if (ok >= total) return
    if (up === 0) break
  }
  // fallback isi slot kosong dengan foto berurutan (index sesuai slot)
  const filled2 = await page.evaluate((c) => {
    const els = [...document.querySelectorAll('.segment-item')].slice(0,c)
    return els.map(el => !el.querySelector('input[type=file]'))
  }, total).catch(() => [])
  for (let i = 0; i < filled2.length; i++) {
    if (filled2[i]) continue  // sudah terisi
    try {
      const f = i < images.length ? images[i] : images[images.length - 1]
      const input = page.locator('.segment-item').nth(i).locator('input[type=file]')
      if (await input.count({ timeout: 2000 })) {
        await input.setInputFiles(f, { timeout: 20000 })
        log(`  slot ${i+1} isi ulang (fallback)`)
        await page.waitForTimeout(1800)
        await settleUploadDialogs(page)
      }
    } catch (e) {}
  }
}


async function runTask({ templateId, images, outFile, log: logFn }) {
  onLog = logFn || null;
  const result = { videoUrl: null, downloadUrl: null, file: null, draftId: null, meta: null, fileId: null, renderTaskId: null, renderDone: false, done: false, templateError: null };
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: BROWSER_VIEWPORT,
    storageState: STORAGE_STATE,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('dialog', async d => { log('DIALOG: ' + d.message().slice(0, 120)); await d.dismiss().catch(() => {}); });
  page.on('download', async dl => {
    const url = dl.url();
    result.downloadUrl = url;
    if (/evercloud|mime_type=video|\.mp4/.test(url)) result.videoUrl = url;
    log('### DOWNLOAD URL: ' + url.slice(0, 220));
    if (outFile) {
      for (let a = 0; a < 3 && !result.file; a++) {
        try { await dl.saveAs(outFile); result.file = outFile; log('### saved -> ' + outFile); }
        catch (e) { log('### saveAs #' + (a + 1) + ' gagal: ' + e.message.slice(0, 80)); await new Promise(r => setTimeout(r, 1500)); }
      }
    }
  });
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/multi_get_templates')) {
      let b = ''; try { b = (await res.text()).slice(0, 5000); } catch (e) {}
      try {
        const j = JSON.parse(b);
        const ret = String((j && j.ret != null) ? j.ret : '');
        if (ret === '1033') {
          result.templateError = 'template tidak ditemukan (ret 1033)';
          log('### TEMPLATE TIDAK DITEMUKAN (ret 1033) — hentikan semua proses');
        }
      } catch (e) {}
    }
    const ct = res.headers()['content-type'] || '';
    const isVideo = ct.includes('video') || /mime_type=video/.test(u) || /evercloud\.capcut\.com\/(origin|uploads)/.test(u);
    const isRender = /render_task|common_task/.test(u) && /edit-api|web-edit|capcutapi/i.test(u);
    if (isVideo || isRender) {
      if (isRender && result.__apiLogs < 25) { result.__apiLogs = (result.__apiLogs || 0) + 1; log('   [api] ' + u.slice(0, 130)); }
      let b = ''; try { b = (await res.text()).slice(0, 3000); } catch (e) {}
      if (isRender) {
        const cm = b.match(/"task_id":"(\d+)"/);
        if (!result.renderTaskId && cm && cm[1] !== '0' && /render_task\/create/.test(u)) { result.renderTaskId = cm[1]; log('### RENDER START task_id=' + cm[1]); }
        const tid = b.match(/"render_task":\{"(\d+)"/);
        if (result.renderTaskId && tid && tid[1] === result.renderTaskId && b.includes('"status":1') && b.includes('file_id')) {
          result.renderDone = true;
          const fm = b.match(/"file_id":"([^"]+)"/);
          if (fm) result.fileId = fm[1];
          const dm = b.match(/"draft_id":"([^"]+)"/);
          if (dm) result.draftId = dm[1];
          result.meta = b;
          log('### RENDER DONE file_id=' + (fm ? fm[1] : '?'));
        }
      }
      if (isVideo && result.renderTaskId) {
        result.videoUrl = u;
        log('### RENDER VIDEO: ' + u.slice(0, 180));
      }
    }
  });

  const assertLive = () => { if (result.templateError) throw new Error(result.templateError); };

  try {
    log('[1] open editor...');
    await page.goto(editorUrl(templateId), { waitUntil: 'domcontentloaded', timeout: T.nav }).catch(() => {});
    await dismissAll(page);
    assertLive();

    // pola dulu sampai editor nampilin slot foto (progres >= 1) — ganti dari diam statis, biar bukan lama sia-sia
    log('[1b] tunggu editor siap (cek slot foto)...');
    const t0 = Date.now();
    let segCount = 0;
    while (Date.now() - t0 < Math.min(T.nav, 60000)) {
      segCount = await page.evaluate(() => document.querySelectorAll('.segment-item').length).catch(() => 0);
      if (segCount >= 1) break;
      await page.waitForTimeout(2500);
    }
    log('   segment-item setelah tunggu: ' + segCount + ' (' + Math.round((Date.now() - t0) / 1000) + 's)');
    await dismissAll(page);

    const hasFresh = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.segment-item')];
      return els.length >= 1 && els.every(el => el.querySelector('input[type=file]'));
    }).catch(() => false);
    if (!hasFresh) {
      log('   slots tidak fresh (ada draft lama), reload ulang...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: T.reload }).catch(() => {});
      const r0 = Date.now();
      while (Date.now() - r0 < Math.min(T.reload, 45000)) {
        const n = await page.evaluate(() => document.querySelectorAll('.segment-item').length).catch(() => 0);
        if (n >= 1) break;
        await page.waitForTimeout(2500);
      }
      await dismissAll(page);
      assertLive();
    }

    log('[2] upload semua slot foto...');
    await uploadSlots(page, images);
    assertLive();

    log('[2b] bereskan dialog hasil upload (Batch replace/OK)...');
    await settleUploadDialogs(page);

    log('[3] autosave wait...');
    await page.waitForTimeout(T.autosave);
    await dismissAll(page);

    const expDeadline = Date.now() + T.export;
    const tag = (outFile && path.basename(path.dirname(outFile))) || Date.now();
    let debugOnce = false;

    const hasBodyText = (s) => page.evaluate((txt) => (document.body.innerText || '').includes(txt), s).catch(() => false);
    const awaitBody = async (s, ms) => {
      const dl = Date.now() + ms;
      while (Date.now() < dl) {
        if (await hasBodyText(s)) return true;
        await page.waitForTimeout(1000);
      }
      return false;
    };

    while (!result.renderTaskId && Date.now() < expDeadline) {
      assertLive();
      log('[4] buka drawer Export...');
      await dismissAll(page);
      await settleUploadDialogs(page);

      // kalau drawer sudah terbuka, tutup dulu via Escape biar dari kondisi bersih
      if (await hasBodyText('Share as presentation')) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1200);
        await dismissAll(page);
      }

      const opened = await clickAny(page, 'Export', { minY: 0 });
      log('   open Export: ' + opened);
      // tutup dialog jika ada sebelum tunggu drawer
      await settleUploadDialogs(page);
      const drawer = await awaitBody('Share as presentation', 15000);
      log('   drawer Export terbuka: ' + drawer);

      if (drawer) {
        // klik Download di panel drawer → buka modal "Export settings"
        let dl = await clickAny(page, 'Download', { minY: 60, big: true });
        if (!dl) dl = await clickAny(page, 'Download', { minY: 60 });
        log('   klik Download panel: ' + dl);
        await settleUploadDialogs(page);
        await page.waitForTimeout(800);
        const st = await awaitBody('Export settings', 15000);
        log('   modal "Export settings": ' + st);
        if (st) {
          let fe = await clickAny(page, 'Export', { minY: 550, big: true });
          if (!fe) fe = await clickAny(page, 'Export', { minY: 550 });
          log('   klik footer Export: ' + fe);
          await settleUploadDialogs(page);
        }

        // tunggu moment render mulai
        if (!result.renderTaskId) {
          const rdl = Date.now() + 15000;
          while (!result.renderTaskId && Date.now() < rdl) await page.waitForTimeout(1000);
        }
        if (result.renderTaskId) break;
      } else {
        if (!debugOnce) { debugOnce = true; await dumpModal(page, tag); }
      }

      if (!result.renderTaskId) {
        await page.keyboard.press('Escape').catch(() => {});
        await dismissAll(page);
        await page.waitForTimeout(3000);
      }
    }

    if (!result.renderTaskId) {
      log('### export tidak mulai dalam waktu tunggu');
    } else {
      log('[5] aktif tunggu render + klik Download berkala...');
      const rDeadline = Date.now() + T.render;
      let clicks = 0;
      while (!result.renderDone && !result.downloadUrl && Date.now() < rDeadline) {
        assertLive();
        await page.waitForTimeout(10000);
        await dismissAll(page);
        if (clicks % 2 === 0) {
          const d = await clickButton(page, 'Download', { minY: 300 });
          if (d) log('   re-klik modal Download');
        }
        clicks++;
      }
      log('   renderDone=' + result.renderDone + ' fileId=' + (result.fileId || '?') + ' dl=' + !!result.downloadUrl);

      log('[6] klik Download di layar hasil (retry)...');
      for (let k = 0; k < 6 && !result.downloadUrl; k++) {
        await dismissAll(page);
        const d = await clickButton(page, 'Download', { minY: 0 });
        log('   click Download #' + (k + 1) + ': ' + d);
        await page.waitForTimeout(8000);
      }
      if (!result.downloadUrl && result.fileId) {
        log('[6b] tidak ada download event; coba klik "Download for desktop"...');
        await clickButton(page, 'Download for desktop', {});
        await page.waitForTimeout(10000);
      }
      // kalau udah dapet link video/download, buka langsung biar auto-download (opsional)
      if (result.videoUrl && !result.file && outFile) {
        // simpan via fetch fallback kalau perlu, tapi download event udah dicoba
        log('[6c] videoUrl tersedia: ' + result.videoUrl.slice(0, 120));
      }
    }

    result.done = !!(result.downloadUrl || (result.renderDone && (result.fileId || result.videoUrl)));

    if (result.renderTaskId && result.done) {
      log('### auto-hapus common_task ' + result.renderTaskId + '...');
      if (outFile && !result.file) {
        const fDeadline = Date.now() + T.download;
        while (!result.file && Date.now() < fDeadline) await new Promise(r => setTimeout(r, 2000));
      }
      try {
        const del = await deleteTask(result.renderTaskId);
        log('### auto-hapus: ' + (del ? 'OK' : 'gagal (bukan ret 0)'));
      } catch (e) {
        log('### auto-hapus error: ' + e.message.slice(0, 100));
      }
    }
  } catch (err) {
    log('ERROR: ' + err.message);
    result.error = err.message;
  }
  await ctx.close().catch(() => {});
  return result;
}

async function checkAccountCookie() {
  const stateFile = STORAGE_STATE;
  let before = [];
  try { before = JSON.parse(fs.readFileSync(stateFile, 'utf8')).cookies || []; } catch (e) {}
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    storageState: stateFile,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  let navError = null;
  await page.goto('https://www.capcut.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => { navError = e.message; });
  await page.waitForTimeout(15000);
  const loginWall = await page.evaluate(() => {
    const t = (document.body.innerText || '').slice(0, 4000);
    return /log in to|log in|sign in to|login\/register/i.test(t);
  }).catch(() => true);
  const fresh = await ctx.storageState();
  fs.writeFileSync(stateFile, JSON.stringify(fresh, null, 2));
  await ctx.close().catch(() => {});
  const cookies = fresh.cookies || [];
  const sessions = cookies.filter((ck) => ck.domain.includes('capcut.com') || ck.domain.includes('bytedance') || ck.domain.includes('tiktok')).length;
  const result = {
    ok: !loginWall && sessions > 0,
    loggedIn: !loginWall,
    sessions,
    cookiesBefore: before.length,
    cookiesAfter: cookies.length,
    navError,
    at: new Date().toISOString(),
  };
  log(`[cookie] cek: login=${result.loggedIn} sesi=${sessions} cookies=${before.length}->${cookies.length}`);
  return result;
}

setInterval(() => ensureBrowserHealthy().catch(() => {}), 60000).unref();

setTimeout(() => {
  getBrowser()
    .then(() => console.log('[warmup] chromium siap (idle, tunggu task)'))
    .catch((e) => console.log('[warmup] gagal buka browser: ' + e.message.slice(0, 120)));
}, 20 * 1000).unref();

module.exports = { runTask, checkAccountCookie };