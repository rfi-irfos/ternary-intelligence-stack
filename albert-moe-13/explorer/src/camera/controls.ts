import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** X span the overview frames (embed through lm_head); comes from TowerScene.rowExtent. */
export interface RowExtent {
  minX: number;
  maxX: number;
}
const OVERVIEW_DIR = new THREE.Vector3(-0.45, -1, 0.5).normalize(); // front-left, slightly above

/** Screen pixels the HUD covers on each side; framing fits into the rest (the free rect). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** NDC bounds of the free rect, shrunk around its centre by `margin` (1 = edge to edge). */
export interface NdcRect { x0: number; x1: number; y0: number; y1: number }
export function freeRect(insets: Insets, width: number, height: number, margin = 1): NdcRect {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  let x0 = -1 + (2 * insets.left) / w;
  let x1 = 1 - (2 * insets.right) / w;
  let y0 = -1 + (2 * insets.bottom) / h;
  let y1 = 1 - (2 * insets.top) / h;
  // A HUD wider than the screen leaves no room: fall back to the whole view rather than fail.
  if (x1 - x0 < 0.2) { x0 = -1; x1 = 1; }
  if (y1 - y0 < 0.2) { y0 = -1; y1 = 1; }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x0: cx + (x0 - cx) / margin, x1: cx + (x1 - cx) / margin, y0: cy + (y0 - cy) / margin, y1: cy + (y1 - cy) / margin };
}

/**
 * Camera pose that keeps every point inside `rect` (NDC) when the camera looks along -`dir`
 * (pointing from the target back to the camera) with vertical half-angle `halfV` and aspect
 * `aspect`. Exact for perspective: for each screen axis the smallest distance c satisfies
 * px_i - px_j - k·x1·pz_i + k·x0·pz_j <= c·k·(x1 - x0) for all point pairs (k = tan of the half
 * angle, p in the camera basis); the sideways offset is then the middle of the feasible interval,
 * so the points sit centred in the free rect.
 */
export function fitPoints(points: THREE.Vector3[], dir: THREE.Vector3, up: THREE.Vector3, halfV: number, aspect: number, rect: NdcRect,
  near = 0.5): { target: THREE.Vector3; position: THREE.Vector3; distance: number } {
  const back = dir.clone().normalize();
  const f = back.clone().negate();
  let r = new THREE.Vector3().crossVectors(f, up);
  if (r.lengthSq() < 1e-9) r = new THREE.Vector3(1, 0, 0);
  r.normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  const o = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(points.length, 1));
  const rel = points.map((p) => { const d = p.clone().sub(o); return { x: d.dot(r), y: d.dot(u), z: d.dot(f) }; });
  const kV = Math.tan(halfV);
  const kH = kV * Math.max(aspect, 0.05);
  const need = (k: number, lo: number, hi: number, pick: (q: { x: number; y: number }) => number): number => {
    let c = -Infinity;
    for (const i of rel) for (const j of rel) c = Math.max(c, (pick(i) - pick(j) - k * hi * i.z + k * lo * j.z) / (k * (hi - lo)));
    return c;
  };
  let c = Math.max(need(kH, rect.x0, rect.x1, (q) => q.x), need(kV, rect.y0, rect.y1, (q) => q.y));
  c = Math.max(c, ...rel.map((q) => near - q.z));
  const mid = (k: number, lo: number, hi: number, pick: (q: { x: number; y: number }) => number): number => {
    let a = -Infinity;
    let b = Infinity;
    for (const q of rel) {
      a = Math.max(a, pick(q) - hi * k * (q.z + c));
      b = Math.min(b, pick(q) - lo * k * (q.z + c));
    }
    return (a + b) / 2;
  };
  const a = mid(kH, rect.x0, rect.x1, (q) => q.x);
  const b = mid(kV, rect.y0, rect.y1, (q) => q.y);
  const target = o.clone().addScaledVector(r, a).addScaledVector(u, b);
  return { target, position: target.clone().addScaledVector(back, c), distance: c };
}

/** The 8 corners of a box. */
export const boxCorners = (box: THREE.Box3): THREE.Vector3[] => {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
};

/**
 * A panel opened or closed (the visitor's own action): if the camera still sits at the overview pose,
 * refit the overview into the new free area (900 ms). A pose the visitor chose is never touched.
 */
export function refitOverview(rig: Pick<CameraRig, 'atOverview' | 'overview'>, ms = 900): boolean {
  if (!rig.atOverview()) return false;
  void rig.overview(ms);
  return true;
}

/**
 * Wires the refit to a side panel: every open or close (not a width drag) refits a camera that still sits at
 * the overview. Returns the unsubscribe function.
 */
export function refitOnToggle(panel: { isOpen(): boolean; onChange(cb: () => void): () => void }, rig: Pick<CameraRig, 'atOverview' | 'overview'>): () => void {
  let was = panel.isOpen();
  return panel.onChange(() => {
    if (panel.isOpen() === was) return;
    was = panel.isOpen();
    refitOverview(rig);
  });
}

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface CameraRig {
  readonly controls: OrbitControls;
  flyTo(target: THREE.Vector3, distance: number, ms?: number): Promise<void>;
  overview(ms?: number): Promise<void>;
  /** Current camera pose (copies). */
  pose(): CameraPose;
  /** Flies back to a pose taken with `pose()`. */
  flyToPose(p: CameraPose, ms?: number): Promise<void>;
  /** Flies along the current view direction until a box of half size (halfWidth x halfHeight) around `target` fills the free rect. */
  frame(target: THREE.Vector3, halfWidth: number, halfHeight: number, ms?: number): Promise<void>;
  /** Flies along the current view direction until the whole box sits centred in the free rect. */
  frameBox(box: THREE.Box3, ms?: number): Promise<void>;
  /**
   * Screen pixels the HUD covers. Changing them never moves the camera; the next user-triggered
   * flight (flyTo, frame, frameBox, overview) fits into the free rect.
   */
  setInsets(insets: Insets): void;
  /**
   * Where the insets come from at fly time: every flight (flyTo, frame, frameBox, overview) and
   * `insets()` read the provider first, so a panel that opened in the same task is already counted
   * (no stale insets from a deferred measure). Reading it never moves the camera.
   */
  setInsetsProvider(provider: (() => Insets) | null): void;
  insets(): Insets;
  /** Called when the camera comes to rest: a flight ends, or (after a short pause) a user drag ends. */
  onSettle(cb: () => void): () => void;
  /** dt in seconds. */
  update(dt: number): void;
  isFlying(): boolean;
  /**
   * When set and returning true, Esc is left to another owner (the explode view reassembles one
   * level); the rig only flies to overview on Esc when this is unset or returns false.
   */
  escapeGuard: (() => boolean) | null;
  /**
   * True while the camera is at the overview pose of the last overview flight: no flight to another pose
   * and no user orbit, pan or zoom since. The app uses it to refit the overview when a panel opens or
   * closes (a user action) without ever touching a pose the visitor chose.
   */
  atOverview(): boolean;
  dispose(): void;
}

interface Flight {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
  dur: number;
  resolve: () => void;
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Camera pose that shows embed, all slabs and lm_head. */
export function overviewPose(aspect: number, fovDeg: number, extent: RowExtent): { target: THREE.Vector3; distance: number } {
  const len = extent.maxX - extent.minX;
  const target = new THREE.Vector3((extent.minX + extent.maxX) / 2, 0, 0);
  // Row length seen across the view direction, plus margin for perspective depth.
  const apparent = len * Math.sqrt(1 - OVERVIEW_DIR.x * OVERVIEW_DIR.x);
  const halfV = THREE.MathUtils.degToRad(fovDeg) / 2;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 0.2));
  const distance = (apparent / 2) / Math.tan(halfH) * 1.25 + len * 0.12;
  return { target, distance };
}

/** Half size of a slab across the row (tower.ts: SLAB_WIDTH 6 in y, SLAB_HEIGHT 4 in z), with the lanes. */
const ROW_HALF_Y = 3.5;
const ROW_HALF_Z = 2.5;

/** Points the overview keeps in view: both row ends with the slab half size around them. */
export function overviewPoints(extent: RowExtent): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [extent.minX, extent.maxX]) for (const y of [-ROW_HALF_Y, ROW_HALF_Y]) for (const z of [-ROW_HALF_Z, ROW_HALF_Z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

export interface ControlsOptions {
  /** True when the visitor prefers reduced motion: every flight then cuts to its pose. Defaults to the media query. */
  reducedMotion?: () => boolean;
  /** False while the keys must not fly the camera (lobby, intro, a dialog). Defaults to always true. */
  keysEnabled?: () => boolean;
}

/** Fly keys by physical position (so they work on every layout): W/S forward and back, A/D left and right, Q/E down and up. */
export const FLY_KEYS: Readonly<Record<string, { fwd?: number; right?: number; up?: number }>> = {
  KeyW: { fwd: 1 }, KeyS: { fwd: -1 }, KeyD: { right: 1 }, KeyA: { right: -1 }, KeyE: { up: 1 }, KeyQ: { up: -1 },
};
/** Flying speed in view distances per second, and the Shift boost. */
export const FLY_SPEED = 0.8;
export const FLY_BOOST = 3;

export function createControls(camera: THREE.PerspectiveCamera, dom: HTMLElement, extent: RowExtent, opts: ControlsOptions = {}): CameraRig {
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = opts.reducedMotion ?? ((): boolean => motionQuery?.matches ?? false);
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true; // right-drag / two-finger pans
  controls.minDistance = 1.5;
  controls.maxDistance = 400;

  let flight: Flight | null = null;
  let hud: Insets = { ...NO_INSETS };
  let provider: (() => Insets) | null = null;
  const clampInsets = (i: Insets): Insets =>
    ({ top: Math.max(0, i.top), right: Math.max(0, i.right), bottom: Math.max(0, i.bottom), left: Math.max(0, i.left) });
  /** The HUD insets of this moment (from the provider when there is one). */
  const pull = (): void => {
    if (provider) hud = clampInsets(provider());
  };
  const settled = new Set<() => void>();
  const settle = (): void => settled.forEach((cb) => cb());
  const viewSize = (): { w: number; h: number } => {
    const el = dom as HTMLElement & { clientWidth?: number };
    const w = el.clientWidth || (typeof window === 'undefined' ? 0 : window.innerWidth) || 1;
    const h = el.clientHeight || (typeof window === 'undefined' ? 0 : window.innerHeight) || 1;
    return { w, h };
  };
  const hasInsets = (): boolean => hud.top + hud.right + hud.bottom + hud.left > 0;
  const viewDir = (): THREE.Vector3 => {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-9) dir.copy(OVERVIEW_DIR);
    return dir.normalize();
  };
  /** Pose that shows `points` centred in the free rect, looking along -`dir`. */
  const fit = (points: THREE.Vector3[], dir: THREE.Vector3, margin: number) => {
    const { w, h } = viewSize();
    return fitPoints(points, dir, camera.up, THREE.MathUtils.degToRad(camera.fov) / 2, camera.aspect, freeRect(hud, w, h, margin));
  };

  const finish = (f: Flight): void => {
    camera.position.copy(f.toPos);
    controls.target.copy(f.toTarget);
    controls.update();
    f.resolve();
    settle();
  };

  // Fly keys (a user action, so the camera may move): camera and pivot move together, speed scales with the
  // distance to the pivot so it feels the same near a slab and far out.
  const held = new Set<string>();
  let boost = false;
  let flyTimer: ReturnType<typeof setTimeout> | null = null;
  const doc = dom.ownerDocument;
  const typing = (t: EventTarget | null): boolean => {
    const n = t as HTMLElement | null;
    return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
  };
  const onFlyDown = (e: KeyboardEvent): void => {
    if (!(e.code in FLY_KEYS) || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (opts.keysEnabled && !opts.keysEnabled()) return;
    held.add(e.code);
    boost = e.shiftKey;
    e.preventDefault();
  };
  const onFlyUp = (e: KeyboardEvent): void => {
    boost = e.shiftKey;
    if (held.delete(e.code) && held.size === 0) {
      if (flyTimer) clearTimeout(flyTimer);
      flyTimer = setTimeout(() => { flyTimer = null; settle(); }, 500);
    }
  };
  const onFlyBlur = (): void => { held.clear(); };
  doc.addEventListener('keydown', onFlyDown);
  doc.addEventListener('keyup', onFlyUp);
  if (typeof window !== 'undefined') window.addEventListener('blur', onFlyBlur);
  const flyDir = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  const fly = (dt: number): void => {
    if (held.size === 0) return;
    if (opts.keysEnabled && !opts.keysEnabled()) { held.clear(); return; }
    let fwd = 0, right = 0, up = 0;
    for (const c of held) { const k = FLY_KEYS[c]!; fwd += k.fwd ?? 0; right += k.right ?? 0; up += k.up ?? 0; }
    if (fwd === 0 && right === 0 && up === 0) return;
    flyDir.copy(controls.target).sub(camera.position);
    const dist = Math.max(flyDir.length(), 6);
    if (flyDir.lengthSq() < 1e-9) flyDir.copy(OVERVIEW_DIR).negate();
    flyDir.normalize();
    flyRight.crossVectors(flyDir, camera.up).normalize();
    flyMove.set(0, 0, 0).addScaledVector(flyDir, fwd).addScaledVector(flyRight, right).addScaledVector(camera.up, up);
    flyMove.multiplyScalar(dist * FLY_SPEED * (boost ? FLY_BOOST : 1) * Math.min(dt, 0.1));
    camera.position.add(flyMove);
    controls.target.add(flyMove);
  };

  let atOv = false;
  let ovDest: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  const start = (toTarget: THREE.Vector3, toPos: THREE.Vector3, ms: number): Promise<void> => {
    atOv = false; // overview() sets it again right after it started its own flight
    if (flight) {
      const old = flight;
      flight = null;
      old.resolve(); // cancelled: resolve so awaiting callers continue
    }
    return new Promise<void>((resolve) => {
      const f: Flight = {
        fromPos: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPos: toPos.clone(),
        toTarget: toTarget.clone(),
        elapsed: 0,
        // Reduced motion: every flight (tours, links, Home, Esc) is a cut; the camera moves only by the visitor's own drag.
        dur: reduced() ? 0 : Math.max(ms, 0) / 1000,
        resolve,
      };
      if (f.dur === 0) {
        finish(f);
        controls.enabled = true;
        return;
      }
      flight = f;
      controls.enabled = false;
    });
  };

  const rig: CameraRig = {
    controls,
    flyTo(target, distance, ms = 900) {
      pull();
      const dir = viewDir();
      if (!hasInsets()) return start(target, target.clone().addScaledVector(dir, distance), ms);
      // The point lands in the middle of the free rect, and what filled the view fills the free rect.
      const { w, h } = viewSize();
      const rect = freeRect(hud, w, h);
      const scale = Math.max(2 / (rect.x1 - rect.x0), 2 / (rect.y1 - rect.y0));
      const d = distance * scale;
      const halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
      const kV = Math.tan(halfV);
      const kH = kV * Math.max(camera.aspect, 0.05);
      const f = dir.clone().negate();
      const r = new THREE.Vector3().crossVectors(f, camera.up);
      if (r.lengthSq() < 1e-9) r.set(1, 0, 0);
      r.normalize();
      const u = new THREE.Vector3().crossVectors(r, f).normalize();
      const cx = (rect.x0 + rect.x1) / 2;
      const cy = (rect.y0 + rect.y1) / 2;
      const aim = target.clone().addScaledVector(r, -cx * d * kH).addScaledVector(u, -cy * d * kV);
      return start(aim, aim.clone().addScaledVector(dir, d), ms);
    },
    pose: () => ({ position: camera.position.clone(), target: controls.target.clone() }),
    flyToPose: (p, ms = 900) => start(p.target, p.position, ms),
    frame(target, halfWidth, halfHeight, ms = 900) {
      pull();
      const dir = viewDir();
      if (!hasInsets()) {
        const halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
        const halfH = Math.atan(Math.tan(halfV) * Math.max(camera.aspect, 0.2));
        const distance = Math.max(halfHeight / Math.tan(halfV), halfWidth / Math.tan(halfH)) * 1.15;
        return start(target, target.clone().addScaledVector(dir, distance), ms);
      }
      // A flat rectangle facing the camera, fitted like a box.
      const f = dir.clone().negate();
      const r = new THREE.Vector3().crossVectors(f, camera.up);
      if (r.lengthSq() < 1e-9) r.set(1, 0, 0);
      r.normalize();
      const u = new THREE.Vector3().crossVectors(r, f).normalize();
      const pts = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => target.clone().addScaledVector(r, sx * halfWidth).addScaledVector(u, sy * halfHeight)));
      const p = fit(pts, dir, 1.15);
      return start(p.target, p.position, ms);
    },
    frameBox(box, ms = 900) {
      pull();
      const p = fit(boxCorners(box), viewDir(), 1.15);
      return start(p.target, p.position, ms);
    },
    setInsets(insets) {
      hud = clampInsets(insets);
    },
    setInsetsProvider(p) {
      provider = p;
    },
    insets: () => {
      pull();
      return { ...hud };
    },
    onSettle(cb) {
      settled.add(cb);
      return () => settled.delete(cb);
    },
    overview(ms = 900) {
      pull();
      let flown: Promise<void>;
      if (!hasInsets()) {
        const { target, distance } = overviewPose(camera.aspect, camera.fov, extent);
        flown = start(target, target.clone().addScaledVector(OVERVIEW_DIR, distance), ms);
      } else {
        const p = fit(overviewPoints(extent), OVERVIEW_DIR, 1.08);
        flown = start(p.target, p.position, ms);
      }
      atOv = true;
      // Where this overview ends: the pose to compare with later (a flight still running counts as "at it").
      ovDest = flight ? { pos: flight.toPos.clone(), target: flight.toTarget.clone() } : { pos: camera.position.clone(), target: controls.target.clone() };
      return flown;
    },
    atOverview: () => {
      if (!atOv) return false;
      if (flight || !ovDest) return true;
      // A plain click on the canvas also fires the controls' 'start' event, so the flag alone is not enough:
      // the pose itself must still be the overview's (an orbit, pan or zoom moves it).
      const tol = 0.005 * Math.max(1, ovDest.pos.distanceTo(ovDest.target));
      return camera.position.distanceTo(ovDest.pos) < tol && controls.target.distanceTo(ovDest.target) < tol;
    },
    update(dt) {
      const f = flight;
      if (f) {
        f.elapsed += dt;
        const s = Math.min(f.elapsed / f.dur, 1);
        if (s >= 1) {
          flight = null;
          finish(f);
          controls.enabled = true;
          return;
        }
        const k = easeInOutCubic(s);
        camera.position.lerpVectors(f.fromPos, f.toPos, k);
        controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      } else {
        fly(dt);
      }
      controls.update();
    },
    isFlying: () => flight !== null,
    escapeGuard: null,
    dispose() {
      dom.ownerDocument.removeEventListener('keydown', onKey);
      doc.removeEventListener('keydown', onFlyDown);
      doc.removeEventListener('keyup', onFlyUp);
      if (typeof window !== 'undefined') window.removeEventListener('blur', onFlyBlur);
      if (flyTimer) clearTimeout(flyTimer);
      controls.removeEventListener('end', onDragEnd);
      if (dragTimer) clearTimeout(dragTimer);
      settled.clear();
      controls.dispose();
    },
  };

  // A user drag ends; damping still glides the camera for a moment, so the settle waits for it.
  let dragTimer: ReturnType<typeof setTimeout> | null = null;
  const onDragEnd = (): void => {
    if (dragTimer) clearTimeout(dragTimer);
    dragTimer = setTimeout(() => { dragTimer = null; settle(); }, 500);
  };
  controls.addEventListener('end', onDragEnd);
  // Orbit, pan and zoom by the visitor move the pose, and atOverview() compares it with the overview's. A click
  // without a drag moves nothing, so it leaves the flag alone.

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !rig.escapeGuard?.()) void rig.overview();
  };
  dom.ownerDocument.addEventListener('keydown', onKey);
  return rig;
}
