import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * HUD coverage from the layout rules. jsdom has no layout engine (every rect is 0 x 0), so the element
 * rects are computed here from the same tokens and rules the CSS uses: the values are read from
 * src/style/tokens.css and the rules in src/style/ui.css are checked to use them. The headless browser
 * run (Task 11b fix round 1 report) measures the real rects with getBoundingClientRect.
 */
const read = (rel: string): string => {
  const raw = readFileSync(new URL(rel, import.meta.url));
  return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
};
const tokensCss = read('../src/style/tokens.css');
const uiCss = read('../src/style/ui.css').replace(/\/\*[\s\S]*?\*\//g, '');
const vars = new Map([...tokensCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
const px = (name: string): number => {
  const v = vars.get(name);
  if (!v || !/^-?\d+(\.\d+)?px$/.test(v)) throw new Error(`${name} is not a px token: ${v}`);
  return parseFloat(v);
};
/** Body of the first ui.css rule whose selector list is exactly `sel`. */
const rule = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = uiCss.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${sel}`);
  return m[1] as string;
};

interface Rect { x: number; y: number; w: number; h: number }
interface State { sidebar: boolean; legend: boolean; sideW?: number }

const T = {
  topH: px('--top-h'),
  timelineH: px('--timeline-h'),
  space2: px('--space-2'),
  space3: px('--space-3'),
  edge: px('--space-4'), // --edge-pad: var(--space-4)
  dockW: px('--dock-w'),
  dockH: px('--dock-h'),
  dockPad: px('--dock-pad'),
  captionH: px('--caption-h'),
  dockGap: px('--dock-gap'),
  dockRow: px('--dock-row'),
  controlH: px('--control-h'),
  /** The legend card (first visit): a 32 px head and seven 32 px rows inside --space-2 / --space-3 padding and a 1 px border. */
  legendH: 32 + 7 * 32 + px('--space-2') + px('--space-3') + 2,
};
/** The side panel's first width: 22 % of the viewport within [280 px, 40 %] (src/ui/sidebar.ts). */
const sideWidth = (w: number): number => Math.round(Math.min(Math.max(280, Math.floor(0.4 * w)), Math.max(280, 0.22 * w)));
const legendWidth = (w: number): number => Math.min(220, Math.max(168, 0.14 * w)); // clamp(168px, 14vw, 220px)

/** The HUD boxes at a viewport. The chips of the top bar sit inside the bar and add nothing. */
function hudRects(w: number, h: number, st: State): Record<string, Rect> {
  const side = st.sideW ?? sideWidth(w);
  const sideTop = T.topH + T.space3;
  const lineY = h - (T.timelineH + 2 * T.space2);
  const out: Record<string, Rect> = {
    top: { x: 0, y: 0, w, h: T.topH },
    timeline: { x: T.space2, y: h - T.space2 - T.timelineH, w: w - 2 * T.space2, h: T.timelineH },
  };
  // .dock: width min(--dock-w, free width), centred in the free width (left of the side panel when it is open).
  const free = st.sidebar ? w - side - 3 * T.edge : w - 2 * T.edge;
  const dw = Math.min(T.dockW, free);
  const cx = st.sidebar ? (w - side - T.edge) / 2 : w / 2;
  out.dock = { x: cx - dw / 2, y: lineY - T.dockH, w: dw, h: T.dockH };
  if (st.sidebar) out.sidebar = { x: w - T.edge - side, y: sideTop, w: side, h: lineY - sideTop };
  if (st.legend) out.legend = { x: T.edge, y: sideTop, w: legendWidth(w), h: T.legendH };
  return out;
}

/** Exact union area of axis-aligned rects (coordinate compression), clipped to the viewport. */
function unionArea(rects: Rect[], w: number, h: number): number {
  const rs = rects.map((r) => ({ x0: Math.max(0, r.x), y0: Math.max(0, r.y), x1: Math.min(w, r.x + r.w), y1: Math.min(h, r.y + r.h) }))
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
  const xs = [...new Set(rs.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] as number;
    const b = xs[i + 1] as number;
    const spans = rs.filter((r) => r.x0 <= a && r.x1 >= b).map((r) => [r.y0, r.y1] as const).sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [y0, y1] of spans) {
      if (y0 > end) { covered += y1 - y0; end = y1; } else if (y1 > end) { covered += y1 - end; end = y1; }
    }
    area += covered * (b - a);
  }
  return area;
}
const coverage = (w: number, h: number, st: State): number => unionArea(Object.values(hudRects(w, h, st)), w, h) / (w * h);
/** The same without the top bar (OS chrome, R5): what the HUD itself takes from the scene. */
const coverageScene = (w: number, h: number, st: State): number =>
  unionArea(Object.entries(hudRects(w, h, st)).filter(([k]) => k !== 'top').map(([, r]) => r), w, h) / (w * h);
const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const CLOSED: State = { sidebar: false, legend: false };
const OPEN: State = { sidebar: true, legend: false };
const EVERYTHING: State = { sidebar: true, legend: true };

describe('HUD layout rules use the tokens', () => {
  it('the mini dock is min(--dock-w, free width) wide and exactly --dock-h tall (caption line plus the big control row)', () => {
    expect(T.dockW).toBe(640); // the caption line (86 characters at about 7 px) needs about 614 px
    expect(T.dockH).toBe(2 * T.dockPad + T.captionH + T.dockGap + T.dockRow + 2); // + 2 x 1px border
    expect(T.dockH).toBeLessThanOrEqual(110);
    expect(T.dockRow).toBeGreaterThanOrEqual(T.controlH);
    expect(T.controlH).toBeGreaterThanOrEqual(32);
    expect(rule('.dock')).toContain('width: min(var(--dock-w), calc(100vw - 2 * var(--edge-pad)))');
    expect(rule('.dock')).toContain('padding: var(--dock-pad) var(--space-4)');
    expect(rule('.player-bar')).toContain('gap: var(--dock-gap)');
    expect(rule('.player-caption')).toContain('height: var(--caption-h)');
    expect(rule('.player-controls')).toContain('height: var(--dock-row)');
  });

  it('the dock re-centres in the width left of the open side panel and shrinks to fit (rule and model)', () => {
    const open = rule('body.side-open .dock, body.layer-open .dock');
    expect(open).toContain('left: calc((100vw - var(--side-w) - var(--edge-pad)) / 2)');
    expect(open).toContain('width: min(var(--dock-w), calc(100vw - var(--side-w) - 3 * var(--edge-pad)))');
    for (const [w, h] of [[1366, 768], [1280, 720], [1920, 1080]] as const) {
      const closed = hudRects(w, h, CLOSED).dock!;
      const withSide = hudRects(w, h, OPEN);
      // centred in the whole width when closed, in the free area left of the panel when open
      expect(closed.x + closed.w / 2).toBe(w / 2);
      expect(withSide.dock!.x + withSide.dock!.w / 2).toBeCloseTo((w - withSide.sidebar!.w - T.edge) / 2, 6);
      expect(withSide.dock!.x + withSide.dock!.w / 2).toBeLessThan(closed.x + closed.w / 2);
      expect(withSide.dock!.x + withSide.dock!.w + T.edge).toBeLessThanOrEqual(withSide.sidebar!.x);
      expect(withSide.dock!.x).toBeGreaterThanOrEqual(T.edge);
    }
    // A widened side panel (40 % of the viewport) still leaves the dock whole.
    for (const w of [1280, 1366, 1920]) {
      const wide = hudRects(w, 720, { sidebar: true, legend: false, sideW: Math.floor(0.4 * w) });
      expect(overlap(wide.dock!, wide.sidebar!)).toBe(0);
      expect(wide.dock!.w).toBe(T.dockW);
    }
  });

  it('timeline, side panel, legend card and top bar follow the tokens', () => {
    expect(T.timelineH).toBe(32); // a 32 px hit area for the scrub line
    expect(rule('.timeline')).toContain('height: var(--timeline-h)');
    // The side panel floats from just under the top bar to one gap above the timeline; head stays, body scrolls.
    expect(rule('.os-sidebar')).toContain('top: calc(var(--top-h) + var(--space-3))');
    expect(rule('.os-sidebar')).toContain('bottom: calc(var(--timeline-h) + 2 * var(--space-2))');
    expect(rule('.os-sidebar')).toContain('right: var(--edge-pad)');
    expect(rule('.os-sidebar')).toContain('position: fixed');
    expect(rule('.sidebar-head')).toContain('flex: none');
    expect(rule('.sidebar-body')).toContain('flex: 1 1 auto');
    expect(rule('.sidebar-body')).toContain('overflow-y: auto');
    // It floats over the scene: no rule gives the canvas or the body a margin for it.
    expect(uiCss).not.toMatch(/canvas\s*\{[^}]*(margin|width)/);
    expect(vars.get('--side-w')).toBe('clamp(280px, 22vw, 512px)');
    expect(rule('.legend-card')).toContain('top: calc(var(--top-h) + var(--space-3))');
    expect(rule('.legend-card')).toContain('width: clamp(168px, 14vw, 220px)');
    // The legend chip is a tray item inside the bar (main.ts appends it to .top-left); the card floats on the page.
    expect(rule('.legend')).toContain('position: relative');
    const main = read('../src/main.ts');
    expect(main).toContain(".querySelector('.top-left')");
    expect(main).toContain('document.body.appendChild(legend.card)');
  });

  it('R2: every small control has a hit target of at least 32 px', () => {
    // The visual pill may stay slim; the hit area (the element or its ::before box) is >= 32 px tall.
    const minSize = (sel: string): number => {
      const m = rule(sel).match(/min-height:\s*(\d+)px/);
      return m ? Number(m[1]) : 0;
    };
    expect(minSize('.tray-item')).toBeGreaterThanOrEqual(32);
    expect(minSize('.side-sec-toggle')).toBeGreaterThanOrEqual(32);
    expect(minSize('.panel-tab')).toBeGreaterThanOrEqual(32);
    expect(minSize('.hud-segment button::before')).toBeGreaterThanOrEqual(32);
    expect(minSize('.top-prefs .hud-segment button::before')).toBeGreaterThanOrEqual(32);
    expect(minSize('.depth-switch .depth-btn::before')).toBeGreaterThanOrEqual(32);
    expect(rule('.sidebar-edge')).toMatch(/width: 3[2-9]px/);
    expect(rule('.sidebar-edge')).toMatch(/height: (?:[4-9]\d)px/);
    // Icon buttons (stepper arrows, step buttons, fold, close) are --control-h square; the round play button is --dock-row.
    expect(rule('.hud-icon')).toContain('width: var(--control-h)');
    expect(rule('.play-btn')).toContain('width: var(--dock-row)');
    expect(rule('.tl-track')).toContain('height: 100%'); // the whole 32 px timeline height scrubs
    // The ::before boxes are real hit areas: positioned on a positioned button, full width.
    expect(rule('.hud-segment button')).toContain('position: relative');
    expect(rule('.depth-switch .depth-btn')).toContain('position: relative');
    for (const sel of ['.hud-segment button::before', '.depth-switch .depth-btn::before']) {
      expect(rule(sel)).toContain('content: ""');
      expect(rule(sel)).toContain('position: absolute');
      expect(rule(sel)).toContain('left: 0; right: 0');
    }
  });

  it('phones: icons-only bar, the open side panel is a full-width sheet and the dock waits below it', () => {
    const css = read('../src/style/ui.css');
    const phone = css.slice(css.indexOf('@media (max-width: 700px)'));
    expect(phone).toContain('.os-sidebar { left: var(--edge-pad); width: auto !important; }');
    expect(phone).toContain('body.side-open .dock { visibility: hidden; }');
    expect(phone).toContain('.home-btn span, .legend-toggle span, .sidebar-btn span');
  });
});

describe('HUD coverage and non-overlap (Simeon: the centre stays free)', () => {
  for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]] as const) {
    it(`${w}×${h}: coverage with the side panel open, closed and with the first-visit legend`, () => {
      const open = coverage(w, h, OPEN);
      const closed = coverage(w, h, CLOSED);
      const legend = coverage(w, h, { sidebar: false, legend: true });
      const all = coverage(w, h, EVERYTHING);
      console.info(`[coverage model] ${w}x${h} side panel ${sideWidth(w)} px: open ${open.toFixed(4)} (without top bar ${coverageScene(w, h, OPEN).toFixed(4)}) ` +
        `closed ${closed.toFixed(4)} (without top bar ${coverageScene(w, h, CLOSED).toFixed(4)}) legend only ${legend.toFixed(4)} everything ${all.toFixed(4)}`);
      // Budgets: closed 0.15 (was 0.12: the timeline is now 32 px tall because it is a scrub control with a 32 px hit
      // area, and the dock is 78 px for the round play button); open 0.35 with the bar (was 0.34) and 0.30 without it (unchanged).
      expect(closed).toBeLessThanOrEqual(0.15);
      expect(coverageScene(w, h, OPEN)).toBeLessThanOrEqual(0.30);
      expect(open).toBeLessThanOrEqual(0.35);
      expect(legend).toBeGreaterThan(closed);
    });

    it(`${w}×${h}: no two HUD elements overlap (legend, side panel, dock, timeline, top bar)`, () => {
      for (const st of [CLOSED, OPEN, { sidebar: false, legend: true }, EVERYTHING]) {
        const entries = Object.entries(hudRects(w, h, st));
        for (const [i, [ka, a]] of entries.entries()) {
          for (const [kb, b] of entries.slice(i + 1)) expect(overlap(a, b), `${ka} x ${kb} at ${w}x${h} ${JSON.stringify(st)}`).toBe(0);
        }
        // everything sits inside the viewport
        for (const [k, r] of entries) {
          expect(r.x, k).toBeGreaterThanOrEqual(0);
          expect(r.y, k).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w, k).toBeLessThanOrEqual(w);
          expect(r.y + r.h, k).toBeLessThanOrEqual(h);
        }
      }
    });

    it(`${w}×${h}: the side panel width stays within 280 px .. 40 % of the viewport and the dock stays whole`, () => {
      expect(sideWidth(w)).toBeGreaterThanOrEqual(280);
      expect(sideWidth(w)).toBeLessThanOrEqual(0.4 * w);
      expect(hudRects(w, h, OPEN).dock!.w).toBe(T.dockW);
      expect(hudRects(w, h, CLOSED).dock!.w).toBe(T.dockW);
    });
  }

  it('phone 390×844: bar, legend card, dock and timeline do not overlap while the side panel is closed', () => {
    const w = 390;
    const h = 844;
    const rects = hudRects(w, h, { sidebar: false, legend: true });
    expect(rects.dock!.w).toBe(w - 2 * T.edge);
    const entries = Object.entries(rects);
    for (const [i, [ka, a]] of entries.entries()) for (const [kb, b] of entries.slice(i + 1)) expect(overlap(a, b), `${ka} x ${kb}`).toBe(0);
  });

  it('the centre of the screen is free with the side panel open', () => {
    for (const [w, h] of [[1366, 768], [1280, 720], [1920, 1080]] as const) {
      const centre: Rect = { x: w / 2 - 1, y: h / 2 - 1, w: 2, h: 2 };
      for (const [k, r] of Object.entries(hudRects(w, h, OPEN))) expect(overlap(r, centre), k).toBe(0);
    }
  });

  it('union area counts overlaps once', () => {
    expect(unionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }], 100, 100)).toBe(175);
  });
});

describe('R10 wiring: labels under the HUD refade at rest, never per frame', () => {
  it('main.ts calls fadeLabels on rig settle and inset changes, not in the animation loop', () => {
    const main = read('../src/main.ts');
    expect(main).toContain('rig.onSettle(refadeLabels)');
    expect(main).toContain('new ResizeObserver(refadeLabels)');
    const loop = main.slice(main.indexOf('renderer.setAnimationLoop'));
    expect(loop.indexOf('renderer.setAnimationLoop')).toBe(0);
    const body = loop.slice(0, loop.indexOf('\n  });') + 1);
    expect(body).not.toContain('fadeLabels');
    expect(body).not.toContain('refadeLabels');
  });
});

describe('layer mode and the empty click', () => {
  it('main.ts passes the layer-mode check (layerMode.element.hidden) to emptyClick', () => {
    const main = read('../src/main.ts');
    expect(main).toContain('layerActive: () => !layerMode.element.hidden');
  });
});
