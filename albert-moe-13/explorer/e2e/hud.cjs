// HUD measurements and screenshots in headless Chrome (started by e2e/run.sh on the Colony).
// Needs the dev-only window.__albert hook that run.sh adds to a temp copy of the app.
// Prints one line "HUD {...}" with: coverage (sidebar closed, open, 40 %, first-visit legend) at
// 1280/1366/1920, the dock against the viewport centre and the open sidebar, the sidebar head row
// (nothing clipped), stepper vs sidebar after a pick, the speed pill, the empty-click fold-all from
// depth 2, and R1 (a real click on a slab frames the level left of the sidebar).
const { chromium } = require(process.env.HOME + '/work/pw/node_modules/playwright');
const out = process.env.OUT || '.';
const URL = process.env.URL || 'http://127.0.0.1:4181/';
const SHOTS = process.env.SHOTS === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[1280, 720], [1366, 768], [1920, 1080]];

async function open(browser, w, h, lang, mode, coach = 'done') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.addInitScript(([lang, mode, coach]) => {
    localStorage.setItem('albert.lang', lang);
    localStorage.setItem('albert.mode', mode);
    if (coach) localStorage.setItem('albert.coach', coach);
    localStorage.setItem('albert-explorer.quality', 'low');
  }, [lang, mode, coach]);
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__albert, null, { timeout: 30000 });
  await page.evaluate(() => window.__albert.bar.ready);
  // The lobby comes first (Task 12): enter the scene through Explore (reduced motion: no intro).
  await page.click('.lobby-entry[data-entry="explore"]');
  await sleep(2500);
  return { ctx, page, errors };
}

/** Union area of the visible HUD boxes (2 px grid), with and without the top bar (OS chrome). */
async function measure(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const sel = {
      top: '.top-bar', dock: '.dock', timeline: '.timeline', sidebar: '.os-sidebar', edge: '.sidebar-edge',
      layer: '.layer-panel', legendCard: '.legend.open .legend-card', coach: '.coach',
    };
    const boxes = {};
    for (const [k, s] of Object.entries(sel)) {
      const e = document.querySelector(s);
      if (!e || e.hidden || e.closest('[hidden]')) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (k === 'sidebar' && r.left >= W - 1) continue;
      boxes[k] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }
    const area = (list) => {
      const step = 2;
      let hit = 0, all = 0;
      for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
        all++;
        if (list.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) hit++;
      }
      return +(hit / all).toFixed(4);
    };
    const list = Object.values(boxes);
    return { coverage: area(list), withoutTopBar: area(Object.entries(boxes).filter(([k]) => k !== 'top').map(([, b]) => b)), boxes };
  });
}

/** Dock against the viewport centre and the open sidebar; the sidebar head row against clipping. */
async function dockAndHead(page) {
  return page.evaluate(() => {
    const W = innerWidth;
    const d = document.querySelector('.dock').getBoundingClientRect();
    const sb = document.querySelector('.os-sidebar');
    const s = sb.getBoundingClientRect();
    const open = s.left < W - 1;
    const kids = [...document.querySelectorAll('.sidebar-head > *')].map((e) => {
      const r = e.getBoundingClientRect();
      return { cls: e.className, w: Math.round(r.width), h: Math.round(r.height), clipped: e.scrollWidth > e.clientWidth + 1 };
    });
    const seg = [...document.querySelectorAll('.sidebar-head .mode-seg button, .sidebar-head-tools button')].map((e) => {
      const r = e.getBoundingClientRect();
      return { text: e.textContent, w: Math.round(r.width), h: Math.round(r.height), clipped: e.scrollWidth > e.clientWidth + 1 };
    });
    return {
      viewportW: W, dock: { left: Math.round(d.left), right: Math.round(d.right), w: Math.round(d.width) },
      dockCentreOffset: +((d.left + d.right) / 2 - W / 2).toFixed(1), sidebarLeft: open ? Math.round(s.left) : null,
      dockClearOfSidebar: open ? d.right <= s.left : true, head: kids, headButtons: seg,
    };
  });
}

/** Sidebar stepper text vs the dock stepper text (item 12). */
const stepperVsSidebar = (page) => page.evaluate(() => ({
  sidebar: document.querySelector('.os-sidebar .panel-title, .os-sidebar .side-sec-body')?.textContent?.slice(0, 80) ?? null,
  stepper: document.querySelector('.dock .layer-stepper')?.textContent ?? null,
}));

const pose = (page) => page.evaluate(() => { const p = window.__albert.rig.pose(); return [p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z].map((v) => +v.toFixed(4)); });
const settle = async (page) => { await sleep(400); await page.waitForFunction(() => !window.__albert.rig.isFlying(), null, { timeout: 15000 }); await sleep(600); };

/** Screen point of a row anchor (slab), and whether the canvas is the top element there. */
const anchorPoint = (page, id) => page.evaluate((id) => {
  const { tower, camera } = window.__albert;
  const q = tower.anchor(id).clone().project(camera);
  const x = ((q.x + 1) / 2) * innerWidth, y = ((1 - q.y) / 2) * innerHeight;
  return { x, y, canvas: document.elementFromPoint(x, y)?.tagName === 'CANVAS' };
}, id);

/** NDC x of the 8 corners of the framed (top) level's mesh box, and the sidebar's left edge in NDC. */
const framedCorners = (page) => page.evaluate(() => {
  const { view, camera } = window.__albert;
  const g = view.root.children[view.root.children.length - 1];
  if (!g) return null;
  const V = camera.position.constructor;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const p = new V(x, y, z).applyMatrix4(o.matrixWorld);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
  });
  const ndc = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) ndc.push(+new V(x, y, z).project(camera).x.toFixed(4));
  const sb = document.querySelector('.os-sidebar');
  const left = sb.getBoundingClientRect().left;
  return { ndcX: ndc, sidebarLeftNdc: +((left / innerWidth) * 2 - 1).toFixed(4), allLeftOfSidebar: ndc.every((x) => x < (left / innerWidth) * 2 - 1) };
});

/** Clicks an empty canvas point (no HUD, nothing of the open level). Returns where it clicked. */
async function emptyClick(page) {
  const pts = await page.evaluate(() => {
    const top = document.querySelector('.top-bar').getBoundingClientRect().bottom;
    const c = [[24, top + 30], [innerWidth * 0.3, top + 24], [24, innerHeight * 0.5], [innerWidth * 0.5, top + 16]];
    return c.filter(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS');
  });
  const [x, y] = pts[0];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  return { x: Math.round(x), y: Math.round(y) };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = { coverage: [], fold: [], r1: [], picks: [] };

  for (const [w, h] of SIZES) {
    // closed, open (default width), open at the 40 % maximum; first visit with the legend.
    const { ctx, page, errors } = await open(browser, w, h, 'de', 'simple');
    const closed = await measure(page);
    await page.click('.sidebar-edge');
    await sleep(500);
    const openM = await measure(page);
    const geo = await dockAndHead(page);
    if (SHOTS) await page.screenshot({ path: `${out}/${w}_01_sidebar_open.png` });
    await page.evaluate(() => window.__albert.sidebar.setWidth(Math.round(innerWidth * 0.4)));
    await sleep(500);
    const wide = await dockAndHead(page);
    if (SHOTS) await page.screenshot({ path: `${out}/${w}_02_sidebar_40.png` });
    await page.evaluate(() => window.__albert.sidebar.setWidth(280));
    await sleep(400);
    const narrow = await dockAndHead(page);
    await page.keyboard.press('Escape');
    await sleep(500);
    const escClosed = await page.evaluate(() => !window.__albert.sidebar.isOpen());
    await ctx.close();
    const first = await open(browser, w, h, 'de', 'simple', null);
    const legend = await measure(first.page);
    if (SHOTS && w === 1366) await first.page.screenshot({ path: `${out}/${w}_03_first_visit.png` });
    await first.ctx.close();
    res.coverage.push({ w, h, closed: closed.coverage, open: openM.coverage, openWithoutTopBar: openM.withoutTopBar, firstVisitLegend: legend.coverage,
      geo, wide, narrow, escClosed, errors: errors.slice(0, 5) });
  }

  // Gear opens the sidebar at Darstellung; no Panel button in the top bar.
  {
    const { ctx, page } = await open(browser, 1366, 768, 'de', 'simple');
    const before = await page.evaluate(() => ({ panelBtn: !!document.querySelector('.sidebar-btn'), open: window.__albert.sidebar.isOpen() }));
    await page.click('.top-bar .settings-btn').catch(() => undefined);
    await sleep(500);
    const after = await page.evaluate(() => ({ open: window.__albert.sidebar.isOpen() }));
    res.gear = { before, after };
    await ctx.close();
  }

  // Item 12: a real click on a slab in the overview; the sidebar and the dock stepper must agree.
  for (const [w, h] of [[1568, 709], [1366, 768]]) {
    const { ctx, page } = await open(browser, w, h, 'de', 'simple');
    const p = await anchorPoint(page, 'L2');
    await page.mouse.click(p.x, p.y);
    await settle(page);
    const s = await stepperVsSidebar(page);
    res.picks.push({ w, h, click: p, ...s, selection: await page.evaluate(() => window.__albert.bar.selection()) });
    await ctx.close();
  }

  // Speed pill and hint line (1366, DE Simple), the fold-all from depth 2.
  for (const [w, h] of [[1366, 768], [1280, 720]]) {
    const { ctx, page, errors } = await open(browser, w, h, 'de', 'simple');
    const pill = await page.evaluate(() => {
      const b = document.querySelector('.speed-pill');
      const r = b.getBoundingClientRect();
      const before = [b.textContent, window.__albert.bar.player().speed()];
      b.click();
      const after = [b.textContent, window.__albert.bar.player().speed(), b.getAttribute('aria-label'), b.title];
      b.click(); b.click(); b.click();
      return { before, after, back: b.textContent, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    });
    if (SHOTS && w === 1366) {
      const r = await page.evaluate(() => { const d = document.querySelector('.dock').getBoundingClientRect(); return { x: d.left, y: d.top, width: d.width, height: d.height }; });
      await page.screenshot({ path: `${out}/${w}_04_speed_pill_dock.png`, clip: r });
    }
    const saved = await pose(page);
    const p9 = await anchorPoint(page, 'L9');
    await page.mouse.click(p9.x, p9.y);
    await settle(page);
    await page.evaluate(() => window.__albert.view.explode('L9.bank'));
    await settle(page);
    const depthBefore = await page.evaluate(() => window.__albert.view.depth());
    const hint = await page.evaluate(() => { const x = document.querySelector('.player-hint'); return { shown: !!x && !x.hidden, text: x?.textContent ?? null }; });
    const at = await emptyClick(page);
    await settle(page);
    const after = await pose(page);
    const state = await page.evaluate(() => ({ depth: window.__albert.view.depth(), parts: window.__albert.view.root.children.length }));
    await page.mouse.click(p9.x, p9.y);
    await settle(page);
    await page.evaluate(() => window.__albert.view.explode('L9.bank'));
    await settle(page);
    await page.keyboard.press('Escape');
    await sleep(800);
    const escDepth = await page.evaluate(() => window.__albert.view.depth());
    res.fold.push({ w, h, pill, l9Click: p9, depthBefore, hint, emptyAt: at, after: state, cameraBackToSaved: JSON.stringify(saved) === JSON.stringify(after),
      escFromDepth2: escDepth, errors: errors.slice(0, 5) });
    await ctx.close();
  }

  // R1: a real click on slab 20 frames the level left of the open sidebar.
  for (const [w, h] of [[1280, 720], [1366, 768]]) {
    const { ctx, page } = await open(browser, w, h, 'de', 'simple');
    await page.click('.sidebar-edge');
    await sleep(600);
    const p = await anchorPoint(page, 'L20');
    await page.mouse.click(p.x, p.y);
    await settle(page);
    const c = await framedCorners(page);
    const depth = await page.evaluate(() => window.__albert.view.depth());
    res.r1.push({ w, h, click: p, depth, ...c });
    await ctx.close();
  }

  console.log('HUD ' + JSON.stringify(res));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
