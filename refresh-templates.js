const fs = require('fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rescrape(id) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`http://localhost:3000/api/template-info/${id}?refresh=1`, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (!d.template) throw new Error('kosong');
      return d.template;
    } catch (e) {
      if (attempt < 3) await sleep(6000);
      else throw e;
    }
  }
}

(async () => {
  const tpl = JSON.parse(fs.readFileSync('/root/web/templates.json', 'utf8'));
  const entries = Object.entries(tpl);
  const ok = [], fail = [];
  for (const [key, v] of entries) {
    const id = v.id || key;
    try {
      const info = await rescrape(id);
      const realId = info.id || key;
      const prev = { title: v.title, pr: v.photos_required };
      tpl[realId] = { id: realId, title: info.title || prev.title, photos_required: info.photos_required || prev.pr };
      if (realId !== key && tpl[key]) delete tpl[key];
      ok.push(`${realId} | pr=${info.photos_required} | vslots=${info.video_slots ?? '?'} | title=${(info.title || '').slice(0, 26)}`);
      console.log('✅', realId.slice(0, 12), '| pr:', info.photos_required, '| vslots:', info.video_slots, '|', (info.title || '').slice(0, 26));
    } catch (e) {
      fail.push(id);
      console.log('❌', id.slice(0, 12), e.message.slice(0, 50));
    }
    await sleep(3500);
  }
  fs.writeFileSync('/root/web/templates.json', JSON.stringify(tpl, null, 2));
  console.log(`\nSELESAI: ok=${ok.length} gagal=${fail.length}`);
  fs.writeFileSync('/root/web/templates-refresh-report.txt', `ok=${ok.length} fail=${fail.length}\n\nFAIL:\n${fail.join('\n')}\n\nOK:\n${ok.join('\n')}\n`);
})().catch((e) => { console.error('FTL', e.message); process.exit(1); });