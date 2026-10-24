import { type Page, expect } from '@playwright/test';
import { createRequire } from 'node:module';

/** Test hook added by the VITE_E2E build (src/main.ts). Types are loose on purpose. */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { __albert: any }
}

export interface StartOptions {
  lang?: 'de' | 'en';
  mode?: 'simple' | 'advanced';
  quality?: 'low' | 'medium' | 'high' | null;
  /** The first-visit hints are marked as seen unless this is null. */
  coach?: 'done' | null;
  /** The intro film is marked as seen (it would play with motion allowed). */
  introSeen?: boolean;
}

/** Opens the app with a fixed language, mode and quality preset; waits for the scene and the recorded runs. */
export async function start(page: Page, o: StartOptions = {}): Promise<void> {
  const { lang = 'en', mode = 'advanced', quality = 'low', coach = 'done', introSeen = true } = o;
  await page.addInitScript(([l, m, q, c, i]) => {
    localStorage.setItem('albert.lang', l as string);
    localStorage.setItem('albert.mode', m as string);
    if (c) localStorage.setItem('albert.coach', c as string);
    if (i) localStorage.setItem('albert.introSeen', '1');
    if (q) localStorage.setItem('albert-explorer.quality', q as string);
  }, [lang, mode, quality, coach, introSeen] as const);
  await page.goto('/');
  await page.waitForFunction(() => !!window.__albert, null, { timeout: 60_000 });
  await page.evaluate(() => window.__albert.bar.ready);
}

/** Start, then enter the scene through the lobby's Explore entry. */
export async function enter(page: Page, o: StartOptions = {}): Promise<void> {
  await start(page, o);
  await page.click('.lobby-entry[data-entry="explore"]');
  await expect(page.locator('.lobby')).toBeHidden();
  await settle(page);
}

/** Waits until no camera flight is running (and a moment more for the labels to refade). */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !window.__albert.rig.isFlying(), null, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

export interface Box { x: number; y: number; w: number; h: number }

/** Rendered box of the first visible match, or null (hidden, display none, visibility hidden, zero size). */
export async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel) as HTMLElement | null;
    if (!e || e.closest('[hidden]')) return null;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = e.getBoundingClientRect();
    return r.width < 1 || r.height < 1 ? null : { x: r.left, y: r.top, w: r.width, h: r.height };
  }, selector);
}

/** Overlap area in px² of two boxes (0 when they only touch). */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Names the pairs of the given boxes that overlap by more than a 1 px sliver (rounding of rects). */
export function overlaps(boxes: Record<string, Box | null>): string[] {
  const names = Object.keys(boxes).filter((k) => boxes[k]);
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = boxes[names[i]!]!;
      const b = boxes[names[j]!]!;
      const area = overlap(a, b);
      if (area > Math.min(a.w, b.w, a.h, b.h) * 1.5) out.push(`${names[i]} x ${names[j]} (${Math.round(area)} px²)`);
    }
  }
  return out;
}

/** Screen point where the row anchor of `id` (a slab) is drawn, and whether the canvas is the top element there. */
export async function anchorPoint(page: Page, id: string): Promise<{ x: number; y: number; canvas: boolean }> {
  return page.evaluate((cid) => {
    const { tower, camera } = window.__albert;
    const q = tower.anchor(cid).clone().project(camera);
    const x = ((q.x + 1) / 2) * innerWidth;
    const y = ((1 - q.y) / 2) * innerHeight;
    return { x, y, canvas: document.elementFromPoint(x, y)?.tagName === 'CANVAS' };
  }, id);
}

export interface AxeViolation { id: string; impact: string | null; help: string; nodes: string[] }

/**
 * Runs axe-core on `selector` and returns the serious and critical violations (WCAG 2 A and AA rules, plus
 * best practice). Each node is named with its html start so a finding can be located.
 */
export async function axeSerious(page: Page, selector: string): Promise<AxeViolation[]> {
  // let the open animation (fade-in, 200 ms) finish: axe reads the colours of the moment
  await page.waitForTimeout(500);
  const require = createRequire(import.meta.url);
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: require.resolve('axe-core') });
  return page.evaluate(async (sel) => {
    const axe = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ html: string; any: Array<{ message: string }> }> }> }> } }).axe;
    const res = await axe.run({ include: [sel] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return res.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => `${n.html.slice(0, 140)} :: ${n.any[0]?.message ?? ''}`) }));
  }, selector);
}

/** Opens a part by its id through a real click on its drawn position: the level opens by the hook, the click picks. */
export async function pickPoint(page: Page, wanted: RegExp): Promise<{ x: number; y: number; id: string } | null> {
  const size = page.viewportSize()!;
  const found = await page.evaluate(({ w, h, re }) => {
    const rx = new RegExp(re);
    const top = (document.querySelector('.top-bar') as HTMLElement).getBoundingClientRect().bottom;
    for (let y = top + 8; y < h - 90; y += 12) {
      for (let x = 8; x < w - 8; x += 12) {
        if (document.elementFromPoint(x, y)?.tagName !== 'CANVAS') continue;
        const id = window.__albert.pick(x, y) as string | null;
        if (id && rx.test(id)) return { x, y, id };
      }
    }
    return null;
  }, { w: size.width, h: size.height, re: wanted.source });
  return found;
}
