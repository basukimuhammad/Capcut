const { chromium } = require('playwright');
const EMAIL = 'putuxml@gmail.com';
const PASS = 'Anjay12!';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--disable-background-networking','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-default-apps','--disable-sync','--mute-audio','--no-first-run','--disable-component-update','--disable-features=TranslateUI,OptimizeHints,MediaRouter'],
  });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('https://www.capcut.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(6000);
  await page.getByText('Continue with email').first().click().catch(()=>{});
  await page.waitForSelector('input[name=username]', { timeout: 30000 }).catch(()=>{});
  await page.fill('input[name=username]', EMAIL);
  await page.locator('input[name=username]').press('Enter');
  await page.waitForSelector('input[name=password]', { timeout: 30000 }).catch(e => console.log('no password field:', e.message));
  await page.waitForTimeout(2000);
  await page.fill('input[name=password]', PASS);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click().catch(async () => {
    await page.locator('input[name=password]').press('Enter');
  });
  console.log('submitted. waiting...');
  await page.waitForTimeout(12000);
  console.log('final url:', page.url());

  const dump = await page.evaluate(() => {
    const text = (document.body.innerText||'').replace(/\s+/g,' ').slice(-600);
    const inputs = [...document.querySelectorAll('input')].map(i => ({type:i.type, ph:i.placeholder, name:i.name}));
    return { text, inputs };
  });
  console.log(JSON.stringify(dump, null, 1).slice(0, 2000));

  const cookies = await ctx.cookies();
  console.log('cookies count:', cookies.length);
  const hasSession = cookies.some(c => /session|sid|sessionid/i.test(c.name) || c.name === 'passport_csrf_token');
  console.log('hasSession-ish cookie:', hasSession);

  await ctx.storageState({ path: 'storage_state.json' });
  console.log('storage state saved');
  await browser.close();
})();
