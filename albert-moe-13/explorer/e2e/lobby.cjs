// Lobby, intro and quick-pass check in headless Chrome (Task 12; started by `SCRIPT=lobby.cjs bash e2e/run.sh`).
// Needs the dev-only window.__albert hook that run.sh adds to a temp copy of the app.
// Prints one line "LOBBY {...}": lobby layout per size and language, drift (camera moves only while the
// lobby is up), the camera after entering (still without input), the intro (length, skip), the quick pass
// (pace, length at 1x), home -> lobby, and every console error or HTTP >= 400 (the favicon).
const { chromium } = require(process.env.HOME + '/work/pw/node_modules/playwright');
const out = process.env.OUT || '.';
const URL = process.env.URL || 'http://127.0.0.1:4181/';
const SHOTS = process.env.SHOTS === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, w, h, { lang = 'de', mode = 'simple', quality = 'high', reduced = true, introSeen = true, coach = 'done', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.addInitScript(([lang, mode, quality, introSeen, coach]) => {
    localStorage.setItem('albert.lang', lang);
    localStorage.setItem('albert.mode', mode);
    if (coach) localStorage.setItem('albert.coach', coach);
    if (introSeen) localStorage.setItem('albert.introSeen', '1');
    localStorage.setItem('albert-explorer.quality', quality);
  }, [lang, mode, quality, introSeen, coach]);
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__albert, null, { timeout: 30000 });
  await page.evaluate(() => window.__albert.bar.ready);
  await sleep(1500);
  return { ctx, page, errors };
}

const pose = (page) => page.evaluate(() => { const p = window.__albert.rig.pose(); return [p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z].map((v) => +v.toFixed(3)); });

/** Layout of the lobby: entry boxes, footer, whether anything leaves the viewport, the HUD state under it. */
const layout = (page) => page.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const lobby = document.querySelector('.lobby');
  const entries = [...document.querySelectorAll('.lobby-entry')].map((e) => ({ id: e.dataset.entry, title: e.querySelector('.lobby-entry-title').textContent, box: r(e) }));
  const all = [...lobby.querySelectorAll('*')].filter((e) => e.offsetParent !== null && !e.closest('[hidden]'));
  const outside = all.filter((e) => { const b = e.getBoundingClientRect(); return b.right > innerWidth + 1 || b.left < -1; }).map((e) => e.className || e.tagName);
  return {
    visible: !lobby.hidden, still: lobby.dataset.still, entries, logo: r(document.querySelector('.lobby-logo')),
    logoFont: getComputedStyle(document.querySelector('.lobby-logo')).fontFamily.split(',')[0],
    sub: document.querySelector('.lobby-sub').textContent, foot: r(document.querySelector('.lobby-foot')),
    checkpoint: document.querySelector('.lobby-checkpoint').textContent, scrollH: lobby.scrollHeight, clientH: lobby.clientHeight,
    horizontalOverflow: outside.slice(0, 5), hudVisibility: getComputedStyle(document.querySelector('.top-bar')).visibility,
    backdrop: getComputedStyle(lobby).backdropFilter, minEntryH: Math.min(...entries.map((e) => e.box.h)),
  };
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const res = { lobby: [], low: null, phone: null, drift: null, enter: null, intro: null, quick: null, home: null };

  // Lobby DE and EN at three widths (High, motion on, so the drift runs).
  for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]]) {
    for (const lang of ['de', 'en']) {
      const { ctx, page, errors } = await open(browser, w, h, { lang, reduced: false });
      const l = await layout(page);
      if (SHOTS) await page.screenshot({ path: `${out}/lobby_${lang}_${w}.png` });
      res.lobby.push({ w, h, lang, ...l, errors: errors.slice(0, 5) });
      await ctx.close();
    }
  }

  // Lobby on Low: a still frame.
  {
    const { ctx, page, errors } = await open(browser, 1366, 768, { quality: 'low', reduced: false });
    const a = await pose(page);
    await sleep(2000);
    const b = await pose(page);
    res.low = { ...(await layout(page)), poseStill: JSON.stringify(a) === JSON.stringify(b), errors: errors.slice(0, 5) };
    if (SHOTS) await page.screenshot({ path: `${out}/lobby_de_1366_low.png` });
    await ctx.close();
  }

  // Phone width.
  {
    const { ctx, page, errors } = await open(browser, 390, 844, { reduced: false, mobile: true });
    res.phone = { ...(await layout(page)), errors: errors.slice(0, 5) };
    if (SHOTS) await page.screenshot({ path: `${out}/lobby_de_390_phone.png`, fullPage: false });
    await ctx.close();
  }

  // Drift: the camera moves while the lobby is up; after Explore it rests until the visitor acts.
  {
    const { ctx, page, errors } = await open(browser, 1366, 768, { reduced: false });
    const d0 = await pose(page);
    await sleep(3000);
    const d1 = await pose(page);
    await page.click('.lobby-entry[data-entry="explore"]');
    await page.waitForFunction(() => !window.__albert.rig.isFlying(), null, { timeout: 15000 });
    await sleep(500);
    const e0 = await pose(page);
    await sleep(3000);
    const e1 = await pose(page);
    res.drift = { lobbyMoves: JSON.stringify(d0) !== JSON.stringify(d1), d0, d1 };
    res.enter = {
      cameraStillAfterEntry: JSON.stringify(e0) === JSON.stringify(e1), e0, e1,
      lobbyHidden: await page.evaluate(() => document.querySelector('.lobby').hidden),
      playing: await page.evaluate(() => window.__albert.bar.player().playing()),
      hud: await page.evaluate(() => getComputedStyle(document.querySelector('.top-bar')).visibility),
      errors: errors.slice(0, 5),
    };
    // Home -> lobby.
    await page.click('.top-bar .home-btn');
    await sleep(800);
    res.home = await page.evaluate(() => ({ lobbyVisible: !document.querySelector('.lobby').hidden, homeLabel: document.querySelector('.home-btn').getAttribute('aria-label') }));
    await ctx.close();
  }

  // Intro (first visit, motion allowed): length, the caption line, then a second visit without it.
  {
    const { ctx, page, errors } = await open(browser, 1366, 768, { reduced: false, introSeen: false, coach: null });
    await page.click('.lobby-entry[data-entry="explore"]');
    const t0 = Date.now();
    await sleep(6000);
    const mid = await page.evaluate(() => ({ shown: !!document.querySelector('.intro'), line: document.querySelector('.intro-line')?.textContent, skip: document.querySelector('.intro-skip')?.textContent,
      hud: getComputedStyle(document.querySelector('.top-bar')).visibility }));
    if (SHOTS) await page.screenshot({ path: `${out}/intro_de_1366.png` });
    await page.waitForFunction(() => !document.querySelector('.intro'), null, { timeout: 60000 });
    const seconds = (Date.now() - t0) / 1000;
    await sleep(800);
    const after = await page.evaluate(() => ({ seen: localStorage.getItem('albert.introSeen'), coach: !!document.querySelector('.coach'), hud: getComputedStyle(document.querySelector('.top-bar')).visibility }));
    if (SHOTS) await page.screenshot({ path: `${out}/intro_end_overview_1366.png` });
    // Skip: reload, clear the flag, Explore, then one key.
    await page.evaluate(() => localStorage.removeItem('albert.introSeen'));
    await page.reload();
    await page.waitForFunction(() => !!window.__albert, null, { timeout: 30000 });
    await page.evaluate(() => window.__albert.bar.ready);
    await sleep(800);
    await page.click('.lobby-entry[data-entry="explore"]');
    await sleep(1500);
    const tk = Date.now();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('.intro'), null, { timeout: 5000 });
    const skip = { ms: Date.now() - tk, playing: await page.evaluate(() => window.__albert.bar.player().playing()) };
    res.intro = { mid, seconds: +seconds.toFixed(1), after, skip, errors: errors.slice(0, 5) };
    await ctx.close();
  }

  // Quick pass from the lobby's Watch (DE Simple, reduced motion so no intro): pace, caption, length.
  {
    const { ctx, page, errors } = await open(browser, 1366, 768, { reduced: true });
    await page.click('.lobby-entry[data-entry="watch"]');
    await sleep(5000);
    const run = await page.evaluate(() => {
      const p = window.__albert.bar.player();
      const tag = document.querySelector('.quick-tag');
      return { playing: p.playing(), pace: p.pace(), index: p.index(), total: p.ops.length, prompt: window.__albert.bar.selection().promptId,
        tag: tag.hidden ? null : tag.textContent, tagTip: tag.title, caption: document.querySelector('.step-line').textContent };
    });
    if (SHOTS) await page.screenshot({ path: `${out}/quick_pass_running_de_1366.png` });
    // The caption then names the layer ("Ebene k von 46 · ...") and changes once per layer group.
    await page.waitForFunction(() => /^Ebene \d+ von 46/.test(document.querySelector('.step-text').textContent), null, { timeout: 120000 });
    await sleep(300);
    const layerCaption = await page.evaluate(() => ({ text: document.querySelector('.step-text').textContent, live: document.querySelector('.step-line').getAttribute('aria-live') }));
    if (SHOTS) await page.screenshot({ path: `${out}/quick_pass_caption_de_1366.png` });
    const t0 = Date.now();
    // Progress every 10 s (SwiftShader frame rate is low; a long frame is clamped, so slow frames stretch the run).
    const progress = [];
    while (Date.now() - t0 < 240000) {
      const st = await page.evaluate(() => ({ playing: window.__albert.bar.player().playing(), index: window.__albert.bar.player().index() }));
      progress.push(st.index);
      if (!st.playing) break;
      await sleep(10000);
    }
    const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
    const seconds = 5 + (Date.now() - t0) / 1000;
    const end = await page.evaluate(() => ({ index: window.__albert.bar.player().index(), total: window.__albert.bar.player().ops.length }));
    res.quick = { ...run, layerCaption, wallSeconds: +seconds.toFixed(1), end, progress, fps, errors: errors.slice(0, 5) };
    await ctx.close();
  }

  console.log('LOBBY ' + JSON.stringify(res));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
