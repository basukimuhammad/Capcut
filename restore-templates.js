const fs = require('fs');

// Data ASLI templates.json: dipulihkan persis urutan index (file tersimpan alphabetical, sama dgn dump asli)
const ORIG = [
  ['COBAIN AJA DULU😋', 3],
  ['MASA SEPI☝️🗿', 3],
  ['gas cobain🗿☕ #jjsmooth #doctortemplate77', 3],
  ['loop mirip am', 3],
  ['JJ AM KECE', 3],
  ['gas cobain#jjkece#miripam#fyp', 3],
  ['Janji Ga Salin tautan? 😣👉\n#JjTipis #Fyp', 3],
  ['JJ kece banget jir😜', 3],
  ['JJ SWEET LOVE', 3],
  ['Transisi Mirip AM ( Terkele kele kana )', 3],
  ['protemplatefestival#overlaylirik#fyp#vir', 3],
  ['jj#jjkece#jjkane#samszdtxar#fyp', 3],
  ['trendcapcut🔥 #trend', 3],
  ['gas cobain🔥🗿☕ #jjsmooth', 3],
  ['jjsmooth', 3],
  ['jjloop#jj#trend#fyp#masbre', 3],
  ['😜🤙fyp#trend#uyekece', 3],
  ['jjsmooth #mastertobe', 3],
  ['konsep Atur sendiri🗿 #jjsmooth', 3],
  ['gas cobain🗿☕ #jjsmooth', 3],
  ['xalvinpreset#yanzsoasik', 3],
  ['HP ipong 29 promag ku lag ges 😭 #TrendHD', 3],
  ['#web_templates photodump', 16],
  ['gas cobain#jjkece#miripam#fyp ', 8],
  ['Pick the goat free template to use ', 10],
  ['KECE CUYYY😋🤙 #desidtz#jjtipis#fyp', 8],
  ['gas cobain #smooth ', 6],
  ['KANE [9.16]#jjbrutal#tiktokviral', 28],
];

const TPL = '/root/web/templates.json';
const tpl = JSON.parse(fs.readFileSync(TPL, 'utf8'));
const keys = Object.keys(tpl);

if (keys.length !== ORIG.length) throw new Error('jumlah berbeda: ' + keys.length + ' vs ' + ORIG.length);

const changed = [];
keys.forEach((key, i) => {
  const [title, pr] = ORIG[i];
  const v = tpl[key];
  if (v.photos_required !== pr || v.title !== title) {
    v.photos_required = pr;
    v.title = title;
    changed.push(key.slice(0, 12));
  }
});
fs.writeFileSync(TPL, JSON.stringify(tpl, null, 2));
console.log('templates.json dipulihkan', changed.length, ':', changed.join(', ') || '(semua sudah asli)');

// Cache info & storage: photos_required ikut nilai asli; hapus video/text slots; judul pakai nama nyata (short_title)
// supaya preview konsisten & tidak tampil junk hashtag.
const TI = '/root/web/template-info.json';
const ti = JSON.parse(fs.readFileSync(TI, 'utf8'));
const tkeys = Object.keys(ti);
tkeys.forEach((key, i) => {
  const [title, pr] = ORIG[i];
  const v = ti[key];
  if (!v) return;
  v.photos_required = pr;
  Reflect.deleteProperty(v, 'video_slots');
  Reflect.deleteProperty(v, 'text_slots');
  const real = v.short_title || v.title;
  if (real && real !== v.title) v.title = real;
  const si = '/root/web/storage/info/' + key + '.json';
  if (fs.existsSync(si)) {
    const s = JSON.parse(fs.readFileSync(si, 'utf8'));
    s.photos_required = pr;
    Reflect.deleteProperty(s, 'video_slots');
    Reflect.deleteProperty(s, 'text_slots');
    const r = s.short_title || s.title;
    if (r && r !== s.title) s.title = r;
    fs.writeFileSync(si, JSON.stringify(s, null, 2));
  }
});
fs.writeFileSync(TI, JSON.stringify(ti, null, 2));
console.log('template-info.json & storage/info: photos_required = nilai asli; judul = nama nyata; video/text slots dihapus');