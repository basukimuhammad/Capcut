const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const WEB_SESS_FILE = path.join(DIR, 'sessions.json');
const ADM_SESS_FILE = path.join(DIR, 'admin-sessions.json');
const KEY_FILE = path.join(DIR, 'apikeys.json');

/* ================= Sesi (cookie terikat IP) ================= */
function loadStore(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; }
}
let webSessions = loadStore(WEB_SESS_FILE);
let admSessions = loadStore(ADM_SESS_FILE);
let saveTimer = null;
function persistSessions() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(WEB_SESS_FILE, JSON.stringify(webSessions)); } catch (e) {}
    try { fs.writeFileSync(ADM_SESS_FILE, JSON.stringify(admSessions)); } catch (e) {}
  }, 300);
}

const SESSION_TTL = 24 * 3600 * 1000;
const COOKIE_NAME = 'gcws';
const ADM_COOKIE = 'gcadm';

function hex(n) { return crypto.randomBytes(n).toString('hex'); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function cookieVal(header, name) {
  if (!header) return null;
  const m = String(header).match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function cookieSet(name, val, maxAge, secure) {
  return `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function ensureWeb(reqIp, cookieHeader) {
  const now = Date.now();
  const tok = cookieVal(cookieHeader, COOKIE_NAME);
  if (tok && webSessions[tok]) {
    const s = webSessions[tok];
    if (s.ip !== reqIp) {                       // 1 cookie = 1 IP; beda IP => undefined
      delete webSessions[tok]; persistSessions();
      return { ok: false, reason: 'ip-diff' };
    }
    if (now - s.at > SESSION_TTL) { delete webSessions[tok]; persistSessions(); return { ok: false, reason: 'expired' }; }
    s.at = now;
    return { ok: true, token: tok, session: s };
  }
  const nt = hex(32);
  webSessions[nt] = { ip: reqIp, at: now };
  persistSessions();
  return { ok: true, token: nt, fresh: true };
}

function admSession(reqIp, cookieHeader) {
  const tok = cookieVal(cookieHeader, ADM_COOKIE);
  if (!tok || !admSessions[tok]) return null;
  const s = admSessions[tok];
  if (s.ip !== reqIp) { delete admSessions[tok]; persistSessions(); return 'ip-diff'; }
  if (Date.now() - s.at > SESSION_TTL) { delete admSessions[tok]; persistSessions(); return 'expired'; }
  s.at = Date.now();
  return true;
}

function loginAdmin(reqIp) {
  const t = hex(32);
  admSessions[t] = { ip: reqIp, at: Date.now() };
  persistSessions();
  return t;
}

function logoutAdmin(cookieHeader) {
  const tok = cookieVal(cookieHeader, ADM_COOKIE);
  if (tok) { delete admSessions[tok]; persistSessions(); }
}

/* ================= Tandai sesi sudah verifikasi manusia ================= */
function setHuman(token) {
  if (token && webSessions[token]) {
    webSessions[token].human = true;
    persistSessions();
    return true;
  }
  return false;
}
function isHuman(token) {
  return !!(token && webSessions[token] && webSessions[token].human);
}

/* human = sesi sudah verifikasi, ATAU captcha single-use valid */
function humanOrCaptcha(sessionToken, captchaToken, ip, action) {
  if (isHuman(sessionToken)) return { ok: true, via: 'session' };
  return consumeCaptcha(captchaToken, ip, action);
}

/* ================= Rate limit generic per-IP ================= */
const rateBuckets = new Map();
function rateLimit(ip, key, max, windowMs) {
  const now = Date.now();
  const bk = key + '|' + ip;
  const arr = (rateBuckets.get(bk) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rateBuckets.set(bk, arr);
  if (arr.length > max) {
    return { ok: false, retry: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
  }
  return { ok: true, remaining: max - arr.length };
}
setInterval(() => {   // bersihkan bucket kedaluwarsa
  const now = Date.now();
  for (const [bk, arr] of rateBuckets) {
    if (!arr.length || now - arr[arr.length - 1] >= 60 * 1000) rateBuckets.delete(bk);
  }
}, 60 * 1000).unref();

/* ================= Rate limit web (5 req / 2 menit / IP) ================= */
const WEB_MAX = 3;
const WEB_WINDOW = 2 * 60 * 1000;
const webRate = new Map();
function webLimit(ip, now = Date.now()) {
  const arr = (webRate.get(ip) || []).filter(t => now - t < WEB_WINDOW);
  arr.push(now);
  webRate.set(ip, arr);
  if (arr.length > WEB_MAX) {
    const retry = Math.max(1, Math.ceil((arr[0] + WEB_WINDOW - now) / 1000));
    return { ok: false, retry };
  }
  const remaining = WEB_MAX - arr.length;
  return { ok: true, remaining, resetAt: arr[0] + WEB_WINDOW };
}

/* ================= Captcha custom (single-use token) ================= */
const CAP_TTL = 5 * 60 * 1000;
const captchaStore = new Map();
function issueCaptcha(ip, action = 'create') {
  const t = hex(16);
  captchaStore.set(t, { ip, at: Date.now(), action });
  return t;
}
function consumeCaptcha(token, ip, action) {
  if (!token) return { ok: false, reason: 'missing' };
  const c = captchaStore.get(token);
  if (!c) return { ok: false, reason: 'invalid' };
  captchaStore.delete(token);
  if (Date.now() - c.at > CAP_TTL) return { ok: false, reason: 'expired' };
  if (c.ip !== ip) return { ok: false, reason: 'ip' };
  if (c.action !== action) return { ok: false, reason: 'action' };
  return { ok: true };
}
setInterval(() => {   // bersihkan token kedaluwarsa
  const now = Date.now();
  for (const [t, c] of captchaStore) if (now - c.at > CAP_TTL) captchaStore.delete(t);
}, 60 * 1000).unref();

/* ================= DB API keys ================= */
let apikeys = [];
try { const raw = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); if (Array.isArray(raw)) apikeys = raw; } catch (e) {}
let keySaveTimer = null;
function saveKeys() {
  clearTimeout(keySaveTimer);
  keySaveTimer = setTimeout(() => { try { fs.writeFileSync(KEY_FILE, JSON.stringify(apikeys, null, 2)); } catch (e) {} }, 200);
}
function genKey() { return 'gc_' + crypto.randomBytes(24).toString('base64url'); }
function strip(rec) { const { key_hash, ...rest } = rec; return rest; }
function listKeys() { return apikeys.map(strip); }
function createKey({ name, note } = {}) {
  const k = genKey();
  const rec = { id: hex(16), key_hash: sha256(k), name: String(name || 'Tanpa nama'), note: String(note || ''), created_at: new Date().toISOString(), revoked: false, uses: 0, last_used_at: null };
  apikeys.push(rec);
  saveKeys();
  return { key: k, rec: strip(rec) };
}
function findKey(candidate) {
  if (!candidate) return null;
  const h = sha256(String(candidate).trim());
  const rec = apikeys.find(r => !r.revoked && r.key_hash === h);
  if (rec) {
    rec.uses = (rec.uses || 0) + 1;
    rec.last_used_at = new Date().toISOString();
    saveKeys();
  }
  return rec || null;
}
function revokeKey(id) {
  const r = apikeys.find(x => x.id === id);
  if (r) { r.revoked = true; saveKeys(); }
  return r;
}

/* ================= Limit global untuk GET publik (6, dipakai bareng) ================= */
const GLOBAL_MAX = 6;
const GLOBAL_WINDOW = 60 * 1000;
const globalBucket = [];
function globalLimit(now = Date.now()) {
  while (globalBucket.length && now - globalBucket[0] >= GLOBAL_WINDOW) globalBucket.shift();
  globalBucket.push(now);
  if (globalBucket.length > GLOBAL_MAX) {
    const retry = Math.max(1, Math.ceil((globalBucket[0] + GLOBAL_WINDOW - now) / 1000));
    return { ok: false, retry };
  }
  return { ok: true, remaining: GLOBAL_MAX - globalBucket.length, resetAt: globalBucket[0] + GLOBAL_WINDOW };
}

const POST_GLOBAL_MAX = 2;
const POST_GLOBAL_WINDOW = 60 * 1000;
const postGlobalBucket = [];
function globalPostLimit(now = Date.now()) {
  while (postGlobalBucket.length && now - postGlobalBucket[0] >= POST_GLOBAL_WINDOW) postGlobalBucket.shift();
  postGlobalBucket.push(now);
  if (postGlobalBucket.length > POST_GLOBAL_MAX) {
    const retry = Math.max(1, Math.ceil((postGlobalBucket[0] + POST_GLOBAL_WINDOW - now) / 1000));
    return { ok: false, retry };
  }
  return { ok: true, remaining: POST_GLOBAL_MAX - postGlobalBucket.length };
}

module.exports = {
  COOKIE_NAME, ADM_COOKIE,
  cookieSet, ensureWeb, admSession, loginAdmin, logoutAdmin,
  webLimit, issueCaptcha, consumeCaptcha,
  setHuman, isHuman, humanOrCaptcha, rateLimit,
  createKey, listKeys, findKey, revokeKey,
  globalLimit, globalPostLimit,
};