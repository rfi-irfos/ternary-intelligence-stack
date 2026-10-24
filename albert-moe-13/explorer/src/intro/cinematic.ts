import * as THREE from 'three';
import type { CameraPose, CameraRig } from '../camera/controls';
import type { Architecture } from '../data/architecture';
import { embedId, slabId } from '../scene/ids';
import type { TowerScene } from '../scene/tower';
import { onPrefsChange, t } from '../ui/prefs';
import { richT } from '../ui/richText';

/**
 * First-visit intro: a slow, calm dolly along the row, from the embedding past the layers (a short
 * pause at each fusion slab's gate arc) to the overview, with one line naming the model and its counts.
 * It plays after the visitor chose Explore or Watch in the lobby, once per browser. Any input skips it
 * (the camera then cuts to the overview); reduced motion skips it entirely. Every position comes from
 * the tower (anchors, slabX) and every count from architecture.json.
 */

export const INTRO_KEY = 'albert.introSeen';

/** View direction of the dolly (from the target back to the camera): beside lane A, a little above. */
const DOLLY_DIR = new THREE.Vector3(-0.55, -1, 0.42).normalize();
/** Camera distance of the dolly: a few slabs fill the view. */
const DOLLY_DISTANCE = 15;
/** Duration of the first move onto the embedding (ms). */
const OPEN_MS = 2200;
/** Duration of the whole travel from the embedding to the last fusion slab (ms), shared by distance. */
const TRAVEL_MS = 13000;
/** Pause at each fusion slab (ms). */
const HOLD_MS = 500;
/** The closing pull back to the overview (ms). */
const CLOSE_MS = 2500;

export interface IntroStep {
  /** null = the overview pose of the rig (fitted to the HUD at fly time). */
  pose: CameraPose | null;
  /** Flight duration (ms). */
  ms: number;
  /** Pause after arriving (ms). */
  hold: number;
  /** What the step looks at (a component id, or "overview"). */
  at: string;
}

function poseAt(target: THREE.Vector3): CameraPose {
  return { target: target.clone(), position: target.clone().addScaledVector(DOLLY_DIR, DOLLY_DISTANCE) };
}

/**
 * The intro path: the embedding, then every fusion slab in row order (a brief hold at each), then the
 * overview. The travel time between two stops follows their distance along the row.
 */
export function introPath(tower: Pick<TowerScene, 'anchor' | 'slabX'>, a: Pick<Architecture, 'model'>): IntroStep[] {
  const fusion = [...a.model.fusion_layers].sort((x, y) => x - y);
  const start = tower.anchor(embedId());
  const steps: IntroStep[] = [{ pose: poseAt(start), ms: OPEN_MS, hold: HOLD_MS, at: embedId() }];
  const xs = fusion.map((l) => tower.slabX(l));
  const total = Math.max((xs[xs.length - 1] ?? start.x) - start.x, 1e-6);
  let prev = start.x;
  fusion.forEach((l, k) => {
    const x = xs[k] as number;
    const target = tower.anchor(slabId(l));
    steps.push({ pose: poseAt(target), ms: Math.round((TRAVEL_MS * Math.abs(x - prev)) / total), hold: HOLD_MS, at: slabId(l) });
    prev = x;
  });
  steps.push({ pose: null, ms: CLOSE_MS, hold: 0, at: 'overview' });
  return steps;
}

/** Total length of a path in ms. */
export const introLength = (steps: IntroStep[]): number => steps.reduce((s, x) => s + x.ms + x.hold, 0);

function store(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const introSeen = (s: Pick<Storage, 'getItem'> | null = store()): boolean => s?.getItem(INTRO_KEY) === '1';

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface IntroOptions {
  doc?: Document;
  store?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reducedMotion?: boolean;
  /** Waits `ms` (default setTimeout); the hold between flights. */
  wait?: (ms: number) => Promise<void>;
}

/** True when the intro would play: not seen yet in this browser and no reduced motion. */
export function shouldPlayIntro(opts: IntroOptions = {}): boolean {
  const s = opts.store === undefined ? store() : opts.store;
  return !introSeen(s) && !(opts.reducedMotion ?? prefersReducedMotion());
}

/** The one caption line: "albert.: 46 layers, 2 streams, 12 shared experts, 331,140,622 parameters". */
export function introLine(a: Pick<Architecture, 'model'>): string {
  const m = a.model;
  return richT('intro.line', { layers: m.num_layers, streams: m.num_streams, experts: m.num_experts, params: m.params });
}

let running: { skip(): void } | null = null;
/** True while the intro plays. */
export const introPlaying = (): boolean => running !== null;
/** Skips a running intro (no-op otherwise). */
export const skipIntro = (): void => running?.skip();

/**
 * Plays the intro once. Resolves when it ends or is skipped; resolves at once (camera untouched) when
 * it was seen before or with reduced motion. Marks it seen either way it ran.
 */
export async function playIntro(
  rig: Pick<CameraRig, 'flyToPose' | 'overview'>,
  tower: Pick<TowerScene, 'anchor' | 'slabX'>,
  a: Pick<Architecture, 'model'>,
  opts: IntroOptions = {},
): Promise<void> {
  if (!shouldPlayIntro(opts) || running) return;
  const doc = opts.doc ?? document;
  const s = opts.store === undefined ? store() : opts.store;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const steps = introPath(tower, a);

  // A full-screen layer over the canvas: it takes every click and wheel, so a skip never picks a part.
  const el = doc.createElement('div');
  el.className = 'intro';
  el.setAttribute('role', 'presentation');
  const line = doc.createElement('p');
  line.className = 'intro-line';
  line.setAttribute('aria-live', 'polite');
  const hint = doc.createElement('p');
  hint.className = 'intro-skip';
  el.append(line, hint);
  const paint = (): void => {
    line.innerHTML = introLine(a);
    hint.textContent = t('intro.skip');
  };
  paint();
  const offPrefs = onPrefsChange(paint);
  doc.body.append(el);
  doc.body.classList.add('cinema');

  let skipped = false;
  let wake: (() => void) | null = null;
  const skip = (): void => {
    if (skipped) return;
    skipped = true;
    wake?.();
    // A cut, not a flight: the visitor asked to be done.
    void rig.overview(0);
  };
  // Capture phase: the key that skips never reaches the player (Space), the explode view or the rig (Esc).
  const onKey = (e: KeyboardEvent): void => {
    e.stopImmediatePropagation();
    e.preventDefault();
    skip();
  };
  const onPointer = (e: Event): void => {
    e.stopPropagation();
    e.preventDefault();
    skip();
  };
  doc.addEventListener('keydown', onKey, true);
  el.addEventListener('pointerdown', onPointer);
  el.addEventListener('wheel', onPointer, { passive: false });
  running = { skip };
  try { s?.setItem(INTRO_KEY, '1'); } catch { /* storage unavailable: it may play again */ }

  const hold = (ms: number): Promise<void> => (ms <= 0 || skipped ? Promise.resolve() : new Promise<void>((r) => {
    wake = r;
    void wait(ms).then(r);
  }));
  try {
    for (const step of steps) {
      if (skipped) break;
      if (step.pose) await rig.flyToPose(step.pose, step.ms);
      else await rig.overview(step.ms);
      if (skipped) break;
      await hold(step.hold);
    }
  } finally {
    running = null;
    wake = null;
    offPrefs();
    doc.removeEventListener('keydown', onKey, true);
    el.remove();
    doc.body.classList.remove('cinema');
  }
}
