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

export function createControls(camera: THREE.PerspectiveCamera, dom: HTMLElement, extent: RowExtent): CameraRig {
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

  const start = (toTarget: THREE.Vector3, toPos: THREE.Vector3, ms: number): Promise<void> => {
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
        dur: Math.max(ms, 0) / 1000,
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
      if (!hasInsets()) {
        const { target, distance } = overviewPose(camera.aspect, camera.fov, extent);
        return start(target, target.clone().addScaledVector(OVERVIEW_DIR, distance), ms);
      }
      const p = fit(overviewPoints(extent), OVERVIEW_DIR, 1.08);
      return start(p.target, p.position, ms);
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
      }
      controls.update();
    },
    isFlying: () => flight !== null,
    escapeGuard: null,
    dispose() {
      dom.ownerDocument.removeEventListener('keydown', onKey);
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

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !rig.escapeGuard?.()) void rig.overview();
  };
  dom.ownerDocument.addEventListener('keydown', onKey);
  return rig;
}
