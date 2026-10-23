// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import fixture from './fixtures/L12.fixture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateLayerWeights } from '../src/data/weights';
import { NUDGE_MARGIN, createExplode } from '../src/scene/explode';
import { childrenOf } from '../src/scene/hierarchy';
import { buildTower } from '../src/scene/tower';
import { createAnimator } from '../src/flow/animate';
import type { ExpertsData, Op } from '../src/flow/timeline';

const a = validateArchitecture(arch);
const loadWeights = async () => validateLayerWeights(fixture);
const noLabel = () => new THREE.Object3D();

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function setup(ms = 0, reducedMotion?: () => boolean) {
  const tower = buildTower(a);
  const rig = { flyTo: vi.fn(() => Promise.resolve()), escapeGuard: null as (() => boolean) | null };
  const view = createExplode({ tower, arch: a, rig, loadWeights, label: noLabel, ms, ...(reducedMotion ? { reducedMotion } : {}) });
  cleanup.push(() => view.dispose());
  return { tower, rig, view };
}

/** Runs an animated explode/reassemble to its end by ticking the view. */
async function settle(view: ReturnType<typeof createExplode>, p: Promise<void>): Promise<void> {
  for (let i = 0; i < 60; i++) view.update(1 / 30);
  await p;
}

/** World AABB of what the row draws for `layer`, read back from the instance matrices. */
function drawnLayerBox(tower: ReturnType<typeof buildTower>, layer: number): THREE.Box3 {
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const b = new THREE.Box3();
  const s = new THREE.Vector3();
  tower.root.updateMatrixWorld(true);
  tower.root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    const ids = im.userData.ids as string[] | undefined;
    if (!im.isInstancedMesh || !ids) return;
    if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
    ids.forEach((id, i) => {
      if (id !== `L${layer}` && !id.startsWith(`L${layer}.`)) return;
      im.getMatrixAt(i, m);
      if (s.setFromMatrixScale(m).lengthSq() === 0) return;
      box.union(b.copy(im.geometry.boundingBox!).applyMatrix4(m.premultiply(im.matrixWorld)));
    });
  });
  return box;
}

function matrices(tower: ReturnType<typeof buildTower>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  tower.root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) out[im.name] = [...im.instanceMatrix.array];
  });
  return out;
}

/** x ranges of the drawn lane segments of one stream, sorted. */
function laneSegments(tower: ReturnType<typeof buildTower>, s: 'A' | 'B'): [number, number][] {
  const lane = tower.root.getObjectByName(`shaft.${s}`) as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  const out: [number, number][] = [];
  for (let i = 0; i < lane.count; i++) {
    lane.getMatrixAt(i, m);
    const len = m.elements[0];
    if (len === 0) continue;
    const cx = m.elements[12];
    out.push([cx - len / 2, cx + len / 2]);
  }
  return out.sort((p, q) => p[0] - q[0]);
}

const SIBLINGS = ['A', 'B'].flatMap((s) => ['ln1', 'attn', 'ln2', 'router'].map((k) => `L20.${s}.${k}`));

describe('exploded parts nudge neighbours aside', () => {
  it('exploding layer 20 leaves no neighbour AABB intersecting the exploded box', async () => {
    const { tower, view } = setup(0);
    await view.explode('L20');
    const box = view.box()!;
    expect(box).not.toBeNull();
    // The box holds every exploded part (and the margin around them).
    view.root.updateMatrixWorld(true);
    expect(box.containsBox(new THREE.Box3().setFromObject(view.root))).toBe(true);
    for (const l of [18, 19, 21, 22]) {
      const nb = drawnLayerBox(tower, l);
      expect(nb.isEmpty()).toBe(false);
      expect(nb.intersectsBox(box), `layer ${l}`).toBe(false);
    }
    // Left of the slab moves left, right moves right, the slab itself stays.
    expect(tower.layerShift[20]).toBe(0);
    expect(tower.layerShift[19]).toBeLessThan(0);
    expect(tower.layerShift[21]).toBeGreaterThan(0);
    for (let l = 0; l < 20; l++) expect(tower.layerShift[l]).toBe(tower.layerShift[19]);
    for (let l = 21; l < 46; l++) expect(tower.layerShift[l]).toBe(tower.layerShift[21]);
    expect(tower.endShift.embed).toBe(tower.layerShift[19]);
    expect(tower.endShift.lm_head).toBe(tower.layerShift[21]);
    // Just far enough: the nearest neighbours end within a hair of the box edge.
    expect(box.min.x - drawnLayerBox(tower, 19).max.x).toBeLessThan(0.01);
    expect(drawnLayerBox(tower, 21).min.x - box.max.x).toBeLessThan(0.01);
  });

  it('reassemble restores every instance matrix exactly', async () => {
    const { tower, view } = setup(500);
    const before = matrices(tower);
    await settle(view, view.explode('L20'));
    await settle(view, view.explode('L20.bank'));
    await settle(view, view.explode('L20.expert.3'));
    expect(matrices(tower)).not.toEqual(before);
    for (let k = 0; k < 3; k++) await settle(view, view.reassemble());
    expect(view.depth()).toBe(0);
    const after = matrices(tower);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [name, arr] of Object.entries(before)) {
      const got = after[name]!;
      expect(got).toHaveLength(arr.length);
      let worst = 0;
      arr.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - got[i]!)); });
      expect(worst, name).toBeLessThan(1e-6);
    }
    expect([...tower.layerShift].every((x) => x === 0)).toBe(true);
  });

  it('nested: opening the expert bank inside an exploded slab nudges attn/router/ln siblings so no sibling AABB intersects the bank box', async () => {
    const { tower, view } = setup(0);
    await view.explode('L20');
    const rowBefore = [...tower.layerShift];
    const centre = new THREE.Vector3(tower.slabX(20), 0, 0);
    const baseOf = (id: string): THREE.Vector3 => {
      const c = childrenOf('L20', a).find((k) => k.id === id)!;
      return centre.clone().add(new THREE.Vector3(...c.pos));
    };
    await view.explode('L20.bank');
    expect(view.depth()).toBe(2);
    const bankLevel = view.root.children[1]!;
    view.root.updateMatrixWorld(true);
    const bankBox = new THREE.Box3().setFromObject(bankLevel);
    const withMargin = bankBox.clone().expandByScalar(NUDGE_MARGIN);
    let moved = 0;
    for (const id of SIBLINGS) {
      const o = view.root.getObjectByName(id)!;
      expect(o.visible).toBe(true); // the parent stays as context
      expect(new THREE.Box3().setFromObject(o).intersectsBox(withMargin), id).toBe(false);
      if (o.position.x < baseOf(id).x - 1e-6) moved++;
    }
    expect(moved).toBe(SIBLINGS.length); // all siblings sit left of the bank and moved left together
    // The slab's lanes stop at the bank's box instead of running through its experts.
    for (const s of ['A', 'B']) {
      const lane = view.root.children[0]!.getObjectByName(`lane.${s}`) as THREE.LineSegments;
      const pos = lane.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        expect(x <= withMargin.min.x + 1e-6 || x >= withMargin.max.x - 1e-6, `lane ${s} x ${x}`).toBe(true);
      }
    }
    // The parent grew, so the row gap grew with it and the chain stays clear of the neighbours.
    expect(tower.layerShift[19]).toBeLessThanOrEqual(rowBefore[19]!);
    expect(tower.layerShift[21]).toBeGreaterThanOrEqual(rowBefore[21]!);
    expect(tower.layerShift[19]! < rowBefore[19]! || tower.layerShift[21]! > rowBefore[21]!).toBe(true);
    const all = view.box()!;
    expect(all.containsBox(new THREE.Box3().setFromObject(view.root))).toBe(true);
    for (const l of [19, 21]) expect(drawnLayerBox(tower, l).intersectsBox(all)).toBe(false);

    // Closing the bank reverses only that level's nudge.
    await view.reassemble();
    expect(view.depth()).toBe(1);
    for (const id of SIBLINGS) {
      expect(view.root.getObjectByName(id)!.position.distanceTo(baseOf(id))).toBeLessThan(1e-9);
    }
    expect(view.root.getObjectByName('L20.bank')!.visible).toBe(true);
    [...tower.layerShift].forEach((x, l) => expect(x).toBeCloseTo(rowBefore[l]!, 9));
  });

  it('nested attention: same-x and right siblings move right, left ones left, none overlaps the heads', async () => {
    const { view } = setup(0);
    await view.explode('L20');
    await view.explode('L20.A.attn');
    view.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(view.root.children[1]!).expandByScalar(NUDGE_MARGIN);
    for (const id of [...SIBLINGS.filter((s) => s !== 'L20.A.attn'), 'L20.bank']) {
      const o = view.root.getObjectByName(id)!;
      expect(new THREE.Box3().setFromObject(o).intersectsBox(box), id).toBe(false);
    }
    expect(view.root.getObjectByName('L20.A.attn')!.visible).toBe(false);
  });

  it('anchor(id) follows the shift', async () => {
    const { tower, view } = setup(0);
    const base = tower.anchor('L21.expert.3');
    // The player overlay is on show before the explode; its marks must follow the row.
    const anim = createAnimator(tower);
    cleanup.push(() => anim.dispose());
    const value: ExpertsData = { position: 0, lit: [3, 4, 5], dark: [], weights: [0.5, 0.3, 0.2], litOutputScales: [0.4, 0.4, 0.4] };
    anim.show({ kind: 'experts', layer: 21, stream: 'A', data: { value }, caveats: [] } as unknown as Op);
    await view.explode('L20');
    const s = tower.layerShift[21]!;
    expect(s).toBeGreaterThan(0);
    const now = tower.anchor('L21.expert.3');
    expect(now.x).toBeCloseTo(base.x + s, 9);
    expect([now.y, now.z]).toEqual([base.y, base.z]);
    expect(anim.root.getObjectByName('lit:L21.expert.3')!.position.distanceTo(now)).toBeLessThan(1e-9);
    // The drawn instance is there too, so picking hits the nudged position, not the old one.
    const experts = tower.root.getObjectByName('experts') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    experts.getMatrixAt((experts.userData.ids as string[]).indexOf('L21.expert.3'), m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(now)).toBeLessThan(1e-4);
    tower.root.updateMatrixWorld(true);
    const hitIds = (x: number): (string | null)[] => new THREE.Raycaster(
      new THREE.Vector3(x, -20, now.z), new THREE.Vector3(0, 1, 0),
    ).intersectObject(tower.root, true).map((h) => tower.pick(h));
    expect(hitIds(now.x)).toContain('L21.expert.3');
    expect(hitIds(base.x)).not.toContain('L21.expert.3');
    await view.reassemble();
    expect(tower.anchor('L21.expert.3').toArray()).toEqual(base.toArray());
    expect(anim.root.getObjectByName('lit:L21.expert.3')!.position.distanceTo(base)).toBeLessThan(1e-9);
  });

  it('edge layer 0 and 45 only shift one side', async () => {
    const { tower, view } = setup(0);
    await view.explode('L0');
    expect(tower.layerShift[0]).toBe(0);
    for (let l = 1; l < 46; l++) expect(tower.layerShift[l]).toBeGreaterThan(0);
    expect(tower.endShift.embed).toBeLessThanOrEqual(0); // the row end before it may step aside, no layer does
    expect(drawnLayerBox(tower, 1).intersectsBox(view.box()!)).toBe(false);
    await view.reassemble();
    await view.explode('L45');
    expect(tower.layerShift[45]).toBe(0);
    for (let l = 0; l < 45; l++) expect(tower.layerShift[l]).toBeLessThan(0);
    expect(tower.endShift.ln_f).toBeGreaterThanOrEqual(0);
    expect(tower.endShift.lm_head).toBeGreaterThanOrEqual(0);
    expect(drawnLayerBox(tower, 44).intersectsBox(view.box()!)).toBe(false);
  });

  it('reduced motion applies the shift instantly', async () => {
    const { tower, view } = setup(700, () => true);
    const slabs = tower.root.getObjectByName('slabs') as THREE.InstancedMesh;
    const x21 = (): number => {
      const m = new THREE.Matrix4();
      slabs.getMatrixAt(21, m);
      return m.elements[12];
    };
    const base = x21();
    await view.explode('L20'); // no update() ticks: nothing animates
    expect(tower.layerShift[21]).toBeGreaterThan(0);
    expect(x21()).toBeCloseTo(base + tower.layerShift[21]!, 4);

    // With motion the same shift tweens over the explode's length.
    const moving = setup(700, () => false);
    const p = moving.view.explode('L20');
    expect(moving.tower.layerShift[21]).toBe(0);
    moving.view.update(0.35);
    const mid = moving.tower.layerShift[21]!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(tower.layerShift[21]!);
    await settle(moving.view, p);
    expect(moving.tower.layerShift[21]).toBeCloseTo(tower.layerShift[21]!, 9);
  });

  it('row lanes stop at the exploded box and stay continuous elsewhere', async () => {
    const { tower, view } = setup(0);
    const whole = laneSegments(tower, 'A');
    // Float32 instance matrices: ends meet within 1e-4.
    for (let i = 1; i < whole.length; i++) expect(whole[i]![0]).toBeCloseTo(whole[i - 1]![1], 4);
    await view.explode('L20');
    const box = view.box()!;
    for (const s of ['A', 'B'] as const) {
      const segs = laneSegments(tower, s);
      let gaps = 0;
      for (let i = 1; i < segs.length; i++) {
        const gap = segs[i]![0] - segs[i - 1]![1];
        if (gap > 1e-3) {
          gaps++;
          expect(segs[i - 1]![1]).toBeCloseTo(box.min.x, 4);
          expect(segs[i]![0]).toBeCloseTo(box.max.x, 4);
        } else expect(Math.abs(gap)).toBeLessThan(1e-3);
      }
      expect(gaps).toBe(1);
      for (const [x0, x1] of segs) expect(x1 <= box.min.x + 1e-3 || x0 >= box.max.x - 1e-3).toBe(true);
      expect(segs[0]![0]).toBeCloseTo(tower.anchor('embed').x, 4);
      expect(segs[segs.length - 1]![1]).toBeCloseTo(tower.anchor('lm_head').x, 4);
    }
    await view.reassemble();
    expect(laneSegments(tower, 'A')).toEqual(whole);
  });

  it('instanced outlines move with their parts and keep a matching culling sphere', async () => {
    const { tower, view } = setup(0);
    await view.explode('L20');
    for (const name of ['experts', 'attn', 'router', 'ln1', 'ln2', 'slabs']) {
      const m = tower.root.getObjectByName(name) as THREE.InstancedMesh;
      const outline = (name === 'slabs' ? tower.root.getObjectByName('slab-edges') : m.getObjectByName(`${name}-edges`)) as
        THREE.LineSegments & { instanceMatrix?: THREE.InstancedBufferAttribute };
      expect(outline.instanceMatrix).toBe(m.instanceMatrix);
      expect(outline.geometry.boundingSphere!.equals(m.boundingSphere!)).toBe(true);
    }
  });

  it('a quality swap while shifted keeps the shift, and the row objects and draw calls stay the same', async () => {
    const { tower, view } = setup(0);
    const objects = (): THREE.Object3D[] => {
      const out: THREE.Object3D[] = [];
      tower.root.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine) out.push(o); });
      return out;
    };
    const before = objects();
    await view.explode('L20');
    await view.explode('L20.bank');
    const shifted = matrices(tower);
    const slabs = tower.root.getObjectByName('slabs') as THREE.Mesh;
    const fresh = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
    view.refreshLook(() => { slabs.material = fresh; });
    expect(fresh.opacity).toBeCloseTo(0.4 * 0.15);
    expect(matrices(tower)).toEqual(shifted);
    expect(objects()).toEqual(before); // no per-slab meshes: the same instanced objects, moved
    await view.reassemble();
    await view.reassemble();
    expect(fresh.opacity).toBe(0.4);
    expect(objects()).toEqual(before);
  });
});
