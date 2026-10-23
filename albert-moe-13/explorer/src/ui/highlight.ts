import * as THREE from 'three';
import type { ComponentId } from '../scene/ids';

/** Colour factor of everything that does not match a highlight. */
export const HIGHLIGHT_DIM = 0.15;

export type IdPredicate = (id: ComponentId) => boolean;

export interface Highlighter {
  /** Dims every component for which `pred` is false; null restores all colours. Never moves the camera. */
  show(pred: IdPredicate | null): void;
  active(): boolean;
}

interface Saved {
  restore(): void;
}

/**
 * Highlights components by dimming the others. Instanced parts are dimmed per instance through their
 * instance colours (a copy is kept and written back), single meshes and the lanes through their
 * material colour. No objects or materials are created, and nothing runs per frame.
 */
export function createHighlighter(roots: () => THREE.Object3D[]): Highlighter {
  let saved: Saved[] = [];
  // Restored in reverse, so the oldest saved colour is the one that stays.
  const restore = (): void => {
    for (let i = saved.length - 1; i >= 0; i--) saved[i]!.restore();
    saved = [];
  };
  // A material shared by several parts is dimmed once per show.
  let seen = new Set<THREE.Material>();
  const dimMaterial = (o: THREE.Object3D): void => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const c = (mat as THREE.MeshBasicMaterial).color as THREE.Color | undefined;
      if (!c || seen.has(mat)) continue;
      seen.add(mat);
      const was = c.clone();
      c.multiplyScalar(HIGHLIGHT_DIM);
      saved.push({ restore: () => c.copy(was) });
    }
  };
  return {
    show(pred) {
      restore();
      seen = new Set();
      if (!pred) return;
      for (const root of roots()) {
        root.traverse((o) => {
          const ids = o.userData.ids as ComponentId[] | undefined;
          if (!ids || ids.length === 0) return;
          const im = o as THREE.InstancedMesh;
          if (im.isInstancedMesh && im.instanceColor) {
            const attr = im.instanceColor;
            const copy = (attr.array as Float32Array).slice();
            let changed = false;
            for (let i = 0; i < ids.length; i++) {
              if (pred(ids[i]!)) continue;
              for (let k = 0; k < 3; k++) attr.array[i * 3 + k] = copy[i * 3 + k]! * HIGHLIGHT_DIM;
              changed = true;
            }
            if (!changed) return;
            attr.needsUpdate = true;
            saved.push({ restore: () => { (attr.array as Float32Array).set(copy); attr.needsUpdate = true; } });
            return;
          }
          if (!pred(ids[0]!)) dimMaterial(o);
        });
      }
    },
    active: () => saved.length > 0,
  };
}
