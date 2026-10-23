import * as THREE from 'three';
import type { Architecture } from '../data/architecture';
import type { CameraRig } from '../camera/controls';
import { findMatrix, type WeightsLoader, weightKey } from '../data/weights';
import { type ComponentId, type Stream, parseId } from './ids';
import { type ChildSpec, type PartKind, childrenOf, isExplodable, lanePath } from './hierarchy';
import { buildTile, CELL, tileCaption } from './tile';
import type { LabelKind } from '../data/labeled';
import { type TowerScene } from './tower';
import { PALETTE, streamColor } from './palette';

export interface TileInfo {
  id: ComponentId;
  name: string;
  rows: number;
  cols: number;
  ternary: boolean;
  /** Row-major cell colours as rendered. */
  colors: number[];
  gamma: number | null;
  tau: number | null;
  fracNeg: number | null;
  fracZero: number | null;
  fracPos: number | null;
}

export interface ExplodeDeps {
  tower: TowerScene;
  arch: Architecture;
  rig: Pick<CameraRig, 'flyTo' | 'escapeGuard'>;
  loadWeights: WeightsLoader;
  /** Text label factory; defaults to a serif canvas sprite. Tests inject a stub. */
  label?: (text: string, kind?: LabelKind) => THREE.Object3D;
  /** Animation length in ms (0 = instant). */
  ms?: number;
  doc?: Document;
  /** Fires after a level opens or closes; `current` is the id of the open level or null. */
  onChange?: (current: ComponentId | null) => void;
}

export interface ExplodeView {
  /** Add this to the scene; holds every exploded part. */
  readonly root: THREE.Group;
  explode(id: ComponentId): Promise<void>;
  /** Closes the top level (parts fly back and the previous level, or the intact row, returns). */
  reassemble(): Promise<void>;
  depth(): number;
  current(): ComponentId | null;
  /** Object to raycast against: the open level, or the whole row when nothing is exploded. */
  pickRoot(): THREE.Object3D;
  pick(hit: THREE.Intersection): ComponentId | null;
  tile(): TileInfo | null;
  update(dt: number): void;
  dispose(): void;
}

interface Level {
  id: ComponentId;
  group: THREE.Group;
  center: THREE.Vector3;
  parts: Map<ComponentId, THREE.Object3D>;
  tile: TileInfo | null;
}

interface Tween {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  scaleFrom: number;
  scaleTo: number;
  t: number;
  dur: number;
  done: () => void;
}

const LABEL_W = 512;
const LABEL_H = 64;

/** Largest font size (px, at most 30, at least 12) at which `text` fits the label width. */
export function fitFontPx(measure: (px: number) => number, maxWidth: number): number {
  let px = 30;
  while (px > 12 && measure(px) > maxWidth) px -= 1;
  return px;
}

/** Serif canvas sprite; the text shrinks to fit so long captions are never clipped. `kind` is kept on userData. */
export function defaultLabel(text: string, kind: LabelKind = 'structure'): THREE.Object3D {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_W;
  canvas.height = LABEL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Object3D();
  ctx.fillStyle = '#ffffff';
  const font = (px: number): string => `italic ${px}px "Times New Roman", Georgia, serif`;
  ctx.font = font(fitFontPx((px) => { ctx.font = font(px); return ctx.measureText(text).width; }, LABEL_W - 16));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, LABEL_W / 2, LABEL_H / 2);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }),
  );
  sprite.scale.set(4, 0.5, 1);
  sprite.renderOrder = 5;
  sprite.userData.kind = kind;
  return sprite;
}

const GEO: Record<PartKind, () => THREE.BufferGeometry> = {
  ln: () => new THREE.BoxGeometry(0.15, 0.6, 1.0),
  attn: () => new THREE.BoxGeometry(1.2, 0.8, 1.0),
  router: () => new THREE.OctahedronGeometry(0.55),
  bank: () => new THREE.BoxGeometry(2.4, 2.4, 2.4),
  expert: () => new THREE.BoxGeometry(0.9, 0.9, 0.9),
  matrix: () => new THREE.BoxGeometry(1.1, 0.06, 1.1),
  head: () => new THREE.CylinderGeometry(0.35, 0.35, 0.6, 16),
  seed: () => new THREE.BoxGeometry(0.8, 0.12, 0.5),
  gelu: () => new THREE.SphereGeometry(0.5, 16, 12),
};

/** Role colour of an exploded part (palette.ts); shapes stay distinct per kind (GEO). */
function partColor(c: ChildSpec): number {
  switch (c.kind) {
    case 'matrix': return PALETTE.neutral;
    case 'router': return PALETTE.router;
    case 'bank': case 'expert': case 'seed': case 'gelu': return PALETTE.expert;
    default: return c.stream === 'shared' ? PALETTE.neutral : streamColor(c.stream);
  }
}

const isInstanced = (o: THREE.Object3D): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh === true;

export function createExplode(deps: ExplodeDeps): ExplodeView {
  const { tower, arch, rig, loadWeights } = deps;
  const label = deps.label ?? defaultLabel;
  const ms = deps.ms ?? 700;
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const root = new THREE.Group();
  root.name = 'explode';
  const stack: Level[] = [];
  const tweens: Tween[] = [];
  const geoCache = new Map<PartKind, THREE.BufferGeometry>();
  let hidden: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }[] = [];
  let dimmed: { mat: THREE.Material; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];

  const geo = (k: PartKind): THREE.BufferGeometry => {
    let g = geoCache.get(k);
    if (!g) geoCache.set(k, (g = GEO[k]()));
    return g;
  };

  // --- hiding the intact row while a level is open ---
  const hideOriginals = (target: ComponentId): void => {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    tower.root.traverse((o) => {
      if (!isInstanced(o) || o.name === 'slabs') return;
      const ids = o.userData.ids as ComponentId[] | undefined;
      if (!ids) return;
      ids.forEach((id, i) => {
        if (id.endsWith('.gate') || !(id === target || id.startsWith(`${target}.`))) return;
        const m = new THREE.Matrix4();
        o.getMatrixAt(i, m);
        hidden.push({ mesh: o, index: i, matrix: m });
        o.setMatrixAt(i, zero);
        o.instanceMatrix.needsUpdate = true;
      });
    });
  };
  const restoreOriginals = (): void => {
    for (const h of hidden) {
      h.mesh.setMatrixAt(h.index, h.matrix);
      h.mesh.instanceMatrix.needsUpdate = true;
    }
    hidden = [];
  };
  const dim = (): void => {
    const seen = new Set<THREE.Material>();
    tower.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        dimmed.push({ mat, opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite });
        mat.transparent = true;
        mat.opacity *= 0.15;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      }
    });
  };
  const undim = (): void => {
    for (const d of dimmed) {
      d.mat.opacity = d.opacity;
      d.mat.transparent = d.transparent;
      d.mat.depthWrite = d.depthWrite;
      d.mat.needsUpdate = true;
    }
    dimmed = [];
  };

  // --- tweens ---
  const animate = (obj: THREE.Object3D, to: THREE.Vector3, scaleFrom: number, scaleTo: number): Promise<void> =>
    new Promise<void>((resolve) => {
      if (ms === 0) {
        obj.position.copy(to);
        obj.scale.setScalar(scaleTo);
        resolve();
        return;
      }
      obj.scale.setScalar(scaleFrom);
      tweens.push({ obj, from: obj.position.clone(), to: to.clone(), scaleFrom, scaleTo, t: 0, dur: ms / 1000, done: resolve });
    });

  const disposeTree = (o: THREE.Object3D): void => {
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (m) {
        for (const mat of Array.isArray(m) ? m : [m]) {
          (mat as THREE.SpriteMaterial).map?.dispose();
          mat.dispose();
        }
      }
      if (mesh.geometry && ![...geoCache.values()].includes(mesh.geometry)) mesh.geometry.dispose();
    });
  };

  let loading = false;
  /** Levels whose reassemble animation is still running. */
  let closing = 0;
  const top = (): Level | undefined => stack[stack.length - 1];

  const flyTo = (level: Level, extent: number): void => {
    void rig.flyTo(level.center, extent * 3 + 4);
  };

  async function buildMatrixLevel(id: ComponentId, center: THREE.Vector3, start: THREE.Vector3): Promise<Level> {
    const p = parseId(id);
    const key = p ? weightKey(p) : null;
    if (p?.type !== 'matrix' || !key?.matrix) throw new Error(`no weight tile for ${id}`);
    const w = await loadWeights(p.layer);
    const m = findMatrix(w, key.matrix);
    if (!m) throw new Error(`weights file has no matrix ${key.matrix}`);
    const group = new THREE.Group();
    group.name = `level:${id}`;
    const tile = buildTile(m, id);
    tile.position.copy(start);
    group.add(tile);
    const grid = tile.userData.grid as { rows: number; cols: number; colors: number[] };
    tileCaption(m).forEach((t, i) => {
      const l = label(t, 'structure');
      l.position.set(0, -0.05, -(grid.rows * CELL) / 2 - 0.35 - i * 0.45);
      tile.add(l);
    });
    const info: TileInfo = {
      id, name: m.name, rows: grid.rows, cols: grid.cols, ternary: m.ternary, colors: grid.colors,
      gamma: m.gamma, tau: m.tau, fracNeg: m.frac_neg, fracZero: m.frac_zero, fracPos: m.frac_pos,
    };
    return { id, group, center, parts: new Map([[id, tile]]), tile: info };
  }

  function buildPartsLevel(id: ComponentId, center: THREE.Vector3, start: () => THREE.Vector3): { level: Level; targets: [THREE.Object3D, THREE.Vector3][]; extent: number } {
    const kids = childrenOf(id, arch);
    const group = new THREE.Group();
    group.name = `level:${id}`;
    const parts = new Map<ComponentId, THREE.Object3D>();
    const targets: [THREE.Object3D, THREE.Vector3][] = [];
    let extent = 1;
    for (const c of kids) {
      // Glass in the role colour with a thin white outline (spec 4.2b), like the parts in the row.
      const mat = new THREE.MeshStandardMaterial({
        color: partColor(c), roughness: 0.45, metalness: 0.1,
        transparent: true, opacity: c.kind === 'bank' ? 0.18 : 0.5, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo(c.kind), mat);
      mesh.name = c.id;
      mesh.userData.ids = [c.id];
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 30),
        new THREE.LineBasicMaterial({ color: PALETTE.edge, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      outline.name = `${c.id}:outline`;
      outline.raycast = (): void => {};
      mesh.add(outline);
      mesh.position.copy(start());
      const text = label(c.label, 'structure');
      text.position.set(0, -0.2, -(c.kind === 'bank' ? 1.6 : 0.95));
      mesh.add(text);
      group.add(mesh);
      parts.set(c.id, mesh);
      targets.push([mesh, center.clone().add(new THREE.Vector3(...c.pos))]);
      extent = Math.max(extent, Math.abs(c.pos[0]) + 1, Math.abs(c.pos[2]) + 1);
    }
    return { level: { id, group, center, parts, tile: null }, targets, extent };
  }

  function addLanes(level: Level, finals: Map<ComponentId, THREE.Vector3>): void {
    const p = parseId(level.id);
    if (p?.type !== 'slab') return;
    const lanes = new THREE.Group();
    lanes.name = 'lanes';
    lanes.visible = false;
    for (const s of ['A', 'B'] as Stream[]) {
      const pts = lanePath(p.layer, s).map((pid) => {
        const at = finals.get(pid);
        if (!at) throw new Error(`lane ${s} references ${pid}, not part of the slab`);
        return at.clone();
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: streamColor(s), linewidth: 2 }),
      );
      line.name = `lane.${s}`;
      lanes.add(line);
    }
    level.group.add(lanes);
    level.group.userData.lanes = lanes;
  }

  const view: ExplodeView = {
    root,

    async explode(id) {
      if (!isExplodable(id, arch) || loading) return;
      const p = parseId(id);
      if (!p || !('layer' in p)) return;
      let cur = top();
      if (cur && !cur.parts.has(id)) {
        while (stack.length) await view.reassemble();
        cur = undefined;
      }
      const center = cur ? cur.center.clone() : new THREE.Vector3(tower.slabX(p.layer), 0, 0);
      const startAt = cur
        ? (cur.parts.get(id)?.position.clone() ?? center.clone())
        : (tower.has(id) ? tower.anchor(id) : center.clone());
      const startOf = (): THREE.Vector3 => startAt.clone();

      let level: Level;
      let extent: number;
      let targets: [THREE.Object3D, THREE.Vector3][];
      if (p.type === 'matrix') {
        loading = true;
        try {
          level = await buildMatrixLevel(id, center, startOf());
        } finally {
          loading = false;
        }
        const info = level.tile!;
        extent = Math.max(info.rows, info.cols) * CELL / 2 + 1;
        targets = [[level.parts.get(id)!, center.clone()]];
      } else {
        ({ level, targets, extent } = buildPartsLevel(id, center, startOf));
      }

      if (cur) cur.group.visible = false;
      else {
        dim();
        hideOriginals(id);
      }
      stack.push(level);
      root.add(level.group);
      addLanes(level, new Map(targets.map(([o, to]) => [o.name, to])));
      flyTo(level, extent);
      deps.onChange?.(id);
      await Promise.all(targets.map(([o, to]) => animate(o, to, 0.2, 1)));
      const lanes = level.group.userData.lanes as THREE.Object3D | undefined;
      if (lanes) lanes.visible = true;
    },

    async reassemble() {
      const level = stack.pop();
      if (!level) return;
      closing++;
      const lanes = level.group.userData.lanes as THREE.Object3D | undefined;
      if (lanes) lanes.visible = false;
      const prev = top();
      deps.onChange?.(prev?.id ?? null);
      if (prev) {
        prev.group.visible = true;
        flyTo(prev, 8);
      }
      const back = prev?.parts.get(level.id)?.position.clone()
        ?? (tower.has(level.id) ? tower.anchor(level.id) : level.center.clone());
      try {
        await Promise.all([...level.parts.values()].map((o) => animate(o, back, 1, 0.2)));
      } finally {
        closing--;
      }
      root.remove(level.group);
      disposeTree(level.group);
      if (stack.length === 0) {
        restoreOriginals();
        undim();
      }
    },

    depth: () => stack.length,
    current: () => top()?.id ?? null,
    pickRoot: () => top()?.group ?? tower.root,
    pick(hit) {
      const ids = hit.object.userData.ids as ComponentId[] | undefined;
      return ids?.[hit.instanceId ?? 0] ?? null;
    },
    tile: () => top()?.tile ?? null,

    update(dt) {
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i]!;
        tw.t = Math.min(tw.t + dt, tw.dur);
        const s = tw.t / tw.dur;
        const k = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
        tw.obj.position.lerpVectors(tw.from, tw.to, k);
        tw.obj.scale.setScalar(tw.scaleFrom + (tw.scaleTo - tw.scaleFrom) * k);
        if (tw.t >= tw.dur) {
          tweens.splice(i, 1);
          tw.done();
        }
      }
    },

    dispose() {
      doc?.removeEventListener('keydown', onKey);
      if (rig.escapeGuard === guard) rig.escapeGuard = null;
      while (stack.length) {
        const l = stack.pop()!;
        root.remove(l.group);
        disposeTree(l.group);
      }
      restoreOriginals();
      undim();
      for (const g of geoCache.values()) g.dispose();
    },
  };

  // Esc belongs to the explode view while a level is open, a level is closing or a weight tile loads.
  // The handler stops the event for every other listener, so the rig's overview never fires in the
  // same keypress, whatever order the listeners were registered in; the guard covers the rig-first
  // order and rigs wired through escapeGuard only.
  const busy = (): boolean => stack.length > 0 || closing > 0 || loading;
  const guard = busy;
  rig.escapeGuard = guard;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !busy()) return;
    e.stopImmediatePropagation();
    if (stack.length > 0) void view.reassemble();
  };
  doc?.addEventListener('keydown', onKey);
  return view;
}
