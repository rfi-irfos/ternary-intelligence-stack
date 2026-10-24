// Renders the social preview image (public/og-image.png, 1200x630) and the raster icons from the running explorer.
//   public/og-image.png        a real screenshot of the overview (the 3D scene as the app draws it), HUD hidden,
//                              with the wordmark and one line set over it
//   public/icon-192.png, icon-512.png, apple-touch-icon.png   rasters of public/favicon.svg
// Run on the Colony (headless Chromium, WebGL 2 from SwiftShader), from albert-moe-13/explorer:
//   colony-run -a albert-moe-13/explorer/public/og-image.png -a albert-moe-13/explorer/public/icon-192.png \
//     -a albert-moe-13/explorer/public/icon-512.png -a albert-moe-13/explorer/public/apple-touch-icon.png -- \
//     'cd albert-moe-13/explorer && npm ci --silent && npx playwright install chromium && node tools/render-share-images.mjs'
// It builds the e2e variant (VITE_E2E=1 adds the window.__albert hook) into dist-share/ and serves it itself.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4182;
const WORDMARK = 'Xperience albert.';
const FIRST = Number(process.env.OG_FIRST ?? 0);
const LAST = Number(process.env.OG_LAST ?? 22);
const LINE = 'Walk through a ternary mixture-of-experts model in 3D';

execFileSync('npx', ['vite', 'build', '--outDir', 'dist-share', '--logLevel', 'error'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_E2E: '1' } });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-share', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(base)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  // --- social preview -------------------------------------------------------------------------------------------
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    localStorage.setItem('albert.lang', 'en');
    localStorage.setItem('albert.mode', 'advanced');
    localStorage.setItem('albert.coach', 'done');
    localStorage.setItem('albert.introSeen', '1');
    localStorage.setItem('albert-explorer.quality', 'high');
  });
  await page.goto(base);
  await page.waitForFunction(() => !!window.__albert, null, { timeout: 120_000 });
  await page.evaluate(() => window.__albert.bar.ready);
  await page.click('.lobby-entry[data-entry="explore"]');
  await page.waitForFunction(() => !window.__albert.rig.isFlying(), null, { timeout: 60_000 });
  // Frame the first layers of the row below the text: the whole 46-layer overview is a thin diagonal at this size.
  await page.evaluate(([from, to]) => {
    const { rig, tower } = window.__albert;
    const a = tower.anchor(`L${from}`).clone();
    const b = tower.anchor(`L${to}`).clone();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    rig.setInsets({ top: 215, right: 30, bottom: 20, left: 30 });
    return rig.frame(mid, (b.x - a.x) / 2 + 3, 8, 0);
  }, [FIRST, LAST]);
  await page.waitForFunction(() => !window.__albert.rig.isFlying(), null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(([mark, line]) => {
    for (const el of [...document.body.children]) if (el.tagName !== 'CANVAS' && el.tagName !== 'SCRIPT') el.style.display = 'none';
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(5,9,20,.92) 0,rgba(5,9,20,.55) 34%,rgba(5,9,20,0) 52%);';
    o.innerHTML = `<div style="position:absolute;left:64px;top:44px;font:700 84px/1.05 'Space Grotesk',system-ui,sans-serif;color:#f3f0e8"></div>
      <div style="position:absolute;left:68px;top:148px;font:500 34px/1.3 Inter,system-ui,sans-serif;color:#e8eefc"></div>`;
    o.children[0].textContent = mark;
    o.children[1].textContent = line;
    document.body.append(o);
  }, [WORDMARK, LINE]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'public/og-image.png', type: 'png' });
  await page.close();

  // --- icons from the favicon -----------------------------------------------------------------------------------
  const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  for (const [name, size, opaque] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['apple-touch-icon.png', 180, true]]) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<style>html,body{margin:0;background:${opaque ? '#000' : 'transparent'}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await p.screenshot({ path: `public/${name}`, type: 'png', omitBackground: !opaque });
    await p.close();
  }
} finally {
  await browser.close();
  server.kill();
}
