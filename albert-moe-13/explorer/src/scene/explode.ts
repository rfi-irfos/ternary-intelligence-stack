import * as THREE from 'three';
import type { Architecture } from '../data/architecture';
import type { CameraRig } from '../camera/controls';
import { findMatrix, type WeightsLoader, weightKey } from '../data/weights';
import { type ComponentId, type Stream, parseId, slabId } from './ids';
import { type ChildSpec, type PartKind, childrenOf, isExplodable, lanePath } from './hierarchy';
import { buildTile, CELL, tileCaption } from './tile';
import type { LabelKind } from '../data/labeled';
import { type RowExtent, type SlotKey, type TowerScene } from './tower';
import { PALETTE, streamColor } from './palette';
import { FONT } from '../style/theme';

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
  /** True when the user prefers reduced motion: parts and the row shift then move instantly. Defaults to the media query. */
  reducedMotion?: () => boolean;
  doc?: Document;
  /** Fires after a level opens or closes; `current` is the id of the open level or null. */
  onChange?: (current: ComponentId | null) => void;
}

export interface ExplodeView {
  /** Add this to the scene; holds every exploded part. */
  readonly root: THREE.Group;
  /**
   * Opens `id`. From the row (nothing open), a part inside a slab opens through its slab and every
   * level between, in one combined move: the slab's other parts make room exactly as when the slab
   * is opened first by hand. Closing once then closes only the part's level; the slab stays open.
   */
  explode(id: ComponentId): Promise<void>;
  /** Closes the top level (parts fly back and the previous level, or the intact row, returns). */
  reassemble(): Promise<void>;
  depth(): number;
  current(): ComponentId | null;
  /** Object to raycast against: the open level, or the whole row when nothing is exploded. */
  pickRoot(): THREE.Object3D;
  pick(hit: THREE.Intersection): ComponentId | null;
  tile(): TileInfo | null;
  /**
   * World AABB of everything open (every level, labels included, plus the exploded slot), grown by
   * ROW_NUDGE_MARGIN along x and NUDGE_MARGIN across; the neighbours of the row are pushed out of
   * it. Null when nothing is open.
   */
  box(): THREE.Box3 | null;
  /**
   * Runs `swap` (a quality change that replaces row materials) with the row undimmed, then dims the
   * new materials again if a level is open, so the intact row stays faded behind the exploded parts
   * and reassembling restores the new materials (not the old ones) to full opacity.
   */
  refreshLook(swap: () => void): void;
  update(dt: number): void;
  dispose(): void;
}

interface Level {
  id: ComponentId;
  group: THREE.Group;
  /** The pivot: where the opened component sits (its parts spread around it). */
  center: THREE.Vector3;
  parts: Map<ComponentId, THREE.Object3D>;
  tile: TileInfo | null;
  /** Layout position of every part, before any nudge. */
  base: Map<ComponentId, THREE.Vector3>;
  /** x nudge of every part while one of its siblings is open as the next level. */
  nudge: Map<ComponentId, number>;
  /** The part of this level that is open as the next level (hidden here), or null. */
  open: ComponentId | null;
  /** Row slot the whole chain of levels sits in. */
  slot: SlotKey;
}

interface Built {
  level: Level;
  targets: [THREE.Object3D, THREE.Vector3][];
  extent: number;
}

/** Gap kept between an exploded part and its siblings nudged aside inside a level (world units). */
export const NUDGE_MARGIN = 0.6;
/**
 * Gap (x, world units) kept between the open group and the row slabs pushed aside. Wider than the
 * sibling margin: a neighbour slab's 6-unit-deep glass plane, seen in perspective from the default
 * and the framed camera, must not reach across the exploded parts.
 */
export const ROW_NUDGE_MARGIN = 1.8;
/** Opacity factor of the exploded slab's glass and of its nearest neighbour on each side while a level is open. */
export const SLAB_FADE = 0.25;
/** Half thickness given to a label's box along Y (sprites are flat). */
const LABEL_HALF_DEPTH = 0.05;
const EPS = 1e-3;

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
  const font = (px: number): string => `500 ${px}px ${FONT.display}`;
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

/**
 * Box of `o` in its own frame (no rotation or scale at rest): its mesh, its mesh children (a tile's
 * glass) and its labels, which count as flat boxes of the sprite's width and height. Cached.
 */
function localBox(o: THREE.Object3D): THREE.Box3 {
  const cached = o.userData.localBox as THREE.Box3 | undefined;
  if (cached) return cached;
  const box = new THREE.Box3();
  const addMesh = (c: THREE.Object3D, off: THREE.Vector3): void => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || isInstanced(c) || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().translate(off));
  };
  addMesh(o, new THREE.Vector3());
  for (const c of o.children) {
    if (c.userData.label) {
      const h = new THREE.Vector3(c.scale.x / 2, LABEL_HALF_DEPTH, c.scale.y / 2);
      box.union(new THREE.Box3(c.position.clone().sub(h), c.position.clone().add(h)));
    } else addMesh(c, c.position);
  }
  o.userData.localBox = box;
  return box;
}

const partBox = (o: THREE.Object3D, at: THREE.Vector3): THREE.Box3 => localBox(o).clone().translate(at);

export function createExplode(deps: ExplodeDeps): ExplodeView {
  const { tower, arch, rig, loadWeights } = deps;
  const label = deps.label ?? defaultLabel;
  const ms = deps.ms ?? 700;
  const reduced = deps.reducedMotion
    ?? ((): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  /** Length of every explode, reassemble and shift tween in ms (0 under reduced motion). */
  const dur = (): number => (reduced() ? 0 : ms);
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const root = new THREE.Group();
  root.name = 'explode';
  const stack: Level[] = [];
  const tweens: Tween[] = [];
  const geoCache = new Map<PartKind, THREE.BufferGeometry>();
  let dimmed: { mat: THREE.Material; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  const slots = tower.slots();

  const geo = (k: PartKind): THREE.BufferGeometry => {
    let g = geoCache.get(k);
    if (!g) geoCache.set(k, (g = GEO[k]()));
    return g;
  };

  // --- dimming the intact row while a level is open ---
  let isDimmed = false;
  const dim = (): void => {
    if (isDimmed) return;
    isDimmed = true;
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
    isDimmed = false;
  };

  // --- tweens (only while something moves; update() is a no-op when idle) ---
  /**
   * Gives `obj` a new goal. A running tween (a part still flying out) keeps its timing and its scale
   * tween and only bends towards the new goal, without a jump; an idle part tweens there at its scale.
   */
  const moveTo = (obj: THREE.Object3D, to: THREE.Vector3): Promise<void> => {
    const tw = tweens.find((x) => x.obj === obj);
    if (!tw) return animate(obj, to, obj.scale.x, obj.scale.x);
    obj.userData.goal = to.clone();
    const k = ease(tw.t / tw.dur);
    // from' such that lerp(from', to, k) is where the part is now.
    if (k < 1 - 1e-9) tw.from.copy(obj.position).addScaledVector(to, -k).multiplyScalar(1 / (1 - k));
    tw.to.copy(to);
    return new Promise<void>((resolve) => {
      const prev = tw.done;
      tw.done = () => { prev(); resolve(); };
    });
  };

  const animate = (obj: THREE.Object3D, to: THREE.Vector3, scaleFrom: number, scaleTo: number): Promise<void> =>
    new Promise<void>((resolve) => {
      // A newer move of the same object replaces the running one.
      const k = tweens.findIndex((tw) => tw.obj === obj);
      if (k >= 0) tweens.splice(k, 1)[0]!.done();
      obj.userData.goal = to.clone();
      const d = dur();
      if (d === 0) {
        obj.position.copy(to);
        obj.scale.setScalar(scaleTo);
        resolve();
        return;
      }
      obj.scale.setScalar(scaleFrom);
      tweens.push({ obj, from: obj.position.clone(), to: to.clone(), scaleFrom, scaleTo, t: 0, dur: d / 1000, done: resolve });
    });

  // The row shift and the slab fade: one tween of every slot offset and every slab's glass fade at a
  // time, same easing and length as the parts.
  interface RowState { shift: Float64Array; fade: Float64Array }
  let shiftTw: { from: RowState; to: RowState; t: number; dur: number; done: () => void } | null = null;
  const layers = tower.layerCount;
  const readShift = (): Float64Array => Float64Array.from(slots.map((k) => tower.shiftOf(k)));
  const readFade = (): Float64Array => Float64Array.from({ length: layers }, (_, l) => tower.slabFade(l));
  const writeFade = (v: ArrayLike<number>): void => {
    for (let l = 0; l < layers; l++) tower.setSlabFade(l, v[l] ?? 1);
  };
  const writeRow = (v: RowState): void => {
    writeFade(v.fade);
    writeShift(v.shift);
  };
  const lerpArr = (a: Float64Array, b: Float64Array, k: number): Float64Array =>
    Float64Array.from(a, (x, i) => x + ((b[i] ?? 0) - x) * k);
  const writeShift = (v: ArrayLike<number>): void => {
    slots.forEach((k, i) => {
      const x = v[i] ?? 0;
      if (typeof k === 'number') tower.layerShift[k] = x;
      else tower.endShift[k] = x;
    });
    tower.applyShift();
  };
  const tweenRow = (to: RowState, gap: RowExtent | null): Promise<void> =>
    new Promise<void>((resolve) => {
      if (shiftTw) {
        const old = shiftTw;
        shiftTw = null;
        old.done();
      }
      tower.setLaneGap(gap);
      const from: RowState = { shift: readShift(), fade: readFade() };
      const d = dur();
      const same = (a: Float64Array, b: Float64Array): boolean => a.every((x, i) => x === b[i]);
      if (d === 0 || (same(from.shift, to.shift) && same(from.fade, to.fade))) {
        writeRow(to);
        resolve();
        return;
      }
      shiftTw = { from, to, t: 0, dur: d / 1000, done: resolve };
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
    void rig.flyTo(level.center, extent * 3 + 4, reduced() ? 0 : undefined);
  };

  // --- layout: nested nudges, then the row shift ---
  const targetOf = (l: Level, id: ComponentId): THREE.Vector3 =>
    l.base.get(id)!.clone().add(new THREE.Vector3(l.nudge.get(id) ?? 0, 0, 0));

  /** Box of a level's visible parts at their (nudged) targets, labels included. */
  const levelBox = (l: Level): THREE.Box3 => {
    const b = new THREE.Box3();
    for (const [id, o] of l.parts) if (id !== l.open) b.union(partBox(o, targetOf(l, id)));
    return b;
  };

  /**
   * Nudges the siblings of `l.open` along x out of `avoid` (the open child's chain, margin
   * included): parts left of the pivot all move left by one amount, parts right of it (or at the
   * same x) right by another, so the level's own layout is kept.
   */
  const nudgeLevel = (l: Level, avoid: THREE.Box3): void => {
    const pivot = l.base.get(l.open!)!.x;
    let left = 0;
    let right = 0;
    const side = new Map<ComponentId, number>();
    for (const [id, o] of l.parts) {
      if (id === l.open) continue;
      const at = l.base.get(id)!;
      const b = partBox(o, at);
      const s = at.x < pivot - 1e-6 ? -1 : 1;
      side.set(id, s);
      if (s < 0) left = Math.max(left, b.max.x - avoid.min.x + EPS);
      else right = Math.max(right, avoid.max.x - b.min.x + EPS);
    }
    for (const [id, s] of side) l.nudge.set(id, s < 0 ? -left : right);
  };

  /** Union of every open level plus the exploded slot, grown by the margin. */
  const openBox = (): THREE.Box3 | null => {
    const first = stack[0];
    if (!first) return null;
    const b = tower.slotBaseBox(first.slot);
    for (const l of stack) b.union(levelBox(l));
    return b.expandByVector(new THREE.Vector3(ROW_NUDGE_MARGIN, NUDGE_MARGIN, NUDGE_MARGIN));
  };

  /** Fade of every slab: the exploded one and its nearest neighbour on each side while a level is open. */
  const fadeLayout = (): Float64Array => {
    const f = new Float64Array(layers).fill(1);
    const slot = stack[0]?.slot;
    if (typeof slot === 'number') {
      for (let l = Math.max(0, slot - 1); l <= Math.min(layers - 1, slot + 1); l++) f[l] = SLAB_FADE;
    }
    return f;
  };

  /** Slot offsets that push every other slot of the row out of the open box (left ones left, right ones right). */
  const rowLayout = (): { to: Float64Array; gap: RowExtent | null } => {
    const to = new Float64Array(slots.length);
    const b = openBox();
    const first = stack[0];
    if (!b || !first) return { to, gap: null };
    const c = slots.indexOf(first.slot);
    let left = 0;
    let right = 0;
    slots.forEach((k, i) => {
      const sb = tower.slotBaseBox(k);
      if (i < c) left = Math.max(left, sb.max.x - b.min.x + EPS);
      else if (i > c) right = Math.max(right, b.max.x - sb.min.x + EPS);
    });
    slots.forEach((_, i) => { to[i] = i < c ? -left : i > c ? right : 0; });
    return { to, gap: { minX: b.min.x, maxX: b.max.x } };
  };

  /**
   * Recomputes the whole chain from the top level down: each level's siblings make room for the
   * levels above it, then the row makes room for all of them. Moves only what has a new goal.
   */
  const relayout = (): Promise<void>[] => {
    const out: Promise<void>[] = [];
    let above: THREE.Box3 | null = null;
    for (let k = stack.length - 1; k >= 0; k--) {
      const l = stack[k]!;
      if (above && l.open) nudgeLevel(l, above.clone().expandByScalar(NUDGE_MARGIN));
      else l.nudge.clear();
      for (const [id, o] of l.parts) {
        if (id === l.open) continue;
        const to = targetOf(l, id);
        const goal = (o.userData.goal as THREE.Vector3 | undefined) ?? o.position;
        if (goal.distanceToSquared(to) > 1e-12) out.push(moveTo(o, to));
      }
      const b = levelBox(l);
      above = above ? b.union(above) : b;
    }
    const { to, gap } = rowLayout();
    out.push(tweenRow({ shift: to, fade: fadeLayout() }, gap));
    return out;
  };

  // --- lanes inside an exploded slab ---
  const STREAMS: Stream[] = ['A', 'B'];
  /**
   * Lane lines of a slab level through its (nudged) parts. A lane that runs into the open child
   * stops at the child's box (margin included) and starts again on its far side, so it never runs
   * through the exploded parts.
   */
  const layoutLanes = (l: Level, child: THREE.Box3 | null): void => {
    const lanes = l.group.userData.lanes as THREE.Group | undefined;
    const p = parseId(l.id);
    if (!lanes || p?.type !== 'slab') return;
    for (const s of STREAMS) {
      const line = lanes.getObjectByName(`lane.${s}`) as THREE.LineSegments;
      const ids = lanePath(p.layer, s);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i + 1 < ids.length; i++) {
        const a = ids[i]!;
        const b = ids[i + 1]!;
        const pa = targetOf(l, a);
        const pb = targetOf(l, b);
        if (child && a === l.open) pa.x = pa.x <= pb.x ? child.max.x : child.min.x;
        if (child && b === l.open) pb.x = pa.x <= pb.x ? child.min.x : child.max.x;
        pts.push(pa, pb);
      }
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
  };
  const setLanesVisible = (on: boolean): void => {
    for (const l of stack) {
      const lanes = l.group.userData.lanes as THREE.Object3D | undefined;
      if (lanes) lanes.visible = on;
    }
  };
  /** Lays the lanes of every level out at the settled positions and shows them. */
  const showLanes = (): void => {
    let above: THREE.Box3 | null = null;
    for (let k = stack.length - 1; k >= 0; k--) {
      const l = stack[k]!;
      layoutLanes(l, l.open && above ? above.clone().expandByScalar(NUDGE_MARGIN) : null);
      const b = levelBox(l);
      above = above ? b.union(above) : b;
    }
    setLanesVisible(true);
  };

  async function buildMatrixLevel(id: ComponentId, center: THREE.Vector3, start: THREE.Vector3, slot: SlotKey): Promise<Level> {
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
      l.userData.label = true;
      l.position.set(0, -0.05, -(grid.rows * CELL) / 2 - 0.35 - i * 0.45);
      tile.add(l);
    });
    const info: TileInfo = {
      id, name: m.name, rows: grid.rows, cols: grid.cols, ternary: m.ternary, colors: grid.colors,
      gamma: m.gamma, tau: m.tau, fracNeg: m.frac_neg, fracZero: m.frac_zero, fracPos: m.frac_pos,
    };
    return {
      id, group, center, parts: new Map([[id, tile]]), tile: info,
      base: new Map([[id, center.clone()]]), nudge: new Map(), open: null, slot,
    };
  }

  function buildPartsLevel(id: ComponentId, center: THREE.Vector3, start: () => THREE.Vector3, slot: SlotKey): { level: Level; targets: [THREE.Object3D, THREE.Vector3][]; extent: number } {
    const kids = childrenOf(id, arch);
    const group = new THREE.Group();
    group.name = `level:${id}`;
    const parts = new Map<ComponentId, THREE.Object3D>();
    const base = new Map<ComponentId, THREE.Vector3>();
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
      text.userData.label = true;
      // Just under the part; experts sit closer (and their grid rows further apart, hierarchy.ts) so no
      // caption hides under the cube of the next row.
      text.position.set(0, -0.2, -(c.kind === 'bank' ? 1.6 : c.kind === 'expert' ? 0.8 : 0.95));
      mesh.add(text);
      group.add(mesh);
      parts.set(c.id, mesh);
      const at = center.clone().add(new THREE.Vector3(...c.pos));
      base.set(c.id, at);
      targets.push([mesh, at.clone()]);
      extent = Math.max(extent, Math.abs(c.pos[0]) + 1, Math.abs(c.pos[2]) + 1);
    }
    return { level: { id, group, center, parts, tile: null, base, nudge: new Map(), open: null, slot }, targets, extent };
  }

  function addLanes(level: Level): void {
    const p = parseId(level.id);
    if (p?.type !== 'slab') return;
    const lanes = new THREE.Group();
    lanes.name = 'lanes';
    lanes.visible = false;
    for (const s of STREAMS) {
      for (const pid of lanePath(p.layer, s)) {
        if (!level.base.has(pid)) throw new Error(`lane ${s} references ${pid}, not part of the slab`);
      }
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: streamColor(s), linewidth: 2 }),
      );
      line.name = `lane.${s}`;
      lanes.add(line);
    }
    level.group.add(lanes);
    level.group.userData.lanes = lanes;
    layoutLanes(level, null);
  }

  /** Ids from slab `layer` down to `id` (the slab first, `id` last), or null when `id` is not inside it. */
  const pathFromSlab = (layer: number, id: ComponentId): ComponentId[] | null => {
    const walk = (at: ComponentId): ComponentId[] | null => {
      if (at === id) return [at];
      for (const c of childrenOf(at, arch)) {
        const rest = walk(c.id);
        if (rest) return [at, ...rest];
      }
      return null;
    };
    return walk(slabId(layer));
  };

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
      // From the row, a part opens through its slab (and any level between): the slab's other parts
      // make room exactly as in a nested open, and every level moves in one combined tween.
      const chain = cur ? [id] : pathFromSlab(p.layer, id);
      if (!chain) return;
      const slot: SlotKey = cur ? cur.slot : p.layer;
      const built: Built[] = [];
      const drop = (): void => { for (const b of built) disposeTree(b.level.group); };
      let parent: Level | undefined = cur;
      let start = new THREE.Vector3(tower.slabX(p.layer), 0, 0);
      try {
        for (const cid of chain) {
          const cp = parseId(cid)!;
          // A nested level opens around its part where the parent laid it out; the first one around the slab.
          const center = parent ? targetOf(parent, cid) : new THREE.Vector3(tower.slabX(p.layer), 0, 0);
          // Parts fly out of the part as drawn now (the parent's part, or the row instance when there is one).
          if (parent && parent === cur) start = cur.parts.get(cid)?.position.clone() ?? center.clone();
          else if (tower.has(cid)) start = tower.anchor(cid);
          const from = start.clone();
          if (cp.type === 'matrix') {
            loading = true;
            let level: Level;
            try {
              level = await buildMatrixLevel(cid, center, from, slot);
            } finally {
              loading = false;
            }
            built.push({ level, targets: [[level.parts.get(cid)!, center.clone()]], extent: Math.max(level.tile!.rows, level.tile!.cols) * CELL / 2 + 1 });
            // The stack changed while the weights loaded (a close, another open): this open is stale.
            if (top() !== cur) {
              drop();
              return;
            }
          } else {
            built.push(buildPartsLevel(cid, center, () => from.clone(), slot));
          }
          parent = built[built.length - 1]!.level;
        }
      } catch (err) {
        drop();
        throw err;
      }

      setLanesVisible(false);
      if (cur) {
        // The parent stays as context: the opened part gives way to its own parts, its siblings make room.
        cur.open = chain[0]!;
        const part = cur.parts.get(chain[0]!);
        if (part) part.visible = false;
      } else {
        dim();
        tower.hide(chain[0]!);
      }
      built.forEach(({ level }, k) => {
        const below = built[k - 1]?.level;
        if (below) {
          below.open = level.id;
          const part = below.parts.get(level.id);
          if (part) part.visible = false;
        }
        stack.push(level);
        root.add(level.group);
        addLanes(level);
      });
      const last = built[built.length - 1]!;
      flyTo(last.level, last.extent);
      deps.onChange?.(id);
      const moves = built.flatMap((b) => b.targets.map(([o, to]) => animate(o, to, 0.2, 1)));
      await Promise.all([...moves, ...relayout()]);
      if (top() === last.level) showLanes();
    },

    async reassemble() {
      const level = stack.pop();
      if (!level) return;
      closing++;
      setLanesVisible(false);
      const lanes = level.group.userData.lanes as THREE.Object3D | undefined;
      if (lanes) lanes.visible = false;
      const prev = top();
      deps.onChange?.(prev?.id ?? null);
      if (prev) {
        prev.open = null;
        flyTo(prev, 8);
      }
      const back = prev ? targetOf(prev, level.id)
        : (tower.has(level.id) ? tower.anchor(level.id) : level.center.clone());
      try {
        await Promise.all([
          ...[...level.parts.values()].map((o) => animate(o, back, 1, 0.2)),
          ...relayout(),
        ]);
      } finally {
        closing--;
      }
      root.remove(level.group);
      disposeTree(level.group);
      if (prev) {
        const part = prev.parts.get(level.id);
        if (part) part.visible = true;
        if (top() === prev) showLanes();
      }
      // Only once everything is closed and no other close still animates: a slab opened meanwhile
      // keeps its originals hidden and the row dimmed.
      if (stack.length === 0 && closing === 0) {
        tower.unhide();
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
    box: () => openBox(),

    update(dt) {
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i]!;
        tw.t = Math.min(tw.t + dt, tw.dur);
        const k = ease(tw.t / tw.dur);
        tw.obj.position.lerpVectors(tw.from, tw.to, k);
        tw.obj.scale.setScalar(tw.scaleFrom + (tw.scaleTo - tw.scaleFrom) * k);
        if (tw.t >= tw.dur) {
          tweens.splice(i, 1);
          tw.done();
        }
      }
      const st = shiftTw;
      if (st) {
        st.t = Math.min(st.t + dt, st.dur);
        if (st.t >= st.dur) {
          shiftTw = null;
          writeRow(st.to); // exact end values: reassembling restores the base matrices bit for bit
          st.done();
        } else {
          const k = ease(st.t / st.dur);
          writeRow({ shift: lerpArr(st.from.shift, st.to.shift, k), fade: lerpArr(st.from.fade, st.to.fade, k) });
        }
      }
    },

    refreshLook(swap) {
      const was = isDimmed;
      if (was) undim();
      try {
        swap();
      } finally {
        if (was) dim();
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
      if (shiftTw) {
        const st = shiftTw;
        shiftTw = null;
        st.done();
      }
      for (const tw of tweens.splice(0)) tw.done();
      tower.setLaneGap(null);
      writeRow({ shift: new Float64Array(slots.length), fade: new Float64Array(layers).fill(1) });
      tower.unhide();
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

/** Cubic ease in and out (the camera uses the same curve). */
function ease(s: number): number {
  return s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
}
