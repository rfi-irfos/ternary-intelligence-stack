// HUD measurements and screenshots in headless Chrome (started by e2e/run.sh on the Colony).
// Needs the dev-only window.__albert hook that run.sh adds to a temp copy of the app.
// Prints one line "HUD {...}" with: coverage (open, closed, collapsed, first-visit legend, Tools drawer)
// at 1280/1366/1920, panel top/bottom against the top bar and the rail, the A6 table fit, the F-GPU-3
// key check, the empty-click fold-all from depth 2, and R1 (a real click on slab 20 frames the level
// left of the panel, from a closed and from a collapsed panel).
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
      top: '.top-bar', dock: '.dock', timeline: '.timeline', panel: '.inspect-panel', layer: '.layer-panel',
      legendList: '.legend.open .legend-list', coach: '.coach',
    };
    const boxes = {};
    for (const [k, s] of Object.entries(sel)) {
      const e = document.querySelector(s);
      if (!e || e.hidden || e.closest('[hidden]')) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
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

/** U1: the open panel against the top bar and the rail. */
async function panelSpan(page) {
  return page.evaluate(() => {
    const p = document.querySelector('.inspect-panel').getBoundingClientRect();
    const top = document.querySelector('.top-bar').getBoundingClientRect();
    const rail = document.querySelector('.timeline').getBoundingClientRect();
    const head = document.querySelector('.inspect-panel .panel-head').getBoundingClientRect();
    const body = document.querySelector('.inspect-panel .panel-body');
    return {
      top: Math.round(p.top), topBarBottom: Math.round(top.bottom), bottom: Math.round(p.bottom), railTop: Math.round(rail.top),
      gapAboveRail: Math.round(rail.top - p.bottom), width: Math.round(p.width), headH: Math.round(head.height),
      bodyScrolls: body.scrollHeight > body.clientHeight, bodyOverflowY: getComputedStyle(body).overflowY,
    };
  });
}

const pose = (page) => page.evaluate(() => { const p = window.__albert.rig.pose(); return [p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z].map((v) => +v.toFixed(4)); });
const settle = async (page) => { await sleep(400); await page.waitForFunction(() => !window.__albert.rig.isFlying(), null, { timeout: 15000 }); await sleep(600); };

/** Screen point of a row anchor (slab), and whether the canvas is the top element there. */
const anchorPoint = (page, id) => page.evaluate((id) => {
  const { tower, camera } = window.__albert;
  const q = tower.anchor(id).clone().project(camera);
  const x = ((q.x + 1) / 2) * innerWidth, y = ((1 - q.y) / 2) * innerHeight;
  return { x, y, canvas: document.elementFromPoint(x, y)?.tagName === 'CANVAS' };
}, id);

/** NDC x of the 8 corners of the framed (top) level's mesh box, and the panel's left edge in NDC. */
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
  const panel = document.querySelector('.inspect-panel');
  const left = panel.hidden ? innerWidth : panel.getBoundingClientRect().left;
  return { ndcX: ndc, panelLeftNdc: +((left / innerWidth) * 2 - 1).toFixed(4), allLeftOfPanel: ndc.every((x) => x < (left / innerWidth) * 2 - 1) };
});

/** A6 table fit: no horizontal scroll, badge clear of the header row. */
const a6 = (page) => page.evaluate(() => {
  const d = document.querySelector('.inspect-panel details[data-caveat="A6"]');
  if (!d) return null;
  d.open = true;
  const wrap = d.querySelector('.cv-table-wrap');
  const badge = wrap.querySelector('.badge');
  const ths = [...wrap.querySelectorAll('th')].map((x) => x.getBoundingClientRect());
  const b = badge?.getBoundingClientRect();
  const hits = b ? ths.filter((r) => Math.min(r.right, b.right) - Math.max(r.left, b.left) > 0 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 0).length : 0;
  return { scrollW: wrap.scrollWidth, clientW: wrap.clientWidth, fits: wrap.scrollWidth <= wrap.clientWidth, badgeOverHeader: hits,
    firstTime: wrap.querySelector('time')?.outerHTML ?? null };
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
  const res = { coverage: [], fgpu3: {}, fold: [], r1: [] };

  for (const [w, h] of SIZES) {
    // closed, open (full height), collapsed; A6 table; Tools drawer (Advanced).
    {
      const { ctx, page, errors } = await open(browser, w, h, 'de', 'simple');
      const closed = await measure(page);
      await page.evaluate(() => window.__albert.view.explode('L20.bank'));
      await settle(page);
      const openM = await measure(page);
      const span = await panelSpan(page);
      if (SHOTS) await page.screenshot({ path: `${out}/${w}_01_full_height_panel.png` });
      await page.click('.inspect-panel [data-action="collapse"]');
      await sleep(600);
      const collapsed = await measure(page);
      await page.click('.inspect-panel [data-action="expand"]');
      await sleep(400);
      await page.evaluate(async () => { await window.__albert.view.reassembleAll({ restoreCamera: false }); await window.__albert.panel.openPanel('L20'); });
      await sleep(600);
      await page.click('.inspect-panel [data-toggle="caveats"]').catch(() => undefined);
      await sleep(300);
      const table = await a6(page);
      if (SHOTS && w !== 1920) {
        await page.evaluate(() => document.querySelector('.inspect-panel details[data-caveat="A6"] .cv-table-wrap')?.scrollIntoView({ block: 'end' }));
        await sleep(300);
        await page.screenshot({ path: `${out}/${w}_05_A6_table.png` });
      }
      await ctx.close();
      const adv = await open(browser, w, h, 'en', 'advanced');
      await adv.page.click('.tools-btn');
      await sleep(400);
      const toolsM = await measure(adv.page);
      await adv.ctx.close();
      const first = await open(browser, w, h, 'de', 'simple', null);
      const legend = await measure(first.page);
      if (SHOTS && w === 1366) await first.page.screenshot({ path: `${out}/${w}_06_first_visit.png` });
      await first.ctx.close();
      res.coverage.push({ w, h, closed: closed.coverage, open: openM.coverage, openWithoutTopBar: openM.withoutTopBar, collapsed: collapsed.coverage,
        firstVisitLegend: legend.coverage, firstVisitLegendBoxes: Object.keys(legend.boxes), toolsDrawer: toolsM.coverage, toolsDock: toolsM.boxes.dock,
        panel: span, a6: table, errors: errors.slice(0, 5) });
    }
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
      return { before, after, back: b.textContent, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        afterNext: b.previousElementSibling?.dataset.action };
    });
    if (SHOTS && w === 1366) {
      const r = await page.evaluate(() => { const d = document.querySelector('.dock').getBoundingClientRect(); return { x: d.left, y: d.top, width: d.width, height: d.height }; });
      await page.screenshot({ path: `${out}/${w}_02_speed_pill_dock.png`, clip: r });
    }
    const saved = await pose(page);
    const p9 = await anchorPoint(page, 'L9');
    await page.mouse.click(p9.x, p9.y);
    await settle(page);
    await page.evaluate(() => window.__albert.view.explode('L9.bank'));
    await settle(page);
    const depthBefore = await page.evaluate(() => window.__albert.view.depth());
    const hint = await page.evaluate(() => { const x = document.querySelector('.player-hint'); return { shown: !x.hidden, text: x.textContent }; });
    if (SHOTS && w === 1366) {
      await page.screenshot({ path: `${out}/${w}_03_depth2_before_empty_click.png` });
      const r = await page.evaluate(() => { const d = document.querySelector('.dock').getBoundingClientRect(); return { x: d.left, y: d.top, width: d.width, height: d.height }; });
      await page.screenshot({ path: `${out}/${w}_04_hint_line.png`, clip: r });
    }
    const at = await emptyClick(page);
    await settle(page);
    const after = await pose(page);
    const state = await page.evaluate(() => ({ depth: window.__albert.view.depth(), parts: window.__albert.view.root.children.length, panelHidden: document.querySelector('.inspect-panel').hidden }));
    if (SHOTS && w === 1366) await page.screenshot({ path: `${out}/${w}_07_after_empty_click_from_depth2.png` });
    // Esc from depth 2 goes one level up.
    await page.mouse.click(p9.x, p9.y);
    await settle(page);
    await page.evaluate(() => window.__albert.view.explode('L9.bank'));
    await settle(page);
    await page.keyboard.press('Escape');
    await sleep(800);
    const escDepth = await page.evaluate(() => window.__albert.view.depth());
    res.fold.push({ w, h, pill, l9Click: p9, depthBefore, hint, emptyAt: at, after: state, cameraBackToSaved: JSON.stringify(saved) === JSON.stringify(after),
      saved, cameraAfter: after, escFromDepth2: escDepth, errors: errors.slice(0, 5) });
    await ctx.close();
  }

  // R1: a real click on slab 20 from a closed and from a collapsed panel.
  for (const [w, h] of [[1280, 720], [1366, 768]]) {
    for (const start of ['closed', 'collapsed']) {
      const { ctx, page } = await open(browser, w, h, 'de', 'simple');
      if (start === 'collapsed') {
        await page.evaluate(() => window.__albert.panel.openPanel('L5'));
        await sleep(400);
        await page.click('.inspect-panel [data-action="collapse"]');
        await sleep(600);
      }
      const p = await anchorPoint(page, 'L20');
      await page.mouse.click(p.x, p.y);
      await settle(page);
      const c = await framedCorners(page);
      const depth = await page.evaluate(() => window.__albert.view.depth());
      res.r1.push({ w, h, start, click: p, depth, ...c });
      await ctx.close();
    }
  }

  // F-GPU-3: the step keys on the focused sentence select (Advanced, Tools open).
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    const { ctx, page } = await open(browser, 1366, 768, 'en', 'advanced');
    await page.click('.tools-btn');
    await sleep(300);
    const sel = () => page.evaluate(() => ({ prompt: document.querySelector('.player-prompt').value, s: window.__albert.bar.selection(), i: window.__albert.bar.player().index() }));
    await page.click('.dock [data-action="next"]').catch(() => undefined);
    await page.click('.dock [data-action="next"]').catch(() => undefined);
    const before = await sel();
    await page.focus('.player-prompt');
    await page.keyboard.press(key);
    await sleep(300);
    const after = await sel();
    // Then the step key once more, wherever the focus is now (after a native change it is back on the page).
    const focus = await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
    await page.keyboard.press('ArrowRight');
    await sleep(300);
    res.fgpu3[key] = { before, after, focusAfter: focus, afterNextRight: await sel() };
    await ctx.close();
  }

  // F-GPU-3 by pointer: pick "de" in the sentence select, then the step key steps the run and keeps "de".
  {
    const { ctx, page } = await open(browser, 1366, 768, 'en', 'advanced');
    await page.click('.tools-btn');
    await sleep(300);
    // A mouse pick focuses the select first (selectOption alone leaves the focus where it was).
    await page.focus('.player-prompt');
    await page.selectOption('.player-prompt', 'de');
    await sleep(400);
    const sel = () => page.evaluate(() => ({ prompt: document.querySelector('.player-prompt').value, i: window.__albert.bar.player().index(),
      focus: document.activeElement?.className || document.activeElement?.tagName }));
    const before = await sel();
    await page.keyboard.press('ArrowRight');
    await sleep(300);
    res.fgpu3.pointerPick = { before, after: await sel() };
    await ctx.close();
  }

  console.log('HUD ' + JSON.stringify(res));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
