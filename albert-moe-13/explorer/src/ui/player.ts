import type { CameraRig } from '../camera/controls';
import { CAVEATS } from '../content/caveats';
import type { Architecture } from '../data/architecture';
import { type Labeled, type LabeledValue, fmt, structure } from '../data/labeled';
import { type Trace, decodeToken, loadTrace } from '../data/trace';
import type { Animator } from '../flow/animate';
import {
  type AttnData, type EmbedData, type ExpertsData, type GateData, type LmHeadData, type MergeData,
  type Op, type OpKind, type ResidData, type RouterData, OP_KINDS, buildTimeline,
} from '../flow/timeline';
import { embedId, lmHeadId, lnFId } from '../scene/ids';
import type { TowerScene } from '../scene/tower';
import { ICONS, typeIcon } from './icons';
import { getLang, getMode, onPrefsChange, t } from './prefs';
import { ROLE_VAR, type Role } from './roles';
import type { StringKey } from './strings';

export type CameraMode = 'follow' | 'free' | 'overview';
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
export const CAMERA_MODES: CameraMode[] = ['follow', 'free', 'overview'];

/** Seconds one op stays on screen at speed 1. */
export const OP_SECONDS = 0.6;

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
  /** First op of `layer`. Returns false when no op has that layer. */
  jumpToLayer(layer: number): boolean;
  /** Next op of `kind` after the current one, wrapping to the start. Returns false when none exists. */
  jumpToNext(kind: OpKind): boolean;
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
  const listeners = new Set<(index: number, op: Op) => void>();

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
    tick(dt) {
      if (!isPlaying) return;
      acc += Math.min(dt, 0.1) * spd;
      while (acc >= OP_SECONDS - 1e-9 && isPlaying) {
        const rest = Math.max(acc - OP_SECONDS, 0);
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
  // top-3 routing: moe.rs:197-381 (the same constant the panel's router caption cites).
  return t(`op.${kind}` as StringKey, { topk: 3, experts: arch?.model.num_experts ?? 12 });
}

/** Colour role of an op (null = neutral). */
export function opRole(op: Pick<Op, 'kind' | 'stream'>): Role | null {
  switch (op.kind) {
    case 'attn': case 'ln1': case 'ln2': case 'resid': return op.stream === 'B' ? 'streamB' : 'streamA';
    case 'router': return 'router';
    case 'experts': return 'expert';
    case 'gate': return 'gate';
    default: return null;
  }
}

/** Chip text: "Router (top-3 of 12 experts) · layer 12 · stream A" (Simple: everyday words). */
export function opChipText(op: Op, arch?: Pick<Architecture, 'model'>): string {
  const parts = [opLabel(op.kind, arch)];
  if (op.layer !== undefined) parts.push(t('where.layer', { n: op.layer }));
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

/** Visible form of a decoded token for Simple mode: trimmed, a blank shows as ␣. */
export const wordOf = (decoded: string): string => decoded.trim() || '␣';

/** True for a token without letters or digits (".", ",", "␣"): its chip gets extra room so it stays visible. */
export const isPunct = (word: string): boolean => !/[\p{L}\p{N}]/u.test(word);

/**
 * The current step as one sentence: "Step 3 of 655 · Layer 12 of 46 · The switch picks 3 of 12
 * experts" (Simple, everyday words) or the technical form (Advanced). `word` is the decoded word the
 * run follows.
 */
export function stepSentence(op: Op, index: number, total: number, arch: Pick<Architecture, 'model'>, word: string): string {
  const parts = [t('now.step', { i: index + 1, n: total })];
  if (op.layer !== undefined) parts.push(t('now.layer', { n: op.layer, of: arch.model.num_layers }));
  if (op.stream) parts.push(t('where.stream', { s: op.stream }));
  const simple = getMode() === 'simple';
  const w = simple ? wordOf(word) : JSON.stringify(word);
  // top-3 routing: moe.rs:197-381 (the same constant opLabel and the panel's router caption cite).
  parts.push(t(`now.${op.kind}` as StringKey, { topk: 3, experts: arch.model.num_experts, w }));
  return parts.join(' · ');
}

/** Icon of an op: the icon of the component it runs in. */
const OP_ICON_TYPE: Record<OpKind, string> = {
  embed: 'embed', ln1: 'ln1', attn: 'attn', resid: 'shaft', ln2: 'ln2', router: 'router', experts: 'bank',
  gate: 'anastomosis', merge: 'layers', ln_f: 'ln_f', lm_head: 'lm_head',
};

/**
 * Detail lines of one op. Every number goes through fmt with the op's own label (measured keeps its
 * provenance). Advanced shows the technical rows and caveat codes; Simple shows the same measured
 * values in everyday words, without token ids, raw logits text or caveat codes.
 */
export function opDetails(op: Op): HTMLElement {
  const box = document.createElement('div');
  box.className = 'player-details';
  const f = (v: LabeledValue, format?: (x: LabeledValue) => string): HTMLElement => {
    const l: Labeled<LabeledValue> = { kind: op.data.kind, value: v, ...(op.data.provenance ? { provenance: op.data.provenance } : {}) };
    return fmt(l, format ? { format } : {});
  };
  const fs = (v: LabeledValue): HTMLElement => fmt(structure(v));
  const pct = (x: LabeledValue): string => `${(Number(x) * 100).toFixed(1)} %`;
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
        box.append(row(t('det.chosen'), ...r.top3.map((e, k) => f(`E${e}`, () => `E${e} (${((r.weights[k] as number) * 100).toFixed(1)} %)`))));
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
      box.append(row('token', f(JSON.stringify(e.token)), ' id ', f(e.tokenId)));
      break;
    }
    case 'attn': {
      const a = d as AttnData;
      box.append(
        row('heads', fs(a.heads.length)),
        row('max attention weight per head', ...a.heads.map((h) => f(Math.max(...h.row), () => `h${h.head} ${Math.max(...h.row).toFixed(2)}`))),
      );
      break;
    }
    case 'resid': {
      const r = d as ResidData;
      box.append(row(r.phase === 'post_attn' ? 'after attention, norm' : 'after experts, norm', f(r.norm)));
      break;
    }
    case 'router': {
      const r = d as RouterData;
      box.append(
        row('top 3 experts (softmax weight after the A3 clamp, before output scales)',
          ...r.top3.map((e, k) => f(`E${e}`, () => `E${e} (${((r.weights[k] as number) * 100).toFixed(1)} %)`))),
        row('output scale (traffic light)', f(r.outputScales.length > 0 ? Math.min(...r.outputScales) : 0),
          r.outputScales.every((s) => s === r.outputScales[0]) ? '(all experts equal)' : '(min over experts)'),
      );
      if (r.a3Clamped) box.append(row('A3', 'safety clamp changed a logit for this token'));
      break;
    }
    case 'experts': {
      const x = d as ExpertsData;
      box.append(row('lit', fs(x.lit.length), ' of ', fs(x.lit.length + x.dark.length), ' experts: ', ...x.lit.map((e) => f(`E${e}`))));
      break;
    }
    case 'gate': {
      const g = d as GateData;
      box.append(row('g_a', f(g.gA)), row('g_b', f(g.gB)));
      break;
    }
    case 'merge': box.append(row('merged norm', f((d as MergeData).mergedNorm))); break;
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
    default: box.append(row(opLabel(op.kind), (d as { note: string }).note));
  }
  if (op.caveats.length > 0) {
    const c = document.createElement('div');
    c.className = 'player-caveats';
    for (const id of op.caveats) {
      const s = document.createElement('span');
      s.className = 'player-caveat chip-caveat';
      s.dataset.caveat = id;
      s.textContent = id;
      s.title = `${CAVEATS[id].title}`;
      c.append(s, ' ');
    }
    box.append(c);
  }
  return box;
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
}

export interface PlayerBar {
  element: HTMLElement;
  /** Ready once the traces are loaded (or failed). */
  ready: Promise<void>;
  tick(dt: number): void;
  player(): Player | null;
  /** Prompt id and token position the player is on (null until a trace is loaded). */
  selection(): { promptId: string; position: number } | null;
  /** Called on every op change: the op, its index and the timeline length (the rail shows the progress). */
  onOp(cb: (op: Op, index: number, total: number) => void): () => void;
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
    || e.isContentEditable || !!e.closest?.('.slab-rail, .tour-menu, [role=dialog]');
};

export function createPlayerBar(deps: PlayerBarDeps): PlayerBar {
  const { arch, tower, rig, animator } = deps;
  const load = deps.load ?? ((id: string) => loadTrace(id, arch));
  const el = document.createElement('div');
  el.className = 'player-bar';
  el.setAttribute('role', 'group');
  const msg = document.createElement('div');
  msg.className = 'player-empty';
  el.append(msg);

  const traces = new Map<string, Trace>();
  let player: Player | null = null;
  let offChange: (() => void) | null = null;
  let lastKey = '';
  let loaded: 'loading' | 'none' | 'ready' = 'loading';
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
  // Play is the one primary control: icon plus a plain label ("Watch albert think").
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'hud-btn play-btn';
  play.dataset.action = 'play';
  const playIcon = document.createElement('span');
  playIcon.className = 'play-icon';
  const playText = document.createElement('span');
  playText.className = 'play-text';
  play.append(playIcon, playText);
  const prev = iconBtn('prev', ICONS.prev);
  const next = iconBtn('next', ICONS.next);
  prev.classList.add('hud-icon--small', 'step-btn');
  next.classList.add('hud-icon--small', 'step-btn');
  /** Simple shows the step arrows only once a run was started and is paused. */
  let started = false;
  // One plain headline says what the bar does.
  const headline = document.createElement('p');
  headline.className = 'player-headline';
  // "Choose another sentence": a popover with the three sentences in full (the selects live in Tools).
  const sentence = document.createElement('button');
  sentence.type = 'button';
  sentence.className = 'hud-btn hud-btn--ghost sentence-chip';

  sentence.setAttribute('aria-haspopup', 'dialog');
  sentence.setAttribute('aria-expanded', 'false');
  sentence.innerHTML = ICONS.token;
  const sentenceText = document.createElement('span');
  sentenceText.className = 'sentence-text';
  sentence.append(sentenceText);
  const pop = document.createElement('div');
  pop.className = 'sentence-pop';
  pop.dataset.control = 'sentence';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  const popList = document.createElement('div');
  popList.className = 'sentence-list';
  pop.append(popList);
  // The sentence as word chips, always visible: the marked chip is the word the run follows.
  const words = document.createElement('div');
  words.className = 'word-strip';
  words.dataset.control = 'sentence';
  words.setAttribute('role', 'group');
  const tools = document.createElement('button');
  tools.type = 'button';
  tools.className = 'hud-btn hud-btn--ghost tools-btn';
  tools.dataset.control = 'tools';
  tools.setAttribute('aria-expanded', 'false');
  const toolsText = document.createElement('span');
  tools.innerHTML = ICONS.sliders;
  tools.append(toolsText);
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.className = 'hud-range';
  scrub.min = '0';
  scrub.value = '0';
  const counter = document.createElement('span');
  counter.className = 'player-counter num';
  const speedSel = select('player-speed');
  for (const sp of SPEEDS) speedSel.append(new Option(`${sp}×`, String(sp)));
  speedSel.value = '1';
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
  const chipIcon = document.createElement('span');
  chipIcon.className = 'step-icon';
  chipIcon.setAttribute('aria-hidden', 'true');
  const chipText = document.createElement('span');
  chipText.className = 'step-text';
  chip.append(chipIcon, chipText);
  const opListeners = new Set<(op: Op, index: number, total: number) => void>();
  const details = document.createElement('div');
  details.className = 'player-detail-box';

  const transport = document.createElement('div');
  transport.className = 'hud-group transport';
  transport.dataset.control = 'play';
  transport.append(prev, play, next);
  const pick = document.createElement('div');
  pick.className = 'hud-group pickers';
  pick.append(prompt.el, token.el);
  const progress = document.createElement('div');
  progress.className = 'hud-group progress';
  progress.append(scrub, counter);
  // Advanced: every expert tool sits in this one drawer, opened from the Tools button.
  const adv = document.createElement('div');
  adv.className = 'hud-group advanced-controls tools-drawer';
  adv.dataset.control = 'tools';
  adv.dataset.adv = 'true';
  const jump = document.createElement('span');
  jump.className = 'hud-join';
  jump.append(layerIn, layerGo);
  const kindJoin = document.createElement('span');
  kindJoin.className = 'hud-join';
  kindJoin.append(kindSel, kindGo);
  adv.append(pick, progress, speedSel, camSel, jump, kindJoin);
  let toolsOpen = false;
  const sentenceWrap = document.createElement('div');
  sentenceWrap.className = 'sentence-wrap';
  sentenceWrap.dataset.control = 'sentence';
  sentenceWrap.append(sentence);
  const top = document.createElement('div');
  top.className = 'player-top';
  top.append(headline, sentenceWrap, tools);
  const controls = document.createElement('div');
  controls.className = 'player-controls';
  controls.append(transport, words);
  const now = document.createElement('div');
  now.className = 'player-now';
  now.append(chip, details);

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

  const syncPlay = (): void => {
    const playing = player?.playing() ?? false;
    if (playing) started = true;
    playIcon.innerHTML = playing ? ICONS.pause : ICONS.play;
    playText.textContent = t(playing ? 'player.pause' : 'player.play');
    play.setAttribute('aria-label', playText.textContent);
    play.title = `${t(playing ? 'player.pauseTip' : 'player.playTip', { n: arch.model.num_layers })} (${t('key.space')})`;
    play.setAttribute('aria-pressed', String(playing));
    play.classList.toggle('playing', playing);
    const steps = getMode() === 'advanced' || (started && !playing);
    prev.hidden = !steps;
    next.hidden = !steps;
  };

  /** Sentence list of the popover and the word strip (current language and mode). */
  const paintSentence = (): void => {
    const tr = traces.get(promptSel.value);
    sentenceText.textContent = t('player.otherSentence');
    sentence.title = t('player.sentenceTip');
    pop.setAttribute('aria-label', t('player.sentenceTip'));
    popList.replaceChildren(...[...traces].map(([id, x]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sentence-option';
      b.dataset.prompt = id;
      b.textContent = x.provenance.prompt;
      b.title = x.provenance.prompt;
      b.setAttribute('aria-pressed', String(id === promptSel.value));
      return b;
    }));
    words.setAttribute('aria-label', t('player.wordsLabel'));
    const simple = getMode() === 'simple';
    words.replaceChildren(...(tr?.provenance.tokens ?? []).map((piece, k) => {
      const dec = decodeToken(piece);
      const w = wordOf(dec);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'word-chip';
      if (isPunct(w)) b.classList.add('word-chip--punct');
      // A piece that continues the previous word (no leading space, e.g. "H" + "und") sits flush to it.
      else if (k > 0 && !/^\s/.test(dec)) b.classList.add('word-chip--joined');
      b.dataset.pos = String(k);
      b.textContent = w;
      const on = String(k) === tokenSel.value;
      b.classList.toggle('current', on);
      b.setAttribute('aria-pressed', String(on));
      const tip = t('player.wordTip', { i: k + 1, w: simple ? w : JSON.stringify(dec) });
      b.title = on ? `${tip} ${t('player.wordCurrent')}` : tip;
      return b;
    }));
  };
  // The popover lives on <body> while open: the dock's chamfered frame clips anything that leaves it.
  const setPop = (open: boolean): void => {
    pop.hidden = !open;
    sentence.setAttribute('aria-expanded', String(open));
    if (!open) { pop.remove(); return; }
    paintSentence();
    if (typeof document === 'undefined') return;
    document.body.append(pop);
    const r = sentence.getBoundingClientRect();
    pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    pop.style.bottom = `${window.innerHeight - r.top + 10}px`;
  };
  const setTools = (open: boolean): void => {
    toolsOpen = open;
    tools.setAttribute('aria-expanded', String(open));
    adv.hidden = getMode() === 'simple' || !open;
  };

  /** Text of the current op (no camera, no animation): used on every op and after a language/mode switch. */
  const paintOp = (): void => {
    if (!player) return;
    const index = player.index();
    const op = player.ops[index] as Op;
    scrub.value = String(index);
    counter.textContent = t('player.counter', { i: index + 1, n: player.ops.length });
    syncPlay();
    const role = opRole(op);
    // Simple, before the first Play: one hint instead of a step the visitor has not asked for.
    const hint = getMode() === 'simple' && !started && index === 0;
    chip.style.setProperty('--role', hint || !role ? 'var(--c-accent)' : ROLE_VAR[role]);
    chip.dataset.role = hint ? 'hint' : role ?? 'neutral';
    chip.dataset.kind = hint ? 'hint' : op.kind;
    chipIcon.innerHTML = hint ? ICONS.play : typeIcon(OP_ICON_TYPE[op.kind]);
    const tr = traces.get(promptSel.value);
    const word = decodeToken(tr?.provenance.tokens[Number(tokenSel.value)] ?? '');
    chipText.textContent = hint ? t('player.hint', { n: arch.model.num_layers }) : stepSentence(op, index, player.ops.length, arch, word);
    chip.title = hint ? t('player.headlineTip', { n: arch.model.num_layers }) : `${t('player.stepTip')}: ${opChipText(op, arch)}`;
    details.replaceChildren(hint ? document.createElement('div') : opDetails(op));
    opListeners.forEach((l) => l(op, index, player!.ops.length));
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
    player = createPlayer(ops, () => undefined);
    offChange = player.onChange(show);
    scrub.max = String(ops.length - 1);
    lastKey = '';
    player.setSpeed(Number(speedSel.value) as Speed);
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
    tokenSel.value = String(tr.provenance.tokens.length - 1);
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
    headline.title = t('player.headlineTip', { n: arch.model.num_layers });
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
    speedSel.setAttribute('aria-label', t('player.speed'));
    speedSel.title = t('player.speed');
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
    kindGo.textContent = t('player.nextKind');
    kindGo.title = t('player.nextKindTip');
    tools.hidden = simple;
    toolsText.textContent = t('player.tools');
    tools.title = t('player.toolsTip');
    setTools(toolsOpen);
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
  tools.addEventListener('click', () => setTools(!toolsOpen));
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
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setPop(false); sentence.focus(); }
  });
  const onDocDown = (e: PointerEvent): void => {
    if (!pop.hidden && !sentenceWrap.contains(e.target as Node) && !pop.contains(e.target as Node)) setPop(false);
  };
  if (typeof document !== 'undefined') document.addEventListener('pointerdown', onDocDown);
  play.addEventListener('click', () => { act(() => player?.toggle()); paintOp(); });
  prev.addEventListener('click', () => { act(() => player?.step(-1)); syncPlay(); });
  next.addEventListener('click', () => { act(() => player?.step(1)); syncPlay(); });
  scrub.addEventListener('input', () => act(() => player?.scrub(Number(scrub.value))));
  speedSel.addEventListener('change', () => player?.setSpeed(Number(speedSel.value) as Speed));
  camSel.addEventListener('change', () => {
    player?.setCameraMode(camSel.value as CameraMode);
    lastKey = '';
    const op = player?.ops[player.index()];
    if (op) followCamera(op, true);
  });
  layerGo.addEventListener('click', () => {
    const l = Number(layerIn.value);
    if (layerIn.value !== '' && Number.isInteger(l)) act(() => player?.jumpToLayer(l));
  });
  kindGo.addEventListener('click', () => act(() => player?.jumpToNext(kindSel.value as OpKind)));

  // Keyboard extras (mouse-first; keys are for accessibility): Space play/pause, arrows step.
  const keyDoc = deps.keys === undefined ? (typeof document === 'undefined' ? null : document) : deps.keys;
  const onKey = (e: KeyboardEvent): void => {
    if (!player || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === ' ') { e.preventDefault(); act(() => player?.toggle()); paintOp(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); act(() => player?.step(-1)); syncPlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); act(() => player?.step(1)); syncPlay(); }
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
    el.replaceChildren(top, controls, adv, now);
    fillTokens(promptSel.value);
    build(promptSel.value, Number(tokenSel.value));
    paintSentence();
  })();

  return {
    element: el,
    ready,
    tick: (dt) => {
      const was = player?.playing() ?? false;
      player?.tick(dt);
      if (was && !player?.playing()) syncPlay();
    },
    player: () => player,
    selection: () => (traces.size > 0 ? { promptId: promptSel.value, position: Number(tokenSel.value) } : null),
    onOp(cb) { opListeners.add(cb); return () => opListeners.delete(cb); },
    dispose() {
      offPrefs();
      offChange?.();
      keyDoc?.removeEventListener('keydown', onKey);
      if (typeof document !== 'undefined') document.removeEventListener('pointerdown', onDocDown);
      pop.remove();
      el.remove();
    },
  };
}
