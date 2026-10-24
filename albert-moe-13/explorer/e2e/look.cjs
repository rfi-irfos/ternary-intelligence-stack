// Screenshots for the look of the sidebar and the dock (fix round 2, items A, E, F, G, H).
// Run with: SCRIPT=look.cjs OUT=dir bash e2e/run.sh   (stdout: one "LOOK {...}" line with the measured colours)
const { chromium } = require(process.env.HOME + '/work/pw/node_modules/playwright');
const URL = process.env.URL || 'http://127.0.0.1:4181/';
const OUT = process.env.OUT || 'e2e/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = [];
  for (const [mode, id] of [['simple', 'L12.expert.7'], ['advanced', 'L12.B.router'], ['simple', 'L20.slab']]) {
    const ctx = await browser.newContext({ viewport: { width: 1568, height: 800 } });
    const page = await ctx.newPage();
    await page.addInitScript((m) => {
      localStorage.setItem('albert.lang', 'de'); localStorage.setItem('albert.mode', m);
      localStorage.setItem('albert.coach', 'done'); localStorage.setItem('albert-explorer.quality', 'low');
    }, mode);
    await page.goto(URL);
    await page.waitForFunction(() => !!window.__albert, null, { timeout: 30000 });
    await page.evaluate(() => window.__albert.bar.ready);
    await page.click('.lobby-entry[data-entry="explore"]');
    await sleep(1500);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.evaluate((pid) => window.__albert.panel.openPanel(pid), id).catch(() => undefined);
    await page.evaluate(() => window.__albert.sidebar.open(['session', 'model', 'inspect', 'analysis']));
    await sleep(1500);
    const tag = `${mode}_${id.replace(/\W+/g, '-')}`;
    await page.screenshot({ path: `${OUT}/look_${tag}.png` });
    const colours = await page.evaluate(() => {
      const c = (q) => { const e = document.querySelector(q); return e ? getComputedStyle(e).color : null; };
      const b = (q, p) => { const e = document.querySelector(q); return e ? getComputedStyle(e)[p] : null; };
      return {
        pill: b('.panel-head .role-chip', 'borderColor'), pillFill: b('.panel-head .role-chip', 'backgroundColor'),
        factsBar: b('.info-card', 'borderLeftColor'), number: c('.info-card .stat-value'),
        tab: b('.panel-tab.active', 'borderBottomColor'),
        secIcons: [...document.querySelectorAll('.side-sec-icon')].map((e) => getComputedStyle(e).color),
      };
    });
    res.push({ mode, id, colours });
    await ctx.close();
  }
  console.log('LOOK ' + JSON.stringify(res));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
