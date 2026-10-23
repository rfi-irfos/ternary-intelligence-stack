import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Modules } from './modules';
import { PALETTE, streamColor } from './palette';
import { RENDER_ORDER, instancedEdges, lookMaterial, markBloom, type LookRole } from './materials';
import type { Architecture } from '../data/architecture';
import {
  type ComponentId, type Stream,
  attnId, embedId, expertId, gateId, ln1Id, ln2Id, lmHeadId, lnFId, parseId, routerId, shaftId, slabId,
} from './ids';

export { streamColor };

/* Layout constants (spec 4.2b). Row runs along +X; slabs are YZ planes. Colours: palette.ts. */

export const SLAB_PITCH = 3;
export const SLAB_WIDTH = 6; // Y
export const SLAB_HEIGHT = 4; // Z
export const LANE_Y: Record<Stream, number> = { A: -1.8, B: 1.8 };
export const LANE_Z = -1.2;
/** Gate arc sits beside the expert bank in X so it never crosses an expert box. */
export const GATE_X_OFFSET = 0.45;
export const EXPERT_SIZE = 0.4;
export const EXPERT_HALF = EXPERT_SIZE / 2;
export function gateArc(x: number): THREE.QuadraticBezierCurve3 {
  const gx = x + GATE_X_OFFSET;
  return new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(gx, LANE_Y.A, LANE_Z),
    new THREE.Vector3(gx, 0, 2.6),
    new THREE.Vector3(gx, LANE_Y.B, LANE_Z),
  );
}
const EXPERT_COLS = 3; // along Y
const EXPERT_ROWS = 4; // along Z

export interface RowExtent {
  minX: number;
  maxX: number;
}

export interface TowerScene {
  root: THREE.Group;
  /** Number of layer slabs. */
  readonly layerCount: number;
  /** X span of the row, embed centre through lm_head centre. */
  readonly rowExtent: RowExtent;
  /** x-centre of slab `layer`. */
  slabX(layer: number): number;
  anchor(id: ComponentId): THREE.Vector3;
  has(id: ComponentId): boolean;
  pick(intersection: THREE.Intersection): ComponentId | null;
  counts(): Record<string, number>;
}

interface Item {
  id: ComponentId;
  pos: THREE.Vector3;
}

const STREAMS: Stream[] = ['A', 'B'];
const tmp = new THREE.Object3D();

function instanced(
  name: string,
  geo: THREE.BufferGeometry,
  items: Item[],
  colorOf: (item: Item) => number,
  mat: THREE.Material,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.name = name;
  const c = new THREE.Color();
  items.forEach((it, i) => {
    tmp.position.copy(it.pos);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
    mesh.setColorAt(i, c.setHex(colorOf(it)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.userData.ids = items.map((it) => it.id);
  mesh.computeBoundingSphere();
  return mesh;
}

/** Glass parts with white outlines (spec 4.2b: no opaque solid cubes). Tint = role colour. */
function glassPart(
  name: string, geo: THREE.BufferGeometry, items: Item[], colorOf: (item: Item) => number,
  mat: THREE.Material, edgeMat: THREE.Material,
): THREE.InstancedMesh {
  const mesh = instanced(name, geo, items, colorOf, mat);
  mesh.userData.look = 'part-glass' satisfies LookRole;
  mesh.renderOrder = RENDER_ORDER.part;
  instancedEdges(mesh, edgeMat);
  return mesh;
}

/** Stream colour of a per-stream part (attention, norms). */
const itemStream = (it: Item): number => streamColor(it.id.includes('.B.') ? 'B' : 'A');

/**
 * The module frame copied to every slab and merged into one geometry. Each copy is disposed after
 * the merge; null when the merge fails (the caller keeps the procedural lines).
 */
function mergedFrames(frame: THREE.BufferGeometry, n: number, slabX: (l: number) => number): THREE.BufferGeometry | null {
  const copies = Array.from({ length: n }, (_, l) => frame.clone().translate(slabX(l), 0, 0));
  const merged = mergeGeometries(copies, false);
  for (const c of copies) c.dispose();
  return merged;
}

/** `modules` (Blender glbs) replace the procedural geometry; layout and ids are identical. */
export function buildTower(a: Architecture, modules?: Modules | null): TowerScene {
  const mg = modules?.geo;
  const n = a.model.num_layers;
  const slabX = (layer: number): number => layer * SLAB_PITCH;
  const anchors = new Map<ComponentId, THREE.Vector3>();
  const root = new THREE.Group();
  root.name = 'tower';

  const add = (id: ComponentId, pos: THREE.Vector3): Item => {
    anchors.set(id, pos.clone());
    return { id, pos };
  };

  // Slabs: glass planes (material per quality, look.ts) + thin white outlines.
  let slabGeo: THREE.BufferGeometry;
  if (mg?.glass) {
    slabGeo = mg.glass;
  } else {
    slabGeo = new THREE.PlaneGeometry(SLAB_HEIGHT, SLAB_WIDTH); // local X = Z-high, Y = width
    slabGeo.rotateY(Math.PI / 2); // plane normal along X; local (x,y,z) -> (0, width, height)
  }
  const slabs = new THREE.InstancedMesh(slabGeo, lookMaterial('slab-glass', 'low'), n);
  slabs.name = 'slabs';
  slabs.userData.ids = Array.from({ length: n }, (_, l) => slabId(l));
  slabs.userData.look = 'slab-glass' satisfies LookRole;
  const hw = SLAB_WIDTH / 2;
  const hh = SLAB_HEIGHT / 2;
  const edgePts: number[] = [];
  for (let l = 0; l < n; l++) {
    tmp.position.set(slabX(l), 0, 0);
    tmp.updateMatrix();
    slabs.setMatrixAt(l, tmp.matrix);
    const x = slabX(l);
    anchors.set(slabId(l), new THREE.Vector3(x, 0, 0));
    const c = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const;
    for (let k = 0; k < 4; k++) {
      const p = c[k]!;
      const q = c[(k + 1) % 4]!;
      edgePts.push(x, p[0], p[1], x, q[0], q[1]);
    }
  }
  slabs.renderOrder = RENDER_ORDER.slab;
  slabs.computeBoundingSphere();
  // One-pixel lines: they stay visible at overview distance, where the 0.02 module bars are sub-pixel.
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
  const lines = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: PALETTE.edge, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  lines.renderOrder = RENDER_ORDER.edge;
  let edges: THREE.Object3D = lines;
  const merged = mg?.frame ? mergedFrames(mg.frame, n, slabX) : null;
  if (merged) {
    // Module bars (one merged mesh) give the outline thickness up close; the lines ride along.
    edges = new THREE.Mesh(
      merged,
      new THREE.MeshBasicMaterial({ color: PALETTE.edge, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    edges.renderOrder = RENDER_ORDER.edge;
    lines.name = 'slab-edge-lines';
    edges.add(lines);
  }
  edges.name = 'slab-edges';
  root.add(slabs, edges);

  // Per-layer components.
  const experts: Item[] = [];
  const perType: Record<'attn' | 'router' | 'ln1' | 'ln2', Item[]> = { attn: [], router: [], ln1: [], ln2: [] };
  const offs = { ln1: -1.0, attn: -0.35, ln2: 0.3, router: 0.95 } as const;
  const gates: Item[] = [];
  const fusion = new Set(a.model.fusion_layers);
  const sp = 0.7;
  for (let l = 0; l < n; l++) {
    const x = slabX(l);
    for (let e = 0; e < a.model.num_experts; e++) {
      const col = e % EXPERT_COLS;
      const row = Math.floor(e / EXPERT_COLS) % EXPERT_ROWS;
      experts.push(add(expertId(l, e), new THREE.Vector3(x, (col - 1) * sp, (row - 1.5) * sp + 0.4)));
    }
    for (const s of STREAMS) {
      const y = LANE_Y[s];
      perType.ln1.push(add(ln1Id(l, s), new THREE.Vector3(x + offs.ln1, y, LANE_Z)));
      perType.attn.push(add(attnId(l, s), new THREE.Vector3(x + offs.attn, y, LANE_Z)));
      perType.ln2.push(add(ln2Id(l, s), new THREE.Vector3(x + offs.ln2, y, LANE_Z)));
      perType.router.push(add(routerId(l, s), new THREE.Vector3(x + offs.router, y, LANE_Z)));
    }
    if (fusion.has(l)) gates.push(add(gateId(l), gateArc(x).getPoint(0.5)));
  }

  // One glass material shared by every part mesh; the per-instance colour carries the role.
  const partMat = lookMaterial('part-glass', 'low');
  const edgeMat = lookMaterial('part-edge', 'low');
  root.add(
    glassPart('experts', mg?.expert ?? new THREE.BoxGeometry(EXPERT_SIZE, EXPERT_SIZE, EXPERT_SIZE), experts, () => PALETTE.expert, partMat, edgeMat),
    glassPart('attn', mg?.attn ?? new THREE.BoxGeometry(0.4, 0.5, 0.5), perType.attn, itemStream, partMat, edgeMat),
    glassPart('router', mg?.router ?? new THREE.OctahedronGeometry(0.2), perType.router, () => PALETTE.router, partMat, edgeMat),
    glassPart('ln1', mg?.ln1 ?? new THREE.BoxGeometry(0.1, 0.4, 0.3), perType.ln1, itemStream, partMat, edgeMat),
    glassPart('ln2', mg?.ln2 ?? new THREE.BoxGeometry(0.1, 0.4, 0.3), perType.ln2, itemStream, partMat, edgeMat),
  );

  // Gates: one red arc between the two lanes, instanced across fusion slabs (solid: it is a light path).
  if (gates.length > 0) {
    // Module gate geometry is centred on the arc midpoint (= the gate anchor).
    const arcGeo = mg?.gate ?? new THREE.TubeGeometry(gateArc(0), 24, 0.05, 6, false);
    const arcItems = gates.map((g) => ({
      id: g.id,
      pos: mg?.gate ? g.pos.clone() : new THREE.Vector3(g.pos.x - GATE_X_OFFSET, 0, 0),
    }));
    const gateMesh = instanced('gates', arcGeo, arcItems, () => PALETTE.gate,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }));
    gateMesh.renderOrder = RENDER_ORDER.gate;
    root.add(gateMesh);
  }

  // Embed, ln_f, lm_head at the row ends.
  const xEmbed = slabX(0) - SLAB_PITCH;
  const xLnF = slabX(n - 1) + SLAB_PITCH;
  const xHead = xLnF + SLAB_PITCH;
  const ends: [ComponentId, number, THREE.BufferGeometry][] = [
    [embedId(), xEmbed, mg?.embed ?? new THREE.BoxGeometry(0.8, 3.2, 2.4)],
    [lnFId(), xLnF, new THREE.BoxGeometry(0.15, 3.2, 1.6)],
    [lmHeadId(), xHead, mg?.lm_head ?? new THREE.BoxGeometry(0.8, 3.2, 2.4)],
  ];
  for (const [id, x, geo] of ends) {
    const it = add(id, new THREE.Vector3(x, 0, 0));
    root.add(glassPart(id, geo, [it], () => PALETTE.neutral, partMat, edgeMat));
  }

  // Lanes: the two light lines running the full row (A cyan, B amber); they feed the bloom.
  const len = xHead - xEmbed;
  for (const s of STREAMS) {
    const geo = new THREE.CylinderGeometry(0.035, 0.035, len, 8);
    geo.rotateZ(Math.PI / 2); // axis Y -> X
    const it = add(shaftId(s), new THREE.Vector3((xEmbed + xHead) / 2, LANE_Y[s], LANE_Z));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: streamColor(s) }));
    m.name = shaftId(s);
    m.position.copy(it.pos);
    m.userData.ids = [it.id];
    markBloom(m);
    root.add(m);
  }

  const counts = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const id of anchors.keys()) {
      const p = parseId(id);
      if (!p || p.type === 'shaft' || p.type === 'slab') continue;
      out[p.type] = (out[p.type] ?? 0) + 1;
    }
    return out;
  };

  return {
    root,
    layerCount: n,
    rowExtent: { minX: xEmbed, maxX: xHead },
    slabX,
    has: (id) => anchors.has(id),
    anchor(id) {
      const v = anchors.get(id);
      if (!v) throw new Error(`unknown component id: ${id}`);
      return v.clone();
    },
    pick(hit) {
      const ids = hit.object.userData.ids as ComponentId[] | undefined;
      if (!ids) return null;
      return ids[hit.instanceId ?? 0] ?? null;
    },
    counts,
  };
}
