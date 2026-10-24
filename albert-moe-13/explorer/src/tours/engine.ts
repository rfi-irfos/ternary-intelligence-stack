import type * as THREE from 'three';
import type { CameraPose, CameraRig } from '../camera/controls';
import type { Architecture } from '../data/architecture';
import { kindName, numText, pctStr, decText } from '../data/labeled';
import { type Trace, decodeToken } from '../data/trace';
import type { WeightsLoader } from '../data/weights';
import { type ComponentId, type Stream, parseId } from '../scene/ids';
import type { TowerScene } from '../scene/tower';
import { type Depth, getDepth, onDepthChange } from '../ui/depth';
import type { IdPredicate } from '../ui/highlight';
import { getLang, getMode, layerLabel, lt, onPrefsChange, saveTourProgress, t, tourProgress } from '../ui/prefs';
import type { TourKey } from '../ui/strings';
import { renderFigure } from './figures';
import { tourOf } from './index';

/** Tour ids are the keys of `tour.<id>` in strings.ts, in spec §4.9 order. */
export type TourId = TourKey;

/** A text in both UI languages; placeholders such as {layers} are filled from the architecture. */
export interface L10n { en: string; de: string }

/** Text of one step per depth. Simple mode reads Intuition; Advanced reads Technical or Researcher. */
export type TourText = Record<Depth, L10n>;

/** Prediction moments: the player picks first, then the measured answer of the recorded run is shown beside the pick. No score. */
export type PredictAction =
  | { predict: 'experts'; layer: number; stream: Stream; prompt: L10n }
  | { predict: 'attention'; layer: number; head: number }
  | { predict: 'gate'; layer: number };

/** A figure under the text. Every number in it is real (structure or measured) or labelled illustrative. */
export type TourFigure =
  | { kind: 'matmul'; layer: number; stream: Stream; matrix: 'q' | 'k' | 'v' | 'o' | 'c_fc' | 'c_proj'; expert?: number }
  | { kind: 'fractions'; layer: number; stream: Stream }
  | { kind: 'topk' };

export interface TourStep {
  /** Component the camera flies to when the step starts (after the user pressed Start, Next or Back). */
  camera: ComponentId | 'overview';
  highlight: ComponentId[];
  text: TourText;
  action?: 'free' | PredictAction;
  figure?: TourFigure;
}

export interface Tour {
  id: TourId;
  title: string;
  steps: TourStep[];
}

/** Layer numbers are 0-based in ids and in the checkpoint; people read them 1-based. */
const layerOfStep = (s: TourStep): number | null => {
  if (s.action && s.action !== 'free') return s.action.layer;
  for (const id of [s.camera, ...s.highlight]) {
    const p = id === 'overview' ? null : parseId(id);
    if (p && 'layer' in p) return p.layer;
  }
  return null;
};

/** Placeholders of the tour texts, all read from architecture.json. Layers in lists are 1-based, as in the dock. */
export function tourVars(a: Architecture, step?: TourStep): Record<string, string | number> {
  const m = a.model;
  const l = step ? layerOfStep(step) : null;
  return {
    layers: m.num_layers, streams: m.num_streams, experts: m.num_experts, topk: m.top_k, hidden: m.hidden,
    ffn: m.ffn_inner, heads: m.num_heads, headDim: m.head_dim, vocab: numText(m.vocab),
    params: numText(m.params), gateCount: m.fusion_layers.length,
    gates: m.fusion_layers.map(layerLabel).join(', '),
    half: m.head_dim / 2, gatesIndex: m.fusion_layers.join(', '),
    layer: l === null ? '' : layerLabel(l), index: l ?? '',
    tau: l === null || !a.layers[l] ? '' : decText(a.layers[l]!.tau, 4),
  };
}

// ---- measured answers (recorded run only; fixture traces are test data and never "measured") ----

export interface Measured { trace: Trace; position: number }

const isMeasured = (m: Measured | null): m is Measured => m !== null && m.trace.provenance.mode === 'eval';

export interface ExpertsAnswer { experts: number[]; shares: number[] }

/** The router's recorded choice for the word: the three experts and their softmax shares. Null without a recorded run. */
export function expertsAnswer(m: Measured | null, layer: number, stream: Stream): ExpertsAnswer | null {
  if (!isMeasured(m)) return null;
  const s = stream === 'A' ? 'a' : 'b';
  const ev = m.trace.events.find((e) => e.type === 'router' && e.layer === layer && e.stream === s);
  if (!ev || ev.type !== 'router') return null;
  const top = ev.top3[m.position];
  const w = ev.weights[m.position];
  if (!top || !w) return null;
  return { experts: [...top], shares: [...w] };
}

export type AttentionAnswer =
  | { kind: 'token'; index: number; share: number }
  | { kind: 'first' }
  | { kind: 'window' };

/** The earlier word with the most attention in one head, from the recorded weights row of the word. */
export function attentionAnswer(m: Measured | null, layer: number, stream: Stream, head: number): AttentionAnswer | null {
  if (!isMeasured(m)) return null;
  if (m.position === 0) return { kind: 'first' };
  const s = stream === 'A' ? 'a' : 'b';
  const ev = m.trace.events.find((e) => e.type === 'attention' && e.layer === layer && e.stream === s && e.head === head);
  if (!ev || ev.type !== 'attention') return null;
  const n = m.trace.provenance.token_ids.length;
  const window = m.trace.provenance.attention_window;
  const row = ev.weights[window === undefined ? m.position : m.position - (n - window)];
  if (!row) return { kind: 'window' };
  let best = 0;
  for (let j = 1; j < m.position; j++) if ((row[j] ?? 0) > (row[best] ?? 0)) best = j;
  return { kind: 'token', index: best, share: row[best] ?? 0 };
}

export interface GateAnswer { gA: number; gB: number; wider: 'A' | 'B' | 'equal' }

/** Which stream takes more from the other at the word: g_a (A adds g_a * B) against g_b. */
export function gateAnswer(m: Measured | null, layer: number): GateAnswer | null {
  if (!isMeasured(m)) return null;
  const ev = m.trace.events.find((e) => e.type === 'gate' && e.layer === layer);
  if (!ev || ev.type !== 'gate') return null;
  const gA = ev.g_a[m.position];
  const gB = ev.g_b[m.position];
  if (gA === undefined || gB === undefined) return null;
  return { gA, gB, wider: gA === gB ? 'equal' : gA > gB ? 'A' : 'B' };
}

// ---- the runner ----

export interface TourDeps {
  arch: Architecture;
  tower: Pick<TowerScene, 'anchor' | 'has'>;
  rig: Pick<CameraRig, 'flyTo' | 'overview' | 'pose' | 'flyToPose' | 'isFlying'>;
  /** Dims everything for which `pred` is false; null clears (the app restores a pinned legend role). */
  highlight(pred: IdPredicate | null): void;
  /** The recorded run and word on screen (null before a run loads). */
  measured(): Measured | null;
  loadWeights: WeightsLoader;
  doc?: Document;
  /** Called when a tour ends (the app can re-enable what it paused). */
  onExit?: (id: TourId) => void;
}

export interface RunOptions {
  /** Element focus returns to when the tour ends (the Tour button). */
  returnFocus?: HTMLElement | null;
}

export interface TourRunner {
  /** Starts a tour at `fromStep`. Moves the camera for that step: call it from a user action (Start, a menu click). */
  runTour(id: TourId, fromStep?: number, opts?: RunOptions): void;
  /** Starts at the saved step of the tour. */
  resume(id: TourId, opts?: RunOptions): void;
  exit(finished?: boolean): void;
  active(): TourId | null;
  step(): number;
  /** A scene pick during a prediction: true when the tour took it (the app then opens no panel). */
  handlePick(id: ComponentId): boolean;
  readonly element: HTMLElement | null;
}

/** Camera distance per kind of target (world units), like the dock's layer look (14) and the panel links. */
export function tourDistance(id: ComponentId | 'overview'): number {
  const p = id === 'overview' ? null : parseId(id);
  switch (p?.type) {
    case 'slab': case 'bank': case 'gate': return 14;
    case 'embed': case 'lm_head': case 'ln_f': return 10;
    case 'shaft': return 16;
    case 'matrix': case 'head': return 5;
    default: return 8;
  }
}

const POSE_EPS = 1e-3;
const near = (a: THREE.Vector3, b: THREE.Vector3): boolean =>
  Math.abs(a.x - b.x) < POSE_EPS && Math.abs(a.y - b.y) < POSE_EPS && Math.abs(a.z - b.z) < POSE_EPS;
const samePose = (a: CameraPose, b: CameraPose): boolean => near(a.position, b.position) && near(a.target, b.target);

/** A highlight id keeps its parts: `L12.A.attn` keeps `L12.A.attn.q`. */
export const highlightPredicate = (ids: ComponentId[]): IdPredicate | null =>
  ids.length === 0 ? null : (id) => ids.some((h) => id === h || id.startsWith(`${h}.`));

interface Active {
  tour: Tour;
  i: number;
  seq: number;
  startPose: CameraPose;
  /** Pose after the last flight a tour step made; null until one landed. */
  landed: CameraPose | null;
  returnFocus: HTMLElement | null;
  picks: number[];
  tokenPick: number | null;
  gatePick: 'A' | 'B' | 'equal' | null;
  revealed: boolean;
}

export function createTourRunner(deps: TourDeps): TourRunner {
  const doc = deps.doc ?? document;
  let act: Active | null = null;
  let card: HTMLElement | null = null;
  const offs: (() => void)[] = [];
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const text = (x: L10n, step?: TourStep): string => lt(x, tourVars(deps.arch, step));
  const depth = (): Depth => (getMode() === 'simple' ? 'intuition' : getDepth());

  const highlightFor = (a: Active): void => {
    const step = a.tour.steps[a.i]!;
    const act0 = step.action;
    if (a.revealed && act0 && act0 !== 'free' && act0.predict === 'experts') {
      const ans = expertsAnswer(deps.measured(), act0.layer, act0.stream);
      if (ans) { deps.highlight(highlightPredicate(ans.experts.map((e) => `L${act0.layer}.expert.${e}`))); return; }
    }
    deps.highlight(highlightPredicate(step.highlight));
  };

  const fly = async (a: Active): Promise<void> => {
    const step = a.tour.steps[a.i]!;
    const seq = a.seq;
    if (step.camera === 'overview') await deps.rig.overview();
    else await deps.rig.flyTo(deps.tower.anchor(step.camera), tourDistance(step.camera));
    if (act === a && a.seq === seq) a.landed = deps.rig.pose();
  };

  // ---- prediction body ----

  const chip = (kind: 'measured'): HTMLElement => {
    const c = el('span', 'kind-tag', kindName(kind));
    c.dataset.kind = kind;
    return c;
  };

  const renderPrediction = (a: Active, step: TourStep, box: HTMLElement): void => {
    const pa = step.action;
    if (!pa || pa === 'free') return;
    const m = deps.measured();
    const ok = isMeasured(m);
    const lang = getLang();
    if (!ok) { box.append(el('p', 'tour-note', t('tourpred.noTrace'))); return; }
    const ctx = (layer: number, stream: Stream | null): string => t('tourpred.context', {
      prompt: m.trace.provenance.prompt_id, word: decodeToken(m.trace.provenance.tokens[m.position] ?? ''),
      layer: layerLabel(layer), stream: stream ?? 'A+B',
    });
    const answerRow = (label: string, body: HTMLElement | string, withChip: boolean): HTMLElement => {
      const row = el('div', 'tour-pred-row');
      row.append(el('strong', undefined, `${label}: `));
      row.append(body);
      if (withChip) row.append(' ', chip('measured'));
      return row;
    };
    const again = (): HTMLButtonElement => {
      const b = el('button', 'tour-btn', t('tourpred.again'));
      b.type = 'button';
      b.dataset.act = 'again';
      b.addEventListener('click', () => { a.picks = []; a.tokenPick = null; a.gatePick = null; a.revealed = false; paint(); highlightFor(a); });
      return b;
    };
    if (pa.predict === 'experts') {
      const k = deps.arch.model.top_k;
      box.append(el('p', 'tour-prompt', lt(pa.prompt, tourVars(deps.arch, step))));
      const grid = el('div', 'tour-pick-grid');
      for (let e = 0; e < deps.arch.model.num_experts; e++) {
        const b = el('button', 'tour-pick', String(e));
        b.type = 'button';
        b.dataset.expert = String(e);
        b.setAttribute('aria-pressed', String(a.picks.includes(e)));
        b.setAttribute('aria-label', t('tourpred.expertBtn', { e }));
        b.title = t('tourpred.expertTip', { e });
        b.disabled = a.revealed;
        b.addEventListener('click', () => togglePick(e));
        b.addEventListener('pointerenter', () => deps.highlight(highlightPredicate([`L${pa.layer}.expert.${e}`])));
        b.addEventListener('focus', () => deps.highlight(highlightPredicate([`L${pa.layer}.expert.${e}`])));
        for (const ev of ['pointerleave', 'blur'] as const) b.addEventListener(ev, () => highlightFor(a));
        grid.append(b);
      }
      box.append(grid);
      if (!a.revealed) {
        const go = el('button', 'tour-btn tour-reveal', t('tourpred.reveal'));
        go.type = 'button';
        go.disabled = a.picks.length !== k;
        go.title = t('tourpred.pickK', { k, c: a.picks.length });
        go.addEventListener('click', () => { a.revealed = true; paint(); highlightFor(a); });
        box.append(el('p', 'tour-note', t('tourpred.pickK', { k, c: a.picks.length })), go);
        return;
      }
      const ans = expertsAnswer(m, pa.layer, pa.stream);
      if (!ans) { box.append(el('p', 'tour-note', t('tourpred.noTrace'))); return; }
      const list = (ids: number[], withShare: boolean): HTMLElement => {
        const ul = el('span', 'tour-chosen');
        ids.forEach((e) => {
          const hit = ans.experts.includes(e);
          const i = ans.experts.indexOf(e);
          const s = el('span', hit && !withShare ? 'tour-chosen-item tour-hit' : 'tour-chosen-item',
            withShare ? `${e} (${t('tourpred.share', { share: pctStr(ans.shares[i] ?? 0, 0, lang) })})` : String(e));
          if (hit && !withShare) { s.append(' ✓'); s.title = t('tourpred.matchMark'); }
          ul.append(s, ' ');
        });
        return ul;
      };
      box.append(
        answerRow(t('tourpred.yours'), list(a.picks, false), false),
        answerRow(t('tourpred.measured'), list(ans.experts, true), true),
        el('p', 'tour-note', ctx(pa.layer, pa.stream)), again(),
      );
      return;
    }
    if (pa.predict === 'attention') {
      const word = decodeToken(m.trace.provenance.tokens[m.position] ?? '');
      const ans = attentionAnswer(m, pa.layer, 'A', pa.head);
      if (ans?.kind === 'first') { box.append(el('p', 'tour-note', t('tourpred.attnNone'))); return; }
      box.append(el('p', 'tour-prompt', t('tourpred.pickToken', { word, head: pa.head })));
      const grid = el('div', 'tour-pick-grid tour-pick-words');
      const from = Math.max(0, m.position - 15);
      for (let j = from; j < m.position; j++) {
        const w = decodeToken(m.trace.provenance.tokens[j] ?? '');
        const b = el('button', 'tour-pick', w.trim() || '·');
        b.type = 'button';
        b.dataset.token = String(j);
        b.setAttribute('aria-pressed', String(a.tokenPick === j));
        b.title = t('tourpred.tokenBtn', { i: j + 1, w });
        b.disabled = a.revealed;
        b.addEventListener('click', () => { a.tokenPick = j; paint(); });
        grid.append(b);
      }
      box.append(grid);
      if (!a.revealed) {
        const go = el('button', 'tour-btn tour-reveal', t('tourpred.reveal'));
        go.type = 'button';
        go.disabled = a.tokenPick === null;
        go.addEventListener('click', () => { a.revealed = true; paint(); });
        box.append(go);
        return;
      }
      if (!ans || ans.kind === 'window') { box.append(el('p', 'tour-note', t('tourpred.attnWindow'))); box.append(again()); return; }
      const w = decodeToken(m.trace.provenance.tokens[ans.index] ?? '');
      const yours = a.tokenPick === null ? '' : decodeToken(m.trace.provenance.tokens[a.tokenPick] ?? '');
      const hit = a.tokenPick === ans.index;
      const mine = el('span', hit ? 'tour-chosen-item tour-hit' : 'tour-chosen-item', `“${yours}”`);
      if (hit) { mine.append(' ✓'); mine.title = t('tourpred.matchMark'); }
      box.append(
        answerRow(t('tourpred.yours'), mine, false),
        answerRow(t('tourpred.measured'), t('tourpred.attnAnswer', { i: ans.index + 1, w, share: pctStr(ans.share, 0, lang) }), true),
        el('p', 'tour-note', ctx(pa.layer, 'A')), again(),
      );
      return;
    }
    // gate
    box.append(el('p', 'tour-prompt', t('tourpred.gateQ')));
    const grid = el('div', 'tour-pick-grid tour-pick-gate');
    for (const [v, key] of [['A', 'tourpred.gateA'], ['B', 'tourpred.gateB']] as const) {
      const b = el('button', 'tour-pick', t(key));
      b.type = 'button';
      b.dataset.gate = v;
      b.setAttribute('aria-pressed', String(a.gatePick === v));
      b.disabled = a.revealed;
      b.addEventListener('click', () => { a.gatePick = v; paint(); });
      grid.append(b);
    }
    box.append(grid);
    if (!a.revealed) {
      const go = el('button', 'tour-btn tour-reveal', t('tourpred.reveal'));
      go.type = 'button';
      go.disabled = a.gatePick === null;
      go.addEventListener('click', () => { a.revealed = true; paint(); });
      box.append(go);
      return;
    }
    const ans = gateAnswer(m, pa.layer);
    if (!ans) { box.append(el('p', 'tour-note', t('tourpred.noTrace'))); return; }
    const name = { A: t('tourpred.gateA'), B: t('tourpred.gateB'), equal: t('tourpred.gateEqual') };
    const mine = el('span', ans.wider === a.gatePick ? 'tour-chosen-item tour-hit' : 'tour-chosen-item', a.gatePick ? name[a.gatePick] : '');
    if (ans.wider === a.gatePick) { mine.append(' ✓'); mine.title = t('tourpred.matchMark'); }
    box.append(
      answerRow(t('tourpred.yours'), mine, false),
      answerRow(t('tourpred.measured'), `${name[ans.wider]} (${t('tourpred.gateValues', { a: decText(ans.gA, 3, lang), b: decText(ans.gB, 3, lang) })})`, true),
      el('p', 'tour-note', ctx(pa.layer, null)), again(),
    );
  };

  const togglePick = (e: number): void => {
    if (!act || act.revealed) return;
    const i = act.picks.indexOf(e);
    if (i >= 0) act.picks.splice(i, 1);
    else if (act.picks.length < deps.arch.model.top_k) act.picks.push(e);
    paint();
  };

  // ---- the card ----

  const refs: { title?: HTMLElement; count?: HTMLElement; body?: HTMLElement; back?: HTMLButtonElement; next?: HTMLButtonElement; exit?: HTMLButtonElement } = {};

  function paint(): void {
    if (!act || !card) return;
    const a = act;
    const step = a.tour.steps[a.i]!;
    const n = a.tour.steps.length;
    card.setAttribute('aria-label', t('tourcard.label', { title: a.tour.title }));
    refs.title!.textContent = a.tour.title;
    refs.count!.textContent = t('tourcard.step', { i: a.i + 1, n });
    const body = refs.body!;
    // A rebuilt card keeps keyboard focus on the same control (a pick button stays focused after a click).
    const had = doc.activeElement as HTMLElement | null;
    const mark = had && card.contains(had) ? Object.entries(had.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${v}"]`).join('') : '';
    body.replaceChildren();
    body.append(el('p', 'tour-text', text(step.text[depth()], step)));
    const idx = layerOfStep(step);
    if (getMode() === 'advanced' && idx !== null) body.append(el('p', 'tour-note tour-index', t('tourcard.layerNote', { n: idx })));
    if (step.figure) {
      const fig = el('div', 'tour-figure');
      body.append(fig);
      const seq = a.seq;
      void renderFigure(step.figure, {
        arch: deps.arch, loadWeights: deps.loadWeights, measured: deps.measured, doc, lang: getLang(),
        alive: () => act === a && a.seq === seq && fig.isConnected,
      }).then((node) => { if (act === a && a.seq === seq) fig.replaceChildren(node); });
    }
    renderPrediction(a, step, body.appendChild(el('div', 'tour-pred')));
    refs.back!.disabled = a.i === 0;
    refs.next!.textContent = a.i === n - 1 ? t('tourcard.done') : t('tourcard.next');
    refs.exit!.textContent = t('tourcard.exit');
    refs.exit!.title = t('tourcard.exitTip');
    refs.back!.textContent = t('tourcard.back');
    if (mark && had && !had.isConnected) card.querySelector<HTMLElement>(mark)?.focus();
  }

  const go = (i: number): void => {
    if (!act) return;
    const a = act;
    a.i = Math.max(0, Math.min(a.tour.steps.length - 1, i));
    a.seq++;
    a.picks = []; a.tokenPick = null; a.gatePick = null; a.revealed = false;
    saveTourProgress(a.tour.id, a.i);
    paint();
    highlightFor(a);
    void fly(a).catch((err: unknown) => console.error(err));
  };

  const buildCard = (): HTMLElement => {
    const c = el('section', 'tour-card');
    c.setAttribute('role', 'dialog');
    c.setAttribute('aria-modal', 'false');
    const head = el('header');
    refs.title = el('h2', 'tour-card-title');
    refs.count = el('span', 'tour-card-count');
    head.append(refs.title, refs.count);
    refs.body = el('div', 'tour-card-body');
    refs.body.setAttribute('aria-live', 'polite');
    const foot = el('footer');
    refs.back = el('button', 'tour-btn');
    refs.back.type = 'button';
    refs.back.dataset.act = 'back';
    refs.next = el('button', 'tour-btn tour-btn-primary');
    refs.next.type = 'button';
    refs.next.dataset.act = 'next';
    refs.exit = el('button', 'tour-btn tour-exit');
    refs.exit.type = 'button';
    refs.exit.dataset.act = 'exit';
    foot.append(refs.exit, refs.back, refs.next);
    c.append(head, refs.body, foot);
    refs.back.addEventListener('click', () => go(act ? act.i - 1 : 0));
    refs.next.addEventListener('click', () => {
      if (!act) return;
      if (act.i >= act.tour.steps.length - 1) api.exit(true);
      else go(act.i + 1);
    });
    refs.exit.addEventListener('click', () => api.exit());
    return c;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !act) return;
    // Esc leaves the tour (one level). It never reaches the explode view, the side panel or the camera rig.
    e.preventDefault();
    e.stopImmediatePropagation();
    api.exit();
  };

  const api: TourRunner = {
    runTour(id, fromStep = 0, opts = {}) {
      const tour = tourOf(id);
      if (!tour) return;
      if (act) api.exit();
      act = {
        tour, i: 0, seq: 0, startPose: deps.rig.pose(), landed: null, returnFocus: opts.returnFocus ?? null,
        picks: [], tokenPick: null, gatePick: null, revealed: false,
      };
      card = buildCard();
      doc.body.append(card);
      doc.body.classList.add('tour-open');
      doc.addEventListener('keydown', onKey, true);
      offs.push(onPrefsChange(paint), onDepthChange(paint));
      go(Number.isInteger(fromStep) ? fromStep : 0);
      refs.next!.focus();
    },
    resume(id, opts) {
      api.runTour(id, tourProgress(id), opts);
    },
    exit(finished = false) {
      const a = act;
      if (!a) return;
      act = null;
      a.seq++;
      doc.removeEventListener('keydown', onKey, true);
      for (const off of offs.splice(0)) off();
      card?.remove();
      card = null;
      doc.body.classList.remove('tour-open');
      deps.highlight(null);
      // The pre-tour pose comes back only when the camera still sits where the tour left it:
      // a pose the visitor chose (orbit, pan, zoom, a click on a part) stays.
      const untouched = deps.rig.isFlying() || (a.landed !== null && samePose(deps.rig.pose(), a.landed));
      if (untouched && a.landed !== null) void deps.rig.flyToPose(a.startPose).catch((err: unknown) => console.error(err));
      if (finished) saveTourProgress(a.tour.id, 0);
      deps.onExit?.(a.tour.id);
      a.returnFocus?.focus();
    },
    active: () => act?.tour.id ?? null,
    step: () => act?.i ?? 0,
    handlePick(id) {
      const a = act;
      if (!a || a.revealed) return false;
      const step = a.tour.steps[a.i]!;
      const pa = step.action;
      if (!pa || pa === 'free' || pa.predict !== 'experts') return false;
      const p = parseId(id);
      if (!p || !('layer' in p) || !('expert' in p) || p.layer !== pa.layer || p.expert === undefined) return false;
      togglePick(p.expert);
      return true;
    },
    get element() { return card; },
  };
  return api;
}

export { TOURS, tourOf } from './index';
