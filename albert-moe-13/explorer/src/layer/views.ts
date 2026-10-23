import * as THREE from 'three';
import { CAVEATS } from '../content/caveats';
import type { Architecture } from '../data/architecture';
import { type LabelKind, fmt, fmtText, structure } from '../data/labeled';
import { type Trace, decodeToken, loadTrace } from '../data/trace';
import { type LayerWeights, type WeightsLoader, findMatrix } from '../data/weights';
import type { ExplodeView } from '../scene/explode';
import type { ComponentId, Stream } from '../scene/ids';
import { divergingColor, ternaryColor } from '../scene/tile';
import { DEPTHS, DEPTH_LABEL, type Depth, getDepth, onDepthChange } from '../ui/depth';
import { type Step, type ViewSpec, layerSteps } from './steps';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
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
    c.style.background = k <= v.position ? hex(0x58c4dd) : hex(0x1a1c21);
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
  v.values.forEach((x, i) => {
    const col = el('div', 'layer-bar');
    const isMarked = v.marked.includes(i);
    col.dataset.marked = String(isMarked);
    const bar = el('span', 'layer-bar-fill');
    bar.style.height = `${Math.round((Math.abs(x) / mx) * 60)}px`;
    bar.style.background = isMarked ? '#ffd940' : x >= 0 ? '#58c4dd' : '#fc6255';
    col.title = `${i}: ${Number(x.toPrecision(4))}`;
    col.append(bar, el('span', 'layer-bar-label', String(i)));
    chart.append(col);
  });
  box.append(chart);
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
      head.append(`rotation angles at position ${v.position} `, kindChip('illustrative', 'position is real, frequencies are a toy'));
      box.append(head);
      for (const [i, a] of v.angles.entries()) box.append(el('div', 'layer-rope-row', `pair ${i}: ${a} rad`));
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
  for (const o of stale) o.removeFromParent();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !want.has(o.name)) return;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(o.geometry as THREE.BufferGeometry),
      new THREE.LineBasicMaterial({ color: 0xffd940 }),
    );
    edges.name = HL;
    o.add(edges);
    count++;
  });
  return count;
}

export const LAYER_CSS = `
.layer-panel { position: fixed; right: 14px; top: 56px; width: min(380px, 92vw); max-height: 80vh; overflow: auto;
  box-sizing: border-box; padding: 10px; font: 12px monospace; color: #cfd8e8; background: rgba(0,0,0,0.78);
  border: 1px solid #333a46; border-radius: 6px; }
.layer-panel button, .layer-panel select, .layer-panel input[type=number] { font: 12px monospace; color: #fff;
  background: #14161b; border: 1px solid #333a46; border-radius: 3px; padding: 3px 6px; cursor: pointer; }
.layer-ctl { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.layer-step-title { margin: 6px 0; font-size: 14px; color: #fff; }
.layer-formula { display: block; margin-bottom: 6px; color: #ffd940; }
.layer-view { margin: 6px 0; }
.layer-view-title { margin-bottom: 4px; }
.layer-heat, .layer-attn-mrow { display: flex; flex-wrap: nowrap; }
.layer-heat-cell { display: inline-block; width: 6px; height: 12px; }
.layer-heat-row, .layer-attn-row { display: flex; gap: 6px; align-items: center; margin: 2px 0; }
.layer-heat-name { min-width: 3.5em; }
.layer-bars { display: flex; gap: 3px; align-items: flex-end; height: 80px; }
.layer-bar { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
.layer-bar-fill { display: block; width: 14px; }
.layer-kind { display: inline-block; padding: 0 5px; border-radius: 3px; border: 1px solid #cfd8e8; }
.layer-kind--measured { border-color: #ffd940; color: #ffd940; }
.layer-kind--illustrative { background: repeating-linear-gradient(45deg, #333a46 0 2px, transparent 2px 4px); }
.layer-caveat { display: inline-block; padding: 0 5px; border: 1px solid #ffd940; color: #ffd940; border-radius: 3px; }
.layer-truncated { color: #fff; border: 1px dashed #ffd940; padding: 3px; margin: 4px 0; }
.layer-matmul { display: flex; gap: 8px; align-items: center; }
.layer-mm-w { display: grid; grid-template-columns: repeat(4, 22px); }
.layer-mm-v { display: grid; grid-template-columns: 38px; }
.layer-mm-cell { display: block; text-align: center; padding: 2px 0; color: #fff; }
`;

export interface LayerModeDeps {
  arch: Architecture;
  view: Pick<ExplodeView, 'explode' | 'reassemble' | 'depth' | 'root'>;
  loadWeights: WeightsLoader;
  /** Defaults to fetching the demo traces. */
  load?: (id: string) => Promise<Trace>;
  ids?: string[];
}

export interface LayerMode {
  element: HTMLElement;
  /** Opens layer mode for one layer and stream (a user action: it opens the exploded slab). */
  enter(layer: number, stream?: Stream): Promise<void>;
  exit(): Promise<void>;
  index(): number;
  steps(): readonly Step[];
  goto(i: number): Promise<void>;
}

export function createLayerMode(deps: LayerModeDeps): LayerMode {
  const { arch, view, loadWeights } = deps;
  const load = deps.load ?? ((id: string) => loadTrace(id, arch));
  const ids = deps.ids ?? ['kjv', 'de', 'ternary'];
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
  let weights: LayerWeights | null = null;
  const traces = new Map<string, Trace>();
  let token = 0;

  const rebuild = (): void => {
    stepList = layerSteps(trace, layer, streamSel.value as Stream, token, arch);
    i = Math.min(i, stepList.length - 1);
  };
  const fillTokens = (): void => {
    tokenSel.replaceChildren();
    const toks = trace ? trace.provenance.tokens.map(decodeToken) : Array.from({ length: 12 }, (_, k) => `toy ${k}`);
    toks.forEach((t, k) => tokenSel.append(new Option(`${k}: ${JSON.stringify(t)}`, String(k))));
    token = Math.min(token, toks.length - 1);
    tokenSel.value = String(token);
  };

  const draw = async (open: boolean): Promise<void> => {
    const step = stepList[i];
    if (!step) return;
    body.replaceChildren(renderStep(step, getDepth(), weights));
    where.textContent = `layer ${layer}, stream ${streamSel.value}, step ${i + 1} of ${stepList.length}`;
    prev.disabled = i === 0;
    next.disabled = i === stepList.length - 1;
    if (open) {
      while (view.depth() > 0) await view.reassemble();
      for (const id of step.open) await view.explode(id);
    }
    applyHighlight(view.root, step.highlight);
  };

  const go = async (to: number, open = true): Promise<void> => {
    i = Math.max(0, Math.min(stepList.length - 1, to));
    await draw(open);
  };
  const reload = async (): Promise<void> => {
    rebuild();
    await draw(false);
  };

  prompt.addEventListener('change', () => {
    void (async () => {
      const id = prompt.value;
      if (id) {
        let t = traces.get(id);
        if (!t) { t = await load(id); traces.set(id, t); }
        trace = t;
      } else trace = null;
      token = 0;
      fillTokens();
      await reload();
    })();
  });
  tokenSel.addEventListener('change', () => { token = Number(tokenSel.value); void reload(); });
  streamSel.addEventListener('change', () => { void reload(); });
  depthSel.addEventListener('change', () => { void draw(false); });
  onDepthChange((d) => { depthSel.value = d; void draw(false); });
  prev.addEventListener('click', () => void go(i - 1));
  next.addEventListener('click', () => void go(i + 1));
  close.addEventListener('click', () => void api.exit());

  const api: LayerMode = {
    element: root,
    async enter(l, s = 'A') {
      layer = l;
      streamSel.value = s;
      depthSel.value = getDepth();
      weights = await loadWeights(l).catch(() => null);
      fillTokens();
      rebuild();
      root.hidden = false;
      await go(0);
    },
    async exit() {
      root.hidden = true;
      applyHighlight(view.root, []);
      while (view.depth() > 0) await view.reassemble();
    },
    index: () => i,
    steps: () => stepList,
    goto: (k) => go(k),
  };
  return api;
}
