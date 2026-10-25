import { expect, test } from '@playwright/test';
import { enter, settle } from './helpers';

test.describe('fly keys in the real app', () => {
  test('W, S, A, D, Q and E move the camera in the explorer', async ({ page }) => {
    await enter(page);
    await settle(page);
    const pos = (): Promise<number[]> => page.evaluate(() => window.__albert.rig.pose().position.toArray());
    const moved = async (key: string): Promise<number> => {
      const a = await pos();
      await page.keyboard.down(key);
      await page.waitForTimeout(600);
      await page.keyboard.up(key);
      const b = await pos();
      return Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
    };
    for (const key of ['KeyW', 'KeyS', 'KeyD', 'KeyA', 'KeyE', 'KeyQ']) {
      expect(await moved(key), key).toBeGreaterThan(0.5);
    }
  });
});
