import * as THREE from 'three';
import { CAVEATS } from '../content/caveats';
import type { Architecture } from '../data/architecture';
import { type LabelKind, decText, fmt, fmtText, kindName, structure } from '../data/labeled';
import { type Trace, decodeToken, loadTrace } from '../data/trace';
import { type LayerWeights, type WeightsLoader, findMatrix } from '../data/weights';
import type { ExplodeView } from '../scene/explode';
import type { CameraPose, CameraRig } from '../camera/controls';
import { type ComponentId, type Stream, parseId } from '../scene/ids';
import { divergingColor, ternaryColor } from '../scene/tile';
import { PALETTE, cssHex } from '../scene/palette';
import { DEPTHS, type Depth, getDepth, onDepthChange, setDepth } from '../ui/depth';
import { ICONS } from '../ui/icons';
import { getLang, getMode, layerLabel, lt, onPrefsChange, t } from '../ui/prefs';
import { defaultPosition } from '../ui/player';
import type { StringKey } from '../ui/strings';
import { type Step, type ViewSpec, layerSteps } from './steps';

const hex = cssHex;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Label chip: the kind of every number drawn in a figure. */
function kindChip(kind: LabelKind, note?: string): HTMLElement {
  const c = el('span', `layer-kind layer-kind--${kind}`, kindName(kind));
  c.dataset.kind = kind;
  if (note) c.title = note;
  return c;
}

/** Heat strip of `values[from..to)`; each cell is a div with its value as title. */
export function heatStrip(values: number[], from: number, to: number): HTMLElement {
  const lo = Math.max(0, Math.min(from, values.length));
  const hi = Math.max(lo, Math.min(to, values.length));
  const slice = values.slice(lo, hi);
  const maxAbs = Math.max(0, ...slice.map(Math.abs));
  const strip = el('div', 'layer-heat');
  for (const [i, v] of slice.entries()) {
    const c = el('span', 'layer-heat-cell');
    c.style.background = hex(divergingColor(v, maxAbs));
    c.title = `[${lo + i}] ${v}`;
    strip.append(c);
  }
  return strip;
}

function heatView(v: Extract<ViewSpec, { kind: 'heat' }>): HTMLElement {
  const box = el('div', 'layer-view layer-view--heat');
  box.append(el('div', 'layer-view-title', v.title));
  const total = Math.max(...v.series.map((s) => s.values.length));
  let [from, to] = v.slice;
  const body = el('div');
  const info = el('span', 'layer-slice');
  const draw = (): void => {
    body.replaceChildren();
    for (const s of v.series) {
      const r = el('div', 'layer-heat-row');
      r.append(el('span', 'layer-heat-name', s.name), heatStrip(s.values, from, to));
      body.append(r);
    }
    info.textContent = t('fig.showing', { a: from, b: to - 1, n: total });
  };
  const zoom = el('input');
  zoom.type = 'range';
  zoom.min = '0';
  zoom.max = String(Math.max(0, total - (to - from)));
  zoom.value = String(from);
  zoom.setAttribute('aria-label', t('fig.sliceStart'));
  zoom.addEventListener('input', () => {
    const w = to - from;
    from = Number(zoom.value);
    to = from + w;
    draw();
  });
  const full = el('button', undefined, t('fig.whole'));
  full.type = 'button';
  full.addEventListener('click', () => { from = 0; to = total; zoom.value = '0'; draw(); });
  const part = el('button', undefined, t('fig.zoom'));
  part.type = 'button';
  part.addEventListener('click', () => { to = Math.min(total, from + Math.min(64, total)); draw(); });
  draw();
  box.append(body, el('div', 'layer-heat-ctl'));
  box.lastElementChild?.append(zoom, part, full, info);
  return box;
}

function attentionView(v: Extract<ViewSpec, { kind: 'attention' }>): HTMLElement {
  const box = el('div', 'layer-view layer-view--attn');
  const head = el('div', 'layer-view-title');
  head.append(`${t('fig.attnOf', { p: v.position })} `, kindChip(v.label, v.note));
  box.append(head);
  if (v.truncated) {
    const t = el('div', 'layer-truncated', v.note);
    t.dataset.truncated = 'true';
    box.append(t);
  }
  const toks = v.tokens ?? v.heads[0]?.row.map((_, i) => `#${i}`) ?? [];
  for (const h of v.heads) {
    const r = el('div', 'layer-attn-row');
    r.append(el('span', 'layer-heat-name', `h${h.head}`));
    const strip = el('div', 'layer-heat');
    const mx = Math.max(0, ...h.row);
    h.row.forEach((w, i) => {
      const c = el('span', 'layer-heat-cell');
      c.style.background = hex(divergingColor(w, mx));
      c.title = `${toks[i] ?? i}: ${decText(w, 3)}`;
      c.dataset.weight = String(w);
      strip.append(c);
    });
    r.append(strip);
    box.append(r);
  }
  const mat = el('div', 'layer-attn-matrix');
  mat.title = t('fig.head0');
  v.matrix.forEach((row, qi) => {
    const r = el('div', 'layer-attn-mrow');
    const mx = Math.max(0, ...row);
    row.forEach((w, ki) => {
      const c = el('span', 'layer-heat-cell');
      c.style.background = hex(divergingColor(w, mx));
      c.title = t('fig.queryKey', { q: qi, k: ki, w: decText(w, 3) });
      r.append(c);
    });
    mat.append(r);
  });
  box.append(mat);
  return box;
}

function maskView(v: Extract<ViewSpec, { kind: 'mask' }>): HTMLElement {
  const box = el('div', 'layer-view layer-view--mask');
  box.append(el('div', 'layer-view-title', t('fig.mask', { p: v.position })));
  const strip = el('div', 'layer-heat');
  for (let k = 0; k < v.size; k++) {
    const c = el('span', 'layer-heat-cell');
    c.style.background = k <= v.position ? hex(PALETTE.neutral) : hex(PALETTE.ternaryZero);
    c.title = k <= v.position ? t('fig.visible', { k }) : t('fig.masked', { k });
    strip.append(c);
  }
  box.append(strip, kindChip('structure'));
  return box;
}

function barsView(v: Extract<ViewSpec, { kind: 'bars' }>): HTMLElement {
  const box = el('div', 'layer-view layer-view--bars');
  const head = el('div', 'layer-view-title');
  head.append(v.title, ' ', kindChip(v.label));
  box.append(head);
  const mx = Math.max(1e-9, ...v.values.map(Math.abs));
  const chart = el('div', 'layer-bars');
  chart.append(Object.assign(el('div', 'layer-bars-zero'), { title: t('fig.zero') }));
  v.values.forEach((x, i) => {
    const col = el('div', 'layer-bar');
    const isMarked = v.marked.includes(i);
    const isClamped = (v.clamped ?? []).includes(i);
    col.dataset.marked = String(isMarked);
    col.classList.toggle('layer-bar--chosen', isMarked);
    col.classList.toggle('layer-bar--a3', isClamped);
    const bar = el('span', `layer-bar-fill ${x >= 0 ? 'layer-bar--pos' : 'layer-bar--neg'}`);
    bar.style.height = `${Math.round((Math.abs(x) / mx) * 44)}px`;
    col.title = `${v.labels?.[i] ?? i}: ${Number(x.toPrecision(4))}${isMarked ? t('fig.chosen') : ''}${isClamped ? t('fig.a3') : ''}`;
    col.append(bar);
    if (isMarked) col.append(el('span', 'layer-bar-chosen', t('fig.chosenTag')));
    if (isClamped) col.append(el('span', 'layer-bar-a3', 'A3'));
    col.append(el('span', 'layer-bar-label', v.labels?.[i] ?? String(i)));
    chart.append(col);
  });
  box.append(chart, el('div', 'layer-legend', t('fig.barsLegend')));
  return box;
}

function matmulView(v: Extract<ViewSpec, { kind: 'matmul' }>, weights: LayerWeights | null): HTMLElement {
  const box = el('div', 'layer-view layer-view--matmul');
  const head = el('div', 'layer-view-title');
  head.append(`${t('fig.toy')} `, kindChip('illustrative', t('fig.toyTip')));
  box.append(head);
  const grid = el('div', 'layer-matmul');
  const cell = (txt: string, color?: string): HTMLElement => {
    const c = el('span', 'layer-mm-cell', txt);
    if (color) c.style.background = color;
    return c;
  };
  const wg = el('div', 'layer-mm-w');
  for (const row of v.w) for (const w of row) wg.append(cell(w > 0 ? '+' : w < 0 ? '-' : '0', hex(ternaryColor(w > 0 ? '+' : w < 0 ? '-' : '0'))));
  const xg = el('div', 'layer-mm-v');
  for (const x of v.x) xg.append(cell(String(x)));
  const yg = el('div', 'layer-mm-v');
  for (const y of v.y) yg.append(cell(String(y)));
  grid.append(wg, el('span', undefined, 'x'), xg, el('span', undefined, '='), yg);
  box.append(grid);
  if (weights) {
    const real = el('div', 'layer-tiles');
    for (const name of v.tiles) {
      const m = findMatrix(weights, name);
      if (!m) continue;
      const line = el('div', 'layer-tile');
      line.append(`${name} `, fmt(structure(m.shape)), ` ${t('fig.realTile')} `, kindChip('structure'));
      real.append(line);
    }
    box.append(real);
  }
  return box;
}

/** Renders one figure. `weights` (this layer's checkpoint tiles) is optional. */
export function renderView(v: ViewSpec, weights: LayerWeights | null = null): HTMLElement {
  switch (v.kind) {
    case 'heat': return heatView(v);
    case 'attention': return attentionView(v);
    case 'mask': return maskView(v);
    case 'bars': return barsView(v);
    case 'matmul': return matmulView(v, weights);
    case 'rope': {
      const box = el('div', 'layer-view layer-view--rope');
      const head = el('div', 'layer-view-title');
      head.append(`${t('fig.rope', { p: v.position, d: v.headDim })} `, kindChip('structure'));
      box.append(head, el('div', 'layer-rope-pairing', v.pairing));
      for (const p of v.pairs) {
        box.append(el('div', 'layer-rope-row', t('fig.ropeRow', { i: p.pair, f: Number(p.freq.toPrecision(4)), a: Number(p.angle.toPrecision(4)) })));
      }
      return box;
    }
    case 'readout': {
      const box = el('div', 'layer-view layer-view--readout');
      for (const it of v.items) {
        const r = el('div', 'layer-readout-row');
        r.append(`${it.name}: `, fmt(it.value, typeof it.value.value === 'string' ? {} : { format: (x) => fmtText({ kind: 'structure', value: x }) }));
        box.append(r);
      }
      return box;
    }
  }
}

/** The text and figure of one step at one depth. */
export function renderStep(step: Step, depth: Depth, weights: LayerWeights | null = null): HTMLElement {
  const box = el('div', 'layer-step');
  box.dataset.step = step.id;
  // Every depth's title comes from layerSteps in the current language (src/layer/steps.ts).
  box.append(el('h3', 'layer-step-title', step.title[depth]));
  const f = el('code', 'layer-formula', step.formula);
  box.append(f, renderView(step.view, weights));
  const foot = el('div', 'layer-step-foot');
  foot.append(`${t('fig.data')} `, kindChip(step.data.kind, step.data.provenance ? t('fig.prompt', { id: step.data.provenance.prompt_id }) : undefined));
  for (const id of step.caveats) {
    const c = el('span', 'layer-caveat', id);
    c.dataset.caveat = id;
    c.title = lt(CAVEATS[id].title);
    foot.append(' ', c);
  }
  box.append(foot);
  return box;
}

const HL = 'layer-highlight';

/** Outlines meshes named in `ids` under `root`; removes outlines of all others. Never moves the camera. */
export function applyHighlight(root: THREE.Object3D, ids: ComponentId[]): number {
  const want = new Set(ids);
  const stale: THREE.Object3D[] = [];
  let count = 0;
  root.traverse((o) => {
    if (o.name === HL) stale.push(o);
  });
  for (const o of stale) {
    o.removeFromParent();
    if (o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !want.has(o.name)) return;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(o.geometry as THREE.BufferGeometry),
      new THREE.LineBasicMaterial({ color: PALETTE.edge }),
    );
    edges.name = HL;
    // Full white and slightly larger than the faint glass outline the part already has.
    edges.scale.setScalar(1.06);
    edges.renderOrder = 5;
    o.add(edges);
    count++;
  });
  return count;
}

export const LAYER_CSS = `
.layer-panel { position: fixed; right: var(--edge-pad); top: calc(var(--top-h) + var(--edge-pad)); bottom: var(--edge-pad);
  width: var(--side-w); overflow-y: auto; box-sizing: border-box; padding: 16px 18px; z-index: 5;
  font: 400 var(--fs-base)/1.45 var(--font-ui); color: var(--c-text); }
.layer-mode .inspect-panel { display: none; }
.layer-panel[hidden] { display: none; }
.layer-nav { display: flex; gap: var(--gap); margin-bottom: 10px; }
.layer-nav .layer-leave { margin-left: auto; }
.layer-ctl { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.layer-ctl .hud-select { flex: 1 1 140px; min-width: 0; }
.layer-where { color: var(--c-text-muted); font-size: var(--fs-small); font-feature-settings: "tnum"; }
.layer-step-title { margin: 10px 0 6px; font: 700 var(--fs-h2)/1.2 var(--font-display); color: var(--c-text); }
.layer-formula { display: block; margin-bottom: 8px; font: 400 var(--fs-large)/1.4 var(--font-math); color: var(--c-accent); }
.layer-view { margin: 8px 0; font-size: var(--fs-small); font-feature-settings: "tnum"; }
.layer-view-title { margin-bottom: 4px; }
.layer-heat, .layer-attn-mrow { display: flex; flex-wrap: nowrap; }
.layer-heat-cell { display: inline-block; width: 6px; height: 12px; }
.layer-heat-row, .layer-attn-row { display: flex; gap: 6px; align-items: center; margin: 2px 0; }
.layer-heat-name { min-width: 3.5em; }
.layer-bars { position: relative; display: flex; gap: 3px; height: 130px; }
.layer-bars-zero { position: absolute; left: 0; right: 0; top: 50px; border-top: 1px solid var(--c-text-muted); }
.layer-bar { position: relative; flex: 1 1 0; height: 100%; }
.layer-bar-fill { position: absolute; left: 20%; width: 60%; }
.layer-bar-fill.layer-bar--pos { bottom: 80px; background: var(--c-ternary-plus); }
.layer-bar-fill.layer-bar--neg { top: 50px; background: var(--c-ternary-minus); }
.layer-bar--chosen { outline: 2px solid var(--c-accent); outline-offset: -1px; }
.layer-bar-chosen { position: absolute; top: 106px; left: 0; right: 0; text-align: center; font-size: 9px; color: var(--c-accent); }
.layer-bar-a3 { position: absolute; top: 96px; left: 0; right: 0; text-align: center; font-size: 9px; color: var(--c-accent); }
.layer-bar-label { position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 10px; }
.layer-legend { margin-top: 4px; font-size: 12px; color: var(--c-text-muted); }
.layer-kind { display: inline-block; padding: 0 6px; border-radius: 999px; border: 1px solid var(--c-text-muted); font-size: 12px; }
.layer-kind--measured { border-color: var(--c-accent); color: var(--c-accent); border-style: solid; }
.layer-kind--illustrative { background: repeating-linear-gradient(45deg, var(--c-hairline) 0 2px, transparent 2px 4px); }
.layer-caveat { display: inline-block; padding: 0 6px; border: 1px solid var(--c-accent); color: var(--c-accent); border-radius: 999px; font-size: 12px; }
.layer-truncated { color: var(--c-text); border: 1px dashed var(--c-accent); padding: 3px; margin: 4px 0; }
.layer-matmul { display: flex; gap: 8px; align-items: center; }
.layer-mm-w { display: grid; grid-template-columns: repeat(4, 22px); }
.layer-mm-v { display: grid; grid-template-columns: 38px; }
.layer-mm-cell { display: block; text-align: center; padding: 2px 0; color: #fff; }
.layer-step-foot { margin-top: 8px; font-size: var(--fs-small); color: var(--c-text-muted); }
`;

export interface LayerModeDeps {
  arch: Architecture;
  view: Pick<ExplodeView, 'explode' | 'reassemble' | 'depth' | 'current' | 'root'> & Partial<Pick<ExplodeView, 'box'>>;
  rig: Pick<CameraRig, 'pose' | 'flyToPose' | 'frame'>;
  /** World centre of a slab, for framing. */
  slabCenter(layer: number): THREE.Vector3;
  loadWeights: WeightsLoader;
  /** Defaults to fetching the demo traces. */
  load?: (id: string) => Promise<Trace>;
  ids?: string[];
  /** Layer currently selected in the rail, scene or panel. */
  selectedLayer?: () => number | null;
  /** Prompt and token position of the player; the step card starts there. */
  defaults?: () => { promptId: string; position: number } | null;
  /** Defaults to the media query. */
  reducedMotion?: () => boolean;
}

export interface LayerMode {
  element: HTMLElement;
  /** Opens layer mode (a user action: it opens the exploded slab and frames it). Default layer: the selected one. */
  enter(layer?: number, stream?: Stream): Promise<void>;
  exit(): Promise<void>;
  index(): number;
  layer(): number;
  /** Token position of the token select. */
  position(): number;
  steps(): readonly Step[];
  goto(i: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Resolves when every queued draw has finished. */
  idle(): Promise<void>;
  /** Removes the depth and prefs listeners and the element. */
  dispose(): void;
}

/** Layer of a component id (null for embed, lm_head, ln_f, shafts). */
export function layerOfId(id: ComponentId | null): number | null {
  const p = id ? parseId(id) : null;
  return p && 'layer' in p ? p.layer : null;
}

const FRAME_HALF_W = 9;
const FRAME_HALF_H = 5;
const FLY_MS = 900;

const samePath = (a: ComponentId[], b: ComponentId[]): boolean => a.length === b.length && a.every((x, k) => x === b[k]);

export function createLayerMode(deps: LayerModeDeps): LayerMode {
  const { arch, view, loadWeights, rig } = deps;
  const load = deps.load ?? ((id: string) => loadTrace(id, arch));
  const ids = deps.ids ?? ['kjv', 'de', 'ternary'];
  const reduced = deps.reducedMotion ?? ((): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ms = (): number => (reduced() ? 0 : FLY_MS);
  const root = el('div', 'layer-panel');
  root.hidden = true;
  root.setAttribute('role', 'region');
  const prompt = el('select', 'hud-select');

  prompt.append(new Option('', ''), ...ids.map((i) => new Option(i, i)));
  const tokenSel = el('select', 'hud-select');

  const streamSel = el('select', 'hud-select');

  streamSel.append(new Option('', 'A'), new Option('', 'B'));
  const depthSel = el('select', 'hud-select');

  depthSel.dataset.adv = 'true';
  for (const d of DEPTHS) depthSel.append(new Option(d, d));
  const prev = el('button', 'hud-btn');
  const next = el('button', 'hud-btn');
  const close = el('button', 'hud-btn layer-leave');
  for (const b of [prev, next, close]) b.type = 'button';
  const where = el('div', 'layer-where');
  const body = el('div');
  const ctl = el('div', 'layer-ctl');
  const nav = el('div', 'layer-nav');
  nav.append(prev, next, close);
  ctl.append(prompt, tokenSel, streamSel, depthSel);
  root.append(nav, ctl, where, body);
  /** Labels of the current language and mode (values and the open step stay). */
  const paintChrome = (): void => {
    root.setAttribute('aria-label', t('layer.region'));
    prompt.setAttribute('aria-label', t('layer.prompt'));
    tokenSel.setAttribute('aria-label', t('layer.token'));
    streamSel.setAttribute('aria-label', t('layer.stream'));
    depthSel.setAttribute('aria-label', t('layer.depth'));
    (prompt.options[0] as HTMLOptionElement).text = t('layer.noTrace');
    (streamSel.options[0] as HTMLOptionElement).text = t('layer.streamA');
    (streamSel.options[1] as HTMLOptionElement).text = t('layer.streamB');
    for (const o of depthSel.options) o.text = t(`depth.${o.value}` as StringKey);
    depthSel.hidden = getMode() === 'simple';
    prev.textContent = t('layer.prev');
    next.textContent = t('layer.next');
    close.replaceChildren();
    close.insertAdjacentHTML('afterbegin', ICONS.close);
    close.append(t('layer.leave'));
  };
  paintChrome();

  let layer = 0;
  let trace: Trace | null = null;
  let stepList: Step[] = [];
  let i = 0;
  /** Index requested by the latest click; draws run in order, so rapid clicks all count. */
  let target = 0;
  let weights: LayerWeights | null = null;
  let openPath: ComponentId[] = [];
  let active = false;
  let saved: CameraPose | null = null;
  let busy = 0;
  let chain: Promise<void> = Promise.resolve();
  const traces = new Map<string, Trace>();

  const position = (): number => Number(tokenSel.value) || 0;
  const syncButtons = (): void => {
    prev.disabled = busy > 0 || i === 0;
    next.disabled = busy > 0 || i >= stepList.length - 1;
  };
  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    const run = chain.then(async () => {
      busy++;
      syncButtons();
      try { await fn(); } finally { busy--; syncButtons(); }
    });
    chain = run.catch((err: unknown) => console.error(err));
    return chain;
  };

  const fillTokens = (keep: number): void => {
    tokenSel.replaceChildren();
    const toks = trace ? trace.provenance.tokens.map(decodeToken) : Array.from({ length: 12 }, (_, k) => t('layer.toy', { k }));
    toks.forEach((t, k) => tokenSel.append(new Option(`${k}: ${JSON.stringify(t)}`, String(k))));
    tokenSel.value = String(Math.max(0, Math.min(toks.length - 1, keep)));
  };
  const rebuild = (): void => {
    stepList = layerSteps(trace, layer, streamSel.value as Stream, position(), arch, getLang());
    i = Math.min(i, stepList.length - 1);
    target = i;
  };
  const ensureTrace = async (id: string): Promise<void> => {
    if (!id) { trace = null; return; }
    let t = traces.get(id);
    if (!t) { t = await load(id); traces.set(id, t); }
    trace = t;
  };

  /** Opens `path` in the exploded view, reusing the levels that are already right. */
  const ensureOpen = async (path: ComponentId[]): Promise<void> => {
    const consistent = view.depth() === openPath.length && (openPath.length === 0 || view.current() === openPath[openPath.length - 1]);
    if (consistent && samePath(openPath, path)) return;
    let k = 0;
    if (consistent) while (k < openPath.length && k < path.length && openPath[k] === path[k]) k++;
    while (view.depth() > k) await view.reassemble();
    for (const id of path.slice(k)) await view.explode(id);
    openPath = [...path];
  };

  /** The frame layer mode last gave the camera (null outside layer mode). */
  let framed: { cx: number; halfW: number; halfH: number } | null = null;
  /** Frame of the exploded slab plus the room its neighbours made (never smaller than the default). */
  const frameFor = (): { c: THREE.Vector3; halfW: number; halfH: number } => {
    const c = deps.slabCenter(layer);
    const b = view.box?.() ?? null;
    let halfW = FRAME_HALF_W;
    let halfH = FRAME_HALF_H;
    if (b) {
      c.x = (b.min.x + b.max.x) / 2;
      halfW = Math.max(halfW, (b.max.x - b.min.x) / 2);
      halfH = Math.max(halfH, (b.max.z - b.min.z) / 2);
    }
    return { c, halfW, halfH };
  };
  /**
   * Frames the open group (`always`), or only when it grew beyond the current frame. Called from
   * user actions only (enter, a step, a prompt/token/stream change), never from idle code.
   */
  const reframe = async (always: boolean): Promise<void> => {
    const f = frameFor();
    const o = framed;
    const grew = !o || f.c.x - f.halfW < o.cx - o.halfW - 1e-6 || f.c.x + f.halfW > o.cx + o.halfW + 1e-6
      || f.halfH > o.halfH + 1e-6;
    if (!always && !grew) return;
    framed = { cx: f.c.x, halfW: f.halfW, halfH: f.halfH };
    await rig.frame(f.c, f.halfW, f.halfH, ms());
  };

  const show = (): void => {
    const step = stepList[i];
    if (!step) return;
    body.replaceChildren(renderStep(step, getDepth(), weights));
    where.textContent = t('layer.where', { l: layerLabel(layer), s: streamSel.value, p: position(), i: i + 1, n: stepList.length });
  };
  const draw = async (): Promise<void> => {
    const step = stepList[i];
    if (!step) return;
    show();
    await ensureOpen(step.open);
    applyHighlight(view.root, step.highlight);
    // A step that opens a bigger group (the bank, an expert) widens the frame so it stays in view.
    if (active && framed) await reframe(false);
  };
  const go = (to: number): Promise<void> => {
    target = Math.max(0, Math.min(stepList.length - 1, to));
    const mine = target;
    return enqueue(async () => { i = mine; await draw(); });
  };
  const reload = (): Promise<void> => enqueue(async () => {
    const keep = position();
    const id = prompt.value;
    await ensureTrace(id);
    fillTokens(keep);
    rebuild();
    await draw();
  });

  // A new sentence follows its default word (the last non-punctuation token), as the player and tours do.
  prompt.addEventListener('change', () => {
    void enqueue(async () => {
      await ensureTrace(prompt.value);
      fillTokens(trace ? defaultPosition(trace.provenance.tokens.map(decodeToken)) : 0);
      rebuild();
      await draw();
    });
  });
  tokenSel.addEventListener('change', () => { void reload(); });
  streamSel.addEventListener('change', () => { void reload(); });
  // The depth select is the global depth (one concept with the panel and the Simple/Advanced mode).
  depthSel.addEventListener('change', () => { setDepth(depthSel.value as Depth); show(); });
  const offDepth = onDepthChange((d) => { depthSel.value = d; if (active) show(); });
  // A language change rebuilds the steps (their texts are per language); the open step stays.
  const offPrefs = onPrefsChange(() => { paintChrome(); if (active) { rebuild(); show(); } });
  prev.addEventListener('click', () => void go(target - 1));
  next.addEventListener('click', () => void go(target + 1));
  close.addEventListener('click', () => void api.exit());

  const api: LayerMode = {
    element: root,
    enter(l, s = 'A') {
      return enqueue(async () => {
        layer = l ?? deps.selectedLayer?.() ?? 0;
        streamSel.value = s;
        depthSel.value = getDepth();
        const d = deps.defaults?.() ?? null;
        const wanted = d && ids.includes(d.promptId) ? d.promptId : '';
        prompt.value = wanted;
        await ensureTrace(wanted);
        fillTokens(d && wanted ? d.position : 0);
        weights = await loadWeights(layer).catch(() => null);
        i = 0;
        rebuild();
        if (!active) saved = rig.pose();
        active = true;
        document.body.classList.add('layer-mode');
        root.hidden = false;
        // Start from a clean view: whatever was open (a panel level, another layer) closes first.
        while (view.depth() > 0) await view.reassemble();
        openPath = [];
        framed = null;
        await draw();
        // Frame the exploded slab plus the room its neighbours made (never smaller than before).
        await reframe(true);
      });
    },
    exit() {
      return enqueue(async () => {
        if (!active) return;
        active = false;
        framed = null;
        root.hidden = true;
        document.body.classList.remove('layer-mode');
        applyHighlight(view.root, []);
        while (view.depth() > 0) await view.reassemble();
        openPath = [];
        if (saved) await rig.flyToPose(saved, ms());
        saved = null;
      });
    },
    index: () => i,
    layer: () => layer,
    position,
    steps: () => stepList,
    goto: (k) => go(k),
    next: () => go(target + 1),
    prev: () => go(target - 1),
    idle: () => chain,
    dispose() {
      offDepth();
      offPrefs();
      root.remove();
    },
  };
  return api;
}
