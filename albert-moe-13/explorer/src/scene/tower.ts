import * as THREE from 'three';
import type { Architecture } from '../data/architecture';
import {
  type ComponentId, type Stream,
  attnId, embedId, expertId, gateId, ln1Id, ln2Id, lmHeadId, lnFId, parseId, routerId, shaftId,
} from './ids';

/** Look constants (spec 4.2b). Row runs along +X; slabs are YZ planes. */
export const COLORS = {
  A: 0xffd940,
  B: 0x66f2b3,
  plus: 0x58c4dd,
  minus: 0xfc6255,
  zero: 0x1a1c21,
  edge: 0xffffff,
} as const;

export const SLAB_PITCH = 3;
export const SLAB_WIDTH = 6; // Y
export const SLAB_HEIGHT = 4; // Z
export const LANE_Y: Record<Stream, number> = { A: -1.8, B: 1.8 };
export const LANE_Z = -1.2;
const EXPERT_COLS = 3; // along Y
const EXPERT_ROWS = 4; // along Z

export interface TowerScene {
  root: THREE.Group;
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
  roughness = 0.55,
): THREE.InstancedMesh {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0.1 });
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

function streamColor(it: Item): number {
  return it.id.includes('.B.') ? COLORS.B : COLORS.A;
}

export function buildTower(a: Architecture): TowerScene {
  const n = a.model.num_layers;
  const slabX = (layer: number): number => layer * SLAB_PITCH;
  const anchors = new Map<ComponentId, THREE.Vector3>();
  const root = new THREE.Group();
  root.name = 'tower';

  const add = (id: ComponentId, pos: THREE.Vector3): Item => {
    anchors.set(id, pos.clone());
    return { id, pos };
  };

  // Slabs: glass planes + merged white outline.
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0x8fb4ff, transparent: true, opacity: 0.06, depthWrite: false,
    side: THREE.DoubleSide, roughness: 0.2, metalness: 0,
  });
  const slabGeo = new THREE.PlaneGeometry(SLAB_HEIGHT, SLAB_WIDTH); // local X = Z-high, Y = width
  slabGeo.rotateY(Math.PI / 2); // plane normal along X; local (x,y,z) -> (0, width, height)
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, n);
  slabs.name = 'slabs';
  const hw = SLAB_WIDTH / 2;
  const hh = SLAB_HEIGHT / 2;
  const edgePts: number[] = [];
  for (let l = 0; l < n; l++) {
    tmp.position.set(slabX(l), 0, 0);
    tmp.updateMatrix();
    slabs.setMatrixAt(l, tmp.matrix);
    const x = slabX(l);
    const c = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const;
    for (let k = 0; k < 4; k++) {
      const p = c[k]!;
      const q = c[(k + 1) % 4]!;
      edgePts.push(x, p[0], p[1], x, q[0], q[1]);
    }
  }
  slabs.renderOrder = 1;
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
  const edges = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.55 }),
  );
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
    if (fusion.has(l)) gates.push(add(gateId(l), new THREE.Vector3(x, 0, 0.9)));
  }

  root.add(
    instanced('experts', new THREE.BoxGeometry(0.4, 0.4, 0.4), experts, () => COLORS.plus),
    instanced('attn', new THREE.BoxGeometry(0.4, 0.5, 0.5), perType.attn, streamColor),
    instanced('router', new THREE.OctahedronGeometry(0.2), perType.router, streamColor),
    instanced('ln1', new THREE.BoxGeometry(0.1, 0.4, 0.3), perType.ln1, streamColor),
    instanced('ln2', new THREE.BoxGeometry(0.1, 0.4, 0.3), perType.ln2, streamColor),
  );

  // Gates: one arc between the two lanes, instanced across fusion slabs.
  if (gates.length > 0) {
    const arc = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, LANE_Y.A, LANE_Z),
      new THREE.Vector3(0, 0, 2.6),
      new THREE.Vector3(0, LANE_Y.B, LANE_Z),
    );
    const arcGeo = new THREE.TubeGeometry(arc, 24, 0.05, 6, false);
    const arcItems = gates.map((g) => ({ id: g.id, pos: new THREE.Vector3(g.pos.x, 0, 0) }));
    root.add(instanced('gates', arcGeo, arcItems, () => 0xffffff, 0.3));
  }

  // Embed, ln_f, lm_head at the row ends.
  const xEmbed = slabX(0) - SLAB_PITCH;
  const xLnF = slabX(n - 1) + SLAB_PITCH;
  const xHead = xLnF + SLAB_PITCH;
  const ends: [ComponentId, number, THREE.BoxGeometry][] = [
    [embedId(), xEmbed, new THREE.BoxGeometry(0.8, 3.2, 2.4)],
    [lnFId(), xLnF, new THREE.BoxGeometry(0.15, 3.2, 1.6)],
    [lmHeadId(), xHead, new THREE.BoxGeometry(0.8, 3.2, 2.4)],
  ];
  for (const [id, x, geo] of ends) {
    const it = add(id, new THREE.Vector3(x, 0, 0));
    root.add(instanced(id, geo, [it], () => 0xdfe6f2));
  }

  // Lanes: the two shafts running the full row.
  const len = xHead - xEmbed;
  for (const s of STREAMS) {
    const geo = new THREE.CylinderGeometry(0.035, 0.035, len, 8);
    geo.rotateZ(Math.PI / 2); // axis Y -> X
    const it = add(shaftId(s), new THREE.Vector3((xEmbed + xHead) / 2, LANE_Y[s], LANE_Z));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLORS[s] }));
    m.name = shaftId(s);
    m.position.copy(it.pos);
    m.userData.ids = [it.id];
    root.add(m);
  }

  const counts = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const id of anchors.keys()) {
      const p = parseId(id);
      if (!p || p.type === 'shaft') continue;
      out[p.type] = (out[p.type] ?? 0) + 1;
    }
    return out;
  };

  return {
    root,
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
