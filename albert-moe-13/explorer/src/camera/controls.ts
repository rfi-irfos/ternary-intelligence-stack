import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** X span the overview frames (embed through lm_head); comes from TowerScene.rowExtent. */
export interface RowExtent {
  minX: number;
  maxX: number;
}
const OVERVIEW_DIR = new THREE.Vector3(-0.45, -1, 0.5).normalize(); // front-left, slightly above

export interface CameraRig {
  readonly controls: OrbitControls;
  flyTo(target: THREE.Vector3, distance: number, ms?: number): Promise<void>;
  overview(ms?: number): Promise<void>;
  /** dt in seconds. */
  update(dt: number): void;
  isFlying(): boolean;
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

export function createControls(camera: THREE.PerspectiveCamera, dom: HTMLElement, extent: RowExtent): CameraRig {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true; // right-drag / two-finger pans
  controls.minDistance = 1.5;
  controls.maxDistance = 400;

  let flight: Flight | null = null;

  const finish = (f: Flight): void => {
    camera.position.copy(f.toPos);
    controls.target.copy(f.toTarget);
    controls.update();
    f.resolve();
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
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-9) dir.copy(OVERVIEW_DIR);
      dir.normalize();
      return start(target, target.clone().addScaledVector(dir, distance), ms);
    },
    overview(ms = 900) {
      const { target, distance } = overviewPose(camera.aspect, camera.fov, extent);
      return start(target, target.clone().addScaledVector(OVERVIEW_DIR, distance), ms);
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
    dispose() {
      dom.ownerDocument.removeEventListener('keydown', onKey);
      controls.dispose();
    },
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') void rig.overview();
  };
  dom.ownerDocument.addEventListener('keydown', onKey);
  return rig;
}
