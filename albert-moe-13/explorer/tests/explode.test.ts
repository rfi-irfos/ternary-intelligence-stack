// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import fixture from './fixtures/L12.fixture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateLayerWeights } from '../src/data/weights';
import { createControls } from '../src/camera/controls';
import { createExplode, fitFontPx } from '../src/scene/explode';
import { childrenOf, lanePath } from '../src/scene/hierarchy';
import { tileGrid } from '../src/scene/tile';
import { PALETTE } from '../src/scene/palette';
import { LANE_Y, buildTower } from '../src/scene/tower';
import { attachPicking, isClick } from '../src/ui/picking';

const a = validateArchitecture(arch);
const loadWeights = async () => validateLayerWeights(fixture);
const noLabel = () => new THREE.Object3D();

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function setup(ms = 0) {
  const tower = buildTower(a);
  const rig = { flyTo: vi.fn(() => Promise.resolve()), escapeGuard: null as (() => boolean) | null };
  const view = createExplode({ tower, arch: a, rig, loadWeights, label: noLabel, ms });
  cleanup.push(() => view.dispose());
  return { tower, rig, view };
}

function snapshot(tower: ReturnType<typeof buildTower>) {
  const out: Record<string, number[]> = {};
  tower.root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) out[im.name] = [...im.instanceMatrix.array];
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) out[`${o.name}#mat${m.uuid}`] = [m.opacity, m.transparent ? 1 : 0, m.depthWrite ? 1 : 0];
  });
  return out;
}

describe('hierarchy', () => {
  it('slab -> ln1, attn, ln2, router per stream plus the bank', () => {
    const ids = childrenOf('L12', a).map((c) => c.id);
    expect(ids).toEqual([
      'L12.A.ln1', 'L12.A.attn', 'L12.A.ln2', 'L12.A.router',
      'L12.B.ln1', 'L12.B.attn', 'L12.B.ln2', 'L12.B.router', 'L12.bank',
    ]);
  });
  it('attn -> Q, K, V, O and four heads; bank -> 12 experts; expert -> four parts', () => {
    expect(childrenOf('L12.A.attn', a).map((c) => c.label)).toEqual(['Q', 'K', 'V', 'head 0', 'head 1', 'head 2', 'head 3', 'O']);
    expect(childrenOf('L12.bank', a)).toHaveLength(12);
    expect(childrenOf('L12.expert.7', a).map((c) => c.label)).toEqual(['seed_bias', 'c_fc', 'GELU', 'c_proj']);
    expect(childrenOf('L12.A.attn.q', a)).toEqual([]);
  });
  it('lane B does not pass through attn of stream A', () => {
    const b = lanePath(12, 'B');
    expect(b).toEqual(['L12.B.ln1', 'L12.B.attn', 'L12.B.ln2', 'L12.B.router', 'L12.bank']);
    expect(b.filter((id) => id.includes('.A.'))).toEqual([]);
    expect(lanePath(12, 'A')).toContain('L12.A.attn');
    expect(lanePath(12, 'A').filter((id) => id.includes('.B.'))).toEqual([]);
    const kids = childrenOf('L12', a);
    const attnA = kids.find((k) => k.id === 'L12.A.attn')!;
    for (const id of b.filter((i) => i !== 'L12.bank')) {
      expect(kids.find((k) => k.id === id)!.pos[1]).toBe(LANE_Y.B);
    }
    expect(attnA.pos[1]).toBe(LANE_Y.A);
    // the lanes meet only in the shared bank
    expect(b.filter((id) => lanePath(12, 'A').includes(id))).toEqual(['L12.bank']);
  });
});

describe('explode view', () => {
  it('explode then reassemble restores every transform', async () => {
    const { tower, view } = setup(0);
    const scene = new THREE.Scene();
    scene.add(tower.root, view.root);
    const before = snapshot(tower);

    await view.explode('L12');
    expect(view.depth()).toBe(1);
    expect(view.root.children).toHaveLength(1);
    expect(snapshot(tower)).not.toEqual(before); // row dimmed, slab-12 instances hidden
    await view.explode('L12.A.attn');
    expect(view.depth()).toBe(2);
    await view.explode('L12.A.attn.q');
    expect(view.depth()).toBe(3);
    await view.reassemble();
    await view.reassemble();
    expect(view.depth()).toBe(1);
    expect(snapshot(tower)).not.toEqual(before);
    await view.reassemble();
    expect(view.depth()).toBe(0);
    expect(view.root.children).toHaveLength(0);
    expect(snapshot(tower)).toEqual(before);
  });

  it('a quality change while exploded dims the new materials and reassemble restores them', async () => {
    const { tower, view } = setup(0);
    const slabs = tower.root.getObjectByName('slabs') as THREE.Mesh;
    const oldMat = slabs.material as THREE.Material;
    const oldOpacity = oldMat.opacity;
    await view.explode('L12');
    expect(oldMat.opacity).toBeCloseTo(oldOpacity * 0.15);
    const fresh = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
    view.refreshLook(() => {
      slabs.material = fresh; // what look.applyQuality does to every tagged mesh
    });
    expect(oldMat.opacity).toBe(oldOpacity); // the cached old preset is left clean
    expect(fresh.opacity).toBeCloseTo(0.4 * 0.15); // the row stays faded behind the open level
    view.refreshLook(() => {}); // a second switch does not dim twice
    expect(fresh.opacity).toBeCloseTo(0.4 * 0.15);
    await view.reassemble();
    expect(fresh.opacity).toBe(0.4);
    // Without an open level the swap runs as is.
    view.refreshLook(() => {});
    expect(fresh.opacity).toBe(0.4);
  });

  it('restores through animated tweens', async () => {
    const { tower, view } = setup(500);
    const before = snapshot(tower);
    const p = view.explode('L12.expert.7');
    for (let i = 0; i < 60; i++) view.update(1 / 30);
    await p;
    const part = view.root.getObjectByName('L12.expert.7.c_fc')!;
    expect(part.position.distanceTo(tower.anchor('L12.expert.7'))).toBeGreaterThan(1);
    const r = view.reassemble();
    for (let i = 0; i < 60; i++) view.update(1 / 30);
    await r;
    expect(snapshot(tower)).toEqual(before);
  });

  it('exploded parts spread to the hierarchy layout around the slab', async () => {
    const { tower, view } = setup(0);
    await view.explode('L12');
    const centre = new THREE.Vector3(tower.slabX(12), 0, 0);
    for (const c of childrenOf('L12', a)) {
      const part = view.root.getObjectByName(c.id)!;
      expect(part.position.distanceTo(centre.clone().add(new THREE.Vector3(...c.pos)))).toBeLessThan(1e-9);
    }
    expect(view.root.getObjectByName('lane.A')).toBeDefined();
    expect(view.root.getObjectByName('lane.B')).toBeDefined();
  });

  it('matrix level shows 32×32 tile from weights/L{n}.json labelled structure', async () => {
    const { view } = setup(0);
    await view.explode('L12.A.attn.q');
    const t = view.tile()!;
    expect([t.rows, t.cols]).toEqual([32, 32]);
    expect(t.colors).toHaveLength(1024);
    expect(t.colors[0]).toBe(PALETTE.ternaryPlus); // '+' warm
    expect(t.colors[1]).toBe(PALETTE.ternaryMinus); // '-' cold
    expect(t.gamma).toBe(0.1);
    expect(t.tau).toBe(0.0153);
    let cells = 0;
    view.root.traverse((o) => {
      if (o.name === 'tile-cells') cells = (o as THREE.InstancedMesh).count;
    });
    expect(cells).toBe(1024);
  });

  it('F32 router gate renders a diverging scale', () => {
    const g = tileGrid(fixture.matrices[1] as never);
    expect([g.rows, g.cols]).toEqual([12, 32]);
    expect(new Set(g.colors).size).toBeGreaterThan(5);
  });

  it('Esc reassembles one level first, then the rig flies to overview', async () => {
    const tower = buildTower(a);
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const overview = vi.spyOn(rig, 'overview');
    const view = createExplode({ tower, arch: a, rig, loadWeights, label: noLabel, ms: 0 });
    cleanup.push(() => view.dispose());
    await view.explode('L12');
    await view.explode('L12.A.attn');
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    esc();
    expect(view.depth()).toBe(1);
    expect(overview).not.toHaveBeenCalled();
    esc();
    expect(view.depth()).toBe(0);
    expect(overview).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0)); // let the last reassemble finish
    esc();
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('Esc never pops a level and flies to overview in one keypress, whichever listener is registered first', async () => {
    const tower = buildTower(a);
    // explode is created (and registers its keydown listener) before the rig exists.
    const shim = { flyTo: vi.fn(() => Promise.resolve()), escapeGuard: null as (() => boolean) | null };
    const view = createExplode({ tower, arch: a, rig: shim, loadWeights, label: noLabel, ms: 700 });
    cleanup.push(() => view.dispose());
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const overview = vi.spyOn(rig, 'overview');
    const tick = (s: number) => { for (let i = 0; i < 20; i++) view.update(s / 20); };
    const open = async (id: string) => { const p = view.explode(id); tick(1); await p; };
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    await open('L12');
    await open('L12.A.attn');
    expect(view.depth()).toBe(2);
    esc();
    expect(view.depth()).toBe(1);
    expect(overview).not.toHaveBeenCalled();
    esc(); // second Esc while the first reassemble still animates
    expect(view.depth()).toBe(0);
    expect(overview).not.toHaveBeenCalled();
    esc(); // third Esc while the last reassemble still animates: swallowed, no jump to overview
    expect(overview).not.toHaveBeenCalled();
    tick(1);
    await new Promise((r) => setTimeout(r, 0));
    esc(); // everything closed: now the rig may fly to overview
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('Esc with the rig created before explode: animated closes swallow extra Esc, overview only after settling', async () => {
    const tower = buildTower(a);
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const overview = vi.spyOn(rig, 'overview');
    const view = createExplode({ tower, arch: a, rig, loadWeights, label: noLabel, ms: 700 });
    cleanup.push(() => view.dispose());
    const tick = (s: number) => { for (let i = 0; i < 20; i++) view.update(s / 20); };
    const open = async (id: string) => { const p = view.explode(id); tick(1); await p; };
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await open('L12');
    await open('L12.A.attn');
    esc();
    expect(view.depth()).toBe(1);
    esc();
    expect(view.depth()).toBe(0);
    esc(); // during the reassemble animation
    expect(overview).not.toHaveBeenCalled();
    tick(1);
    await new Promise((r) => setTimeout(r, 0));
    esc();
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('tile captions are structure labels and fit: one short line each, never a long single line', async () => {
    const calls: [string, string | undefined][] = [];
    const tower = buildTower(a);
    const rig = { flyTo: vi.fn(() => Promise.resolve()), escapeGuard: null as (() => boolean) | null };
    const view = createExplode({
      tower, arch: a, rig, loadWeights, ms: 0,
      label: (t, k) => { calls.push([t, k]); return new THREE.Object3D(); },
    });
    cleanup.push(() => view.dispose());
    await view.explode('L12');
    await view.explode('L12.A.attn');
    calls.length = 0;
    await view.explode('L12.A.attn.q');
    expect(calls.map((c) => c[0])).toEqual([
      'stream_a.attn.q_proj.weight', 'γ 0.1 · τ 0.0153', '−1 40.0 % · 0 20.0 % · +1 40.0 %',
    ]);
    for (const [t, k] of calls) {
      expect(k).toBe('structure');
      expect(t.length).toBeLessThanOrEqual(40);
    }
  });

  it('label font shrinks until the text fits', () => {
    expect(fitFontPx((px) => px * 10, 400)).toBe(30);
    expect(fitFontPx((px) => px * 20, 400)).toBe(20);
    expect(fitFontPx(() => 9999, 400)).toBe(12);
  });

  it('picks parts only from the open level', async () => {
    const { tower, view } = setup(0);
    expect(view.pickRoot()).toBe(tower.root);
    await view.explode('L12');
    expect(view.pickRoot()).toBe(view.root.children[0]);
    const part = view.root.getObjectByName('L12.A.attn')!;
    expect(view.pick({ object: part } as THREE.Intersection)).toBe('L12.A.attn');
  });
});

describe('click picking', () => {
  function rigUp() {
    const dom = document.createElement('canvas');
    const h = { pickAt: vi.fn(() => 'L1.expert.0' as string | null), onPick: vi.fn(), onEmpty: vi.fn(), onHover: vi.fn() };
    cleanup.push(attachPicking(dom, h));
    const fire = (type: string, x: number, y: number, buttons = 0) =>
      dom.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons }));
    return { h, fire };
  }

  it('pointerup or click without a canvas pointerdown never picks (tab activation, focus click)', () => {
    let t = 0;
    const dom = document.createElement('canvas');
    document.body.append(dom);
    const h = { pickAt: vi.fn(() => 'L23.expert.6' as string | null), onPick: vi.fn(), onEmpty: vi.fn() };
    cleanup.push(attachPicking(dom, h, () => t), () => dom.remove());
    const fire = (type: string, x: number, y: number, target: EventTarget = dom) =>
      target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    fire('pointerup', 100, 100);
    fire('click', 100, 100);
    fire('mouseup', 100, 100);
    // Press elsewhere on the page, release on the canvas.
    fire('pointerdown', 100, 100, document.body);
    fire('pointerup', 100, 100);
    // Press on the canvas, window loses focus, release.
    fire('pointerdown', 100, 100);
    window.dispatchEvent(new Event('blur'));
    fire('pointerup', 100, 100);
    // Press, cancelled by the browser, release.
    fire('pointerdown', 100, 100);
    fire('pointercancel', 100, 100);
    fire('pointerup', 100, 100);
    // A long hold is not a click.
    fire('pointerdown', 100, 100);
    t += 1500;
    fire('pointerup', 100, 100);
    // One press releases once: a second pointerup does not pick again.
    fire('pointerdown', 100, 100);
    fire('pointerup', 101, 100);
    fire('pointerup', 101, 100);
    expect(h.pickAt).toHaveBeenCalledTimes(1);
    expect(h.onPick).toHaveBeenCalledTimes(1);
    expect(h.onEmpty).not.toHaveBeenCalled();
  });

  it('isClick allows up to 4 px', () => {
    expect(isClick({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false);
  });

  it('a click picks, a drag does not', () => {
    const { h, fire } = rigUp();
    fire('pointerdown', 100, 100, 1);
    fire('pointerup', 102, 101);
    expect(h.onPick).toHaveBeenCalledWith('L1.expert.0');
    fire('pointerdown', 100, 100, 1);
    fire('pointerup', 120, 100);
    expect(h.onPick).toHaveBeenCalledTimes(1);
    expect(h.onEmpty).not.toHaveBeenCalled();
  });

  it('a click on nothing reports empty space; hover is skipped while dragging', () => {
    const { h, fire } = rigUp();
    h.pickAt.mockReturnValue(null);
    fire('pointerdown', 5, 5, 1);
    fire('pointerup', 5, 5);
    expect(h.onEmpty).toHaveBeenCalledTimes(1);
    h.pickAt.mockClear();
    fire('pointermove', 9, 9, 1);
    expect(h.pickAt).not.toHaveBeenCalled();
    h.pickAt.mockReturnValue('L1.expert.0');
    fire('pointermove', 9, 9, 0);
    expect(h.onHover).toHaveBeenCalledWith('L1.expert.0');
  });
});
