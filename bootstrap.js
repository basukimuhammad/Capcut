const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'storage_state.json');
const sources = ['/etc/secrets/storage_state.json', '/etc/secrets/cookies.json'];
const SAME = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };

function convert(raw) {
  const list = Array.isArray(raw) ? raw : (raw.cookies || []);
  const cookies = list
    .map((c) => {
      const sameSite = SAME[String(c.sameSite || '').toLowerCase()] || 'Lax';
      const exp = c.expirationDate || c.expires;
      return {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        httpOnly: !!c.httpOnly,
        secure: sameSite === 'None' ? true : !!c.secure,
        sameSite,
        expires: exp && exp > 0 ? Math.floor(exp) : -1,
      };
    })
    .filter((c) => c.name && c.domain);
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
      console.log(`[boot] storage_state.json dibuat dari ${src} (${state.cookies.length} cookie)`);
      done = true;
      break;
    }
    if (!done) console.log('[boot] PERINGATAN: Secret File cookies.json belum ada');
  } catch (e) {
    console.error('[boot] gagal menyiapkan storage_state.json:', e.message);
  }
}
