import { expect, test } from '@playwright/test';
import { enter, settle, start } from './helpers';

const pose = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const p = window.__albert.rig.pose();
  return [p.position.x, p.position.y, p.position.z].map((v: number) => +v.toFixed(3)).join(',');
});

test.describe('prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the lobby does not drift', async ({ page }) => {
    await start(page, { quality: 'medium', introSeen: false });
    const a = await pose(page);
    await page.waitForTimeout(3000);
    expect(await pose(page)).toBe(a);
  });

  test('the intro film does not play', async ({ page }) => {
    await start(page, { introSeen: false });
    await page.click('.lobby-entry[data-entry="explore"]');
    await settle(page);
    await expect(page.locator('.intro')).toHaveCount(0);
  });

  test('camera flights (tour step, layer link, Esc to overview) are cuts: no flight is ever running', async ({ page }) => {
    await enter(page);
    await page.evaluate(() => {
      (window as any).__flying = false;
      const rig = window.__albert.rig;
      const tick = () => { if (rig.isFlying()) (window as any).__flying = true; requestAnimationFrame(tick); };
      tick();
    });
    const before = await pose(page);
    await page.click('.tours-btn');
    await page.click('.tour-item[data-tour="meet"]');
    await expect(page.locator('.tour-card')).toBeVisible();
    await page.click('.tour-btn-primary');
    await page.click('.tour-btn-primary');
    await page.waitForTimeout(800);
    expect(await pose(page)).not.toBe(before); // the tour did move the camera ...
    await page.click('.tour-exit');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__flying)).toBe(false); // ... but only by cuts
  });

  test('with the preference off, a flight takes time', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await enter(page);
    await page.evaluate(() => { void window.__albert.rig.flyTo(window.__albert.tower.anchor('L20').clone(), 14, 900); });
    expect(await page.evaluate(() => window.__albert.rig.isFlying())).toBe(true);
    await ctx.close();
  });
});
