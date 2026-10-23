import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Blender-authored modules (blender/build_modules.py). Geometry only: the
 * scene keeps its own materials (Task 11 applies role colours). The glb
 * material names (mod_glass, mod_edge, mod_expert, mod_attn, mod_router,
 * mod_ln, mod_gate, mod_end) are carried in `materialNames` for overrides.
 */
export type ModulePart =
  | 'glass' | 'frame' | 'expert' | 'attn' | 'router' | 'ln1' | 'ln2' | 'gate' | 'embed' | 'lm_head';

export interface Modules {
  /** Geometry per part, in the part's own local frame (origin = slot origin). */
  geo: Partial<Record<ModulePart, THREE.BufferGeometry>>;
  /** glb material name per part. */
  materialNames: Partial<Record<ModulePart, string>>;
  /** Node translation per slot name (slab-local coordinates), for checks. */
  slotPositions: Record<string, THREE.Vector3>;
}

export const MODULE_FILES = ['slab', 'slab_fusion', 'embed', 'lm_head'] as const;

const SLOT_PART: [RegExp, ModulePart][] = [
  [/^slot_expert_\d+$/, 'expert'],
  [/^slot_attn_[AB]$/, 'attn'],
  [/^slot_router_[AB]$/, 'router'],
  [/^slot_ln1_[AB]$/, 'ln1'],
  [/^slot_ln2_[AB]$/, 'ln2'],
  [/^slot_gate$/, 'gate'],
  [/^slot_embed$/, 'embed'],
  [/^slot_lm_head$/, 'lm_head'],
  [/^slab_glass$/, 'glass'],
  [/^slab_frame$/, 'frame'],
];

function collect(scene: THREE.Object3D, out: Modules): void {
  scene.traverse((o) => {
    const part = SLOT_PART.find(([re]) => re.test(o.name))?.[1];
    if (o.name.startsWith('slot_') || o.name.startsWith('lane_anchor_')) {
      out.slotPositions[o.name] = o.position.clone();
    }
    const mesh = o as THREE.Mesh;
    if (!part || !mesh.isMesh || out.geo[part]) return;
    out.geo[part] = mesh.geometry;
    const m = mesh.material as THREE.Material;
    if (m?.name) out.materialNames[part] = m.name;
  });
}

/** Parse glb byte buffers (slab, slab_fusion, embed, lm_head) into Modules. */
export async function parseModules(buffers: Record<(typeof MODULE_FILES)[number], ArrayBuffer>): Promise<Modules> {
  const loader = new GLTFLoader();
  const out: Modules = { geo: {}, materialNames: {}, slotPositions: {} };
  for (const f of MODULE_FILES) {
    const gltf = await loader.parseAsync(buffers[f], '');
    collect(gltf.scene, out);
  }
  return out;
}

/**
 * Fetch the four glbs. Resolves null (never throws) when any is missing or
 * unreadable, so callers fall back to procedural geometry.
 */
export async function loadModules(base = `${import.meta.env?.BASE_URL ?? '/'}assets/`): Promise<Modules | null> {
  try {
    const bufs = {} as Record<(typeof MODULE_FILES)[number], ArrayBuffer>;
    for (const f of MODULE_FILES) {
      const r = await fetch(`${base}${f}.glb`);
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      // Vite dev serves index.html for missing files; reject non-glb payloads.
      if (new Uint32Array(buf, 0, 1)[0] !== 0x46546c67) return null;
      bufs[f] = buf;
    }
    const m = await parseModules(bufs);
    for (const p of ['glass', 'frame', 'expert', 'attn', 'router', 'ln1', 'ln2', 'gate', 'embed', 'lm_head'] as const) {
      if (!m.geo[p]) return null;
    }
    return m;
  } catch {
    return null;
  }
}
