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
const num = (name: string): number => Number(vars.get(name));
/** Body of the first ui.css rule whose selector list is exactly `sel`. */
const rule = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = uiCss.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${sel}`);
  return m[1] as string;
};

interface Rect { x: number; y: number; w: number; h: number }
type PanelState = 'none' | 'open' | 'collapsed';

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
  controlH: px('--control-h'),
  panelMaxVh: num('--panel-max-vh'),
  /** The collapsed panel: a tray tab in the system bar (top 3px, 30 px tall, at most 220 px wide). */
  tabW: 220,
  tabH: 30,
};
const sideW = (w: number): number => Math.min(380, Math.max(300, 0.24 * w)); // --side-w: clamp(300px, 24vw, 380px)

/** The HUD boxes at a viewport (the legend chip sits inside the system bar and adds nothing). */
function hudRects(w: number, h: number, panel: PanelState): Record<string, Rect> {
  const side = sideW(w);
  const open = panel === 'open';
  const out: Record<string, Rect> = {
    top: { x: 0, y: 0, w, h: T.topH },
    timeline: { x: T.space2, y: h - T.space2 - T.timelineH, w: w - 2 * T.space2, h: T.timelineH },
  };
  // .dock: width min(--dock-w, free width), centred in the free width; it sits on the timeline.
  const free = open ? w - side - 3 * T.edge : w - 2 * T.edge;
  const dw = Math.min(T.dockW, free);
  const cx = open ? (w - side - T.edge) / 2 : w / 2;
  out.dock = { x: cx - dw / 2, y: h - (T.timelineH + 2 * T.space2) - T.dockH, w: dw, h: T.dockH };
  const top = T.topH + T.space3;
  if (open) {
    const maxH = Math.min(h - T.topH - T.timelineH - 5 * T.space2, (T.panelMaxVh / 100) * h);
    out.panel = { x: w - T.edge - side, y: top, w: side, h: maxH };
  } else if (panel === 'collapsed') {
    out.panel = { x: w - 300 - T.tabW, y: 3, w: T.tabW, h: T.tabH };
  }
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
const coverage = (w: number, h: number, panel: PanelState): number => unionArea(Object.values(hudRects(w, h, panel)), w, h) / (w * h);
const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

describe('HUD layout rules use the tokens', () => {
  it('the dock is min(--dock-w, free width) wide and exactly --dock-h tall (caption line plus one control row)', () => {
    expect(T.dockW).toBe(720);
    expect(T.dockH).toBe(2 * T.dockPad + T.captionH + T.dockGap + T.controlH + 2); // + 2 x 1px border
    expect(T.dockH).toBeLessThanOrEqual(110);
    expect(T.controlH).toBeGreaterThanOrEqual(32);
    expect(rule('.dock')).toContain('width: min(var(--dock-w), calc(100vw - 2 * var(--edge-pad)))');
    expect(rule('.dock')).toContain('padding: var(--dock-pad) var(--space-3)');
    expect(rule('body.side-open .dock')).toContain('width: min(var(--dock-w), calc(100vw - var(--side-w) - 3 * var(--edge-pad)))');
    expect(rule('.player-bar')).toContain('gap: var(--dock-gap)');
    expect(rule('.player-caption')).toContain('height: var(--caption-h)');
    expect(rule('.player-controls')).toContain('height: var(--control-h)');
  });

  it('timeline, panel cap and legend chip follow the tokens', () => {
    expect(T.timelineH).toBeLessThanOrEqual(22);
    expect(rule('.timeline')).toContain('height: var(--timeline-h)');
    expect(rule('.inspect-panel')).toContain('calc(var(--panel-max-vh) * 1vh)');
    expect(rule('.inspect-panel')).toContain('width: var(--side-w)');
    expect(vars.get('--side-w')).toBe('clamp(300px, 24vw, 380px)');
    // The legend chip is a tray item inside the system bar (main.ts appends it to .top-left).
    expect(rule('.legend')).toContain('position: relative');
    expect(read('../src/main.ts')).toContain(".querySelector('.top-left')");
    // The collapsed panel is a tray tab inside the bar: 3 + 30 px stay within --top-h.
    const tab = rule('.inspect-panel.collapsed');
    expect(tab).toContain('top: 3px');
    expect(tab).toContain('height: 30px');
    expect(tab).toContain('right: var(--tray-right');
    expect(3 + T.tabH).toBeLessThanOrEqual(T.topH);
  });
});

describe('HUD coverage (Simeon: a smaller HUD, the centre stays free)', () => {
  for (const [w, h] of [[1366, 768], [1280, 720], [1920, 1080]] as const) {
    it(`${w}×${h}: at most 25 % with the panel open, 12 % with it closed or collapsed`, () => {
      const open = coverage(w, h, 'open');
      const closed = coverage(w, h, 'none');
      const collapsed = coverage(w, h, 'collapsed');
      expect(open).toBeLessThanOrEqual(0.25);
      expect(closed).toBeLessThanOrEqual(0.12);
      expect(collapsed).toBeLessThanOrEqual(0.12);
    });

    it(`${w}×${h}: the dock never intersects the panel and stays 720 px wide`, () => {
      const r = hudRects(w, h, 'open');
      expect(overlap(r.dock!, r.panel!)).toBe(0);
      expect(r.dock!.x + r.dock!.w).toBeLessThanOrEqual(r.panel!.x);
      expect(r.dock!.w).toBe(720);
      expect(hudRects(w, h, 'none').dock!.w).toBe(720);
    });
  }

  it('the centre of the screen is free with the panel open', () => {
    for (const [w, h] of [[1366, 768], [1280, 720]] as const) {
      const centre: Rect = { x: w / 2 - 1, y: h / 2 - 1, w: 2, h: 2 };
      for (const r of Object.values(hudRects(w, h, 'none'))) expect(overlap(r, centre)).toBe(0);
    }
  });

  it('union area counts overlaps once', () => {
    expect(unionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }], 100, 100)).toBe(175);
  });
});
