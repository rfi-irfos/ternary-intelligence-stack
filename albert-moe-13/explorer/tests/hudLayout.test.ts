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
interface State { sidebar: boolean; legend: boolean; sideW?: number; tour?: boolean }

const T = {
  topH: px('--top-h'),
  timelineH: px('--timeline-h'),
  space2: px('--space-2'),
  space3: px('--space-3'),
  edge: px('--space-4'), // --edge-pad: var(--space-4)
  dockW: px('--dock-w'),
  dockH: px('--dock-h'),
  tourH: px('--tour-h'),
  dockPad: px('--dock-pad'),
  captionH: px('--caption-h'),
  dockGap: px('--dock-gap'),
  dockRow: px('--dock-row'),
  dockCtl: px('--dock-ctl'),
  /** Fixed parts of the dock row: speed button min-width (52 px) and the layer count (min-width 4.2em at 14 px = 59 px). */
  speedW: 52,
  countW: Math.ceil(4.2 * 14),
  controlH: px('--control-h'),
  /** The legend card (first visit): a 32 px head and seven 32 px rows inside --space-2 / --space-3 padding and a 1 px border. */
  legendH: 32 + 7 * 32 + px('--space-2') + px('--space-3') + 2,
};
/** The widest side panel: min(40 % of the viewport, half the viewport - 232 px), at least 280 px (sidebarMax in src/ui/sidebar.ts). */
const sideMax = (w: number): number => Math.max(280, Math.floor(Math.min(0.4 * w, w / 2 - 232)));
/** The side panel's first width: 22 % of the viewport within [280 px, sideMax] (src/ui/sidebar.ts). */
const sideWidth = (w: number): number => Math.round(Math.min(sideMax(w), Math.max(280, 0.22 * w)));
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
  // .dock: always centred in the VIEWPORT. Its width is min(--dock-w, free width); with the side panel open
  // the half width is capped to end one gap before the panel: 100vw - 2 x (panel + margin + gap).
  const free = st.sidebar ? w - 2 * (side + 2 * T.edge) : w - 2 * T.edge;
  const dw = Math.min(T.dockW, free);
  // One row of three zones in every state: the dock is always --dock-h tall.
  out.dock = { x: w / 2 - dw / 2, y: lineY - T.dockH, w: dw, h: T.dockH };
  // .tour-card: centred above the dock, the dock's own width and x, --tour-h tall, one --space-2 above the dock.
  if (st.tour) out.tour = { x: out.dock.x, y: out.dock.y - T.space2 - T.tourH, w: out.dock.w, h: T.tourH };
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

/** The three zones inside the dock (grid: flexible left, then the transport, then speed + stepper; 8 px gaps, 12 px padding, 1 px border). */
function dockZones(dock: Rect): { left: Rect; centre: Rect; right: Rect; captionShown: boolean } {
  const inner = dock.w - 2 - 2 * T.dockPad;
  const centreW = 2 * T.dockCtl + T.dockRow + 2 * T.dockGap;
  const rightW = T.speedW + T.dockGap + 2 * T.dockCtl + T.countW;
  const x0 = dock.x + 1 + T.dockPad;
  const y0 = dock.y + 1 + T.dockPad;
  const leftW = Math.max(0, inner - centreW - rightW - 2 * T.dockGap);
  return {
    left: { x: x0, y: y0, w: leftW, h: T.dockRow },
    centre: { x: x0 + leftW + T.dockGap, y: y0, w: centreW, h: T.dockRow },
    right: { x: x0 + inner - rightW, y: y0, w: rightW, h: T.dockRow },
    captionShown: inner > 414, // @container (max-width: 414px) hides the caption
  };
}

const CLOSED: State = { sidebar: false, legend: false };
const TOUR: State = { sidebar: false, legend: false, tour: true };
const OPEN: State = { sidebar: true, legend: false };
const EVERYTHING: State = { sidebar: true, legend: true };

describe('HUD layout rules use the tokens', () => {
  it('the mini dock is min(--dock-w, free width) wide and --dock-h tall: one card, one row of three zones, 36 px controls, 48 px play, 8 px gaps, 12 px padding', () => {
    expect(T.dockW).toBe(640);
    expect(T.dockH).toBe(2 * T.dockPad + T.dockRow + 2); // + 2 x 1px border
    expect(T.dockPad).toBe(12);
    expect(T.dockGap).toBe(8);
    expect(T.dockCtl).toBe(36);
    expect(T.dockRow).toBe(48);
    // title (20 px line) + caption (--caption-h) fit the 48 px row
    expect(20 + T.captionH).toBeLessThanOrEqual(T.dockRow);
    expect(rule('.dock')).toContain('width: min(var(--dock-w), calc(100vw - 2 * var(--edge-pad)))');
    expect(rule('.dock')).toContain('padding: var(--dock-pad)');
    expect(rule('.dock')).toContain('container-type: inline-size');
    expect(rule('.player-caption')).toContain('height: var(--caption-h)');
    const row = rule('.player-controls');
    expect(row).toContain('display: grid');
    expect(row).toContain('grid-template-columns: minmax(0, 1fr) auto auto');
    expect(row).toContain('align-items: center');
    expect(row).toContain('column-gap: var(--dock-gap)');
    expect(row).toContain('height: var(--dock-row)');
    expect(row).not.toContain('wrap');
    expect(rule('.transport')).toContain('gap: var(--dock-gap)');
    expect(rule('.dock-right')).toContain('gap: var(--dock-gap)');
    expect(rule('.dock-title')).toContain('text-overflow: ellipsis');
    expect(rule('.dock .hud-icon, .dock .speed-pill')).toContain('width: var(--dock-ctl)');
    expect(rule('.dock .hud-icon, .dock .speed-pill')).toContain('height: var(--dock-ctl)');
    expect(rule('.play-btn')).toContain('width: var(--dock-row)');
    expect(rule('.play-btn')).toContain('height: var(--dock-row)');
    // below 440 px of dock the caption is hidden (container content box: 440 - 24 - 2 = 414 px)
    expect(uiCss).toContain('@container (max-width: 414px) { .player-caption { display: none; } }');
  });

  for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]] as const) {
    for (const [name, st] of [['closed', CLOSED], ['default', OPEN], ['max', { sidebar: true, legend: false, sideW: sideMax(w) }]] as const) {
      it(`${w}x${h}, sidebar ${name}: the dock is one row, the controls have equal heights and the left zone never touches the centre zone`, () => {
        const dock = hudRects(w, h, st).dock!;
        const z = dockZones(dock);
        // one row: all three zones share the same top and height, inside the dock
        for (const r of [z.left, z.centre, z.right]) {
          expect(r.y).toBe(z.left.y);
          expect(r.h).toBe(T.dockRow);
          expect(r.y).toBeGreaterThanOrEqual(dock.y);
          expect(r.y + r.h).toBeLessThanOrEqual(dock.y + dock.h);
        }
        // zones in order with at least one gap between them, nothing outside the card
        expect(z.left.x + z.left.w + T.dockGap).toBeLessThanOrEqual(z.centre.x);
        expect(z.centre.x + z.centre.w + T.dockGap).toBeLessThanOrEqual(z.right.x);
        expect(z.right.x + z.right.w).toBeLessThanOrEqual(dock.x + dock.w - T.dockPad - 1);
        expect(overlap(z.left, z.centre)).toBe(0);
        expect(overlap(z.centre, z.right)).toBe(0);
        // the title still has room (at least "Eb…", the full text is in the tooltip) and the card is vertically balanced
        expect(z.left.w).toBeGreaterThanOrEqual(40);
        expect(z.left.y - dock.y).toBe(dock.y + dock.h - (z.left.y + z.left.h));
        // the caption is shown exactly when the dock is wider than 440 px
        expect(z.captionShown).toBe(dock.w > 440);
        if (name !== 'max') expect(dock.w).toBe(T.dockW);
        else expect(dock.w).toBeGreaterThanOrEqual(416);
      });
    }
  }

  it('the dock centre equals the viewport centre, open or closed; its width is capped so it ends before the open side panel (rule and model)', () => {
    const open = rule('body.side-open .dock, body.layer-open .dock');
    expect(open).toContain('width: min(var(--dock-w), calc(100vw - 2 * (var(--side-w) + 2 * var(--edge-pad))))');
    // no rule moves the dock sideways: it keeps left: 50% and the -50% shift in every state
    expect(open).not.toContain('left:');
    expect(rule('.dock')).toContain('left: 50%');
    expect(rule('.dock')).toContain('transform: translateX(-50%)');
    for (const [w, h] of [[1366, 768], [1280, 720], [1920, 1080]] as const) {
      for (const st of [CLOSED, OPEN, { sidebar: true, legend: false, sideW: sideMax(w) }]) {
        const r = hudRects(w, h, st);
        expect(r.dock!.x + r.dock!.w / 2, `${w} ${JSON.stringify(st)}`).toBe(w / 2);
        if (st.sidebar) {
          // the dock's right edge ends at least one gap before the panel's left edge
          expect(r.sidebar!.x - (r.dock!.x + r.dock!.w)).toBeGreaterThanOrEqual(T.edge);
          expect(overlap(r.dock!, r.sidebar!)).toBe(0);
        }
        expect(r.dock!.x).toBeGreaterThanOrEqual(T.edge);
      }
    }
    // The cap in numbers: a plain 40 % panel (512 px at 1280) would leave a dock of 1280 - 2 x (512 + 24) = 208 px;
    // the sidebar maximum min(40 %, 100vw/2 - 232 px) = 408 px keeps 416 px, at every viewport width.
    expect(hudRects(1280, 720, { sidebar: true, legend: false, sideW: 512 }).dock!.w).toBe(208);
    for (const w of [1280, 1366, 1920]) expect(hudRects(w, 720, { sidebar: true, legend: false, sideW: sideMax(w) }).dock!.w).toBe(416);
    // At its default width the dock keeps its full width on all three sizes.
    for (const w of [1280, 1366, 1920]) expect(hudRects(w, 720, OPEN).dock!.w).toBe(T.dockW);
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
    expect(sideMax(1280)).toBe(408);
    expect(rule('.legend-card')).toContain('top: calc(var(--top-h) + var(--space-3))');
    expect(rule('.legend-card')).toContain('width: clamp(168px, 14vw, 220px)');
    // The legend chip is a tray item inside the bar (main.ts puts it into the right-hand .top-nav, before Tour); the card floats on the page.
    expect(rule('.legend')).toContain('position: relative');
    const main = read('../src/main.ts');
    expect(main).toContain('top.nav.insertBefore(legend.element, top.toursButton)');
    expect(main).toContain('document.body.appendChild(legend.card)');
  });

  it('the side panel head row: title, Einfach | Erweitert, close; 32 px high, fits the 280 px minimum with room to spare', () => {
    expect(rule('.sidebar-head')).toContain('display: flex');
    expect(rule('.sidebar-head')).toContain('min-height: 48px');
    expect(rule('.sidebar-head-tools')).toContain('height: 32px');
    expect(rule('.sidebar-head-tools .hud-segment')).toContain('height: 32px');
    expect(rule('.sidebar-title')).toContain('line-height'.replace('line-height', '14px/32px'));
    expect(rule('.sidebar-close')).toContain('flex: none');
    expect(rule('.hud-icon')).toContain('width: var(--control-h)');
    expect(T.controlH).toBeGreaterThanOrEqual(32);
    // Width estimate at 280 px (about 0.6 em per bold character, 0.56 em per medium one): the labels, the
    // paddings and the gaps of the head row, per language. The real render is checked in the GPU pass.
    const gap = px('--space-2');
    const headPadding = px('--space-3') + px('--space-1') + 2; // left, right, border
    const segPad = 2 * px('--space-2') * 2; // two buttons, both sides
    const rowWidth = (title: string, a: string, b: string): number =>
      title.length * 0.6 * 14 + (a.length + b.length) * 0.56 * 13 + segPad + 8 + T.controlH + 2 * gap + headPadding;
    expect(rowWidth('Werkbank', 'Einfach', 'Erweitert')).toBeLessThanOrEqual(280);
    expect(rowWidth('Workbench', 'Simple', 'Advanced')).toBeLessThanOrEqual(280);
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
    expect(phone).toContain('.os-sidebar { left: var(--edge-pad); width: auto !important; top: auto; height: min(42vh, 420px); height: min(42dvh, 420px); }');
    expect(phone).toContain('body.side-open .dock, body.side-open .tour-card { visibility: hidden; }');
    expect(phone).toContain('.home-btn span, .legend-toggle span');
  });
});

describe('E and G: the top bar and the settings dropdown follow the rules', () => {
  it('phone lobby: small title, entry descriptions kept for screen readers only, tight settings row', () => {
    const css = readFileSync('src/style/ui.css', 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 600px)'), css.indexOf('@media (max-width: 1100px)'));
    expect(phone).toContain('.lobby-logo { font-size: 38px; }');
    expect(phone).toContain('.lobby-entry-desc { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }');
    expect(phone).toContain('.lobby-entry { min-height: 56px;');
    // 56 px stays above the 32 px target floor
    expect(56).toBeGreaterThanOrEqual(32);
  });

  it('every target is at least 32 px; the divider is 1 px; the phone collapse (icons only) is kept', () => {
    expect(rule('.tray-item')).toMatch(/min-height: 32px/);
    expect(rule('.hud-icon')).toContain('width: var(--control-h)');
    expect(rule('.top-divider')).toContain('width: 1px');
    expect(rule('.top-right')).toContain('display: flex');
    expect(rule('.top-bar')).toContain('justify-content: space-between');
    expect(uiCss).toContain('.home-btn span, .legend-toggle span');
    expect(uiCss).toContain('.top-prefs .hud-segment button::before { min-height: 32px; }');
  });

  it('the dropdown floats under the gear, over the scene (no layout shift)', () => {
    expect(rule('.settings-menu')).toContain('position: fixed');
    expect(rule('.settings-menu')).toMatch(/top: calc\(var\(--top-h\) \+ var\(--space-2\)\)/);
    expect(rule('.settings-menu')).toContain('right: var(--edge-pad)');
    expect(rule('.settings-menu[hidden]')).toContain('display: none');
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
      for (const st of [CLOSED, OPEN, { sidebar: true, legend: false, sideW: sideMax(w) }, { sidebar: true, legend: true, sideW: sideMax(w) },
        { sidebar: false, legend: true }, EVERYTHING, TOUR, { sidebar: true, legend: false, tour: true },
        { sidebar: true, legend: true, sideW: sideMax(w), tour: true }, { sidebar: false, legend: true, tour: true }]) {
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

    it(`${w}×${h}: the side panel width stays within 280 px .. min(40 %, half the viewport - 232 px) and the dock stays whole`, () => {
      expect(sideWidth(w)).toBeGreaterThanOrEqual(280);
      expect(sideWidth(w)).toBeLessThanOrEqual(0.4 * w);
      expect(hudRects(w, h, OPEN).dock!.w).toBe(T.dockW);
      expect(hudRects(w, h, CLOSED).dock!.w).toBe(T.dockW);
      const wide = hudRects(w, h, { sidebar: true, legend: false, sideW: sideMax(w) });
      expect(wide.sidebar!.w).toBe(sideMax(w));
      expect(overlap(wide.dock!, wide.sidebar!)).toBe(0);
    });
  }

  it(`${'tour card'}: centred above the dock with the dock's own extent; its rules use the tokens`, () => {
    expect(T.tourH).toBe(216);
    const r = rule('.tour-card');
    expect(r).toContain('left: 50%');
    expect(r).toContain('transform: translateX(-50%)');
    expect(r).toContain('bottom: calc(var(--timeline-h) + 2 * var(--space-2) + var(--dock-h) + var(--space-2))');
    expect(r).toContain('width: min(var(--dock-w), calc(100vw - 2 * var(--edge-pad)))');
    expect(r).toContain('height: var(--tour-h)');
    expect(rule('body.side-open .tour-card, body.layer-open .tour-card')).toContain('width: min(var(--dock-w), calc(100vw - 2 * (var(--side-w) + 2 * var(--edge-pad))))');
    expect(rule('.tour-card-body')).toContain('overflow-y: auto');
    expect(uiCss).toContain('body.side-open .dock, body.side-open .tour-card { visibility: hidden; }');
    for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]] as const) {
      for (const st of [TOUR, { sidebar: true, legend: false, tour: true }, { sidebar: true, legend: false, sideW: sideMax(w), tour: true }]) {
        const rs = hudRects(w, h, st);
        expect(rs.tour!.x, `${w}`).toBe(rs.dock!.x);
        expect(rs.tour!.w).toBe(rs.dock!.w);
        expect(rs.tour!.x + rs.tour!.w / 2).toBe(w / 2);
        expect(rs.tour!.y + rs.tour!.h + T.space2).toBe(rs.dock!.y);
        // clear of the top bar by a wide margin
        expect(rs.tour!.y).toBeGreaterThan(T.topH + T.space3);
        if (st.sidebar) expect(overlap(rs.tour!, rs.sidebar!)).toBe(0);
      }
    }
  });

  for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]] as const) {
    it(`${w}×${h}: coverage while a tour runs stays within its budget`, () => {
      const c = coverage(w, h, TOUR);
      const withSide = coverage(w, h, { sidebar: true, legend: false, tour: true });
      console.info(`[coverage model] ${w}x${h} tour card: closed ${c.toFixed(4)} (without top bar ${coverageScene(w, h, TOUR).toFixed(4)}), with side panel ${withSide.toFixed(4)}`);
      // New budgets: a tour adds one card above the dock. 0.36 with the bar and 0.31 without it, side panel closed;
      // 0.50 with the side panel open as well (the card narrows with the dock, so it never grows wider than the dock).
      expect(c).toBeLessThanOrEqual(0.36);
      expect(coverageScene(w, h, TOUR)).toBeLessThanOrEqual(0.31);
      expect(withSide).toBeLessThanOrEqual(0.5);
      expect(c).toBeGreaterThan(coverage(w, h, CLOSED));
    });
  }

  it('phone 390×844: with a tour the card, dock, legend card and timeline do not overlap', () => {
    const w = 390;
    const h = 844;
    const rects = hudRects(w, h, { sidebar: false, legend: true, tour: true });
    expect(rects.tour!.w).toBe(w - 2 * T.edge);
    const entries = Object.entries(rects);
    for (const [i, [ka, a]] of entries.entries()) for (const [kb, b] of entries.slice(i + 1)) expect(overlap(a, b), `${ka} x ${kb}`).toBe(0);
  });

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
