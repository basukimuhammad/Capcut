#!/usr/bin/env node
'use strict';
/**
 * Auto backup -> Telegram owner
 *
 * Pakai:   node backup.js                    (backup + kirim ke owner)
 *          node backup.js --no-send          (cuma bikin arsip, buat tes)
 *          node backup.js --with-env         (ikut sertakan .env / file rahasia)
 *          node backup.js --install-cron     (pasang jadwal tiap 6 jam)
 *          node backup.js --remove-cron
 *
 * Yang TIDAK ikut backup: node_modules, storage, tasks, dist, log, lock file,
 * state runtime (sessions/cookies/task runtime), dan file > 8MB.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const BACKUP_DIR = path.join(DIR, 'backups');
const LOG_FILE = path.join(DIR, 'backup.log');
const LOCK_FILE = path.join(DIR, '.backup.lock');

const MAX_FILE_BYTES = 8 * 1024 * 1024; // lewati file tunggal > 8MB
const PART_BYTES = 45 * 1024 * 1024; // batas upload bot Telegram (maks 50MB)
const KEEP_LOCAL = 5; // simpan 5 arsip terakhir di server

const INCLUDE_ENV = process.argv.includes('--with-env');
const SEND = !process.argv.includes('--no-send');

/* ---------- env ---------- */
const envFile = path.join(DIR, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OWNER_IDS = (process.env.OWNER_TG_ID || '')
  .split(',')
  .map((s) => String(s).trim())
  .filter(Boolean);

/* ---------- aturan pengecualian ---------- */
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.pm2', '.cache', 'backups', '.next', '.turbo',
  'storage', 'tasks', 'uploads', 'cache', 'debug', 'dist', 'coverage', '.vscode', '.idea',
]);
const EXCLUDE_FILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'server.log', 'backup.log', 'backup-cron.log', '.backup.lock',
  'storage_state.json', 'sessions.json', 'tasks.json', 'admin-sessions.json',
]);
if (!INCLUDE_ENV) EXCLUDE_FILES.add('.env');
const EXCLUDE_RE = [
  /\.log(\.\d+)?$/i,
  /\.pid$/i,
  /\.tar\.gz(\.\d+)?$/i,
  /\.tmp$/i,
  /(^|\/)thumbs\.db$/i,
  /(^|\/)\.DS_Store$/i,
];

/* ---------- util ---------- */
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
};
const bytes = (n) => {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
};
const exec = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 400)}`))));
  });

/* ---------- telegram ---------- */
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
let statusId = null;
const errMsg = (e) => {
  const c = e && e.cause;
  return [e && e.message, c && c.code, c && c.message].filter(Boolean).join(' | ');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, label, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === tries) throw new Error(`${label} gagal ${tries}x: ${errMsg(e)}`);
      const wait = 3000 * i;
      log(`[retry] ${label} percobaan ${i} gagal (${errMsg(e)}), ulang dalam ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}
const api = async (method, body = {}) => {
  let r;
  try {
    r = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    log(`[net] ${method} gagal: ${errMsg(e)}`);
    throw e;
  }
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new Error(`${method}: ${(j && j.description) || r.status}`);
  return j.result;
};
const sendMessage = (chat_id, text) => retry(() => api('sendMessage', { chat_id, text, parse_mode: 'HTML' }), 'sendMessage');
const editText = async (chat_id, message_id, text) => {
  try {
    await retry(() => api('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML' }), 'editMessageText');
    return true;
  } catch (e) {
    return false;
  }
};
const statusIds = new Map();
async function status(text) {
  for (const chat of OWNER_IDS) {
    const id = statusIds.get(chat);
    if (id && (await editText(chat, id, text))) continue;
    try {
      statusIds.set(chat, (await sendMessage(chat, text)).message_id);
    } catch (e) { log('status gagal:', errMsg(e)); }
  }
}
async function sendFile(chat, file, caption) {
  const fd = new FormData();
  fd.append('chat_id', chat);
  fd.append('document', new Blob([fs.readFileSync(file)]), path.basename(file));
  fd.append('caption', caption);
  return retry(async () => {
    const r = await fetch(`${API}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(300000) });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) throw new Error(`sendDocument: ${(j && j.description) || r.status}`);
    return j.result;
  }, `sendDocument ${path.basename(file)}`);
}

/* ---------- pilih file ---------- */
function collect() {
  const files = [];
  const skipDirs = new Set();
  const skipFiles = new Set();
  let total = 0;

  const walk = (rel) => {
    const abs = path.join(DIR, rel);
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) { skipDirs.add(r); continue; }
        if (EXCLUDE_RE.some((re) => re.test(r))) continue;
        walk(r);
      } else if (e.isFile()) {
        if (EXCLUDE_FILES.has(e.name) || EXCLUDE_RE.some((re) => re.test(r))) { skipFiles.add(r); continue; }
        let st;
        try { st = fs.statSync(path.join(DIR, r)); } catch (err) { continue; }
        if (st.size > MAX_FILE_BYTES) { skipFiles.add(r); continue; }
        if (st.size === 0) continue;
        total += st.size;
        files.push(r);
      }
    }
  };
  walk('');
  return { files, skipDirs, skipFiles, total };
}

/* ---------- shrink arsip lama ---------- */
function pruneLocal() {
  let list = [];
  try { list = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('backup-')).sort(); } catch (e) {}
  for (const f of list.slice(0, Math.max(0, list.length - KEEP_LOCAL))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) {}
  }
}

function splitParts(archive) {
  const buf = fs.readFileSync(archive);
  if (buf.length <= PART_BYTES) return [archive];
  const parts = [];
  for (let i = 0, n = 1; i < buf.length; i += PART_BYTES, n++) {
    const p = `${archive}.${String(n).padStart(3, '0')}`;
    fs.writeFileSync(p, buf.subarray(i, i + PART_BYTES));
    parts.push(p);
  }
  fs.unlinkSync(archive);
  return parts;
}

/* ---------- jalankan ---------- */
async function run() {
  const t0 = Date.now();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  if (SEND && (!BOT_TOKEN || !OWNER_IDS.length)) throw new Error('BOT_TOKEN / OWNER_TG_ID belum diisi');

  const { files, skipDirs, skipFiles, total } = collect();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archive = path.join(BACKUP_DIR, `backup-${stamp}.tar.gz`);
  log(`arsip: ${files.length} file (${bytes(total)}), skip ${skipDirs.size} folder, ${skipFiles.size} file`);

  // tar isi daftar file hasil filter (tanpa direktori storage/node_modules dll)
  const listFile = path.join(BACKUP_DIR, `.filelist-${stamp}.txt`);
  fs.writeFileSync(listFile, files.join('\n'));
  try {
    await exec('tar', ['-czf', archive, '--files-from', listFile]);
  } finally {
    try { fs.unlinkSync(listFile); } catch (e) {}
  }

  const size = fs.statSync(archive).size;
  const sha = await exec('sha256sum', [archive]).then((r) => r.out.trim().slice(0, 16)).catch(() => 'n/a');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log(`selesai: ${path.basename(archive)} ${bytes(size)} sha=${sha} ${secs}s`);

  if (!SEND) {
    pruneLocal();
    log('mode --no-send, tidak dikirim ke telegram');
    return;
  }

  const parts = splitParts(archive);
  const multi = parts.length > 1;
  const caption = [
    `🗄 <b>Backup otomatis</b>`,
    ``,
    `📦 File: ${files.length} (${bytes(total)})`,
    `🧮 Arsip: ${bytes(size)}${multi ? ` (${parts.length} bagian)` : ''}`,
    `🔑 ${sha}`,
    `🕒 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
    multi ? `\n⚠️ Gabung dulu: <code>cat backup-*.tar.gz.00* &gt; backup.tar.gz</code>` : '',
    `\n<i>Tidak ikut: node_modules, storage, tasks, dist, log, lock, state runtime${INCLUDE_ENV ? '' : ', .env'}</i>`,
  ].join('\n');

  await status('🔄 <b>Backup</b> sedang dikirim ke owner…');
  for (const chat of OWNER_IDS) {
    for (let i = 0; i < parts.length; i++) {
      if (parts.length > 1) {
        await status(`🔄 <b>Backup</b> dikirim ke owner… ${i + 1}/${parts.length}`);
      }
      await sendFile(chat, parts[i], multi ? `${caption}\n\nBagian ${i + 1}/${parts.length}` : caption);
      log(`terkirim ke ${chat}: ${path.basename(parts[i])}`);
    }
  }
  await status(
    `✅ <b>Backup selesai</b>\n\n${files.length} file · ${bytes(size)}${multi ? ` · ${parts.length} bagian` : ''}\n${sha}\n<i>skip: ${[...skipDirs].slice(0, 6).join(', ') || '—'}</i>`
  );

  pruneLocal();
  log('arsip lokal dipangkas, sisa', KEEP_LOCAL);
}

/* ---------- cron ---------- */
function cron() {
  const i = process.argv.indexOf('--install-cron');
  const sched = i >= 0 ? process.argv[i + 1] : '';
  const schedule = sched && !sched.startsWith('--') ? sched : '0 */6 * * *';
  const marker = '# gencap-auto-backup';
  const cmd = `flock -n ${LOCK_FILE} /usr/bin/node ${path.join(DIR, 'backup.js')} >> ${path.join(DIR, 'backup-cron.log')} 2>&1 ${marker}`;
  const cron = require('child_process');
  const cur = cron.execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
  const lines = cur.split('\n').filter((l) => l.trim() && !l.includes(marker));
  if (process.argv.includes('--remove-cron')) {
    cron.execSync('crontab -', { input: lines.join('\n') + '\n' });
    return console.log('jadwal backup dihapus');
  }
  cron.execSync('crontab -', { input: lines.concat(`${schedule} ${cmd}`).join('\n') + '\n' });
  console.log('jadwal backup terpasang:');
  console.log(`  ${schedule} ${cmd}`);
}

/* ---------- lock (anti jalan bareng; cron juga pakai flock) ---------- */
const STALE_MS = 30 * 60 * 1000;
function acquireLock() {
  const grab = () => {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, `${process.pid} ${Date.now()}`);
    fs.closeSync(fd);
  };
  try {
    grab();
    return true;
  } catch (e) {
    try {
      if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > STALE_MS) {
        fs.unlinkSync(LOCK_FILE);
        log('lock lama (>30 menit), diambil alih');
        grab();
        return true;
      }
    } catch (err) {}
    log('proses backup lain sedang jalan, skip');
    return false;
  }
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch (e) {}
}

if (process.argv.includes('--install-cron') || process.argv.includes('--remove-cron')) {
  cron();
} else {
  if (!acquireLock()) process.exit(0);
  run()
    .catch((e) => {
      log('GAGAL:', e.stack || e.message);
      status(`❌ <b>Backup gagal</b>\n<pre>${String(e.message).slice(0, 400)}</pre>`).catch(() => {});
      process.exitCode = 1;
    })
    .finally(releaseLock);
}