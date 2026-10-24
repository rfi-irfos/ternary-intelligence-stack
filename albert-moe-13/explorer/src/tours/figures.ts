import type { Architecture } from '../data/architecture';
import { type Trace, decodeToken } from '../data/trace';
import { decText, kindName, pctStr } from '../data/labeled';
import { type WeightsLoader, findMatrix, ternarySlice } from '../data/weights';
import { cssHex } from '../scene/palette';
import { ternaryColor } from '../scene/tile';
import { toyRandom } from '../layer/steps';
import { layerLabel, t } from '../ui/prefs';
import type { Lang } from '../ui/strings';
import type { Measured, TourFigure } from './engine';

export interface FigureCtx {
  arch: Architecture;
  loadWeights: WeightsLoader;
  measured(): Measured | null;
  doc: Document;
  lang: Lang;
  /** False once the step changed: a late weight file must not paint into a newer card. */
  alive(): boolean;
}

/** Name of a matrix inside `L{n}.json` for a tour figure. */
export function matrixKey(stream: 'A' | 'B', m: 'q' | 'k' | 'v' | 'o' | 'c_fc' | 'c_proj', expert = 0): string {
  return m === 'c_fc' || m === 'c_proj' ? `experts.${expert}.${m}.weight` : `stream_${stream.toLowerCase()}.attn.${m}_proj.weight`;
}

const tag = (doc: Document, kind: 'structure' | 'measured' | 'illustrative'): HTMLElement => {
  const c = doc.createElement('span');
  c.className = 'kind-tag';
  c.dataset.kind = kind;
  c.textContent = kindName(kind);
  return c;
};

const line = (doc: Document, cls: string, text: string, kind?: 'structure' | 'measured' | 'illustrative'): HTMLElement => {
  const d = doc.createElement('div');
  d.className = cls;
  d.append(text);
  if (kind) d.append(' ', tag(doc, kind));
  return d;
};

/** Example input of the matmul figures: fixed per layer and matrix, always labelled illustrative. */
export function sampleInput(seed: number): number[] {
  const rnd = toyRandom(seed);
  return Array.from({ length: 4 }, () => Math.round(rnd() * 10) / 10);
}

/** W (real 4x4 corner), x (illustrative), y = gamma * (W x). */
export function matmulOf(w: number[][], x: number[], gamma: number): number[] {
  return w.map((row) => Math.round(gamma * row.reduce((s, c, j) => s + c * (x[j] ?? 0), 0) * 1000) / 1000);
}

function matmulFigure(f: Extract<TourFigure, { kind: 'matmul' }>, ctx: FigureCtx, weights: Awaited<ReturnType<WeightsLoader>>): HTMLElement {
  const doc = ctx.doc;
  const box = doc.createElement('div');
  box.className = 'tour-fig tour-fig-matmul';
  const name = matrixKey(f.stream, f.matrix, f.expert ?? 0);
  const sl = ternarySlice(weights, name);
  if (!sl) { box.append(line(doc, 'tour-note', t('tourfig.noWeights'))); return box; }
  const gamma = sl.gamma ?? 1;
  const x = sampleInput(f.layer * 131 + name.length);
  const y = matmulOf(sl.w, x, gamma);
  const grid = doc.createElement('div');
  grid.className = 'tour-mm';
  const cell = (txt: string, color?: string): HTMLElement => {
    const c = doc.createElement('span');
    c.className = 'tour-mm-cell';
    c.textContent = txt;
    if (color) c.style.background = color;
    return c;
  };
  const wg = doc.createElement('div');
  wg.className = 'tour-mm-w';
  for (const row of sl.w) {
    for (const v of row) {
      const ch = v > 0 ? '+' : v < 0 ? '-' : '0';
      wg.append(cell(v > 0 ? '+1' : v < 0 ? '−1' : '0', cssHex(ternaryColor(ch))));
    }
  }
  const col = (vals: number[], cls: string): HTMLElement => {
    const g = doc.createElement('div');
    g.className = cls;
    for (const v of vals) g.append(cell(decText(v, 3, ctx.lang).replace(/0+$/, '').replace(/[.,]$/, '') || '0'));
    return g;
  };
  grid.append(wg, doc.createTextNode('×'), col(x, 'tour-mm-v'), doc.createTextNode('→'), col(y, 'tour-mm-v'));
  box.append(grid);
  box.append(
    line(doc, 'tour-fig-cap', t('tourfig.slice', { name }), 'structure'),
    line(doc, 'tour-fig-cap', t('tourfig.gamma', { g: decText(gamma, 4, ctx.lang) }), 'structure'),
    line(doc, 'tour-fig-cap', t('tourfig.sample'), 'illustrative'),
    line(doc, 'tour-fig-cap', t('tourfig.out'), 'illustrative'),
  );
  return box;
}

function fractionsFigure(f: Extract<TourFigure, { kind: 'fractions' }>, ctx: FigureCtx, weights: Awaited<ReturnType<WeightsLoader>>): HTMLElement {
  const doc = ctx.doc;
  const box = doc.createElement('div');
  box.className = 'tour-fig tour-fig-fractions';
  box.append(line(doc, 'tour-fig-title', t('tourfig.fracTitle', { layer: layerLabel(f.layer) }), 'structure'));
  const names = (['q', 'k', 'v', 'o'] as const).map((m) => matrixKey(f.stream, m))
    .concat([matrixKey(f.stream, 'c_fc', 0), matrixKey(f.stream, 'c_proj', 0)]);
  for (const name of names) {
    const m = findMatrix(weights, name);
    if (!m || m.frac_neg === null || m.frac_zero === null || m.frac_pos === null) continue;
    const row = doc.createElement('div');
    row.className = 'tour-frac-row';
    row.dataset.matrix = name;
    const label = doc.createElement('span');
    label.className = 'tour-frac-name';
    label.textContent = name.replace(/\.weight$/, '').replace(/^stream_/, '');
    const bar = doc.createElement('span');
    bar.className = 'tour-frac-bar';
    for (const [cls, v] of [['neg', m.frac_neg], ['zero', m.frac_zero], ['pos', m.frac_pos]] as const) {
      const s = doc.createElement('span');
      s.className = `tour-frac tour-frac-${cls}`;
      s.style.width = `${(v * 100).toFixed(2)}%`;
      bar.append(s);
    }
    const nums = doc.createElement('span');
    nums.className = 'tour-frac-nums';
    nums.textContent = t('tourfig.fracRow', { neg: pctStr(m.frac_neg, 1, ctx.lang), zero: pctStr(m.frac_zero, 1, ctx.lang), pos: pctStr(m.frac_pos, 1, ctx.lang) });
    row.append(label, bar, nums);
    box.append(row);
  }
  return box;
}

function topkFigure(ctx: FigureCtx, trace: Trace | null): HTMLElement {
  const doc = ctx.doc;
  const box = doc.createElement('div');
  box.className = 'tour-fig tour-fig-topk';
  if (!trace || trace.provenance.mode !== 'eval') { box.append(line(doc, 'tour-note', t('tourfig.noTopk'))); return box; }
  box.append(line(doc, 'tour-fig-title', t('tourfig.topk', { prompt: trace.provenance.prompt_id }), 'measured'));
  const ol = doc.createElement('ol');
  ol.className = 'tour-topk';
  for (const k of trace.top_k) {
    const li = doc.createElement('li');
    li.textContent = `“${decodeToken(k.token)}” ${pctStr(k.prob, 1, ctx.lang)}`;
    ol.append(li);
  }
  box.append(ol);
  return box;
}

/** Builds the figure of a tour step. Weights load lazily (once per layer); nothing is invented while they load. */
export async function renderFigure(f: TourFigure, ctx: FigureCtx): Promise<HTMLElement> {
  if (f.kind === 'topk') return topkFigure(ctx, ctx.measured()?.trace ?? null);
  try {
    const w = await ctx.loadWeights(f.layer);
    if (!ctx.alive()) return ctx.doc.createElement('div');
    return f.kind === 'matmul' ? matmulFigure(f, ctx, w) : fractionsFigure(f, ctx, w);
  } catch {
    return line(ctx.doc, 'tour-note', t('tourfig.noWeights'));
  }
}
