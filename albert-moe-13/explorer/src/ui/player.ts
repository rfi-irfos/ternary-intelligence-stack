import { PALETTE, cssHex } from '../scene/palette';
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

const OP_LABEL: Record<OpKind, string> = {
  embed: 'embedding', ln1: 'layer norm 1', attn: 'attention', resid: 'residual add', ln2: 'layer norm 2',
  router: 'router', experts: 'experts', gate: 'gate', merge: 'merge A+B', ln_f: 'final norm', lm_head: 'lm_head',
};

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

/** Detail lines of one op. Every number goes through fmt with the op's own label (measured keeps its provenance). */
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
    default: box.append(row(OP_LABEL[op.kind], (d as { note: string }).note));
  }
  if (op.caveats.length > 0) {
    const c = document.createElement('div');
    c.className = 'player-caveats';
    for (const id of op.caveats) {
      const s = document.createElement('span');
      s.className = 'player-caveat';
      s.dataset.caveat = id;
      s.textContent = id;
      s.title = `${CAVEATS[id].title}`;
      c.append(s, ' ');
    }
    box.append(c);
  }
  return box;
}

export const PLAYER_CSS = `
.player-bar { position: fixed; left: 50%; bottom: 52px; transform: translateX(-50%); width: min(900px, 96vw);
  box-sizing: border-box; padding: 8px 10px; font: 12px monospace; color: #cfd8e8;
  background: rgba(0,0,0,0.72); border: 1px solid #333a46; border-radius: 6px; }
.player-bar button, .player-bar select, .player-bar input[type=number] { font: 12px monospace; color: #fff;
  background: #14161b; border: 1px solid #333a46; border-radius: 3px; padding: 3px 6px; }
.player-bar button { cursor: pointer; }
.player-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px; }
.player-bar input[type=range] { flex: 1 1 200px; }
.player-bar input[type=number] { width: 4.5em; }
.player-where { color: #fff; margin-bottom: 4px; }
.player-caveat { display: inline-block; padding: 0 5px; border: 1px solid ${cssHex(PALETTE.accent)}; color: ${cssHex(PALETTE.accent)}; border-radius: 3px; }
.player-empty { color: #fff; }
`;

export interface PlayerBarDeps {
  arch: Architecture;
  tower: TowerScene;
  rig: Pick<CameraRig, 'flyTo' | 'overview'>;
  animator: Pick<Animator, 'show'>;
  /** Defaults to fetching public/data/trace/<id>.json and validating it. */
  load?: (id: string) => Promise<Trace>;
  ids?: string[];
}

export interface PlayerBar {
  element: HTMLElement;
  /** Ready once the traces are loaded (or failed). */
  ready: Promise<void>;
  tick(dt: number): void;
  player(): Player | null;
  /** Prompt id and token position the player is on (null until a trace is loaded). */
  selection(): { promptId: string; position: number } | null;
}

const TRACE_IDS = ['kjv', 'de', 'ternary'];
const FOLLOW_DISTANCE = 14;

const btn = (text: string, title: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  return b;
};

function select(label: string, options: [string, string][]): HTMLSelectElement {
  const s = document.createElement('select');
  s.setAttribute('aria-label', label);
  s.title = label;
  for (const [v, t] of options) s.append(new Option(t, v));
  return s;
}

export function createPlayerBar(deps: PlayerBarDeps): PlayerBar {
  const { arch, tower, rig, animator } = deps;
  const load = deps.load ?? ((id: string) => loadTrace(id, arch));
  const el = document.createElement('div');
  el.className = 'player-bar';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Follow a token');
  const msg = document.createElement('div');
  msg.className = 'player-empty';
  msg.textContent = 'loading measured traces';
  el.append(msg);

  const traces = new Map<string, Trace>();
  let player: Player | null = null;
  let offChange: (() => void) | null = null;
  let lastKey = '';
  /** True only while handling a user action (Play, Step, scrub, jumps); builds never move the camera. */
  let userAction = false;
  const act = (fn: () => void): void => {
    userAction = true;
    try { fn(); } finally { userAction = false; }
  };

  const promptSel = select('Prompt', []);
  const tokenSel = select('Token', []);
  const play = btn('Play', 'Play / pause');
  const prev = btn('Prev', 'Step back one op');
  const next = btn('Next', 'Step forward one op');
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.value = '0';
  scrub.setAttribute('aria-label', 'Scrub through the forward pass');
  const speedSel = select('Speed', SPEEDS.map((s) => [String(s), `${s}x`]));
  speedSel.value = '1';
  const camSel = select('Camera', CAMERA_MODES.map((m) => [m, `camera: ${m}`]));
  camSel.value = 'free';
  const layerIn = document.createElement('input');
  layerIn.type = 'number';
  layerIn.min = '0';
  layerIn.max = String(arch.model.num_layers - 1);
  layerIn.placeholder = 'layer';
  layerIn.setAttribute('aria-label', 'Jump to layer');
  const layerGo = btn('Go', 'Jump to this layer');
  const kindSel = select('Next op of kind', OP_KINDS.map((k) => [k, OP_LABEL[k]]));
  const kindGo = btn('Next of kind', 'Jump to the next op of this kind');
  const where = document.createElement('div');
  where.className = 'player-where';
  const details = document.createElement('div');

  const controls = document.createElement('div');
  controls.className = 'player-controls';
  controls.append(promptSel, tokenSel, prev, play, next, scrub, speedSel, camSel, layerIn, layerGo, kindSel, kindGo);

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

  const show = (index: number, op: Op): void => {
    animator.show(op);
    scrub.value = String(index);
    const lay = op.layer !== undefined ? ` layer ${op.layer}` : '';
    const str = op.stream ? ` stream ${op.stream}` : '';
    where.textContent = `${index + 1} / ${player?.ops.length ?? 0}: ${OP_LABEL[op.kind]}${lay}${str}`;
    details.replaceChildren(opDetails(op));
    play.textContent = player?.playing() ? 'Pause' : 'Play';
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

  const fillTokens = (id: string): void => {
    const t = traces.get(id);
    tokenSel.replaceChildren();
    if (!t) return;
    t.provenance.tokens.forEach((piece, k) => tokenSel.append(new Option(`${k}: ${JSON.stringify(decodeToken(piece))}`, String(k))));
    tokenSel.value = String(t.provenance.tokens.length - 1);
  };

  promptSel.addEventListener('change', () => { fillTokens(promptSel.value); build(promptSel.value, Number(tokenSel.value)); });
  tokenSel.addEventListener('change', () => build(promptSel.value, Number(tokenSel.value)));
  play.addEventListener('click', () => { act(() => player?.toggle()); play.textContent = player?.playing() ? 'Pause' : 'Play'; });
  prev.addEventListener('click', () => { act(() => player?.step(-1)); play.textContent = 'Play'; });
  next.addEventListener('click', () => { act(() => player?.step(1)); play.textContent = 'Play'; });
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

  const ready = (async () => {
    const results = await Promise.allSettled((deps.ids ?? TRACE_IDS).map(async (id) => [id, await load(id)] as const));
    for (const r of results) if (r.status === 'fulfilled') traces.set(r.value[0], r.value[1]);
    if (traces.size === 0) {
      el.replaceChildren(Object.assign(document.createElement('div'), { className: 'player-empty', textContent: NO_TRACE_TEXT }));
      return;
    }
    for (const [id, t] of traces) promptSel.append(new Option(`${id}: ${t.provenance.prompt}`, id));
    el.replaceChildren(controls, where, details);
    fillTokens(promptSel.value);
    build(promptSel.value, Number(tokenSel.value));
  })();

  return { element: el, ready, tick: (dt) => { player?.tick(dt); if (player && !player.playing() && play.textContent === 'Pause') play.textContent = 'Play'; }, player: () => player, selection: () => (traces.size > 0 ? { promptId: promptSel.value, position: Number(tokenSel.value) } : null) };
}

