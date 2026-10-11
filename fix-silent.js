const fs = require('fs');
const path = require('path');
const { ensureAudio, audioLoudnessDb } = require('./server');

const DIR = __dirname;
const tasks = JSON.parse(fs.readFileSync(path.join(DIR, 'tasks.json'), 'utf8'));

(async () => {
  let silent = 0, ok = 0, fixed = 0, skipped = 0;
  for (const t of tasks) {
    if (t.status !== 'completed' || !t.result || !t.result.file) { skipped++; continue; }
    const file = path.join(DIR, 'tasks', t.id, 'result.mp4');
    if (!fs.existsSync(file)) { skipped++; continue; }
    const db = await audioLoudnessDb(file);
    if (db > -45) { ok++; console.log(`OK    ${t.id} audio ${db} dB`); continue; }
    silent++;
    console.log(`SILENT ${t.id} ${db === -Infinity ? 'no audio' : db + ' dB'} -> memperbaiki...`);
    const fixedNow = await ensureAudio(file, t.template_id);
    if (fixedNow) { fixed++; console.log(`  FIXED ${t.id}`); }
    else console.log(`  GAGAL DIPERBAIKI ${t.id}`);
  }
  console.log(`\nSelesai. ada suara=${ok}, silent=${silent}, berhasil diperbaiki=${fixed}, dilewati=${skipped}`);
})().catch(e => { console.error(e); process.exit(1); });