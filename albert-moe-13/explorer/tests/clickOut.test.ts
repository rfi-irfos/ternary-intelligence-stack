// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import archJson from '../public/data/architecture.json';
import fixture from './fixtures/L12.fixture.json';
import { boxCorners, createControls } from '../src/camera/controls';
import { validateArchitecture } from '../src/data/architecture';
import { validateLayerWeights } from '../src/data/weights';
import { createExplode } from '../src/scene/explode';
import { buildTower } from '../src/scene/tower';
import { createRaycastPicker } from '../src/ui/picking';
import { emptyClick, pickAction } from '../src/ui/pickAction';
import { measureHud } from '../src/ui/hudInsets';
import { createPanel } from '../src/ui/panel';
import { onPrefsChange, setLang, setMode } from '../src/ui/prefs';
import { sceneName } from '../src/ui/roles';

/*
 * U3 (click into empty space folds everything back), R1 (the rig reads the HUD insets at fly time),
 * R8 (scene names follow DE/EN and Simple/Advanced without reopening) and R10 (labels under a HUD band fade).
 */
const arch = validateArchitecture(archJson);
const loadWeights = async () => validateLayerWeights(fixture);
const W = 1280;
const H = 720;

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  document.body.innerHTML = '';
  setLang('en');
  setMode('simple');
});

function world(opts: { ms?: number; label?: (t: string) => THREE.Object3D } = {}) {
  const tower = buildTower(arch);
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
  camera.up.set(0, 0, 1);
  const dom = document.createElement('canvas');
  Object.defineProperty(dom, 'clientWidth', { value: W });
  Object.defineProperty(dom, 'clientHeight', { value: H });
  dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
  document.body.appendChild(dom);
  const rig = createControls(camera, dom, tower.rowExtent);
  cleanup.push(() => rig.dispose());
  const view = createExplode({
    tower, arch, rig, loadWeights, ms: opts.ms ?? 0, reducedMotion: () => (opts.ms ?? 0) === 0,
    label: opts.label ?? (() => new THREE.Object3D()), name: sceneName, watch: onPrefsChange,
  });
  cleanup.push(() => view.dispose());
  const scene = new THREE.Scene();
  scene.add(tower.root, view.root);
  return { tower, camera, dom, rig, view, scene };
}

/** Every instance matrix of the row (the slabs, experts, glass ...). */
function matrices(tower: ReturnType<typeof buildTower>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  tower.root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) out.set(`${im.name}#${im.uuid}`, [...im.instanceMatrix.array]);
  });
  return out;
}
/** Visibility of every object of the row, by name and uuid. */
function visibility(tower: ReturnType<typeof buildTower>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  tower.root.traverse((o) => { out[`${o.name}#${o.uuid}`] = o.visible; });
  return out;
}
const expectSameMatrices = (a: Map<string, number[]>, b: Map<string, number[]>): void => {
  expect([...b.keys()]).toEqual([...a.keys()]);
  for (const [k, v] of a) {
    const w = b.get(k)!;
    expect(w.length, k).toBe(v.length);
    let worst = 0;
    for (let i = 0; i < v.length; i++) worst = Math.max(worst, Math.abs((v[i] as number) - (w[i] as number)));
    expect(worst, k).toBeLessThan(1e-6);
  }
};
const expectPose = (camera: THREE.PerspectiveCamera, target: THREE.Vector3, pose: { position: THREE.Vector3; target: THREE.Vector3 }): void => {
  expect(camera.position.distanceTo(pose.position)).toBeLessThan(1e-6);
  expect(target.distanceTo(pose.target)).toBeLessThan(1e-6);
};

describe('U3: an empty click folds every level back', () => {
  it('slab 9, then its bank, then an empty click: depth 0, every instance matrix at base, camera at the saved pose', async () => {
    const { tower, camera, rig, view } = world();
    await rig.overview(0);
    const base = matrices(tower);
    const saved = rig.pose();
    const closePanel = vi.fn();
    await view.explode('L9');
    await view.explode('L9.bank');
    expect(view.depth()).toBe(2);
    expect(camera.position.distanceTo(saved.position)).toBeGreaterThan(1); // the levels were framed
    await emptyClick({ depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel });
    expect(view.depth()).toBe(0);
    expect(view.root.children).toHaveLength(0);
    expect(closePanel).not.toHaveBeenCalled();
    expectSameMatrices(base, matrices(tower));
    expectPose(camera, rig.controls.target, saved);
  });

  it('animated: all levels close in ONE tween of the explode length; the camera flies back with it', async () => {
    const { tower, camera, rig, view } = world({ ms: 600 });
    await rig.overview(0);
    const base = matrices(tower);
    const saved = rig.pose();
    const tick = (s: number): void => { for (let i = 0; i < 30; i++) { view.update(s / 30); rig.update(s / 30); } };
    let p = view.explode('L9'); tick(1); await p;
    p = view.explode('L9.bank'); tick(1); await p;
    expect(view.depth()).toBe(2);
    const done = vi.fn();
    void view.reassembleAll().then(done);
    expect(view.depth()).toBe(0);
    tick(0.3);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    tick(0.35); // 0.65 s > 0.6 s: one tween, not one per level
    for (let i = 0; i < 5; i++) await Promise.resolve();
    tick(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toHaveBeenCalled();
    expectSameMatrices(base, matrices(tower));
    expectPose(camera, rig.controls.target, saved);
  });

  it('with a level open, a click on a dimmed neighbour slab is empty: depth 0, the neighbour does not explode', async () => {
    const { tower, camera, rig, view, dom } = world();
    await rig.overview(0);
    const base = matrices(tower);
    const baseVisible = visibility(tower);
    await view.explode('L9');
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const pickAt = createRaycastPicker(camera, dom, () => view.pickRoot(), (hit) => view.pick(hit));
    const rowPick = createRaycastPicker(camera, dom, () => tower.root, (hit) => tower.pick(hit));
    // Find a screen point on the dimmed slab L10 (or L8) that the open level does not cover.
    let at: { x: number; y: number; id: string } | null = null;
    for (const n of [10, 8, 11, 7]) {
      const c = tower.anchor(`L${n}`).clone();
      for (const dz of [0, 0.4, -0.4, 0.8, -0.8]) for (const dy of [0, 0.5, -0.5]) {
        const q = c.clone().add(new THREE.Vector3(0, dy, dz)).project(camera);
        const x = ((q.x + 1) / 2) * W;
        const y = ((1 - q.y) / 2) * H;
        if (x < 0 || x > W || y < 0 || y > H) continue;
        const row = rowPick(x, y);
        if (row?.id === `L${n}` && pickAt(x, y) === null) { at = { x, y, id: `L${n}` }; break; }
      }
      if (at) break;
    }
    expect(at, 'a visible neighbour slab outside the open level').not.toBeNull();
    // What the app does on pointerup: pick in the open level only; nothing there is an empty click.
    expect(pickAt(at!.x, at!.y)).toBeNull();
    await emptyClick({ depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel: vi.fn() });
    expect(view.depth()).toBe(0);
    expect(view.current()).toBeNull();
    // The neighbour (and the whole row) is back exactly as before: no level of its own, no hidden instance.
    expectSameMatrices(base, matrices(tower));
    expect(visibility(tower)).toEqual(baseVisible);
  });

  it('race: an empty click during a running explode tween folds everything; the row and the camera return', async () => {
    const { tower, camera, rig, view } = world({ ms: 600 });
    await rig.overview(0);
    const base = matrices(tower);
    const saved = rig.pose();
    const tick = (s: number): void => { for (let i = 0; i < 30; i++) { view.update(s / 30); rig.update(s / 30); } };
    const opening = view.explode('L9');
    tick(0.2); // the parts are on their way out, the camera is flying
    expect(view.depth()).toBe(1);
    const folding = emptyClick({ depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel: vi.fn() });
    tick(1);
    await Promise.all([opening, folding]);
    tick(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(view.depth()).toBe(0);
    expect(view.root.children).toHaveLength(0);
    expectSameMatrices(base, matrices(tower));
    expectPose(camera, rig.controls.target, saved);
  });

  it('race: an open during a running fold-all keeps the original pose; the next fold-all returns there', async () => {
    const { camera, rig, view } = world({ ms: 600 });
    await rig.overview(0);
    const saved = rig.pose();
    const tick = (s: number): void => { for (let i = 0; i < 30; i++) { view.update(s / 30); rig.update(s / 30); } };
    let p = view.explode('L9'); tick(1); await p;
    p = view.explode('L9.bank'); tick(1); await p;
    const fold = view.reassembleAll();
    tick(0.2); // the camera is half way back
    expect(rig.isFlying()).toBe(true);
    const reopen = view.explode('L30');
    tick(1);
    await Promise.all([fold, reopen]);
    expect(view.depth()).toBe(1);
    const fold2 = view.reassembleAll();
    tick(1.5);
    await fold2;
    expect(view.depth()).toBe(0);
    expectPose(camera, rig.controls.target, saved);
  });

  it('race: a fold-all while a matrix level still loads its weights drops that open', async () => {
    const tower = buildTower(arch);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const view = createExplode({
      tower, arch, rig: { flyTo: vi.fn(() => Promise.resolve()), escapeGuard: null }, ms: 600, reducedMotion: () => false,
      loadWeights: async () => { await gate; return validateLayerWeights(fixture); }, label: () => new THREE.Object3D(),
    });
    cleanup.push(() => view.dispose());
    const base = matrices(tower);
    const tick = (s: number): void => { for (let i = 0; i < 30; i++) view.update(s / 30); };
    const opening = view.explode('L12.A.attn.q'); // from the row: slab, attention, matrix (weights pending)
    await Promise.resolve();
    expect(view.depth()).toBe(0);
    const fold = view.reassembleAll();
    release();
    tick(1);
    await Promise.all([opening, fold]);
    tick(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(view.depth()).toBe(0);
    expect(view.root.children).toHaveLength(0);
    expectSameMatrices(base, matrices(tower));
  });

  it('layer mode owns its levels: an empty click leaves the depth and the camera alone', async () => {
    const { camera, rig, view } = world();
    await rig.overview(0);
    await view.explode('L9');
    await view.explode('L9.bank');
    const layerPanel = document.createElement('div'); // what main.ts reads: layerMode.element.hidden
    layerPanel.hidden = false;
    const before = rig.pose();
    const closePanel = vi.fn();
    await emptyClick({ layerActive: () => !layerPanel.hidden, depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel });
    expect(view.depth()).toBe(2);
    expect(closePanel).not.toHaveBeenCalled();
    expectPose(camera, rig.controls.target, before);
    // Layer mode closed: the same click folds everything.
    layerPanel.hidden = true;
    await emptyClick({ layerActive: () => !layerPanel.hidden, depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel });
    expect(view.depth()).toBe(0);
  });

  it('Esc and the level-up button stay one level back: depth 2 -> 1', async () => {
    const { view } = world();
    await view.explode('L9');
    await view.explode('L9.bank');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(view.depth()).toBe(1);
    await view.reassemble(); // the level-up button calls reassemble()
    expect(view.depth()).toBe(0);
  });

  it('closed level by level (Esc), the next fold-all returns to the pose of its own first open', async () => {
    const { camera, rig, view } = world();
    await rig.overview(0);
    await view.explode('L9');
    await view.reassemble();
    // The visitor moved the camera; the next chain saves the new pose.
    await rig.flyTo(new THREE.Vector3(60, 0, 0), 30, 0);
    const second = rig.pose();
    await view.explode('L30');
    await view.reassembleAll();
    expectPose(camera, rig.controls.target, second);
  });

  it('with nothing open an empty click closes the panel and never moves the camera', async () => {
    const { camera, rig, view } = world();
    await rig.overview(0);
    const before = camera.position.clone();
    const closePanel = vi.fn();
    await emptyClick({ depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel });
    expect(closePanel).toHaveBeenCalledTimes(1);
    expect(camera.position.distanceTo(before)).toBe(0);
  });
});

describe('R8: scene names follow language and mode without reopening the level', () => {
  it('ln1/ln2 read "Norm (before attention)" in Simple and "ln1 A" in Advanced; DE/EN switch in place', async () => {
    const made: string[] = [];
    const { view } = world({ label: (t) => { made.push(t); const o = new THREE.Object3D(); o.name = `label:${t}`; return o; } });
    await view.explode('L12');
    const names = (): string[] => {
      const out: string[] = [];
      view.root.traverse((o) => { if (o.userData.label) out.push(o.userData.text as string); });
      return out;
    };
    expect(names()).toContain('Norm (before attention)');
    expect(names()).toContain('Norm (before the switch)');
    expect(names()).not.toContain('ln1 A');
    setLang('de');
    expect(names()).toContain('Norm (vor Aufmerksamkeit)');
    expect(names()).toContain('Norm (vor der Weiche)');
    setMode('advanced');
    expect(names()).toContain('ln1 A');
    expect(names()).toContain('ln2 B');
    // Still the same level: nothing was reopened.
    expect(view.depth()).toBe(1);
    expect(view.current()).toBe('L12');
    // The new sprites replaced the old ones (one label per caption, never two).
    const sprites = new Set<THREE.Object3D>();
    view.root.traverse((o) => { if (o.userData.label) sprites.add(o); });
    expect(sprites.size).toBe(names().length);
  });

  it('tile captions update too (number format follows the language) and keep their place', async () => {
    const { view } = world({ label: () => new THREE.Object3D() });
    await view.explode('L12');
    await view.explode('L12.A.attn');
    await view.explode('L12.A.attn.q');
    const caps = (): Array<[string, number]> => {
      const out: Array<[string, number]> = [];
      view.root.children.at(-1)!.traverse((o) => { if (o.userData.label) out.push([o.userData.text as string, o.position.z]); });
      return out;
    };
    const before = caps();
    expect(before.map((c) => c[0])).toContain('−1 40.0 % · 0 20.0 % · +1 40.0 %');
    setLang('de');
    const after = caps();
    expect(after.map((c) => c[0])).toContain('−1 40,0 % · 0 20,0 % · +1 40,0 %');
    expect(after.map((c) => c[1]).sort()).toEqual(before.map((c) => c[1]).sort());
    expect(view.depth()).toBe(3);
  });
});

describe('R10: canvas labels under a HUD band fade; computed at rest, not per frame', () => {
  it('a context label under the right inset fades; the framed level keeps its labels; clearing the inset brings it back', async () => {
    const { camera, rig, view } = world();
    await rig.overview(0);
    await view.explode('L12');
    await view.explode('L12.bank');
    camera.updateMatrixWorld();
    const ctx: THREE.Object3D[] = [];
    const framed: THREE.Object3D[] = [];
    const [slabLevel, bankLevel] = view.root.children;
    slabLevel!.traverse((o) => { if (o.userData.label) ctx.push(o); });
    bankLevel!.traverse((o) => { if (o.userData.label) framed.push(o); });
    expect(ctx.length).toBeGreaterThan(0);
    const faded = (o: THREE.Object3D): boolean => o.userData.hudFaded === true;
    // The whole view is a band: every visible on-screen context label fades, the framed ones never.
    view.fadeLabels(camera, W, H, { top: H, right: 0, bottom: 0, left: 0 });
    expect(ctx.some(faded)).toBe(true);
    expect(framed.some(faded)).toBe(false);
    // No band: nothing is faded.
    view.fadeLabels(camera, W, H, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(ctx.some(faded)).toBe(false);
  });
  // The wiring (rig settle and inset changes, never the frame loop) is checked in tests/hudLayout.test.ts.
});

describe('R1: the rig reads the insets at fly time', () => {
  /** A panel whose layout box follows its state, as the CSS lays it out at 1280 x 720. */
  function hud() {
    const panel = createPanel({ arch, tower: buildTower(arch), rig: { flyTo: vi.fn(() => Promise.resolve()) }, loadWeights });
    document.body.appendChild(panel.element);
    const sideW = Math.min(380, Math.max(300, 0.24 * W));
    Object.defineProperty(panel.element, 'offsetWidth', {
      get: () => (panel.element.hidden ? 0 : panel.collapsed() ? 220 : sideW),
    });
    Object.defineProperty(panel.element, 'offsetLeft', {
      get: () => (panel.element.hidden ? 0 : panel.collapsed() ? W - 300 - 220 : W - 16 - sideW),
    });
    const top = document.createElement('div');
    Object.defineProperty(top, 'offsetHeight', { value: 36 });
    const dock = document.createElement('div');
    Object.defineProperty(dock, 'offsetHeight', { value: 60 });
    Object.defineProperty(dock, 'offsetTop', { value: H - 28 - 60 });
    const provider = () => measureHud({
      top, dock, gap: 8, win: { innerWidth: W, innerHeight: H },
      side: () => (!panel.element.hidden && !panel.collapsed() ? panel.element : null),
      legendList: () => null,
    });
    return { panel, provider, rightNow: () => W - (W - 16 - sideW) + 8 };
  }

  for (const start of ['closed', 'collapsed'] as const) {
    it(`from a ${start} panel, a click on slab 20 frames the level left of the real panel (all 8 corners)`, async () => {
      const tower = buildTower(arch);
      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
      camera.up.set(0, 0, 1);
      const dom = document.createElement('canvas');
      Object.defineProperty(dom, 'clientWidth', { value: W });
      Object.defineProperty(dom, 'clientHeight', { value: H });
      document.body.appendChild(dom);
      const rig = createControls(camera, dom, tower.rowExtent);
      cleanup.push(() => rig.dispose());
      const { panel, provider, rightNow } = hud();
      rig.setInsetsProvider(provider);
      if (start === 'collapsed') {
        await panel.openPanel('L5');
        panel.setCollapsed(true);
      }
      // What the app had measured before the click (no side column): stale by the time the level flies.
      expect(provider().right).toBe(0);
      const boxes: THREE.Box3[] = [];
      const frameBox = rig.frameBox.bind(rig);
      rig.frameBox = (b, ms) => { boxes.push(b.clone()); return frameBox(b, 0); };
      const view = createExplode({
        tower, arch, rig, loadWeights, label: () => new THREE.Object3D(), ms: 0,
        onChange: (id) => { if (id) void panel.openPanel(id); else panel.close(); },
      });
      cleanup.push(() => view.dispose());
      await rig.overview(0);
      await new Promise<void>((done) => {
        pickAction('L20', { explodable: () => true, explode: (id) => view.explode(id).finally(done), openPanel: (id) => panel.openPanel(id) });
      });
      expect(panel.element.hidden).toBe(false);
      expect(panel.collapsed()).toBe(false);
      expect(rig.insets().right).toBe(rightNow());
      const xMax = 1 - (2 * rightNow()) / W;
      const box = boxes.at(-1)!;
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      for (const c of boxCorners(box)) {
        const q = c.clone().project(camera);
        expect(q.x).toBeLessThan(xMax);
        expect(q.x).toBeGreaterThan(-1);
      }
    });
  }
});
