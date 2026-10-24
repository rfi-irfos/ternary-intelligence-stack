// The browser sequence of fix round 2 (B and C): Explore with the intro, skip it, open the sidebar by the edge tab
// (and by the gear), then check that the overview refit and that nothing started the run.
// Prints one line "SEQ {...}". Run with: SCRIPT=sequence.cjs bash e2e/run.sh
const { chromium } = require(process.env.HOME + '/work/pw/node_modules/playwright');
const URL = process.env.URL || 'http://127.0.0.1:4181/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = (page) => page.evaluate(() => {
  const a = window.__albert;
  const p = a.rig.pose();
  const pl = a.bar.player();
  return {
    atOverview: a.rig.atOverview(), flying: a.rig.isFlying(), sidebarOpen: a.sidebar.isOpen(),
    playing: pl?.playing() ?? null, index: pl?.index() ?? null, speed: pl?.speed() ?? null,
    pose: [p.position.x, p.position.y, p.position.z].map((v) => +v.toFixed(2)),
    insets: a.rig.insets(),
  };
});

async function run(browser, skipWith, openWith) {
  const ctx = await browser.newContext({ viewport: { width: 1568, height: 709 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(() => {
    localStorage.setItem('albert.lang', 'de');
    localStorage.setItem('albert.mode', 'advanced');
    localStorage.setItem('albert.coach', 'done');
    localStorage.setItem('albert-explorer.quality', 'low');
  });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__albert, null, { timeout: 30000 });
  await page.evaluate(() => window.__albert.bar.ready);
  await page.click('.lobby-entry[data-entry="explore"]');
  await sleep(1200);
  const intro = await page.evaluate(() => !!document.querySelector('.intro-skip'));
  if (intro) {
    if (skipWith === 'key') await page.keyboard.press('Escape');
    else await page.mouse.click(300, 300);
  }
  await sleep(2500);
  const afterSkip = await state(page);
  if (openWith === 'canvasThenEdge') {
    // a plain click on empty canvas (no drag) before the edge tab: the overview flag must survive it
    await page.mouse.click(640, 660);
    await sleep(400);
  }
  await page.click('.sidebar-edge');
  await sleep(2500);
  const afterOpen = await state(page);
  await page.click('.os-sidebar .sidebar-close');
  await sleep(2500);
  const afterClose = await state(page);
  await ctx.close();
  return { skipWith, openWith, intro, afterSkip, afterOpen, afterClose, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = [];
  for (const [s, o] of [['click', 'edge'], ['key', 'edge'], ['click', 'canvasThenEdge']]) out.push(await run(browser, s, o));
  console.log('SEQ ' + JSON.stringify(out));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
