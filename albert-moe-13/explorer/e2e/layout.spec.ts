import { type Page, expect, test } from '@playwright/test';
import { type Box, box, enter, overlaps, pickPoint, settle, start } from './helpers';

/** Every HUD part that can be on screen at once, measured by getBoundingClientRect (never read from the CSS). */
const PARTS = {
  top: '.top-bar', side: '.os-sidebar', edge: '.sidebar-edge', dock: '.dock', timeline: '.timeline',
  tour: '.tour-card', legend: '.legend-card', menu: '.settings-menu', debug: '.debug-overlay',
} as const;

async function hudBoxes(page: Page): Promise<Record<string, Box | null>> {
  const out: Record<string, Box | null> = {};
  for (const [k, sel] of Object.entries(PARTS)) out[k] = await box(page, sel);
  return out;
}

async function expectClean(page: Page, label: string): Promise<void> {
  const b = await hudBoxes(page);
  const vw = page.viewportSize()!.width;
  const vh = page.viewportSize()!.height;
  expect(overlaps(b), `${label}: overlapping HUD parts`).toEqual([]);
  for (const [k, r] of Object.entries(b)) {
    if (!r) continue;
    expect(r.x, `${label}: ${k} left`).toBeGreaterThanOrEqual(-1);
    expect(r.x + r.w, `${label}: ${k} right`).toBeLessThanOrEqual(vw + 1);
    expect(r.y, `${label}: ${k} top`).toBeGreaterThanOrEqual(-1);
    expect(r.y + r.h, `${label}: ${k} bottom`).toBeLessThanOrEqual(vh + 1);
  }
}

async function openTour(page: Page): Promise<void> {
  await page.click('.tours-btn');
  await page.click('.tour-item[data-tour="meet"]');
  await expect(page.locator('.tour-card')).toBeVisible();
  await settle(page);
}

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test.describe(`${w} × ${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('top bar, Workbench, dock, timeline and tour card never overlap (closed, default, 280 px, widest)', async ({ page }) => {
      await enter(page);
      await expectClean(page, 'closed');
      await page.click('.sidebar-edge');
      await settle(page);
      await expectClean(page, 'open, default width');
      await page.evaluate(() => window.__albert.sidebar.setWidth(280));
      await settle(page);
      await expectClean(page, 'open, 280 px');
      expect((await box(page, '.os-sidebar'))!.w).toBeCloseTo(280, 0);
      await page.evaluate(() => window.__albert.sidebar.setWidth(100000));
      await settle(page);
      await expectClean(page, 'open, widest');
      const max = await page.evaluate(() => window.__albert.sidebar.width());
      expect((await box(page, '.os-sidebar'))!.w).toBeCloseTo(max, 0);
      // the dock keeps room: at the widest card it is still 416 px wide (viewport - 2 x (card + padding), sidebar.ts)
      expect((await box(page, '.dock'))!.w).toBeGreaterThanOrEqual(410);
    });

    test('with a tour card open: card, dock, timeline, top bar and Workbench stay apart', async ({ page }) => {
      await enter(page);
      await openTour(page);
      await expectClean(page, 'tour, side closed');
      await page.evaluate(() => window.__albert.sidebar.open());
      await settle(page);
      await expectClean(page, 'tour, side open');
      await page.evaluate(() => window.__albert.sidebar.setWidth(100000));
      await settle(page);
      await expectClean(page, 'tour, side widest');
    });

    test('the settings menu and the first-visit legend card stay clear of the dock and the Workbench', async ({ page }) => {
      await enter(page, { coach: null });
      await page.click('.settings-btn');
      await expectClean(page, 'first visit, settings menu');
    });
  });
}

/** The `?debug=1` overlay is a HUD part (PARTS.debug): it must keep clear of every other part, in every state. */
async function debugStates(page: Page, label: string, phone: boolean): Promise<void> {
  await enter(page, { query: '?debug=1' });
  await expect(page.locator('.debug-overlay')).toBeVisible();
  await expectClean(page, `${label} debug closed`);
  await page.click('.settings-btn');
  await expectClean(page, `${label} debug, settings menu`);
  await page.click('.settings-btn');
  if (phone) await page.tap('.tours-btn'); else await page.click('.tours-btn');
  await page.click('.tour-item[data-tour="meet"]');
  await expect(page.locator('.tour-card')).toBeVisible();
  await settle(page);
  await expectClean(page, `${label} debug, tour card`);
  if (!phone) {
    await page.evaluate(() => window.__albert.sidebar.open());
    await settle(page);
    await expectClean(page, `${label} debug, tour card and Workbench`);
  }
}

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`debug overlay (?debug=1) stays clear of the HUD at ${w} × ${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await debugStates(page, `${w}`, false);
  });
}

test.describe('debug overlay on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('stays clear of the HUD at 390 × 844', async ({ page }) => {
    await debugStates(page, 'phone', true);
  });
});

test.describe('debug overlay content', () => {
  test('without the flag there is no overlay; with it fps, draw calls, triangles, preset and canvas are shown', async ({ page }) => {
    await enter(page);
    expect(await page.locator('.debug-overlay').count()).toBe(0);
    await page.goto('about:blank');
    await enter(page, { query: '?debug=1', quality: 'medium' });
    const o = page.locator('.debug-overlay');
    await expect(o).toBeVisible();
    await page.waitForFunction(() => Number((document.querySelector('.debug-overlay') as HTMLElement).dataset.calls) > 0, null, { timeout: 30_000 });
    const text = (await o.textContent()) ?? '';
    for (const part of ['FPS', 'Draw calls', 'Triangles', 'Quality', 'medium', 'Canvas', 'Pixel ratio']) expect(text).toContain(part);
    expect(Number(await o.getAttribute('data-triangles'))).toBeGreaterThan(0);
    // ?debug=0 and a bare ?debug do not count
    await page.goto('about:blank');
    await enter(page, { query: '?debug=0' });
    expect(await page.locator('.debug-overlay').count()).toBe(0);
  });
});

test.describe('sidebar head row', () => {
  for (const width of [280, 100000]) {
    for (const lang of ['en', 'de'] as const) {
      for (const mode of ['simple', 'advanced'] as const) {
        test(`${width === 280 ? '280 px' : 'widest'}, ${lang}, ${mode}: title, view switch and close stay on one row, nothing clipped`, async ({ page }) => {
          await enter(page, { lang, mode });
          await page.click('.sidebar-edge');
          await page.evaluate((x) => window.__albert.sidebar.setWidth(x), width);
          await settle(page);
          const head = await page.evaluate(() => {
            const row = document.querySelector('.sidebar-head') as HTMLElement;
            const rr = row.getBoundingClientRect();
            const kids = [...row.children].map((e) => {
              const r = e.getBoundingClientRect();
              return { cls: e.className, x: r.left, right: r.right, cy: (r.top + r.bottom) / 2, h: r.height, clipped: (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1 };
            });
            const buttons = [...row.querySelectorAll('button')].map((b) => ({ text: b.textContent, clipped: b.scrollWidth > b.clientWidth + 1, inside: b.getBoundingClientRect().right <= rr.right + 0.5 && b.getBoundingClientRect().left >= rr.left - 0.5 }));
            return { row: { x: rr.left, right: rr.right, h: rr.height }, kids, buttons, sbw: (document.querySelector('.os-sidebar') as HTMLElement).getBoundingClientRect().width };
          });
          expect(head.kids.length).toBe(3);
          // one row: the centres sit within 2 px of each other
          const cys = head.kids.map((k) => k.cy);
          expect(Math.max(...cys) - Math.min(...cys)).toBeLessThanOrEqual(2);
          for (const k of head.kids) expect(k.clipped, `${k.cls} clipped`).toBe(false);
          for (const b of head.buttons) { expect(b.clipped, `button "${b.text}" clipped`).toBe(false); expect(b.inside, `button "${b.text}" inside`).toBe(true); }
          // the parts do not overlap each other
          const sorted = [...head.kids].sort((a, b) => a.x - b.x);
          for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.x).toBeGreaterThanOrEqual(sorted[i - 1]!.right - 0.5);
          // the title shows whole (no ellipsis)
          const title = await page.evaluate(() => { const t = document.querySelector('.sidebar-title') as HTMLElement; return { full: t.scrollWidth <= t.clientWidth + 1, text: t.textContent }; });
          expect(title.full, `title "${title.text}" is cut`).toBe(true);
          if (width === 280) expect(head.sbw).toBeCloseTo(280, 0);
        });
      }
    }
  }
});

test.describe('phone 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('top bar, dock and timeline fit the width without overlapping; no sideways scroll', async ({ page }) => {
    await enter(page);
    await expectClean(page, 'phone closed');
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      barKids: [...document.querySelector('.top-bar')!.querySelectorAll('.top-left > *, .top-nav > *, .top-prefs > *')].map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className.toString().split(' ')[0], right: r.right, left: r.left, w: r.width }; }),
      dockClipped: [...document.querySelectorAll('.dock .dock-left, .dock .dock-centre, .dock .dock-right')].map((e) => e.getBoundingClientRect().right),
    }));
    expect(m.scrollW).toBeLessThanOrEqual(m.innerW);
    for (const k of m.barKids) { expect(k.left, k.cls).toBeGreaterThanOrEqual(0); expect(k.right, k.cls).toBeLessThanOrEqual(m.innerW + 0.5); }
    for (const r of m.dockClipped) expect(r).toBeLessThanOrEqual(m.innerW + 0.5);
  });

  test('with a tour card open the card, dock and bars stay apart', async ({ page }) => {
    await enter(page);
    await page.tap('.tours-btn');
    await page.tap('.tour-item[data-tour="meet"]');
    await expect(page.locator('.tour-card')).toBeVisible();
    await settle(page);
    await expectClean(page, 'phone tour');
  });
});

test.describe('picking a slab with the Workbench open (R1)', () => {
  for (const [w, h] of [[1280, 720], [1366, 768]] as const) {
    test.describe(`${w} × ${h}`, () => {
      test.use({ viewport: { width: w, height: h } });
      test(`a real click on a slab opens a level and frames it left of the Workbench`, async ({ page }) => {
        await enter(page);
        await page.click('.sidebar-edge');
        await settle(page);
        const slab = await pickPoint(page, /^L\d+$/);
        expect(slab, 'a slab is drawn and clickable left of the Workbench').not.toBeNull();
        await page.mouse.click(slab!.x, slab!.y);
        await settle(page);
        expect(await page.evaluate(() => window.__albert.view.depth())).toBeGreaterThanOrEqual(1);
        const framed = await page.evaluate(() => {
          const { view, camera } = window.__albert;
          const g = view.root.children[view.root.children.length - 1];
          const V = camera.position.constructor;
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          g.updateMatrixWorld(true);
          g.traverse((o: any) => {
            if (!o.isMesh || !o.geometry || !o.visible) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox;
            for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
              const p = new V(x, y, z).applyMatrix4(o.matrixWorld);
              x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
            }
          });
          let maxPx = -Infinity;
          for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) maxPx = Math.max(maxPx, ((new V(x, y, z).project(camera).x + 1) / 2) * innerWidth);
          return { rightmost: maxPx, sidebarLeft: document.querySelector('.os-sidebar')!.getBoundingClientRect().left };
        });
        expect(framed.rightmost).toBeLessThanOrEqual(framed.sidebarLeft + 1);
      });
    });
  }
});

test.describe('camera sequence after the intro', () => {
  for (const [skip, via] of [['click', 'edge'], ['key', 'edge'], ['click', 'canvas then edge']] as const) {
    test(`skip the intro by ${skip}, open the Workbench (${via}): the overview refits and nothing starts the run`, async ({ page }) => {
      await start(page, { introSeen: false, coach: 'done' });
      await page.click('.lobby-entry[data-entry="explore"]');
      await expect(page.locator('.intro-skip')).toBeVisible({ timeout: 30_000 });
      if (skip === 'key') await page.keyboard.press('Escape');
      else await page.mouse.click(300, 300);
      await expect(page.locator('.intro-skip')).toBeHidden();
      await settle(page);
      const state = () => page.evaluate(() => {
        const a = window.__albert;
        const pl = a.bar.player();
        return { atOverview: a.rig.atOverview(), side: a.sidebar.isOpen(), playing: pl?.playing() ?? null, index: pl?.index() ?? null, right: a.rig.insets().right };
      });
      const s0 = await state();
      expect(s0.atOverview).toBe(true);
      expect(s0.playing).toBe(false);
      if (via === 'canvas then edge') {
        // a plain click on empty canvas (no drag) must not make the visitor's pose "chosen"
        await page.mouse.click(640, 660);
        await page.waitForTimeout(400);
      }
      await page.click('.sidebar-edge');
      await settle(page);
      const s1 = await state();
      expect(s1.side).toBe(true);
      expect(s1.atOverview).toBe(true);
      expect(s1.right).toBeGreaterThan(0);
      expect(s1.playing).toBe(false);
      expect(s1.index).toBe(s0.index);
      await page.click('.os-sidebar .sidebar-close');
      await settle(page);
      const s2 = await state();
      expect(s2.atOverview).toBe(true);
      expect(s2.right).toBeLessThan(s1.right);
    });
  }
});

test.describe('lobby', () => {
  for (const [w, h, phone] of [[1280, 720, false], [1920, 1080, false], [390, 844, true]] as const) {
    test.describe(`${w} × ${h}`, () => {
      test.use({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
      for (const lang of ['en', 'de'] as const) {
        test(`${lang}: every entry is on screen, tall enough to press, nothing leaves the width`, async ({ page }) => {
          await start(page, { lang });
          const lobby = await page.evaluate(() => {
            const l = document.querySelector('.lobby') as HTMLElement;
            const entries = [...document.querySelectorAll('.lobby-entry')].map((e) => { const r = e.getBoundingClientRect(); return { id: (e as HTMLElement).dataset.entry, top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; });
            const outside = [...l.querySelectorAll('*')].filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest('[hidden]')).filter((e) => { const b = e.getBoundingClientRect(); return b.right > innerWidth + 1 || b.left < -1; }).map((e) => e.className.toString() || e.tagName);
            return { visible: !l.hidden, entries, outside, scrollable: l.scrollHeight > l.clientHeight + 1 };
          });
          expect(lobby.visible).toBe(true);
          expect(lobby.entries.length).toBeGreaterThanOrEqual(3);
          for (const e of lobby.entries) { expect(e.h, e.id).toBeGreaterThanOrEqual(44); expect(e.right).toBeLessThanOrEqual(w + 0.5); expect(e.left).toBeGreaterThanOrEqual(-0.5); }
          expect(lobby.outside).toEqual([]);
          if (!lobby.scrollable) for (const e of lobby.entries) expect(e.bottom).toBeLessThanOrEqual(h + 0.5);
        });
      }
    });
  }

  for (const [w, h, phone] of [[1280, 720, false], [1920, 1080, false], [390, 844, true]] as const) {
    test.describe(`About, ${w} × ${h}`, () => {
      test.use({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
      for (const lang of ['en', 'de'] as const) {
        test(`${lang}: the dialog fits the screen, scrolls to its last link, covers the HUD and leaves nothing sticking out`, async ({ page }) => {
          await start(page, { lang });
          await page.click('.lobby-about-btn');
          const box = page.locator('.lobby-about');
          await expect(box).toBeVisible();
          await page.waitForTimeout(400);
          const m = await page.evaluate(() => {
            const d = document.querySelector('.lobby-about') as HTMLElement;
            const r = d.getBoundingClientRect();
            const wide = [...d.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1); }).map((e) => e.className.toString() || e.tagName);
            const cx = r.left + r.width / 2;
            const cy = r.top + Math.min(r.height / 2, 200);
            const hud = ['.top-bar', '.dock', '.timeline', '.os-sidebar', '.legend-card', '.coach', '.layer-panel'].filter((q) => { const e = document.querySelector(q); return e && getComputedStyle(e).visibility !== 'hidden'; });
            const close = (d.querySelector('.lobby-about-close') as HTMLElement).getBoundingClientRect();
            return {
              r: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, wide, hud, hit: d.contains(document.elementFromPoint(cx, cy)),
              scrolls: d.scrollHeight > d.clientHeight + 1, closeSize: Math.min(close.width, close.height), docOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            };
          });
          expect(m.r.top).toBeGreaterThanOrEqual(0);
          expect(m.r.bottom).toBeLessThanOrEqual(h + 0.5);
          expect(m.r.left).toBeGreaterThanOrEqual(0);
          expect(m.r.right).toBeLessThanOrEqual(w + 0.5);
          expect(m.wide).toEqual([]);
          expect(m.hud).toEqual([]);
          expect(m.hit).toBe(true);
          expect(m.docOverflow).toBe(false);
          expect(m.closeSize).toBeGreaterThanOrEqual(36);
          if (phone) expect(m.scrolls).toBe(true);
          const last = page.locator('.about-links a').last();
          await last.scrollIntoViewIfNeeded();
          const inView = await last.evaluate((e) => { const b = e.getBoundingClientRect(); const d = e.closest('.lobby-about')!.getBoundingClientRect(); return b.top >= d.top && b.bottom <= d.bottom + 1; });
          expect(inView).toBe(true);
          await page.keyboard.press('Escape');
          await expect(box).toBeHidden();
          await expect(page.locator('.lobby-about-btn')).toBeFocused();
        });
      }
    });
  }

  test('the lobby drifts the camera; after Explore the camera rests; Home returns to the lobby', async ({ page }) => {
    await start(page, { quality: 'medium' });
    const pose = () => page.evaluate(() => { const p = window.__albert.rig.pose(); return [p.position.x, p.position.y, p.position.z].map((v: number) => +v.toFixed(3)).join(','); });
    const a = await pose();
    await page.waitForTimeout(2500);
    expect(await pose()).not.toBe(a);
    await page.click('.lobby-entry[data-entry="explore"]');
    await settle(page);
    const b = await pose();
    await page.waitForTimeout(2500);
    expect(await pose()).toBe(b);
    await page.click('.top-bar .home-btn');
    await expect(page.locator('.lobby')).toBeVisible();
  });
});
