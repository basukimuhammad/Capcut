const path = require('path');

const DIR = __dirname;

module.exports = {
  // Satu tempat semua config browser CapCut.
  UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  headless: true,
  viewport: { width: 1440, height: 900 },

  // batas kesehatan (dipakai ensureBrowserHealthy)
  maxMemoryMb: parseInt(process.env.CHROMIUM_MAX_MB || '4000', 10),
  minFreeMb: parseInt(process.env.MIN_FREE_MB || '500', 10),

  // session akun (cookie login CapCut)
  storageState: path.join(DIR, 'storage_state.json'),

  // editor CapCut
  editor: {
    base: 'https://www.capcut.com/',
    path: 'editor-template?template_scale=1%3A1&enter_from=page_header&create_id=%ID%&from_page=template_detail_page',
  },

  // argumen launch chromium
  launchArgs: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--disable-extensions',
    '--disable-background-networking', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-default-apps',
    '--disable-sync', '--mute-audio', '--no-first-run', '--disable-component-update',
    '--disable-features=TranslateUI,OptimizeHints,MediaRouter',
  ],

  timeouts: {
    nav: 90000,
    wait: 32000,
    reload: 90000,
    autosave: 30000,
    upload: 20000,
    export: 8 * 60 * 1000,   // tunggu modal export mulai
    render: 10 * 60 * 1000,  // tunggu render selesai + download
    download: 60000,
  },
};