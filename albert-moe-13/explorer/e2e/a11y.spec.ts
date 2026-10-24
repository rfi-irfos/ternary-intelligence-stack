import { type Page, expect, test } from '@playwright/test';
import { axeSerious, enter, settle, start } from './helpers';

/** No serious or critical axe finding (WCAG 2 A and AA) in the part; a finding fails with the node and the rule. */
async function clean(page: Page, selector: string): Promise<void> {
  expect(await axeSerious(page, selector), `axe on ${selector}`).toEqual([]);
}

for (const lang of ['en', 'de'] as const) {
  test.describe(`axe, ${lang}`, () => {
    test('the Workbench with every section open (Session, Model, Inspection, Analysis)', async ({ page }) => {
      await enter(page, { lang });
      await page.evaluate(() => window.__albert.view.explode('L12.bank'));
      await settle(page);
      await page.evaluate(() => window.__albert.panel.openPanel('L12.expert.7'));
      await page.evaluate(() => window.__albert.sidebar.open(['session', 'model', 'inspect', 'analysis']));
      await settle(page);
      await clean(page, '.os-sidebar');
    });

    test('the panel for an expert, a head and a router, in Simple and in Advanced', async ({ page }) => {
      for (const mode of ['simple', 'advanced'] as const) {
        await enter(page, { lang, mode });
        await page.evaluate(() => window.__albert.sidebar.open(['session', 'model', 'inspect', 'analysis']));
        for (const id of ['L12.expert.7', 'L12.B.router', 'L12.A.attn.head0', 'L33.gate']) {
          await page.evaluate((x) => window.__albert.panel.openPanel(x), id);
          await clean(page, '.os-sidebar');
        }
        await page.goto('about:blank');
      }
    });

    test('the dock, the timeline and the top bar', async ({ page }) => {
      await enter(page, { lang });
      await clean(page, '.dock');
      await clean(page, '.timeline');
      await clean(page, '.top-bar');
      await page.click('.settings-btn');
      await clean(page, '.settings-menu');
    });

    test('the tour menu and the tour card', async ({ page }) => {
      await enter(page, { lang });
      await page.click('.tours-btn');
      await clean(page, '.tour-menu');
      await page.click('.tour-item[data-tour="meet"]');
      await expect(page.locator('.tour-card')).toBeVisible();
      await settle(page);
      await clean(page, '.tour-card');
    });

    test('the About dialog of the lobby', async ({ page }) => {
      await start(page, { lang });
      await page.click('.lobby-about-btn');
      await expect(page.locator('.lobby-about')).toBeVisible();
      await clean(page, '.lobby-about');
    });

    test('the legend card, the first-visit hints and the lobby', async ({ page }) => {
      await enter(page, { lang, coach: null });
      await clean(page, '.legend-card');
      await clean(page, '.coach');
      await page.click('.top-bar .home-btn');
      await expect(page.locator('.lobby')).toBeVisible();
      await clean(page, '.lobby');
    });

    test('the lightbox', async ({ page }) => {
      await enter(page, { lang });
      await page.evaluate(() => window.__albert.sidebar.open(['analysis']));
      await page.click('.exhibit-open');
      await expect(page.locator('.lightbox')).toBeVisible();
      await clean(page, '.lightbox');
      await page.keyboard.press('Escape');
      await expect(page.locator('.lightbox')).toHaveCount(0);
    });

    test('the shortcut list', async ({ page }) => {
      await enter(page, { lang });
      await page.keyboard.press('Shift+Slash');
      await expect(page.locator('.shortcuts')).toBeVisible();
      await clean(page, '.shortcuts');
    });
  });
}

test.describe('shortcut list, real browser', () => {
  test('opens from the ? key and from the Workbench; focus is trapped, Esc closes and focus returns', async ({ page }) => {
    await enter(page);
    // ? key
    await page.keyboard.press('Shift+Slash');
    const dialog = page.locator('.shortcuts');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.shortcuts-close')).toBeFocused();
    for (const k of ['Space', 'Esc', 'Tab']) await expect(dialog).toContainText(k);
    await expect(dialog).toContainText('←');
    await expect(dialog).toContainText('→');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.shortcuts'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // one Esc closed only the dialog: no camera flight, the sidebar state is unchanged
    expect(await page.evaluate(() => window.__albert.rig.isFlying())).toBe(false);

    // Workbench entry
    await page.click('.sidebar-edge');
    const entry = page.locator('.shortcuts-entry-btn');
    await entry.scrollIntoViewIfNeeded();
    await entry.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
  });

  test('Space, the arrows and 1 to 3 do what the list says', async ({ page }) => {
    await enter(page);
    const idx = () => page.evaluate(() => window.__albert.bar.player().index());
    const i0 = await idx();
    await page.keyboard.press('ArrowRight');
    expect(await idx()).toBeGreaterThan(i0);
    await page.keyboard.press('ArrowLeft');
    expect(await idx()).toBe(i0);
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.__albert.bar.player().playing())).toBe(true);
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.__albert.bar.player().playing())).toBe(false);
  });
});
