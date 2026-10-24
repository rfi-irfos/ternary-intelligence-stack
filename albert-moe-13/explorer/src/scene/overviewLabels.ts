import * as THREE from 'three';
import { layerLabel, t } from '../ui/prefs';
import type { TowerScene } from './tower';
import { embedId, lmHeadId, slabId } from './ids';
import { defaultLabel } from './explode';

/**
 * The three pill labels of the overview (Simeon's mockup): "Eingabe" over the embedding, "Ausgabe" over
 * the output head and "Ebene N" over the selected layer, each with a thin leader line down to the part.
 * Same look as the labels of the exploded views (defaultLabel: dark fill, 1 px cyan-blue border). They
 * keep a constant size on screen (a 12 px text at every zoom, sizeAttenuation off), hang from their
 * leader tip, and hide while a level is open (the exploded view has its own labels).
 */
export interface OverviewLabels {
  group: THREE.Group;
  /** The layer named by "Ebene N" (code index), null hides that label. */
  setLayer(layer: number | null): void;
  /** Shows or hides all three (hidden while a level is exploded, in layer mode or in the lobby). */
  setVisible(on: boolean): void;
  /** Redraws the texts in the current language and mode. */
  refresh(): void;
  /** Keeps the pixel size when the viewport height changes. */
  resize(viewportHeight: number): void;
  names(): string[];
  dispose(): void;
}

/** Screen height of one label: 12 px text on the 64 px texture whose text is 30 px high at most. */
const TEXT_PX = 12;
const TEX_TEXT = 30;
const TEX_H = 64;
const TEX_W = 512;
/** Vertical field of view factor: scale 1 (sizeAttenuation off) is 1 / (2 tan(fov/2)) of the viewport height. */
const FOV_K = 2 * Math.tan(THREE.MathUtils.degToRad(45) / 2);

export function createOverviewLabels(deps: {
  tower: TowerScene;
  /** Label factory (tests inject a stub). */
  label?: (text: string) => THREE.Object3D;
  fov?: number;
}): OverviewLabels {
  const make = deps.label ?? ((text: string) => defaultLabel(text, 'structure'));
  const fovK = deps.fov ? 2 * Math.tan(THREE.MathUtils.degToRad(deps.fov) / 2) : FOV_K;
  const group = new THREE.Group();
  group.name = 'overview-labels';
  let layer: number | null = null;
  let visible = true;
  let height = typeof window === 'undefined' ? 720 : window.innerHeight;
  const top = new THREE.Box3().setFromObject(deps.tower.root).max.y + 0.4;
  const slots = new Map<'input' | 'layer' | 'output', THREE.Object3D | null>([['input', null], ['layer', null], ['output', null]]);

  const place = (kind: 'input' | 'layer' | 'output', text: string, at: THREE.Vector3 | null): void => {
    const old = slots.get(kind);
    if (old) {
      group.remove(old);
      disposeSprite(old);
    }
    slots.set(kind, null);
    if (!at) return;
    const s = make(text);
    s.position.set(at.x, top, at.z);
    if (s instanceof THREE.Sprite) {
      s.material.sizeAttenuation = false;
      s.center.set(0.5, 0); // the leader tip (bottom centre of the texture) sits on the point
      s.material.needsUpdate = true;
    }
    s.userData.overview = kind;
    group.add(s);
    slots.set(kind, s);
    scaleOne(s);
  };
  const scaleOne = (s: THREE.Object3D): void => {
    const h = (TEXT_PX / TEX_TEXT) * TEX_H / height * fovK;
    s.scale.set(h * (TEX_W / TEX_H), h, 1);
    s.visible = visible;
  };
  const build = (): void => {
    place('input', t('scene.input'), deps.tower.has(embedId()) ? deps.tower.anchor(embedId()) : null);
    place('output', t('scene.output'), deps.tower.has(lmHeadId()) ? deps.tower.anchor(lmHeadId()) : null);
    place('layer', t('scene.layer', { n: layerLabel(layer ?? 0) }), layer !== null && deps.tower.has(slabId(layer)) ? deps.tower.anchor(slabId(layer)) : null);
  };
  build();
  return {
    group,
    setLayer(l) {
      if (l === layer) return;
      layer = l;
      build();
    },
    setVisible(on) {
      visible = on;
      for (const s of slots.values()) if (s) s.visible = on;
    },
    refresh: build,
    resize(h) {
      height = Math.max(1, h);
      for (const s of slots.values()) if (s) scaleOne(s);
    },
    names: () => [...slots.entries()].filter(([, s]) => s).map(([k]) => k),
    dispose() {
      for (const s of slots.values()) if (s) disposeSprite(s);
      group.removeFromParent();
    },
  };
}

function disposeSprite(o: THREE.Object3D): void {
  if (o instanceof THREE.Sprite) {
    o.material.map?.dispose();
    o.material.dispose();
  }
}
