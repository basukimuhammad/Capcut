const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------
 * 1. Siapkan storage_state.json dari Secret File Render (cookies.json)
 *    Bahasa CapCut dipaksa ke Inggris, karena kode di capcut-run.js
 *    mencari teks "Export", "Download", dll (bukan "Ekspor").
 * ------------------------------------------------------------------ */
const target = path.join(__dirname, 'storage_state.json');
const sources = ['/etc/secrets/storage_state.json', '/etc/secrets/cookies.json'];
const SAME = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
const LOCALE = process.env.CAPCUT_LOCALE || 'en-US';
const LOCALE_COOKIES = ['capcut_locale', 'ug_capcut_locale'];

function convert(raw) {
  const list = Array.isArray(raw) ? raw : (raw.cookies || []);
  const cookies = list
    .map((c) => {
      const sameSite = SAME[String(c.sameSite || '').toLowerCase()] || 'Lax';
      const exp = c.expirationDate || c.expires;
      return {
        name: c.name,
        value: LOCALE_COOKIES.includes(c.name) ? LOCALE : c.value,
        domain: c.domain,
        path: c.path || '/',
        httpOnly: !!c.httpOnly,
        secure: sameSite === 'None' ? true : !!c.secure,
        sameSite,
        expires: exp && exp > 0 ? Math.floor(exp) : -1,
      };
    })
    .filter((c) => c.name && c.domain);

  // pastikan cookie bahasa ada walau tidak ikut ter-export
  if (!cookies.some((c) => c.name === 'capcut_locale')) {
    cookies.push({
      name: 'capcut_locale', value: LOCALE, domain: 'www.capcut.com', path: '/',
      httpOnly: false, secure: false, sameSite: 'Lax', expires: -1,
    });
  }
  return { cookies, origins: [] };
}

if (!fs.existsSync(target)) {
  try {
    let done = false;
    for (const src of sources) {
      if (!fs.existsSync(src)) continue;
      const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
      const state = convert(raw);
      fs.writeFileSync(target, JSON.stringify(state, null, 2));
      console.log(`[boot] storage_state.json dibuat dari ${src} (${state.cookies.length} cookie, locale=${LOCALE})`);
      done = true;
      break;
    }
    if (!done) console.log('[boot] PERINGATAN: Secret File cookies.json belum ada');
  } catch (e) {
    console.error('[boot] gagal menyiapkan storage_state.json:', e.message);
  }
}

/* ------------------------------------------------------------------
 * 2. Patch Playwright: setiap context baru otomatis locale en-US
 *    (Accept-Language Inggris), tanpa mengubah capcut-run.js.
 * ------------------------------------------------------------------ */
try {
  const { chromium } = require('playwright');

  const wrapBrowser = (browser) => {
    if (!browser || browser.__localePatched) return browser;
    const origNewContext = browser.newContext.bind(browser);
    browser.newContext = (opts = {}) => origNewContext({ locale: LOCALE, ...opts });
    browser.__localePatched = true;
    return browser;
  };

  for (const method of ['connectOverCDP', 'connect', 'launch']) {
    if (typeof chromium[method] !== 'function') continue;
    const orig = chromium[method].bind(chromium);
    chromium[method] = async (...args) => wrapBrowser(await orig(...args));
  }
  console.log(`[boot] Playwright dipatch: locale ${LOCALE}`);
} catch (e) {
  console.error('[boot] patch Playwright dilewati:', e.message);
}
