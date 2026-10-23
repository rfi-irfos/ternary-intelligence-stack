import * as THREE from 'three';
import type { ComponentId } from '../scene/ids';

/** Pointer-up within this many pixels of pointer-down counts as a click, not an orbit drag. */
export const DRAG_PX = 4;

export const isClick = (down: { x: number; y: number }, up: { x: number; y: number }): boolean =>
  Math.hypot(up.x - down.x, up.y - down.y) <= DRAG_PX;

export interface PickingHandlers {
  /** Id under the screen point, or null for empty space. */
  pickAt(x: number, y: number): ComponentId | null;
  onPick(id: ComponentId): void;
  onEmpty(): void;
  onHover?(id: ComponentId | null): void;
}

/** A press longer than this is a hold, not a click. */
export const CLICK_MS = 1000;

/** Runs `cb` on the next animation frame (or at once where there is none). */
export const nextFrame = (cb: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cb());
  else cb();
};

/**
 * Hover raycasts are throttled to one per animation frame (`schedule`): a burst of pointermoves
 * between two frames costs one pick, at the last pointer position.
 *
 * Click = pointerdown AND pointerup on the canvas, same pointer, primary button, moved <= 4 px,
 * within CLICK_MS. A pointerup without a preceding canvas pointerdown never picks (tab activation,
 * focus clicks, a press that started elsewhere); the pending press is dropped on pointercancel,
 * window blur and when the page is hidden. Hover is evaluated only while no button is held.
 */
export function attachPicking(
  dom: HTMLElement,
  h: PickingHandlers,
  now: () => number = () => performance.now(),
  schedule: (cb: () => void) => void = nextFrame,
): () => void {
  let down: { x: number; y: number; id: number | undefined; t: number } | null = null;
  let hovered: ComponentId | null = null;
  let move: { x: number; y: number; buttons: number } | null = null;
  let pending = false;
  let detached = false;
  const pid = (e: MouseEvent): number | undefined => (e as PointerEvent).pointerId;
  const onDown = (e: MouseEvent): void => {
    down = e.button === 0 && (e as PointerEvent).isPrimary !== false
      ? { x: e.clientX, y: e.clientY, id: pid(e), t: now() }
      : null;
  };
  const onUp = (e: MouseEvent): void => {
    const d = down;
    down = null;
    if (e.button !== 0 || !d || d.id !== pid(e) || now() - d.t > CLICK_MS) return;
    if (!isClick(d, { x: e.clientX, y: e.clientY })) return;
    const id = h.pickAt(e.clientX, e.clientY);
    if (id) h.onPick(id);
    else h.onEmpty();
  };
  const cancel = (): void => {
    down = null;
  };
  const onVisibility = (): void => {
    if (dom.ownerDocument.hidden) down = null;
  };
  const hoverNow = (): void => {
    pending = false;
    const m = move;
    move = null;
    if (detached || !m || !h.onHover || m.buttons !== 0) return;
    const id = h.pickAt(m.x, m.y);
    if (id !== hovered) {
      hovered = id;
      h.onHover(id);
    }
  };
  const onMove = (e: MouseEvent): void => {
    if (!h.onHover || e.buttons !== 0) return;
    move = { x: e.clientX, y: e.clientY, buttons: e.buttons };
    if (pending) return;
    pending = true;
    schedule(hoverNow);
  };
  const onLeave = (): void => {
    move = null;
    if (hovered !== null && h.onHover) {
      hovered = null;
      h.onHover(null);
    }
  };
  const win = dom.ownerDocument.defaultView;
  dom.addEventListener('pointerleave', onLeave);
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', cancel);
  dom.addEventListener('pointermove', onMove);
  win?.addEventListener('blur', cancel);
  dom.ownerDocument.addEventListener('visibilitychange', onVisibility);
  return () => {
    detached = true;
    dom.removeEventListener('pointerleave', onLeave);
    dom.removeEventListener('pointerdown', onDown);
    dom.removeEventListener('pointerup', onUp);
    dom.removeEventListener('pointercancel', cancel);
    dom.removeEventListener('pointermove', onMove);
    win?.removeEventListener('blur', cancel);
    dom.ownerDocument.removeEventListener('visibilitychange', onVisibility);
  };
}

export interface RayHit {
  id: ComponentId;
  object: THREE.Object3D;
  instanceId?: number;
}

/** Raycasts `getRoot()`; glass slab planes only win when nothing solid is behind them. */
export function createRaycastPicker(
  camera: THREE.Camera,
  dom: HTMLElement,
  getRoot: () => THREE.Object3D,
  idOf: (hit: THREE.Intersection) => ComponentId | null,
): (x: number, y: number) => RayHit | null {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  return (x, y) => {
    const r = dom.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let slab: RayHit | null = null;
    for (const hit of ray.intersectObject(getRoot(), true)) {
      const id = idOf(hit);
      if (!id) continue;
      const rh: RayHit = { id, object: hit.object, instanceId: hit.instanceId };
      if (!/^L\d+$/.test(id)) return rh;
      slab ??= rh;
    }
    return slab;
  };
}

/** White outline around the hovered object (one reusable line object). */
export function createHover(scene: THREE.Scene): { show(hit: RayHit | null): void } {
  const edges = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  const line = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  line.visible = false;
  line.renderOrder = 10;
  line.matrixAutoUpdate = false;
  scene.add(line);
  const m = new THREE.Matrix4();
  return {
    show(hit) {
      const o = hit?.object as THREE.Mesh | undefined;
      if (!hit || !o || !o.geometry) {
        line.visible = false;
        return;
      }
      let g = edges.get(o.geometry);
      if (!g) edges.set(o.geometry, (g = new THREE.EdgesGeometry(o.geometry)));
      line.geometry = g;
      o.updateWorldMatrix(true, false);
      line.matrix.copy(o.matrixWorld);
      if (hit.instanceId !== undefined && (o as THREE.InstancedMesh).isInstancedMesh) {
        (o as THREE.InstancedMesh).getMatrixAt(hit.instanceId, m);
        line.matrix.multiply(m);
      }
      line.matrix.scale(new THREE.Vector3(1.06, 1.06, 1.06));
      line.matrixWorldNeedsUpdate = true;
      line.visible = true;
    },
  };
}
