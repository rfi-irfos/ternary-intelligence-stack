import * as THREE from 'three';
import { CAVEATS } from '../content/caveats';
import type { Architecture } from '../data/architecture';
import { type LabelKind, fmt, fmtText, structure } from '../data/labeled';
import { type Trace, decodeToken, loadTrace } from '../data/trace';
import { type LayerWeights, type WeightsLoader, findMatrix } from '../data/weights';
import type { ExplodeView } from '../scene/explode';
import type { CameraPose, CameraRig } from '../camera/controls';
import { type ComponentId, type Stream, parseId } from '../scene/ids';
import { divergingColor, ternaryColor } from '../scene/tile';
import { PALETTE, cssHex } from '../scene/palette';
import { DEPTHS, DEPTH_LABEL, type Depth, getDepth, onDepthChange } from '../ui/depth';
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
  const c = el('span', `layer-kind layer-kind--${kind}`, kind);
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
    info.textContent = `showing ${from}..${to - 1} of ${total}`;
  };
  const zoom = el('input');
  zoom.type = 'range';
  zoom.min = '0';
  zoom.max = String(Math.max(0, total - (to - from)));
  zoom.value = String(from);
  zoom.setAttribute('aria-label', 'Slice start');
  zoom.addEventListener('input', () => {
    const w = to - from;
    from = Number(zoom.value);
    to = from + w;
    draw();
  });
  const full = el('button', undefined, 'whole vector');
  full.type = 'button';
  full.addEventListener('click', () => { from = 0; to = total; zoom.value = '0'; draw(); });
  const part = el('button', undefined, 'zoom slice');
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
  head.append(`attention of position ${v.position} `, kindChip(v.label, v.note));
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
      c.title = `${toks[i] ?? i}: ${w.toFixed(3)}`;
      c.dataset.weight = String(w);
      strip.append(c);
    });
    r.append(strip);
    box.append(r);
  }
  const mat = el('div', 'layer-attn-matrix');
  mat.title = 'head 0: rows = queries, columns = keys (causal)';
  v.matrix.forEach((row, qi) => {
    const r = el('div', 'layer-attn-mrow');
    const mx = Math.max(0, ...row);
    row.forEach((w, ki) => {
      const c = el('span', 'layer-heat-cell');
      c.style.background = hex(divergingColor(w, mx));
      c.title = `query ${qi} -> key ${ki}: ${w.toFixed(3)}`;
      r.append(c);
    });
    mat.append(r);
  });
  box.append(mat);
  return box;
}

function maskView(v: Extract<ViewSpec, { kind: 'mask' }>): HTMLElement {
  const box = el('div', 'layer-view layer-view--mask');
  box.append(el('div', 'layer-view-title', `causal mask for query ${v.position}`));
  const strip = el('div', 'layer-heat');
  for (let k = 0; k < v.size; k++) {
    const c = el('span', 'layer-heat-cell');
    c.style.background = k <= v.position ? hex(PALETTE.neutral) : hex(PALETTE.ternaryZero);
    c.title = k <= v.position ? `key ${k}: visible` : `key ${k}: masked`;
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
  chart.append(Object.assign(el('div', 'layer-bars-zero'), { title: 'zero' }));
  v.values.forEach((x, i) => {
    const col = el('div', 'layer-bar');
    const isMarked = v.marked.includes(i);
    const isClamped = (v.clamped ?? []).includes(i);
    col.dataset.marked = String(isMarked);
    col.classList.toggle('layer-bar--chosen', isMarked);
    col.classList.toggle('layer-bar--a3', isClamped);
    const bar = el('span', `layer-bar-fill ${x >= 0 ? 'layer-bar--pos' : 'layer-bar--neg'}`);
    bar.style.height = `${Math.round((Math.abs(x) / mx) * 44)}px`;
    col.title = `${v.labels?.[i] ?? i}: ${Number(x.toPrecision(4))}${isMarked ? ' (chosen)' : ''}${isClamped ? ' (A3 clamp may have changed this logit)' : ''}`;
    col.append(bar);
    if (isMarked) col.append(el('span', 'layer-bar-chosen', 'chosen'));
    if (isClamped) col.append(el('span', 'layer-bar-a3', 'A3'));
    col.append(el('span', 'layer-bar-label', v.labels?.[i] ?? String(i)));
    chart.append(col);
  });
  box.append(chart, el('div', 'layer-legend', 'bar up = positive, down = negative; outlined and labelled "chosen" = selected expert; A3 = clamp flag set for this token'));
  return box;
}

function matmulView(v: Extract<ViewSpec, { kind: 'matmul' }>, weights: LayerWeights | null): HTMLElement {
  const box = el('div', 'layer-view layer-view--matmul');
  const head = el('div', 'layer-view-title');
  head.append('toy 4x4 ternary matmul ', kindChip('illustrative', 'a schematic, not the checkpoint'));
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
      line.append(`${name} `, fmt(structure(m.shape)), ' real checkpoint tile ', kindChip('structure'));
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
      head.append(`rotation angles at position ${v.position}, head_dim ${v.headDim} `, kindChip('structure'));
      box.append(head, el('div', 'layer-rope-pairing', v.pairing));
      for (const p of v.pairs) {
        box.append(el('div', 'layer-rope-row', `pair ${p.pair}: freq ${Number(p.freq.toPrecision(4))}, angle ${Number(p.angle.toPrecision(4))} rad`));
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
  box.append(el('h3', 'layer-step-title', step.title[depth]));
  const f = el('code', 'layer-formula', step.formula);
  box.append(f, renderView(step.view, weights));
  const foot = el('div', 'layer-step-foot');
  foot.append('data: ', kindChip(step.data.kind, step.data.provenance ? `prompt ${step.data.provenance.prompt_id}` : undefined));
  for (const id of step.caveats) {
    const c = el('span', 'layer-caveat', id);
    c.dataset.caveat = id;
    c.title = CAVEATS[id].title;
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
.layer-panel { position: fixed; right: 12px; top: 12px; width: 340px; max-height: calc(100vh - 220px); overflow-y: auto;
  box-sizing: border-box; padding: 10px; font: 12px monospace; color: #cfd8e8; background: #0a0c12;
  border: 1px solid #333a46; border-radius: 6px; z-index: 5; }
.layer-mode .inspect-panel { display: none; }
.layer-panel[hidden] { display: none; }
.layer-panel button, .layer-panel select, .layer-panel input[type=number] { font: 12px monospace; color: #fff;
  background: #14161b; border: 1px solid #333a46; border-radius: 3px; padding: 3px 6px; cursor: pointer; }
.layer-ctl { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.layer-step-title { margin: 6px 0; font-size: 14px; color: #fff; }
.layer-formula { display: block; margin-bottom: 6px; color: ${cssHex(PALETTE.accent)}; }
.layer-view { margin: 6px 0; }
.layer-view-title { margin-bottom: 4px; }
.layer-heat, .layer-attn-mrow { display: flex; flex-wrap: nowrap; }
.layer-heat-cell { display: inline-block; width: 6px; height: 12px; }
.layer-heat-row, .layer-attn-row { display: flex; gap: 6px; align-items: center; margin: 2px 0; }
.layer-heat-name { min-width: 3.5em; }
.layer-bars { position: relative; display: flex; gap: 3px; height: 130px; }
.layer-bars-zero { position: absolute; left: 0; right: 0; top: 50px; border-top: 1px solid #cfd8e8; }
.layer-bar { position: relative; flex: 1 1 0; height: 100%; }
.layer-bar-fill { position: absolute; left: 20%; width: 60%; }
.layer-bar-fill.layer-bar--pos { bottom: 80px; background: ${cssHex(PALETTE.ternaryPlus)}; }
.layer-bar-fill.layer-bar--neg { top: 50px; background: ${cssHex(PALETTE.ternaryMinus)}; }
.layer-bar--chosen { outline: 2px solid ${cssHex(PALETTE.accent)}; outline-offset: -1px; }
.layer-bar-chosen { position: absolute; top: 106px; left: 0; right: 0; text-align: center; font-size: 8px; color: ${cssHex(PALETTE.accent)}; }
.layer-bar-a3 { position: absolute; top: 96px; left: 0; right: 0; text-align: center; font-size: 8px; color: ${cssHex(PALETTE.accent)}; }
.layer-bar-label { position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; }
.layer-legend { margin-top: 4px; font-size: 10px; }
.layer-kind { display: inline-block; padding: 0 5px; border-radius: 3px; border: 1px solid #cfd8e8; }
.layer-kind--measured { border-color: ${cssHex(PALETTE.accent)}; color: ${cssHex(PALETTE.accent)}; border-style: solid; }
.layer-kind--illustrative { background: repeating-linear-gradient(45deg, #333a46 0 2px, transparent 2px 4px); }
.layer-caveat { display: inline-block; padding: 0 5px; border: 1px solid ${cssHex(PALETTE.accent)}; color: ${cssHex(PALETTE.accent)}; border-radius: 3px; }
.layer-truncated { color: #fff; border: 1px dashed ${cssHex(PALETTE.accent)}; padding: 3px; margin: 4px 0; }
.layer-matmul { display: flex; gap: 8px; align-items: center; }
.layer-mm-w { display: grid; grid-template-columns: repeat(4, 22px); }
.layer-mm-v { display: grid; grid-template-columns: 38px; }
.layer-mm-cell { display: block; text-align: center; padding: 2px 0; color: #fff; }
`;

export interface LayerModeDeps {
  arch: Architecture;
  view: Pick<ExplodeView, 'explode' | 'reassemble' | 'depth' | 'current' | 'root'>;
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
  root.setAttribute('aria-label', 'Layer steps');
  const prompt = el('select');
  prompt.setAttribute('aria-label', 'Prompt');
  prompt.append(new Option('no trace (illustrative)', ''), ...ids.map((i) => new Option(i, i)));
  const tokenSel = el('select');
  tokenSel.setAttribute('aria-label', 'Token');
  const streamSel = el('select');
  streamSel.setAttribute('aria-label', 'Stream');
  streamSel.append(new Option('stream A', 'A'), new Option('stream B', 'B'));
  const depthSel = el('select');
  depthSel.setAttribute('aria-label', 'Depth');
  for (const d of DEPTHS) depthSel.append(new Option(DEPTH_LABEL[d], d));
  const prev = el('button', undefined, 'Prev');
  const next = el('button', undefined, 'Next');
  const close = el('button', undefined, 'Leave layer');
  for (const b of [prev, next, close]) b.type = 'button';
  const where = el('div', 'layer-where');
  const body = el('div');
  const ctl = el('div', 'layer-ctl');
  ctl.append(prompt, tokenSel, streamSel, depthSel, prev, next, close);
  root.append(ctl, where, body);

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
    const toks = trace ? trace.provenance.tokens.map(decodeToken) : Array.from({ length: 12 }, (_, k) => `toy ${k}`);
    toks.forEach((t, k) => tokenSel.append(new Option(`${k}: ${JSON.stringify(t)}`, String(k))));
    tokenSel.value = String(Math.max(0, Math.min(toks.length - 1, keep)));
  };
  const rebuild = (): void => {
    stepList = layerSteps(trace, layer, streamSel.value as Stream, position(), arch);
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

  const show = (): void => {
    const step = stepList[i];
    if (!step) return;
    body.replaceChildren(renderStep(step, getDepth(), weights));
    where.textContent = `layer ${layer}, stream ${streamSel.value}, token ${position()}, step ${i + 1} of ${stepList.length}`;
  };
  const draw = async (): Promise<void> => {
    const step = stepList[i];
    if (!step) return;
    show();
    await ensureOpen(step.open);
    applyHighlight(view.root, step.highlight);
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

  prompt.addEventListener('change', () => { void (async () => { tokenSel.value = '0'; await reload(); })(); });
  tokenSel.addEventListener('change', () => { void reload(); });
  streamSel.addEventListener('change', () => { void reload(); });
  depthSel.addEventListener('change', () => { show(); });
  onDepthChange((d) => { depthSel.value = d; if (active) show(); });
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
        await draw();
        await rig.frame(deps.slabCenter(layer), FRAME_HALF_W, FRAME_HALF_H, ms());
      });
    },
    exit() {
      return enqueue(async () => {
        if (!active) return;
        active = false;
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
  };
  return api;
}
