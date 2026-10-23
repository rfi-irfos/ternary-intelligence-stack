import * as THREE from 'three';
import type { Modules } from './modules';
import { PALETTE, streamColor } from './palette';
import {
  INSTANCE_FADE, RENDER_ORDER, instancedEdges, lookMaterial, markBloom, sharedInstanceLines, withInstanceFade, type LookRole,
} from './materials';
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

/** One place in the row: a layer slab (0..n-1) or one of the row ends. */
export type SlotKey = number | 'embed' | 'ln_f' | 'lm_head';

export interface TowerScene {
  root: THREE.Group;
  /** Number of layer slabs. */
  readonly layerCount: number;
  /** X span of the row, embed centre through lm_head centre (base layout, without shifts). */
  readonly rowExtent: RowExtent;
  /** x-centre of slab `layer` in the base layout (add `layerShift[layer]` for where it is drawn now). */
  slabX(layer: number): number;
  /** Where `id` is drawn now: the base anchor plus the x shift of its slot. */
  anchor(id: ComponentId): THREE.Vector3;
  has(id: ComponentId): boolean;
  pick(intersection: THREE.Intersection): ComponentId | null;
  counts(): Record<string, number>;
  /**
   * Per-layer x offset (world units) of everything that belongs to the layer: glass, frame, parts,
   * gate arc. Write it (explode.ts does), then call applyShift().
   */
  readonly layerShift: Float64Array;
  /** x offsets of the row ends. */
  readonly endShift: Record<'embed' | 'ln_f' | 'lm_head', number>;
  /** Slots in row order (embed, layers 0..n-1, ln_f, lm_head). */
  slots(): SlotKey[];
  /** Slot that holds `id` (null for the lanes, which span the row). */
  slotOf(id: ComponentId): SlotKey | null;
  shiftOf(slot: SlotKey): number;
  /** World AABB of everything drawn in a slot in the base layout (hidden instances included). */
  slotBaseBox(slot: SlotKey): THREE.Box3;
  /** World AABB of a slot where it is drawn now (base box moved by the slot's shift). */
  slotBox(slot: SlotKey): THREE.Box3;
  /** The lanes are cut between these x values (an exploded group sits there); null = continuous. */
  setLaneGap(gap: RowExtent | null): void;
  /**
   * Rewrites the instance matrices of every row element from the base layout plus the shifts
   * (hidden instances stay at scale 0), the lane segments, and the culling spheres. No new objects.
   */
  applyShift(): void;
  /**
   * Hides (scale 0) the instances of `target` and everything below it, and shows again whatever an
   * earlier call hid (it replaces, never accumulates); slab glass and gate arcs stay.
   */
  hide(target: ComponentId): void;
  unhide(): void;
  /** Called after every applyShift(); returns the unsubscribe function. */
  onShift(fn: () => void): () => void;
  /**
   * Opacity factor (1 = as is) of slab `layer`'s glass, frame and outline, applied per instance on
   * top of the material's opacity, so a quality swap or the row dim keeps it. No new materials.
   */
  setSlabFade(layer: number, f: number): void;
  slabFade(layer: number): number;
}

interface Item {
  id: ComponentId;
  pos: THREE.Vector3;
}

/** An instanced mesh whose instances move with their slot. */
interface Shiftable {
  mesh: THREE.InstancedMesh;
  /** Instance matrices of the base layout. */
  base: Float32Array;
  /** Internal slot index per instance (see slotIndex). */
  slot: Int16Array;
  hidden: Set<number>;
  /** Objects that share `mesh.instanceMatrix` and need their culling sphere refreshed. */
  followers: THREE.Object3D[];
  /** May be hidden by hide() (slab glass may not). */
  hideable: boolean;
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

const LANE_RADIUS = 0.035;
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** `modules` (Blender glbs) replace the procedural geometry; layout and ids are identical. */
export function buildTower(a: Architecture, modules?: Modules | null): TowerScene {
  const mg = modules?.geo;
  const n = a.model.num_layers;
  const slabX = (layer: number): number => layer * SLAB_PITCH;
  const anchors = new Map<ComponentId, THREE.Vector3>();
  const root = new THREE.Group();
  root.name = 'tower';

  // Internal slot index: 0 = embed, 1..n = layers, n+1 = ln_f, n+2 = lm_head (row order).
  const slotCount = n + 3;
  const slotIndex = (k: SlotKey): number => {
    if (k === 'embed') return 0;
    if (k === 'ln_f') return n + 1;
    if (k === 'lm_head') return n + 2;
    if (!Number.isInteger(k) || k < 0 || k >= n) throw new Error(`no slot for layer ${k}`);
    return k + 1;
  };
  const slotKey = (i: number): SlotKey => (i === 0 ? 'embed' : i === n + 1 ? 'ln_f' : i === n + 2 ? 'lm_head' : i - 1);
  const slotOf = (id: ComponentId): SlotKey | null => {
    const p = parseId(id);
    if (!p || p.type === 'shaft') return null;
    return 'layer' in p ? p.layer : p.type;
  };
  const layerShift = new Float64Array(n);
  const endShift = { embed: 0, ln_f: 0, lm_head: 0 };
  const shiftAt = (i: number): number => {
    const k = slotKey(i);
    return typeof k === 'number' ? layerShift[k] ?? 0 : endShift[k];
  };

  const add = (id: ComponentId, pos: THREE.Vector3): Item => {
    anchors.set(id, pos.clone());
    return { id, pos };
  };

  const shiftables: Shiftable[] = [];
  const register = (mesh: THREE.InstancedMesh, slots: number[], hideable = true): Shiftable => {
    const sh: Shiftable = {
      mesh, base: Float32Array.from(mesh.instanceMatrix.array), slot: Int16Array.from(slots),
      hidden: new Set(), followers: mesh.children.filter((c) => (c as unknown as { instanceMatrix?: unknown }).instanceMatrix === mesh.instanceMatrix),
      hideable,
    };
    shiftables.push(sh);
    return sh;
  };
  const slotsOfIds = (ids: ComponentId[]): number[] => ids.map((id) => {
    const k = slotOf(id);
    if (k === null) throw new Error(`no slot for ${id}`);
    return slotIndex(k);
  });

  // Slabs: glass planes (material per quality, look.ts) + thin white outlines.
  let slabGeo: THREE.BufferGeometry;
  if (mg?.glass) {
    slabGeo = mg.glass;
  } else {
    slabGeo = new THREE.PlaneGeometry(SLAB_HEIGHT, SLAB_WIDTH); // local X = Z-high, Y = width
    slabGeo.rotateY(Math.PI / 2); // plane normal along X; local (x,y,z) -> (0, width, height)
  }
  // One fade factor per slab, shared by the glass, the frame bars and the outline (explode.ts fades
  // the exploded slab and its nearest neighbours so their planes do not cut across the parts).
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  slabGeo.setAttribute(INSTANCE_FADE, fade);
  const slabs = new THREE.InstancedMesh(slabGeo, lookMaterial('slab-glass', 'low'), n);
  slabs.name = 'slabs';
  slabs.userData.ids = Array.from({ length: n }, (_, l) => slabId(l));
  slabs.userData.look = 'slab-glass' satisfies LookRole;
  for (let l = 0; l < n; l++) {
    tmp.position.set(slabX(l), 0, 0);
    tmp.updateMatrix();
    slabs.setMatrixAt(l, tmp.matrix);
    anchors.set(slabId(l), new THREE.Vector3(slabX(l), 0, 0));
  }
  slabs.renderOrder = RENDER_ORDER.slab;
  slabs.computeBoundingSphere();
  // One-pixel slab outlines, instanced on the slab matrices (they move with the slab). They stay
  // visible at overview distance, where the 0.02 module bars are sub-pixel.
  const hw = SLAB_WIDTH / 2;
  const hh = SLAB_HEIGHT / 2;
  const rect: number[] = [];
  const c4 = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const;
  for (let k = 0; k < 4; k++) {
    const p = c4[k]!;
    const q = c4[(k + 1) % 4]!;
    rect.push(0, p[0], p[1], 0, q[0], q[1]);
  }
  const lineMat = withInstanceFade(new THREE.LineBasicMaterial({ color: PALETTE.edge, transparent: true, opacity: 0.55, depthWrite: false }));
  lineMat.defines = { USE_INSTANCING: '' };
  const lines = sharedInstanceLines(slabs, new THREE.Float32BufferAttribute(rect, 3), lineMat);
  lines.geometry.setAttribute(INSTANCE_FADE, fade);
  slabs.remove(lines);
  const slabFollowers: THREE.Object3D[] = [lines];
  let edges: THREE.Object3D = lines;
  if (mg?.frame) {
    // Module bars give the outline thickness up close: one instanced mesh on the slab matrices.
    mg.frame.setAttribute(INSTANCE_FADE, fade);
    const frame = new THREE.InstancedMesh(
      mg.frame,
      withInstanceFade(new THREE.MeshBasicMaterial({ color: PALETTE.edge, transparent: true, opacity: 0.55, depthWrite: false })),
      n,
    );
    frame.instanceMatrix = slabs.instanceMatrix;
    frame.computeBoundingSphere();
    frame.renderOrder = RENDER_ORDER.edge;
    lines.name = 'slab-edge-lines';
    frame.add(lines);
    edges = frame;
    slabFollowers.push(frame);
  }
  edges.name = 'slab-edges';
  root.add(slabs, edges);
  const slabSh = register(slabs, slotsOfIds(slabs.userData.ids as ComponentId[]), false);
  slabSh.followers.push(...slabFollowers);

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
  const parts = [
    glassPart('experts', mg?.expert ?? new THREE.BoxGeometry(EXPERT_SIZE, EXPERT_SIZE, EXPERT_SIZE), experts, () => PALETTE.expert, partMat, edgeMat),
    glassPart('attn', mg?.attn ?? new THREE.BoxGeometry(0.4, 0.5, 0.5), perType.attn, itemStream, partMat, edgeMat),
    glassPart('router', mg?.router ?? new THREE.OctahedronGeometry(0.2), perType.router, () => PALETTE.router, partMat, edgeMat),
    glassPart('ln1', mg?.ln1 ?? new THREE.BoxGeometry(0.1, 0.4, 0.3), perType.ln1, itemStream, partMat, edgeMat),
    glassPart('ln2', mg?.ln2 ?? new THREE.BoxGeometry(0.1, 0.4, 0.3), perType.ln2, itemStream, partMat, edgeMat),
  ];
  for (const m of parts) {
    root.add(m);
    register(m, slotsOfIds(m.userData.ids as ComponentId[]));
  }

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
    register(gateMesh, slotsOfIds(gateMesh.userData.ids as ComponentId[]));
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
    const m = glassPart(id, geo, [it], () => PALETTE.neutral, partMat, edgeMat);
    root.add(m);
    register(m, slotsOfIds([id]));
  }

  // Base x of every slot (row order) and its base AABB (everything instanced in it).
  const slotBaseX = Array.from({ length: slotCount }, (_, i) => {
    const k = slotKey(i);
    return k === 'embed' ? xEmbed : k === 'ln_f' ? xLnF : k === 'lm_head' ? xHead : slabX(k);
  });
  const slotBase = Array.from({ length: slotCount }, () => new THREE.Box3());
  {
    const m = new THREE.Matrix4();
    const b = new THREE.Box3();
    for (const sh of [...shiftables, ...(mg?.frame ? [{ mesh: edges as THREE.InstancedMesh, base: slabSh.base, slot: slabSh.slot }] : [])]) {
      const g = sh.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      for (let i = 0; i < sh.slot.length; i++) {
        m.fromArray(sh.base, i * 16);
        slotBase[sh.slot[i]!]!.union(b.copy(g.boundingBox!).applyMatrix4(m));
      }
    }
  }

  // Lanes: the two light lines along the row (A cyan, B amber); they feed the bloom. One instanced
  // cylinder segment per gap between neighbouring slots, so a shift stretches the segment that
  // crosses it and the lane stays continuous; one spare instance for a cut inside a segment.
  const segCount = slotCount - 1;
  const laneCount = segCount + 1;
  const laneGeo = new THREE.CylinderGeometry(LANE_RADIUS, LANE_RADIUS, 1, 8);
  laneGeo.rotateZ(Math.PI / 2); // axis Y -> X, unit length along X
  const lanes: THREE.InstancedMesh[] = [];
  for (const s of STREAMS) {
    const it = add(shaftId(s), new THREE.Vector3((xEmbed + xHead) / 2, LANE_Y[s], LANE_Z));
    const m = new THREE.InstancedMesh(laneGeo, new THREE.MeshBasicMaterial({ color: streamColor(s) }), laneCount);
    m.name = shaftId(s);
    m.position.set(0, it.pos.y, it.pos.z);
    m.userData.ids = Array.from({ length: laneCount }, () => it.id);
    markBloom(m);
    root.add(m);
    lanes.push(m);
  }
  let laneGap: RowExtent | null = null;
  const segM = new THREE.Matrix4();
  const writeLanes = (): void => {
    const pieces: [number, number][] = [];
    for (let i = 0; i < segCount; i++) {
      const x0 = slotBaseX[i]! + shiftAt(i);
      const x1 = slotBaseX[i + 1]! + shiftAt(i + 1);
      if (!laneGap || x1 <= laneGap.minX || x0 >= laneGap.maxX) {
        pieces.push([x0, x1]);
        continue;
      }
      if (x0 < laneGap.minX) pieces.push([x0, laneGap.minX]);
      if (x1 > laneGap.maxX) pieces.push([laneGap.maxX, x1]);
    }
    for (const m of lanes) {
      for (let i = 0; i < laneCount; i++) {
        const p = pieces[i];
        if (!p || p[1] - p[0] <= 1e-6) m.setMatrixAt(i, ZERO_MATRIX);
        else m.setMatrixAt(i, segM.makeScale(p[1] - p[0], 1, 1).setPosition((p[0] + p[1]) / 2, 0, 0));
      }
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  };

  const listeners = new Set<() => void>();
  const applyShift = (): void => {
    for (const sh of shiftables) {
      const arr = sh.mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < sh.slot.length; i++) {
        const o = i * 16;
        if (sh.hidden.has(i)) {
          ZERO_MATRIX.toArray(arr, o);
          continue;
        }
        for (let k = 0; k < 16; k++) arr[o + k] = sh.base[o + k]!;
        arr[o + 12] = sh.base[o + 12]! + shiftAt(sh.slot[i]!);
      }
      sh.mesh.instanceMatrix.needsUpdate = true;
      sh.mesh.computeBoundingSphere();
      sh.mesh.boundingBox = null;
      for (const f of sh.followers) {
        const im = f as THREE.InstancedMesh;
        if (im.isInstancedMesh) {
          im.computeBoundingSphere();
          im.boundingBox = null;
        } else {
          (f as THREE.LineSegments).geometry.boundingSphere = sh.mesh.boundingSphere!.clone();
        }
      }
    }
    writeLanes();
    for (const fn of listeners) fn();
  };
  applyShift();

  const counts = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const id of anchors.keys()) {
      const p = parseId(id);
      if (!p || p.type === 'shaft' || p.type === 'slab') continue;
      out[p.type] = (out[p.type] ?? 0) + 1;
    }
    return out;
  };
  const shiftOf = (k: SlotKey): number => shiftAt(slotIndex(k));

  return {
    root,
    layerCount: n,
    rowExtent: { minX: xEmbed, maxX: xHead },
    slabX,
    has: (id) => anchors.has(id),
    anchor(id) {
      const v = anchors.get(id);
      if (!v) throw new Error(`unknown component id: ${id}`);
      const k = slotOf(id);
      const out = v.clone();
      if (k !== null) out.x += shiftOf(k);
      return out;
    },
    pick(hit) {
      const ids = hit.object.userData.ids as ComponentId[] | undefined;
      if (!ids) return null;
      return ids[hit.instanceId ?? 0] ?? null;
    },
    counts,
    layerShift,
    endShift,
    slots: () => Array.from({ length: slotCount }, (_, i) => slotKey(i)),
    slotOf,
    shiftOf,
    slotBaseBox: (k) => slotBase[slotIndex(k)]!.clone(),
    slotBox(k) {
      const b = slotBase[slotIndex(k)]!.clone();
      return b.translate(new THREE.Vector3(shiftOf(k), 0, 0));
    },
    setLaneGap(gap) {
      laneGap = gap ? { ...gap } : null;
    },
    applyShift,
    hide(target) {
      // Replaces what was hidden: a slab still flying back while another one opens shows again.
      for (const sh of shiftables) {
        sh.hidden.clear();
        if (!sh.hideable) continue;
        const ids = sh.mesh.userData.ids as ComponentId[];
        ids.forEach((id, i) => {
          if (id.endsWith('.gate') || !(id === target || id.startsWith(`${target}.`))) return;
          sh.hidden.add(i);
        });
      }
      applyShift();
    },
    unhide() {
      for (const sh of shiftables) sh.hidden.clear();
      applyShift();
    },
    onShift(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setSlabFade(layer, f) {
      if (fade.getX(layer) === f) return;
      fade.setX(layer, f);
      fade.needsUpdate = true;
    },
    slabFade: (layer) => fade.getX(layer),
  };
}
