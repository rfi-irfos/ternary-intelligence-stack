import { expect, test } from '@playwright/test';
import { enter, pickPoint, settle, start } from './helpers';

test.describe('smoke', () => {
  test('loads: the dock shows 1 / 46 and the timeline runs from 0:00 to the real end of the run', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    await enter(page);
    await expect(page.locator('.dock .layer-count')).toHaveText('1 / 46');
    await expect(page.locator('.tl-time--start')).toHaveText('0:00');
    const end = await page.locator('.tl-time--end').textContent();
    expect(end).toMatch(/^\d+:\d\d$/);
    // the printed end is the run's own length (read from the player, not typed in)
    const seconds = await page.evaluate(() => Math.round(window.__albert.bar.timing().duration()));
    expect(Number(await page.locator('.tl-track').getAttribute('aria-valuemax'))).toBe(seconds);
    const [m, s] = end!.split(':').map(Number);
    expect(m! * 60 + s!).toBe(seconds);
    expect(errors).toEqual([]);
    // the boot text is gone once the scene is drawn
    await expect(page.locator('#boot')).toHaveCount(0);
  });

  test('favicon and page title are served', async ({ page, request }) => {
    await start(page);
    const res = await request.get('/favicon.svg');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('svg');
    expect(await page.title()).toBe('Xperience albert. — a ternary MoE model in 3D');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  });

  test('clicking an expert opens the panel with c_fc [1024 × 256]', async ({ page }) => {
    await enter(page);
    // open the expert bank of layer 12 (the level the visitor reaches by clicking the slab), then click an expert for real
    await page.evaluate(() => window.__albert.view.explode('L12.bank'));
    await settle(page);
    const p = await pickPoint(page, /^L12\.expert\.\d+$/);
    expect(p, 'an expert is drawn somewhere on the canvas').not.toBeNull();
    await page.mouse.click(p!.x, p!.y);
    await settle(page);
    const n = p!.id.split('.').pop();
    await page.click('[role=tab][data-tab="tensors"]');
    const row = page.locator(`tr[data-tensor="blocks.12.experts.${n}.c_fc.weight"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('[1024 × 256]');
    await expect(row).toHaveAttribute('data-dtype', 'ternary');
  });

  test('no WebGL2 shows the fallback page', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
        return id === 'webgl2' ? null : (orig as (...a: unknown[]) => unknown).call(this, id, ...rest);
      } as typeof orig;
      localStorage.setItem('albert.lang', 'en');
    });
    await page.goto('/');
    await page.waitForURL('**/fallback.html');
    await expect(page.locator('h1:visible')).toContainText('without the 3D view');
    // real data: 46 layers, the 7 gates, a c_fc tensor, and the caveats
    const layers = page.locator('table:has(caption:text("All layers")) tbody tr');
    await expect(layers.filter({ visible: true })).toHaveCount(46);
    await expect(page.locator('main [data-l="en"]')).toContainText('[1024 × 256]');
    await expect(page.locator('article.caveat:visible')).toHaveCount(9);
    expect(await page.locator('canvas').count()).toBe(0);
    // the language switch changes what is shown
    await page.click('button[data-set="de"]');
    await expect(page.locator('h1:visible')).toContainText('ohne 3D-Ansicht');
    // the link goes back to the app
    expect(await page.locator('a:visible').first().getAttribute('href')).toBe('./');
  });

  test('a lost WebGL context shows the overlay with a reload, a restore rebuilds the view', async ({ page }) => {
    await enter(page);
    await page.evaluate(() => {
      const gl = window.__albert.renderer.getContext() as WebGL2RenderingContext;
      (window as unknown as { __ext: WEBGL_lose_context }).__ext = gl.getExtension('WEBGL_lose_context')!;
      (window as unknown as { __ext: WEBGL_lose_context }).__ext.loseContext();
    });
    const overlay = page.locator('.gl-lost');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Reload' })).toBeFocused();
    await expect(overlay).toContainText('The 3D view stopped');
    await page.evaluate(() => (window as unknown as { __ext: WEBGL_lose_context }).__ext.restoreContext());
    await expect(overlay).toBeHidden();
    // drawing runs again: the renderer's frame counter moves and the context is live
    const f0 = await page.evaluate(() => window.__albert.renderer.info.render.frame);
    await page.waitForTimeout(1500);
    const f1 = await page.evaluate(() => window.__albert.renderer.info.render.frame);
    expect(f1).toBeGreaterThan(f0);
    expect(await page.evaluate(() => window.__albert.renderer.getContext().isContextLost())).toBe(false);
  });

  test('keyboard: Tab reaches the dock, the top bar and the Workbench; Esc steps back one level per press', async ({ page }) => {
    await enter(page);
    const reached = new Set<string>();
    for (let i = 0; i < 60 && reached.size < 3; i++) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return '';
        if (a.closest('.dock')) return 'dock';
        if (a.closest('.top-bar')) return 'top';
        if (a.closest('.os-sidebar, .sidebar-edge')) return 'workbench';
        return '';
      });
      if (where) reached.add(where);
    }
    expect([...reached].sort()).toEqual(['dock', 'top', 'workbench']);

    // Esc: one level per press. Open a level and the side panel, then press Esc until the overview is back.
    await page.evaluate(() => window.__albert.view.explode('L12.bank'));
    await settle(page);
    const depth0 = await page.evaluate(() => window.__albert.view.depth());
    expect(depth0).toBeGreaterThan(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const steps: Array<{ depth: number; side: boolean }> = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Escape');
      await settle(page);
      steps.push(await page.evaluate(() => ({ depth: window.__albert.view.depth(), side: window.__albert.sidebar.isOpen() })));
      if (steps.at(-1)!.depth === 0 && !steps.at(-1)!.side) break;
    }
    // depth never drops by more than one per press, and the end state is the closed overview
    let prev = depth0;
    for (const s of steps) { expect(prev - s.depth).toBeLessThanOrEqual(1); prev = s.depth; }
    expect(steps.at(-1)).toEqual({ depth: 0, side: false });
    // depth() drops the moment a level is popped, but its close animation still runs (slow under SwiftShader) and Esc
    // belongs to the explode view until it ends: wait for that, or the last Esc is swallowed and no overview flight starts
    await expect.poll(() => page.evaluate(() => !window.__albert.rig.escapeGuard?.()), { timeout: 30_000 }).toBe(true);
    await page.keyboard.press('Escape');
    // the flight back to the overview ends at the overview pose (SwiftShader frames are slow: poll, do not guess a time)
    await expect.poll(() => page.evaluate(() => window.__albert.rig.atOverview() && !window.__albert.rig.isFlying()), { timeout: 20_000 }).toBe(true);
  });

  test('mobile 390 × 844: pinch zooms, the panel is a full-width sheet, the preset is low', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    // no saved quality: the phone default must pick Low by itself
    await start(page, { quality: null });
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await page.evaluate(() => window.__albert.quality())).toBe('low');
    await expect(page.locator('.quality-menu select')).toHaveValue('');
    await page.click('.lobby-entry[data-entry="explore"]');
    await settle(page);

    // pinch: two touch points move apart on the canvas; the camera must come closer
    const dist = () => page.evaluate(() => { const p = window.__albert.rig.pose(); return p.position.distanceTo(p.target); });
    const before = await dist();
    const cdp = await ctx.newCDPSession(page);
    const pts = (d: number) => [{ x: 195 - d, y: 400, id: 1 }, { x: 195 + d, y: 400, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
    for (let d = 40; d <= 140; d += 10) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
      await page.waitForTimeout(40);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(800);
    expect(await dist()).toBeLessThan(before * 0.9);

    // the Workbench opens as one full-width sheet below the top bar; the dock waits until it closes
    await page.tap('.sidebar-edge');
    const sheet = await page.evaluate(() => {
      const r = document.querySelector('.os-sidebar')!.getBoundingClientRect();
      const t = document.querySelector('.top-bar')!.getBoundingClientRect();
      const tl = document.querySelector('.timeline')!.getBoundingClientRect();
      return { x: r.left, right: r.right, top: r.top, bottom: r.bottom, barBottom: t.bottom, tlTop: tl.top, w: innerWidth, dock: getComputedStyle(document.querySelector('.dock')!).visibility };
    });
    expect(sheet.right - sheet.x).toBeGreaterThan(sheet.w - 40);
    expect(sheet.top).toBeGreaterThanOrEqual(sheet.barBottom);
    expect(sheet.bottom).toBeLessThanOrEqual(sheet.tlTop);
    expect(sheet.dock).toBe('hidden');
    await ctx.close();
  });
});
