import type { CameraRig } from '../camera/controls';
import { CAVEATS } from '../content/caveats';
import type { Architecture } from '../data/architecture';
import { type Labeled, type LabeledValue, decText, fmt, pctStr, structure } from '../data/labeled';
import { type Trace, decodeToken, loadTrace } from '../data/trace';
import { defaultPosition, isPunct, wordOf } from '../data/words';
import type { Animator } from '../flow/animate';
import {
  type AttnData, type EmbedData, type ExpertsData, type GateData, type LmHeadData, type MergeData,
  type Op, type OpKind, type ResidData, type RouterData, OP_KINDS, buildTimeline,
} from '../flow/timeline';
import { embedId, lmHeadId, lnFId } from '../scene/ids';
import type { TowerScene } from '../scene/tower';
import { ICONS } from './icons';
import { getLang, getMode, layerLabel, lt, onPrefsChange, setMode, t } from './prefs';
import { ROLE_VAR, type Role } from './roles';
import { MODES, type Mode, type StringKey } from './strings';
import { segmented } from './topbar';
import { escHtml, richT } from './richText';

export type CameraMode = 'follow' | 'free' | 'overview';
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
export const CAMERA_MODES: CameraMode[] = ['follow', 'free', 'overview'];

/** Seconds one op stays on screen at speed 1 (full pace: Advanced keeps every op this long). */
export const OP_SECONDS = 0.6;

/**
 * Quick pass (Simple and the lobby's "Watch it think"): one whole pass in about this many seconds at
 * speed 1. It keeps every recorded op in order and only changes the pacing: the ops are grouped by
 * layer (plus one group before and one after the layers), every group gets the same time and its ops
 * share it evenly. 655 ops x 0.6 s would be about 6.5 minutes.
 */
export const QUICK_PASS_SECONDS = 75;

export type Pace = 'full' | 'quick';

/** Longest frame (s) the player counts, per pace: a slow machine must not stretch a quick pass. */
export const MAX_FRAME_FULL = 0.1;
export const MAX_FRAME_QUICK = 0.25;

/** Group index of every op for the quick pass: consecutive ops of one layer form one group. */
export function quickGroups(ops: readonly Pick<Op, 'layer'>[]): number[] {
  const out: number[] = [];
  let g = -1;
  let last: string | null = null;
  let seenLayer = false;
  ops.forEach((o) => {
    seenLayer ||= o.layer !== undefined;
    const key = o.layer !== undefined ? `L${o.layer}` : seenLayer ? 'post' : 'pre';
    if (key !== last) { g++; last = key; }
    out.push(g);
  });
  return out;
}

/** Seconds each op stays on screen in the quick pass at speed 1; they sum to `total`. */
export function quickSeconds(ops: readonly Pick<Op, 'layer'>[], total = QUICK_PASS_SECONDS): number[] {
  const groups = quickGroups(ops);
  const n = groups.length > 0 ? (groups[groups.length - 1] as number) + 1 : 0;
  const size = new Array<number>(n).fill(0);
  for (const g of groups) size[g] = (size[g] as number) + 1;
  return groups.map((g) => total / n / (size[g] as number));
}

export interface Player {
  readonly ops: readonly Op[];
  index(): number;
  playing(): boolean;
  speed(): Speed;
  cameraMode(): CameraMode;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Moves by `delta` ops (clamped to the timeline). */
  step(delta: number): void;
  scrub(index: number): void;
  setSpeed(s: Speed): void;
  setCameraMode(m: CameraMode): void;
  /** Full pace (OP_SECONDS per op) or the quick pass (QUICK_PASS_SECONDS for the whole run). */
  pace(): Pace;
  setPace(p: Pace): void;
  /** First op of `layer`. Returns false when no op has that layer. */
  jumpToLayer(layer: number): boolean;
  /** Next op of `kind` after the current one, wrapping to the start. Returns false when none exists. */
  jumpToNext(kind: OpKind): boolean;
  /** Length of the whole run in seconds at speed 1 (current pace): m:ss on the timeline. */
  duration(): number;
  /** Seconds at speed 1 until op `index` starts. */
  timeOf(index: number): number;
  /** Seconds at speed 1 the run has played (start of the current op plus the time inside it). */
  elapsed(): number;
  /** The op that is on screen at `seconds` (clamped). */
  indexAtTime(seconds: number): number;
  /** dt in seconds; advances while playing. */
  tick(dt: number): void;
  onChange(cb: (index: number, op: Op) => void): () => void;
}

export function createPlayer(ops: readonly Op[], animate: (op: Op, index: number) => void): Player {
  if (ops.length === 0) throw new Error('player needs at least one op');
  let i = 0;
  let isPlaying = false;
  let spd: Speed = 1;
  let mode: CameraMode = 'free';
  let acc = 0;
  let pace: Pace = 'full';
  let quick: number[] | null = null;
  /** Seconds op `k` stays on screen at speed 1. */
  const dur = (k: number): number => {
    if (pace === 'full') return OP_SECONDS;
    quick ??= quickSeconds(ops);
    return quick[k] ?? OP_SECONDS;
  };
  const listeners = new Set<(index: number, op: Op) => void>();
  /** Start time of every op (and the end) at speed 1, per pace; rebuilt when the pace changes. */
  let starts: number[] | null = null;
  let startsPace: Pace | null = null;
  const marks = (): number[] => {
    if (starts && startsPace === pace) return starts;
    const out = [0];
    for (let k = 0; k < ops.length; k++) out.push((out[k] as number) + dur(k));
    starts = out;
    startsPace = pace;
    return out;
  };

  const go = (to: number): void => {
    i = Math.max(0, Math.min(ops.length - 1, Math.trunc(to)));
    acc = 0;
    const op = ops[i] as Op;
    animate(op, i);
    listeners.forEach((l) => l(i, op));
  };

  const p: Player = {
    ops,
    index: () => i,
    playing: () => isPlaying,
    speed: () => spd,
    cameraMode: () => mode,
    play() {
      if (i >= ops.length - 1) go(0);
      isPlaying = true;
    },
    pause() { isPlaying = false; },
    toggle() { if (isPlaying) p.pause(); else p.play(); },
    step(d) { p.pause(); go(i + d); },
    scrub(to) { go(to); },
    setSpeed(s) { if (SPEEDS.includes(s)) spd = s; },
    setCameraMode(m) { mode = m; },
    pace: () => pace,
    setPace(v) { if (v === 'full' || v === 'quick') pace = v; },
    jumpToLayer(layer) {
      const at = ops.findIndex((o) => o.layer === layer);
      if (at < 0) return false;
      go(at);
      return true;
    },
    jumpToNext(kind) {
      for (let k = 1; k <= ops.length; k++) {
        const at = (i + k) % ops.length;
        if ((ops[at] as Op).kind === kind) { go(at); return true; }
      }
      return false;
    },
    duration: () => marks()[ops.length] as number,
    timeOf: (k) => marks()[Math.max(0, Math.min(ops.length, Math.trunc(k)))] as number,
    elapsed: () => (marks()[i] as number) + Math.min(acc, dur(i)),
    indexAtTime(sec) {
      const m = marks();
      let lo = 0;
      let hi = ops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((m[mid] as number) <= sec + 1e-9) lo = mid; else hi = mid - 1;
      }
      return Math.max(0, Math.min(ops.length - 1, lo));
    },
    tick(dt) {
      if (!isPlaying) return;
      acc += Math.min(dt, pace === 'quick' ? MAX_FRAME_QUICK : MAX_FRAME_FULL) * spd;
      while (acc >= dur(i) - 1e-9 && isPlaying) {
        const rest = Math.max(acc - dur(i), 0);
        if (i >= ops.length - 1) { isPlaying = false; acc = 0; break; }
        go(i + 1);
        acc = rest;
      }
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
  return p;
}

// ---------------------------------------------------------------- UI

/** Op name in the current language and mode (Simple: everyday words; Advanced: technical). */
export function opLabel(kind: OpKind, arch?: Pick<Architecture, 'model'>): string {
  // The counts come from architecture.json (model.top_k, model.num_experts); without it the op names carry none.
  return t(`op.${kind}` as StringKey, arch ? { topk: arch.model.top_k, experts: arch.model.num_experts } : undefined);
}

/** Colour role of an op (null = neutral). */
export function opRole(op: Pick<Op, 'kind' | 'stream'>): Role | null {
  switch (op.kind) {
    case 'attn': case 'ln1': case 'ln2': case 'resid': return op.stream === 'B' ? 'streamB' : 'streamA';
    case 'router': return 'router';
    case 'experts': return 'expert';
    case 'gate': return 'gate';
    case 'embed': return 'input';
    case 'merge': case 'ln_f': return 'merge';
    case 'lm_head': return 'output';
    default: return null;
  }
}

/** Chip text: "Router (top-3 of 12 experts) · layer 12 · stream A" (Simple: everyday words). */
export function opChipText(op: Op, arch?: Pick<Architecture, 'model'>): string {
  const parts = [opLabel(op.kind, arch)];
  if (op.layer !== undefined) parts.push(t('where.layer', { n: layerLabel(op.layer) }));
  if (op.stream) parts.push(t('where.stream', { s: op.stream }));
  return parts.join(' · ');
}

/** English text shown when no trace loads (the EN string; DE has its own). */
export const NO_TRACE_TEXT = 'no measured trace available';

/** Label, then parts: strings are literal text; consecutive value elements are separated by ", ". */
const row = (label: string, ...parts: (HTMLElement | string)[]): HTMLElement => {
  const d = document.createElement('div');
  d.className = 'player-row';
  const b = document.createElement('b');
  b.textContent = `${label} `;
  d.append(b);
  parts.forEach((v, k) => {
    if (k > 0 && typeof v !== 'string' && typeof parts[k - 1] !== 'string') d.append(', ');
    d.append(v);
  });
  return d;
};

export { defaultPosition, isPunct, wordOf };

/**
 * The current step as one sentence: "Step 3 of 655 · Layer 12 of 46 · The switch picks 3 of 12
 * experts" (Simple, everyday words) or the technical form (Advanced). `word` is the decoded word the
 * run follows.
 */
export function stepSentence(op: Op, index: number, total: number, arch: Pick<Architecture, 'model'>, word: string): string {
  const tmp = document.createElement('span');
  tmp.innerHTML = stepSentenceHtml(op, index, total, arch, word);
  return tmp.textContent ?? '';
}


/**
 * The step sentence as rich HTML: every count (step, layer, top-k, experts) is a structure value with its
 * badge, read from the timeline and architecture.json, never typed into the text.
 */
export function stepSentenceHtml(op: Op, index: number, total: number, arch: Pick<Architecture, 'model'>, word: string, withLayer = true): string {
  const parts = [richT('now.step', { i: index + 1, n: total })];
  if (op.layer !== undefined && withLayer) parts.push(richT('now.layer', { n: layerLabel(op.layer), of: arch.model.num_layers }));
  if (op.stream) parts.push(escHtml(t('where.stream', { s: op.stream })));
  const simple = getMode() === 'simple';
  const w = simple ? wordOf(word) : JSON.stringify(word);
  parts.push(richT(`now.${op.kind}` as StringKey, { topk: arch.model.top_k, experts: arch.model.num_experts }, { w }));
  return parts.join(' · ');
}

/**
 * Word chips of a sentence: a chip spans the pieces up to the next piece with a leading space ("H" + "und"
 * is one chip "Hund"); a punctuation piece is a chip of its own. Every token is in exactly one chip.
 */
export function wordGroups(decoded: string[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  decoded.forEach((d, k) => {
    const punct = isPunct(wordOf(d));
    const prev = out[out.length - 1];
    const prevPunct = k > 0 && isPunct(wordOf(decoded[k - 1] ?? ''));
    if (!prev || /^\s/.test(d) || punct || prevPunct) out.push({ from: k, to: k });
    else prev.to = k;
  });
  return out;
}

/** Language of a traced prompt (fixed set: "de" is German, "kjv" and "ternary" are English). */
export const promptLang = (promptId: string): 'de' | 'en' => (promptId === 'de' ? 'de' : 'en');

/**
 * Detail lines of one op. Every number goes through fmt with the op's own label (measured keeps its
 * provenance). Advanced shows the technical rows and caveat codes; Simple shows the same measured
 * values in everyday words, without token ids, raw logits text or caveat codes.
 */
export function opDetails(op: Op, arch?: Pick<Architecture, 'model'>): HTMLElement {
  const box = document.createElement('div');
  box.className = 'player-details';
  const f = (v: LabeledValue, format?: (x: LabeledValue) => string): HTMLElement => {
    const l: Labeled<LabeledValue> = { kind: op.data.kind, value: v, ...(op.data.provenance ? { provenance: op.data.provenance } : {}) };
    return fmt(l, format ? { format } : {});
  };
  const fs = (v: LabeledValue): HTMLElement => fmt(structure(v));
  const pct = (x: LabeledValue): string => pctStr(Number(x));
  const d = op.data.value;
  const simple = getMode() === 'simple';
  if (simple) {
    switch (op.kind) {
      // The word itself is marked in the word strip; Simple shows no extra row for it.
      case 'embed': break;
      case 'attn': box.append(row(t('det.heads'), fs((d as AttnData).heads.length))); break;
      case 'resid': box.append(row(t('det.length'), f((d as ResidData).norm))); break;
      case 'router': {
        const r = d as RouterData;
        box.append(row(t('det.chosen'), ...r.top3.map((e, k) => f(`E${e}`, () => `E${e} (${pctStr(r.weights[k] as number)})`))));
        break;
      }
      case 'experts': {
        const x = d as ExpertsData;
        box.append(row(t('det.working'), ...x.lit.map((e) => f(`E${e}`))));
        break;
      }
      case 'gate': {
        const g = d as GateData;
        box.append(row(t('det.aFromB'), f(g.gA)), row(t('det.bFromA'), f(g.gB)));
        break;
      }
      case 'merge': box.append(row(t('det.merged'), f((d as MergeData).mergedNorm))); break;
      case 'lm_head': {
        const h = d as LmHeadData;
        if (h.available) for (const k of h.topK) box.append(row(getLang() === 'de' ? `„${wordOf(k.token)}“` : `“${wordOf(k.token)}”`, f(k.prob, pct)));
        break;
      }
      default: break;
    }
    return box;
  }
  switch (op.kind) {
    case 'embed': {
      const e = d as EmbedData;
      box.append(row(t('adv.token'), f(JSON.stringify(e.token)), ` ${t('adv.id')} `, f(e.tokenId, () => String(e.tokenId))));
      break;
    }
    case 'attn': {
      const a = d as AttnData;
      box.append(
        row(t('adv.heads'), fs(a.heads.length)),
        row(t('adv.maxAttn'), ...a.heads.map((h) => f(Math.max(...h.row), () => `h${h.head} ${decText(Math.max(...h.row), 2)}`))),
      );
      break;
    }
    case 'resid': {
      const r = d as ResidData;
      box.append(row(t(r.phase === 'post_attn' ? 'adv.normAttn' : 'adv.normExperts'), f(r.norm)));
      break;
    }
    case 'router': {
      const r = d as RouterData;
      box.append(
        row(t('adv.topk', { k: r.top3.length }),
          ...r.top3.map((e, k) => f(`E${e}`, () => `E${e} (${pctStr(r.weights[k] as number)})`))),
        row(t('adv.scale'), f(r.outputScales.length > 0 ? Math.min(...r.outputScales) : 0),
          t(r.outputScales.every((s) => s === r.outputScales[0]) ? 'adv.scaleEqual' : 'adv.scaleMin')),
      );
      if (r.a3Clamped) box.append(row('A3', t('adv.a3')));
      break;
    }
    case 'experts': {
      const x = d as ExpertsData;
      box.append(row(t('adv.lit'), fs(x.lit.length), ` ${t('adv.of')} `, fs(x.lit.length + x.dark.length), ` ${t('adv.experts')} `, ...x.lit.map((e) => f(`E${e}`))));
      break;
    }
    case 'gate': {
      const g = d as GateData;
      box.append(row('g_a', f(g.gA)), row('g_b', f(g.gB)));
      break;
    }
    case 'merge': box.append(row(t('adv.merged'), f((d as MergeData).mergedNorm))); break;
    case 'lm_head': {
      const h = d as LmHeadData;
      if (!h.available) {
        const note = document.createElement('div');
        note.className = 'player-row';
        note.textContent = h.note;
        box.append(note);
        break;
      }
      for (const k of h.topK) box.append(row(JSON.stringify(k.token), f(k.prob, pct)));
      break;
    }
    default: box.append(row(opLabel(op.kind, arch), (d as { note: string }).note));
  }
  if (op.caveats.length > 0) {
    const c = document.createElement('div');
    c.className = 'player-caveats';
    for (const id of op.caveats) {
      const s = document.createElement('span');
      s.className = 'player-caveat chip-caveat';
      s.dataset.caveat = id;
      s.textContent = id;
      s.title = lt(CAVEATS[id].title);
      c.append(s, ' ');
    }
    box.append(c);
  }
  return box;
}

/** Layer number moved by `delta` and clamped to 0..count-1: the stepper of the dock never leaves the model. */
export function stepLayer(current: number, delta: number, count: number): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), current + delta));
}

/** m:ss of a length in seconds (rounded to the nearest second): 75 -> "1:15". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What the run timeline needs: all values come from the real player, nothing is typed in. */
export interface RunTiming {
  /** Length of the run in seconds at 1x (current pace). */
  duration(): number;
  /** Seconds played so far. */
  elapsed(): number;
  /** Start of every swap gate (anastomosis op) in seconds; empty when the run has none. */
  gates(): number[];
  /** Start of the first op of every layer, in seconds. */
  layers(): number[];
  /** Jumps the run to the op on screen at `seconds` (the visitor's own navigation). */
  seek(seconds: number): void;
  /** Steps by whole ops (arrow keys on the timeline). */
  step(delta: number): void;
}

export interface PlayerBarDeps {
  arch: Architecture;
  tower: TowerScene;
  rig: Pick<CameraRig, 'flyTo' | 'overview'>;
  animator: Pick<Animator, 'show'>;
  /** Defaults to fetching public/data/trace/<id>.json and validating it. */
  load?: (id: string) => Promise<Trace>;
  ids?: string[];
  /** Document for the Space / arrow shortcuts (default: the global document; null = none). */
  keys?: Document | null;
  /** The layer stepper of the dock moved to `layer` (the app selects it and looks at it). */
  onLayerStep?: (layer: number) => void;
}

export interface PlayerBar {
  /** The mini dock: caption line, transport (back, play, next, speed) and the layer stepper. */
  element: HTMLElement;
  /** Content of the side panel's Sitzung section: sentence picker, word chips and, in Advanced, the expert tools. */
  session: HTMLElement;
  /** Einfach | Erweitert, for the head row of the side panel (always visible). */
  display: HTMLElement;
  /** Timing of the current run, null before a trace is loaded. */
  timing(): RunTiming | null;
  /**
   * The experts the router chose in one layer for the word on screen, per stream, with the recorded
   * softmax share of each (sums to 1 per stream). Empty before a trace loads; never recomputed.
   */
  routing(layer: number): { word: string; rows: Array<{ stream: 'A' | 'B'; experts: Array<{ expert: number; share: number }> }> };
  /** The layer the stepper shows (a selection from elsewhere moves it and, when paused, the timeline playhead; the camera does not move). */
  setLayer(layer: number): void;
  /** Ready once the traces are loaded (or failed). */
  ready: Promise<void>;
  tick(dt: number): void;
  player(): Player | null;
  /** Prompt id and token position the player is on (null until a trace is loaded). */
  selection(): { promptId: string; position: number } | null;
  /** Called on every op change: the op, its index and the timeline length (the rail shows the progress). */
  onOp(cb: (op: Op, index: number, total: number) => void): () => void;
  /**
   * A short hint for the caption line while a level of the model is open (null = none). It shows while
   * the run is paused; a playing run shows its step sentence.
   */
  setHint(key: StringKey | null): void;
  /**
   * "Watch it think" (lobby): the first sentence, from its first step, as a quick pass. Choosing it is
   * the visitor's explicit choice, so it may switch the sentence; the word stays the sentence's default.
   */
  watch(): void;
  /** Pauses a running run (the HUD home button); the bar shows the paused state at once. */
  pause(): void;
  /** True once at least one recorded run loaded (false while loading and when none loaded). */
  hasTraces(): boolean;
  /** Moves keyboard focus to the dock (after the visitor left the lobby); it never lands on Play. */
  focusPlay(): void;
  /** Date the first loaded trace was recorded (provenance.date), null before the traces load. */
  traceDate(): string | null;
  dispose(): void;
}

const TRACE_IDS = ['kjv', 'de', 'ternary'];
const FOLLOW_DISTANCE = 14;

/** Icon button: the name lives in aria-label, the tooltip adds the keyboard shortcut. */
const iconBtn = (action: string, icon: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hud-icon';
  b.dataset.action = action;
  b.innerHTML = icon;
  return b;
};

const textBtn = (action: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hud-btn';
  b.dataset.action = action;
  return b;
};

function select(cls: string): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = `hud-select ${cls}`;
  return s;
}

/** Field: a visible small label above a control (Simple and Advanced alike). */
function field(cls: string, control: HTMLElement): { el: HTMLElement; label: HTMLElement } {
  const el = document.createElement('label');
  el.className = `hud-field ${cls}`;
  const label = document.createElement('span');
  label.className = 'hud-field-label';
  el.append(label, control);
  return { el, label };
}

const isTyping = (t: EventTarget | null): boolean => {
  const e = t as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.tagName === 'BUTTON'
    || e.isContentEditable || !!e.closest?.('.run-timeline, .tour-menu, [role=dialog]');
};

export function createPlayerBar(deps: PlayerBarDeps): PlayerBar {
  const { arch, tower, rig, animator } = deps;
  const load = deps.load ?? ((id: string) => loadTrace(id, arch));
  const el = document.createElement('div');
  el.className = 'player-bar';
  el.setAttribute('role', 'group');
  el.tabIndex = -1;
  const msg = document.createElement('div');
  msg.className = 'player-empty';
  el.append(msg);

  const traces = new Map<string, Trace>();
  let player: Player | null = null;
  let offChange: (() => void) | null = null;
  let lastKey = '';
  let loaded: 'loading' | 'none' | 'ready' = 'loading';
  /**
   * Set by watch(): this run is a quick pass even in Advanced. A pause keeps it; a step, a scrub or jump,
   * a new sentence and a change of mode clear it.
   */
  let quickRun = false;
  let lastMode: Mode = getMode();
  /** The quick pass groups (pre, one per layer, post) of the current timeline. */
  let groupOf: number[] = [];
  const quickPlaying = (): boolean => !!player && player.playing() && player.pace() === 'quick';
  /** Simple and the lobby's Watch run the quick pass; Advanced keeps the full pace of every op. */
  const paceNow = (): Pace => (quickRun || getMode() === 'simple' ? 'quick' : 'full');
  const applyPace = (): void => { player?.setPace(paceNow()); };
  /** True only while handling a user action (Play, Step, scrub, jumps); builds never move the camera. */
  let userAction = false;
  const act = (fn: () => void): void => {
    userAction = true;
    try { fn(); } finally { userAction = false; }
  };

  const promptSel = select('player-prompt');
  const tokenSel = select('player-token');
  const prompt = field('field-prompt', promptSel);
  const token = field('field-token', tokenSel);
  // Play is the one primary control: icon plus a short label ("Start" / "Play"), so the word chips keep their room.
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'play-btn';
  play.dataset.action = 'play';
  const playIcon = document.createElement('span');
  playIcon.className = 'play-icon';
  const playText = document.createElement('span');
  playText.className = 'play-text';
  play.append(playIcon, playText);
  const prev = iconBtn('prev', ICONS.prev);
  const next = iconBtn('next', ICONS.next);
  prev.classList.add('step-btn');
  next.classList.add('step-btn');
  // Layer stepper "‹ 22 / 46 ›": the previous / next layer, clamped; the label reads the model's layer count.
  const stepper = document.createElement('div');
  stepper.className = 'layer-stepper';
  stepper.dataset.control = 'layer';
  stepper.setAttribute('role', 'group');
  const layerPrev = iconBtn('layer-prev', ICONS.chevron);
  const layerNext = iconBtn('layer-next', ICONS.chevron);
  layerPrev.classList.add('hud-icon--small', 'layer-prev');
  layerNext.classList.add('hud-icon--small', 'layer-next');
  const layerCount = document.createElement('span');
  layerCount.className = 'layer-count num';
  let layerShown = 0;
  stepper.append(layerPrev, layerCount, layerNext);
  /** True once a run was started: the caption then shows the step sentence instead of the first hint. */
  let started = false;
  // One plain headline says what the bar does.
  const headline = document.createElement('p');
  headline.className = 'player-headline';
  // "Choose another sentence": a popover with the three sentences in full (the selects live in Tools).
  // An icon button with a tooltip; its name lives in aria-label.
  const sentence = document.createElement('button');
  sentence.type = 'button';
  sentence.className = 'hud-btn sentence-chip';
  sentence.setAttribute('aria-haspopup', 'dialog');
  sentence.setAttribute('aria-expanded', 'false');
  const sentenceText = document.createElement('span');
  sentence.innerHTML = ICONS.token;
  sentence.append(sentenceText);
  sentence.insertAdjacentHTML('beforeend', ICONS.chevronDown);
  const pop = document.createElement('div');
  pop.className = 'sentence-pop';
  pop.dataset.control = 'sentence';
  pop.setAttribute('role', 'dialog');
  pop.tabIndex = -1;
  pop.hidden = true;
  const popList = document.createElement('div');
  popList.className = 'sentence-list';
  pop.append(popList);
  // The sentence as word chips, always visible: the marked chip is the word the run follows.
  const words = document.createElement('div');
  words.className = 'word-strip';
  words.dataset.control = 'sentence';
  words.setAttribute('role', 'group');
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.className = 'hud-range';
  scrub.min = '0';
  scrub.value = '0';
  const counter = document.createElement('span');
  counter.className = 'player-counter num';
  // Speed: one pill right after Next, in both modes; a click cycles 0.5× → 1× → 2× → 4× (the only speed control).
  let speed: Speed = 1;
  const speedBtn = document.createElement('button');
  speedBtn.type = 'button';
  speedBtn.className = 'hud-btn speed-pill';
  speedBtn.dataset.action = 'speed';
  speedBtn.dataset.control = 'speed';
  const camSel = select('player-camera');
  for (const m of CAMERA_MODES) camSel.append(new Option(m, m));
  camSel.value = 'free';
  const layerIn = document.createElement('input');
  layerIn.type = 'number';
  layerIn.className = 'hud-number';
  layerIn.min = '0';
  layerIn.max = String(arch.model.num_layers - 1);
  const layerGo = textBtn('layer-go');
  const kindSel = select('player-kind');
  for (const k of OP_KINDS) kindSel.append(new Option(k, k));
  const kindGo = textBtn('kind-go');
  // The current step as a sentence, in the colour and with the icon of its role.
  const chip = document.createElement('p');
  chip.className = 'step-line';
  chip.setAttribute('aria-live', 'polite');
  // One polite announcement per layer group while a quick pass plays (the step line is silent then).
  const announce = document.createElement('p');
  announce.className = 'sr-only';
  announce.setAttribute('aria-live', 'polite');
  announce.setAttribute('role', 'status');
  let announced = -1;
  const chipText = document.createElement('span');
  chipText.className = 'step-text';
  // While a quick pass plays, a small tag says so (its tooltip: every recorded step, only faster).
  const quickTag = document.createElement('span');
  quickTag.className = 'quick-tag';
  quickTag.hidden = true;
  // Simple: the step's few values on the same line (ellipsis, full text as tooltip); the line never wraps.
  const details = document.createElement('span');
  details.className = 'player-detail-box';
  chip.append(chipText, details);
  const opListeners = new Set<(op: Op, index: number, total: number) => void>();
  // Advanced: every detail row (router weights, output scale, caveat codes) lives in the Tools drawer.
  const fullDetails = document.createElement('div');
  fullDetails.className = 'player-detail-full';
  // Einfach | Erweitert sits at the right end of the control row (same prefs state as everywhere).
  const modeSeg = segmented<Mode>('mode-toggle', MODES, getMode, setMode);
  modeSeg.wrap.dataset.control = 'mode';

  // Every dock control carries its own data-control key (the HUD count in tests/ui.test.ts).
  prev.dataset.control = 'prev';
  play.dataset.control = 'play';
  next.dataset.control = 'next';
  const transport = document.createElement('div');
  transport.className = 'hud-group transport';
  transport.append(prev, play, next);
  // The lobby's Watch and the dock use the same transport; the stepper sits right of it.
  const pick = document.createElement('div');
  pick.className = 'hud-group pickers';
  pick.append(prompt.el, token.el);
  const progress = document.createElement('div');
  progress.className = 'hud-group progress';
  progress.append(scrub, counter);
  // Advanced: every expert tool sits in this one group in the Sitzung section.
  const adv = document.createElement('div');
  adv.className = 'hud-group advanced-controls tools-drawer';
  adv.dataset.adv = 'true';
  adv.dataset.control = 'tools';
  const jump = document.createElement('span');
  jump.className = 'hud-join';
  jump.append(layerIn, layerGo);
  const kindJoin = document.createElement('span');
  kindJoin.className = 'hud-join';
  kindJoin.append(kindSel, kindGo);
  adv.append(pick, progress, camSel, jump, kindJoin, fullDetails);
  const sentenceWrap = document.createElement('div');
  sentenceWrap.className = 'sentence-wrap';
  sentenceWrap.dataset.control = 'sentence';
  sentenceWrap.append(sentence);
  // Caption line: the headline before the first Play, then the step sentence (one line, fixed height).
  const top = document.createElement('div');
  top.className = 'player-caption';
  /** Caption hint while a level is open (U3); the step sentence wins while the run plays. */
  let levelHint: StringKey | null = null;
  let foldTipShown = false;
  let foldTipDone = false;
  const hintLine = document.createElement('p');
  hintLine.className = 'player-hint';
  hintLine.hidden = true;
  const paintHint = (): boolean => {
    const on = levelHint !== null && !(player?.playing() ?? false);
    hintLine.hidden = !on;
    hintLine.textContent = on && levelHint ? t(levelHint) : '';
    return on;
  };

  top.append(headline, chip, hintLine, announce);
  // Mini dock: the control row is the transport and the layer stepper; the sentence, the word chips and the
  // expert tools live in the side panel (session), Einfach | Erweitert in its Darstellung section (display).
  const controls = document.createElement('div');
  controls.className = 'player-controls';
  // Three zones in one row: the title and caption (flexible), the transport, speed and the layer stepper.
  const titleEl = document.createElement('div');
  titleEl.className = 'dock-title';
  const textBlock = document.createElement('div');
  textBlock.className = 'dock-text';
  textBlock.append(titleEl, top);
  const zoneLeft = document.createElement('div');
  zoneLeft.className = 'dock-left';
  zoneLeft.append(quickTag, textBlock);
  transport.classList.add('dock-centre');
  const zoneRight = document.createElement('div');
  zoneRight.className = 'hud-group dock-right';
  zoneRight.append(speedBtn, stepper);
  controls.append(zoneLeft, transport, zoneRight);
  const session = document.createElement('div');
  session.className = 'session-pane';
  const display = document.createElement('div');
  display.className = 'display-pane';
  display.append(modeSeg.wrap);

  const followCamera = (op: Op, force: boolean): void => {
    const mode = player?.cameraMode();
    if (mode === 'overview') {
      if (force || lastKey !== 'overview') void rig.overview();
      lastKey = 'overview';
      return;
    }
    if (mode !== 'follow') return;
    const key = op.layer !== undefined ? `L${op.layer}` : op.kind;
    if (!force && key === lastKey) return;
    lastKey = key;
    const id = op.layer !== undefined ? `L${op.layer}` : op.kind === 'embed' ? embedId() : op.kind === 'lm_head' ? lmHeadId() : lnFId();
    if (tower.has(id)) void rig.flyTo(tower.anchor(id).clone(), FOLLOW_DISTANCE, 600);
  };

  const paintSpeed = (): void => {
    const v = `${decText(speed, speed % 1 === 0 ? 0 : 1)}×`;
    speedBtn.textContent = v;
    speedBtn.title = t('dock.speedCycle');
    speedBtn.setAttribute('aria-label', t('player.speedAria', { v }));
  };
  const cycleSpeed = (): void => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] as Speed;
    player?.setSpeed(speed);
    paintSpeed();
    syncPlay();
  };

  const syncPlay = (): void => {
    const playing = player?.playing() ?? false;
    if (playing) started = true;
    playIcon.innerHTML = playing ? ICONS.pause : ICONS.play;
    playText.textContent = t(playing ? 'player.pause' : 'player.play');
    play.setAttribute('aria-label', playText.textContent);
    // At 4x a step lasts about 0.03 s: every step is passed through, but "nothing is left out" would not be
    // literally true on screen, so the tooltip says only what is true.
    const quickTip = speed >= 4
      ? t('player.quickTipFast', { n: player?.ops.length ?? 0 })
      : t('player.quickTip', { n: player?.ops.length ?? 0, s: QUICK_PASS_SECONDS });
    const tip = t(playing ? 'player.pauseTip' : 'player.playTip', { n: arch.model.num_layers });
    play.title = `${tip}${paceNow() === 'quick' ? ` · ${quickTip}` : ''} (${t('key.space')})`;
    quickTag.hidden = !(playing && player?.pace() === 'quick');
    quickTag.textContent = t('player.quick');
    quickTag.title = quickTip;
    // While a level is open the caption line keeps the step sentence during a run; the fold-back hint
    // rides on the Pause tooltip instead, once: after the first pause the caption line shows it.
    if (playing && levelHint && !foldTipDone) {
      play.title += ` · ${t('hint.foldTip')}`;
      foldTipShown = true;
    } else if (!playing && foldTipShown && levelHint) foldTipDone = true;
    play.setAttribute('aria-pressed', String(playing));
    play.classList.toggle('playing', playing);
  };

  /** Sentence list of the popover and the word strip (current language and mode). */
  const paintSentence = (): void => {
    const tr = traces.get(promptSel.value);
    pop.setAttribute('aria-label', t('player.sentenceTip'));
    popList.replaceChildren(...[...traces].map(([id, x]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sentence-option';
      b.dataset.prompt = id;
      b.textContent = x.provenance.prompt;
      b.title = x.provenance.prompt;
      b.lang = promptLang(x.provenance.prompt_id);
      b.setAttribute('aria-pressed', String(id === promptSel.value));
      return b;
    }));
    words.setAttribute('aria-label', t('player.wordsLabel'));
    // The traced sentence is never translated: its chips carry the sentence's own language.
    words.lang = promptLang(tr?.provenance.prompt_id ?? '');
    const simple = getMode() === 'simple';
    const pos = Number(tokenSel.value);
    const decoded = (tr?.provenance.tokens ?? []).map(decodeToken);
    words.replaceChildren(...wordGroups(decoded).map((g, n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'word-chip';
      const pieces = decoded.slice(g.from, g.to + 1);
      const w = wordOf(pieces.join(''));
      if (isPunct(w)) b.classList.add('word-chip--punct');
      if (pieces.length > 1) b.classList.add('word-chip--pieces');
      // Clicking a chip follows its last piece (the position the word is complete at).
      b.dataset.pos = String(g.to);
      b.dataset.from = String(g.from);
      b.dataset.to = String(g.to);
      for (const [k, piece] of pieces.entries()) {
        const sp = document.createElement('span');
        sp.className = 'word-piece';
        sp.textContent = k === 0 ? piece.replace(/^\s+/, '') || wordOf(piece) : piece;
        b.append(sp);
      }
      const on = pos >= g.from && pos <= g.to;
      b.classList.toggle('current', on);
      b.setAttribute('aria-pressed', String(on));
      const tip = t('player.wordTip', { i: n + 1, w: simple ? w : JSON.stringify(pieces.join('')) });
      const parts = pieces.length > 1 ? ` (${pieces.map((x) => JSON.stringify(x)).join(' · ')})` : '';
      b.title = `${tip}${parts}${on ? ` ${t('player.wordCurrent')}` : ''}`;
      return b;
    }));
    revealCurrent();
  };
  /**
   * Keeps the followed word in view inside the one-line strip (the strip scrolls, nothing else does).
   * Runs after a repaint and whenever the strip changes width (the dock narrows when the panel opens).
   */
  const revealCurrent = (): void => {
    const c = words.querySelector<HTMLElement>('.word-chip.current');
    if (!c || words.clientWidth <= 0) return;
    const left = c.getBoundingClientRect().left - words.getBoundingClientRect().left + words.scrollLeft;
    const pad = 16;
    if (left - pad < words.scrollLeft) words.scrollLeft = Math.max(0, left - pad);
    else if (left + c.offsetWidth + pad > words.scrollLeft + words.clientWidth) words.scrollLeft = left + c.offsetWidth + pad - words.clientWidth;
  };
  const stripObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(revealCurrent) : null;
  stripObserver?.observe(words);
  // The popover lives on <body> while open: the dock's chamfered frame clips anything that leaves it.
  const setPop = (open: boolean): void => {
    pop.hidden = !open;
    sentence.setAttribute('aria-expanded', String(open));
    if (!open) { pop.remove(); return; }
    paintSentence();
    if (typeof document === 'undefined') return;
    document.body.append(pop);
    const r = sentence.getBoundingClientRect();
    // Opens below the picker, inside the viewport.
    const w = Math.min(460, window.innerWidth * 0.8);
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 6}px`;
    // Focus moves into the popover, so keyboard users land on the sentence list (Esc closes it).
    (pop.querySelector<HTMLElement>('[aria-pressed="true"]') ?? pop.querySelector<HTMLElement>('button') ?? pop).focus();
  };
  /** The expert tools (pickers, scrubber, camera, jumps, all detail rows) show in Advanced, in the Sitzung section. */
  const setTools = (): void => { adv.hidden = getMode() === 'simple'; };
  /** Title of the left zone: "Layer N" (one numbering, 1-based), or "Ready" before a run has started. */
  const paintTitle = (): void => {
    const op = player?.ops[player.index()];
    const ready = !started && (op === undefined || op.layer === undefined);
    titleEl.textContent = ready ? t('dock.ready') : t('dock.title', { n: layerLabel(layerShown) });
    textBlock.title = `${titleEl.textContent} · ${top.textContent ?? ''}`.replace(/\s+/g, ' ').replace(/ · $/, '');
  };
  const paintLayer = (): void => {
    const n = arch.model.num_layers;
    paintTitle();
    layerCount.textContent = `${layerLabel(layerShown)} / ${layerLabel(n - 1)}`;
    layerCount.title = t('dock.layerCount', { n: layerLabel(layerShown), of: layerLabel(n - 1) });
    layerPrev.disabled = layerShown <= 0;
    layerNext.disabled = layerShown >= n - 1;
    stepper.setAttribute('aria-label', t('dock.layerGroup'));
    layerPrev.setAttribute('aria-label', t('dock.layerPrev'));
    layerPrev.title = t('dock.layerPrev');
    layerNext.setAttribute('aria-label', t('dock.layerNext'));
    layerNext.title = t('dock.layerNext');
  };
  const moveLayer = (delta: number): void => {
    const to = stepLayer(layerShown, delta, arch.model.num_layers);
    if (to === layerShown) return;
    layerShown = to;
    paintLayer();
    deps.onLayerStep?.(to);
  };

  /** Text of the current op (no camera, no animation): used on every op and after a language/mode switch. */
  const paintOp = (): void => {
    if (!player) return;
    const index = player.index();
    const op = player.ops[index] as Op;
    scrub.value = String(index);
    counter.textContent = t('player.counter', { i: index + 1, n: player.ops.length });
    syncPlay();
    // Quick pass: the caption names the layer and its main op, and changes once per layer group, not per op.
    const qp = quickPlaying();
    const g = groupOf[index] ?? 0;
    const shown: Op = qp ? mainOf[g] ?? op : op;
    chip.setAttribute('aria-live', qp ? 'off' : 'polite');
    const role = opRole(shown);
    // Simple, before the first Play: one hint instead of a step the visitor has not asked for.
    const hint = getMode() === 'simple' && !started && index === 0;
    chip.style.setProperty('--role', hint || !role ? 'var(--c-accent)' : ROLE_VAR[role]);
    chip.dataset.role = hint ? 'hint' : role ?? 'neutral';
    chip.dataset.kind = hint ? 'hint' : shown.kind;
    const tr = traces.get(promptSel.value);
    const word = decodeToken(tr?.provenance.tokens[Number(tokenSel.value)] ?? '');
    // One caption line: the headline until the first Play, then the step sentence (same height).
    const levelOpen = paintHint();
    headline.hidden = !hint || levelOpen;
    chip.hidden = hint || levelOpen;
    if (hint) {
      chipText.innerHTML = '';
      delete chipText.dataset.group;
    } else if (qp) {
      const key = `${g}|${getLang()}|${getMode()}`;
      if (chipText.dataset.group !== key) {
        chipText.dataset.group = key;
        chipText.innerHTML = quickCaptionHtml(shown);
      }
    } else {
      delete chipText.dataset.group;
      chipText.innerHTML = stepSentenceHtml(op, index, player.ops.length, arch, word, false);
    }
    if (qp && !hint) {
      if (announced !== g) {
        announced = g;
        // one polite sentence per layer group: the layer (it is in the dock title, not in the caption) and what happens in it
        announce.textContent = shown.layer !== undefined ? `${t('dock.title', { n: layerLabel(shown.layer) })} · ${chipText.textContent ?? ''}` : chipText.textContent ?? '';
      }
    } else announced = -1;
    const simple = getMode() === 'simple';
    // The per-op values show when paused, stepping and at the normal pace; a quick pass shows none.
    const d = hint || qp ? document.createElement('div') : opDetails(op, arch);
    details.replaceChildren(...(simple ? [d] : []));
    // The measured values follow the sentence only when they fit whole: the caption never ends in "…"
    // (they stay in the tooltip of the line either way).
    details.hidden = false;
    if (details.clientWidth > 0 && details.scrollWidth > details.clientWidth + 1) details.hidden = true;
    fullDetails.replaceChildren(...(simple || hint ? [] : [opDetails(op, arch)]));
    chip.title = hint ? '' : `${t('player.stepTip')}: ${chipText.textContent ?? ''}${d.textContent ? ` · ${d.textContent}` : ''}`;
    paintTitle();
    opListeners.forEach((l) => l(op, index, player!.ops.length));
  };

  /** Ops of every quick group: the main op of a layer is its router (the choice), else its first op. */
  let mainOf: Op[] = [];
  const quickCaptionHtml = (main: Op): string => {
    // The layer is in the dock title; the caption names only what happens in it.
    return escHtml(opLabel(main.kind, arch));
  };

  const show = (_index: number, op: Op): void => {
    animator.show(op);
    paintOp();
    if (userAction || player?.playing()) followCamera(op, false);
  };

  const build = (id: string, position: number): void => {
    offChange?.();
    const trace = traces.get(id);
    if (!trace) return;
    const ops = buildTimeline(trace, arch, position);
    quickRun = false;
    groupOf = quickGroups(ops);
    mainOf = [];
    const post = (groupOf[ops.length - 1] ?? 0);
    ops.forEach((o, k) => {
      const gi = groupOf[k] as number;
      const cur = mainOf[gi];
      if (!cur) mainOf[gi] = o;
      else if (o.layer !== undefined && cur.kind !== 'router' && o.kind === 'router') mainOf[gi] = o;
      else if (o.layer === undefined && gi === post && gi > 0) mainOf[gi] = o;
    });
    player = createPlayer(ops, () => undefined);
    offChange = player.onChange(show);
    scrub.max = String(ops.length - 1);
    lastKey = '';
    player.setSpeed(speed);
    applyPace();
    player.setCameraMode(camSel.value as CameraMode);
    player.scrub(0);
  };

  const tokenText = (piece: string, k: number): string => {
    const dec = decodeToken(piece);
    return getMode() === 'simple' ? wordOf(dec) : `${k}: ${JSON.stringify(dec)}`;
  };
  const fillTokens = (id: string): void => {
    const tr = traces.get(id);
    tokenSel.replaceChildren();
    if (!tr) return;
    tr.provenance.tokens.forEach((piece, k) => tokenSel.append(new Option(tokenText(piece, k), String(k))));
    tokenSel.value = String(defaultPosition(tr.provenance.tokens.map(decodeToken)));
  };
  const fillPrompts = (): void => {
    const keep = promptSel.value;
    promptSel.replaceChildren();
    for (const [id, tr] of traces) promptSel.append(new Option(getMode() === 'simple' ? tr.provenance.prompt : `${id}: ${tr.provenance.prompt}`, id));
    if (keep) promptSel.value = keep;
  };

  /** Labels, tooltips and option texts of the current language and mode; keeps every value. */
  const paint = (): void => {
    const simple = getMode() === 'simple';
    el.setAttribute('aria-label', t('player.group'));
    el.dataset.mode = getMode();
    headline.textContent = t('player.headline');
    headline.title = `${t('player.headlineTip', { n: arch.model.num_layers })} ${t('player.hint', { n: arch.model.num_layers })}`;
    modeSeg.label.textContent = t('mode.label');
    modeSeg.group.setAttribute('aria-label', t('mode.label'));
    modeSeg.wrap.title = t('mode.toggleTip');
    for (const b of modeSeg.buttons) {
      b.textContent = t(`mode.${b.dataset.value}` as StringKey);
      b.title = t(`mode.${b.dataset.value}Tip` as StringKey);
    }
    modeSeg.sync();
    if (getMode() !== lastMode) {
      lastMode = getMode();
      quickRun = false;
    }
    applyPace();
    msg.textContent = loaded === 'none' ? t('player.noTrace') : t('player.loading');
    prev.setAttribute('aria-label', t('player.prev'));
    prev.title = `${t('player.prev')} (${t('key.left')})`;
    next.setAttribute('aria-label', t('player.next'));
    next.title = `${t('player.next')} (${t('key.right')})`;
    prompt.label.textContent = t('player.prompt');
    promptSel.setAttribute('aria-label', t('player.prompt'));
    token.label.textContent = t('player.token');
    tokenSel.setAttribute('aria-label', t('player.token'));
    scrub.setAttribute('aria-label', t('player.scrub'));
    scrub.title = t('player.scrub');
    paintSpeed();
    camSel.setAttribute('aria-label', t('player.camera'));
    camSel.title = t('player.camera');
    const camText: Record<CameraMode, StringKey> = { follow: 'player.cameraFollow', free: 'player.cameraFree', overview: 'player.cameraOverview' };
    for (const o of camSel.options) o.text = t(camText[o.value as CameraMode]);
    layerIn.placeholder = t('player.layer');
    layerIn.setAttribute('aria-label', t('player.layerAria'));
    layerGo.textContent = t('player.go');
    layerGo.title = t('player.goTip');
    kindSel.setAttribute('aria-label', t('player.kind'));
    kindSel.title = t('player.kind');
    for (const o of kindSel.options) o.text = opLabel(o.value as OpKind, arch);
    sentence.setAttribute('aria-label', t('player.otherSentence'));
    sentenceText.textContent = t('player.otherSentence');
    sentence.title = t('player.sentenceTip');
    kindGo.textContent = t('player.nextKind');
    kindGo.title = t('player.nextKindTip');
    setTools();
    paintLayer();
    if (simple) setPop(false);
    if (traces.size > 0) {
      const tok = tokenSel.value;
      fillPrompts();
      const tr = traces.get(promptSel.value);
      if (tr) tr.provenance.tokens.forEach((piece, k) => { const o = tokenSel.options[k]; if (o) o.text = tokenText(piece, k); });
      tokenSel.value = tok;
      paintSentence();
    }
    paintOp();
  };

  promptSel.addEventListener('change', () => { fillTokens(promptSel.value); build(promptSel.value, Number(tokenSel.value)); paintSentence(); });
  tokenSel.addEventListener('change', () => { build(promptSel.value, Number(tokenSel.value)); paintSentence(); });
  sentence.addEventListener('click', () => setPop(pop.hidden));
  layerPrev.addEventListener('click', () => moveLayer(-1));
  layerNext.addEventListener('click', () => moveLayer(1));
  // Choosing a sentence or a word only rebuilds the timeline; the camera stays where it is.
  pop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const opt = target.closest<HTMLElement>('[data-prompt]');
    if (opt?.dataset.prompt) {
      promptSel.value = opt.dataset.prompt;
      promptSel.dispatchEvent(new Event('change'));
      setPop(false);
      sentence.focus();
    }
  });
  // Clicking a word follows that word: the timeline is rebuilt, the camera stays where it is.
  words.addEventListener('click', (e) => {
    const w = (e.target as HTMLElement).closest<HTMLElement>('[data-pos]');
    if (w?.dataset.pos) {
      tokenSel.value = w.dataset.pos;
      tokenSel.dispatchEvent(new Event('change'));
    }
  });
  // Esc closes the open popover wherever focus is (capture phase, before the explode view and the
  // camera see the key), so the same keypress never flies the camera.
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || pop.hidden) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    setPop(false);
    sentence.focus();
  };
  if (typeof document !== 'undefined') document.addEventListener('keydown', onEsc, true);
  const onDocDown = (e: PointerEvent): void => {
    if (!pop.hidden && !sentenceWrap.contains(e.target as Node) && !pop.contains(e.target as Node)) setPop(false);
  };
  if (typeof document !== 'undefined') document.addEventListener('pointerdown', onDocDown);
  /** Play / Pause from the button or Space: a pause ends a quick run started from the lobby. */
  const toggle = (): void => {
    applyPace();
    act(() => player?.toggle());
    paintOp();
  };
  const stepBy = (d: number): void => {
    quickRun = false;
    applyPace();
    act(() => player?.step(d));
    syncPlay();
  };
  play.addEventListener('click', toggle);
  prev.addEventListener('click', () => stepBy(-1));
  next.addEventListener('click', () => stepBy(1));
  // A scrub or a jump is the visitor's own navigation: the run is no longer the lobby's quick pass.
  const leaveQuickRun = (): void => {
    quickRun = false;
    applyPace();
  };
  scrub.addEventListener('input', () => { leaveQuickRun(); act(() => player?.scrub(Number(scrub.value))); });
  speedBtn.addEventListener('click', cycleSpeed);
  camSel.addEventListener('change', () => {
    player?.setCameraMode(camSel.value as CameraMode);
    lastKey = '';
    const op = player?.ops[player.index()];
    if (op) followCamera(op, true);
  });
  layerGo.addEventListener('click', () => {
    const l = Number(layerIn.value);
    if (layerIn.value !== '' && Number.isInteger(l)) { leaveQuickRun(); act(() => player?.jumpToLayer(l)); }
  });
  kindGo.addEventListener('click', () => { leaveQuickRun(); act(() => player?.jumpToNext(kindSel.value as OpKind)); });

  // Keyboard extras (mouse-first; keys are for accessibility): Space play/pause, arrows step.
  const keyDoc = deps.keys === undefined ? (typeof document === 'undefined' ? null : document) : deps.keys;
  // F-GPU-3: focus stayed on a select of the Tools drawer after a pick, so the step key ArrowRight
  // reached the select (Chrome picks the next option) and reset the run with another sentence.
  // A select gives focus back right after its change, so the step keys work again. While it has focus,
  // Left/Right step the run (never the value); Up/Down and typeahead change the value natively.
  const onSelectKey = (e: KeyboardEvent): void => {
    if (!player || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepBy(e.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  for (const s of [promptSel, tokenSel, camSel, kindSel]) s.addEventListener('change', () => s.blur());
  for (const s of [promptSel, tokenSel, camSel, kindSel]) s.addEventListener('keydown', onSelectKey);
  const onKey = (e: KeyboardEvent): void => {
    if (!player || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === ' ') { e.preventDefault(); if (!e.repeat) toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBy(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepBy(1); }
  };
  keyDoc?.addEventListener('keydown', onKey);
  const offPrefs = onPrefsChange(paint);
  paint();

  const ready = (async () => {
    const results = await Promise.allSettled((deps.ids ?? TRACE_IDS).map(async (id) => [id, await load(id)] as const));
    for (const r of results) if (r.status === 'fulfilled') traces.set(r.value[0], r.value[1]);
    if (traces.size === 0) {
      loaded = 'none';
      msg.textContent = t('player.noTrace');
      el.replaceChildren(msg);
      return;
    }
    loaded = 'ready';
    fillPrompts();
    el.replaceChildren(controls);
    session.replaceChildren(sentenceWrap, words, adv);
    fillTokens(promptSel.value);
    build(promptSel.value, Number(tokenSel.value));
    paintSentence();
  })();

  const timing: RunTiming = {
    duration: () => player?.duration() ?? 0,
    elapsed: () => player?.elapsed() ?? 0,
    gates: () => (player ? player.ops.flatMap((o, k) => (o.kind === 'gate' ? [player!.timeOf(k)] : [])) : []),
    layers: () => {
      if (!player) return [];
      const seen = new Set<number>();
      const out: number[] = [];
      player.ops.forEach((o, k) => {
        if (o.layer !== undefined && !seen.has(o.layer)) { seen.add(o.layer); out.push(player!.timeOf(k)); }
      });
      return out;
    },
    seek(sec) {
      if (!player) return;
      // Read the index on the axis the visitor sees (quick pass) BEFORE the pace switches to the full axis.
      const k = player.indexAtTime(sec);
      leaveQuickRun();
      act(() => player?.scrub(k));
    },
    step: (d) => stepBy(d),
  };

  return {
    element: el,
    session,
    display,
    timing: () => (player ? timing : null),
    routing(layer) {
      const tr = traces.get(promptSel.value);
      const word = decodeToken(tr?.provenance.tokens[Number(tokenSel.value)] ?? '').trim();
      const rows: Array<{ stream: 'A' | 'B'; experts: Array<{ expert: number; share: number }> }> = [];
      for (const op of player?.ops ?? []) {
        if (op.kind !== 'router' || op.layer !== layer || !op.stream) continue;
        const d = op.data.value as RouterData;
        rows.push({ stream: op.stream, experts: d.top3.map((expert, k) => ({ expert, share: d.weights[k] as number })) });
      }
      return { word, rows };
    },
    setLayer(l) {
      layerShown = Math.max(0, Math.min(arch.model.num_layers - 1, Math.trunc(l)));
      paintLayer();
      // A selection from elsewhere (a click on a slab): the playhead follows to the first op of that layer,
      // so stepper, sidebar and timeline name the same layer. A playing run keeps its own position, and
      // no camera follow runs (this is not `act`).
      const here = player?.ops[player.index()]?.layer;
      if (player && !player.playing() && here !== layerShown) {
        player.jumpToLayer(layerShown);
      }
    },
    ready,
    tick: (dt) => {
      const was = player?.playing() ?? false;
      player?.tick(dt);
      if (was && !player?.playing()) {
        // natural end of a run (a pause never reaches this tick): the next Play is a full pass again
        quickRun = false;
        applyPace();
        paintOp();
      }
    },
    player: () => player,
    selection: () => (traces.size > 0 ? { promptId: promptSel.value, position: Number(tokenSel.value) } : null),
    onOp(cb) { opListeners.add(cb); return () => opListeners.delete(cb); },
    setHint(key) {
      levelHint = key;
      paintOp();
    },
    watch() {
      const first = [...traces.keys()][0];
      if (!first) return;
      if (promptSel.value !== first) {
        promptSel.value = first;
        fillTokens(first);
        build(first, Number(tokenSel.value));
        paintSentence();
      }
      quickRun = true;
      applyPace();
      act(() => { player?.scrub(0); player?.play(); });
      paintOp();
    },
    pause() {
      if (!player?.playing()) return;
      player.pause();
      paintOp();
    },
    hasTraces: () => traces.size > 0,
    focusPlay() {
      // Keyboard focus lands on the dock itself, never on the Play button: a key still held down from the
      // intro skip (Enter repeats, Space fires on release) would otherwise click Play without a request.
      if (el.isConnected) el.focus({ preventScroll: true });
    },
    traceDate: () => [...traces.values()][0]?.provenance.date ?? null,
    dispose() {
      stripObserver?.disconnect();
      offPrefs();
      offChange?.();
      keyDoc?.removeEventListener('keydown', onKey);
      if (typeof document !== 'undefined') {
        document.removeEventListener('pointerdown', onDocDown);
        document.removeEventListener('keydown', onEsc, true);
      }
      pop.remove();
      session.remove();
      display.remove();
      el.remove();
    },
  };
}
