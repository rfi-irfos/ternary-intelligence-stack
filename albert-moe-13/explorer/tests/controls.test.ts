// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import archJson from '../public/data/architecture.json';
import { boxCorners, createControls, refitOnToggle, refitOverview, freeRect, overviewPoints, overviewPose } from '../src/camera/controls';
import { validateArchitecture } from '../src/data/architecture';
import { createExplode } from '../src/scene/explode';
import { buildTower } from '../src/scene/tower';
import { createSidebar } from '../src/ui/sidebar';
import { createTopBar } from '../src/ui/topbar';

const arch = validateArchitecture(archJson);

const EXTENT = { minX: -3, maxX: 141 };
const rigs: Array<{ dispose(): void }> = [];
afterEach(() => {
  while (rigs.length) rigs.pop()!.dispose();
});

function rig(extent = EXTENT) {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(10, -10, 5);
  const dom = document.createElement('canvas');
  document.body.appendChild(dom);
  const r = createControls(camera, dom, extent);
  rigs.push(r);
  return { camera, rig: r };
}

function run(r: ReturnType<typeof rig>['rig'], max = 600): void {
  for (let i = 0; i < max && r.isFlying(); i++) r.update(1 / 60);
}

describe('camera rig', () => {
  it('flyTo ends at target distance', async () => {
    const { camera, rig: r } = rig();
    const target = new THREE.Vector3(30, 0, 0);
    const p = r.flyTo(target, 12, 500);
    expect(r.isFlying()).toBe(true);
    run(r);
    await p;
    expect(r.isFlying()).toBe(false);
    expect(camera.position.distanceTo(target)).toBeCloseTo(12, 3);
    expect(r.controls.target.distanceTo(target)).toBeLessThan(1e-3);
  });

  it('flyTo interrupted by second flyTo ends at second target', async () => {
    const { camera, rig: r } = rig();
    const a = new THREE.Vector3(30, 0, 0);
    const b = new THREE.Vector3(90, 0, 0);
    const p1 = r.flyTo(a, 12, 900);
    for (let i = 0; i < 20; i++) r.update(1 / 60);
    const before = camera.position.clone();
    const p2 = r.flyTo(b, 8, 400);
    r.update(0);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6); // no jump
    await p1; // cancelled promise resolves
    run(r);
    await p2;
    expect(r.controls.enabled).toBe(true);
    expect(r.isFlying()).toBe(false);
    expect(camera.position.distanceTo(b)).toBeCloseTo(8, 3);
    expect(r.controls.target.distanceTo(b)).toBeLessThan(1e-3);
  });

  it('controls disabled while flying, re-enabled after', async () => {
    const { rig: r } = rig();
    expect(r.controls.enabled).toBe(true);
    const p = r.flyTo(new THREE.Vector3(5, 0, 0), 10, 300);
    expect(r.controls.enabled).toBe(false);
    run(r);
    await p;
    expect(r.controls.enabled).toBe(true);
  });

  it('Esc triggers overview', async () => {
    const { rig: r } = rig();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(r.isFlying()).toBe(true);
  });

  it('overview frames embed, every slab and lm_head', async () => {
    const { camera, rig: r } = rig();
    const p = r.overview(300);
    run(r);
    await p;
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    for (const x of [-3, 0, 45 * 3, 141]) {
      for (const [y, z] of [[-3, -2], [3, 2]]) {
        expect(frustum.containsPoint(new THREE.Vector3(x, y, z))).toBe(true);
      }
    }
    expect(camera.position.y).toBeLessThan(0); // front
    expect(camera.position.x).toBeLessThan(overviewPose(16 / 9, 45, EXTENT).target.x); // left
    expect(camera.position.z).toBeGreaterThan(0); // above
  });

  it('overview pose follows the given extent', () => {
    const small = overviewPose(16 / 9, 45, { minX: -3, maxX: 9 });
    expect(small.target.x).toBeCloseTo(3, 6);
    expect(small.distance).toBeLessThan(overviewPose(16 / 9, 45, EXTENT).distance);
  });
});

describe('HUD-aware framing (1366×768, dock 250 px, panel 396 px)', () => {
  const W = 1366;
  const H = 768;
  const HUD = { top: 0, right: 396, bottom: 250, left: 0 };
  const yMin = -1 + (2 * HUD.bottom) / H;
  const xMax = 1 - (2 * HUD.right) / W;

  function hudRig() {
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const dom = document.createElement('canvas');
    Object.defineProperty(dom, 'clientWidth', { value: W });
    Object.defineProperty(dom, 'clientHeight', { value: H });
    document.body.appendChild(dom);
    const tower = buildTower(arch);
    const r = createControls(camera, dom, tower.rowExtent);
    rigs.push(r);
    return { camera, rig: r, tower };
  }
  const ndc = (camera: THREE.PerspectiveCamera, p: THREE.Vector3): THREE.Vector3 => {
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return p.clone().project(camera);
  };
  const expectFree = (camera: THREE.PerspectiveCamera, pts: THREE.Vector3[]): void => {
    for (const p of pts) {
      const q = ndc(camera, p);
      expect(q.y).toBeGreaterThan(yMin);
      expect(q.x).toBeLessThan(xMax);
      expect(q.y).toBeLessThan(1);
      expect(q.x).toBeGreaterThan(-1);
      expect(q.z).toBeLessThan(1);
    }
  };

  it('the opened L20 bank box sits above the dock and left of the panel', async () => {
    const { camera, rig: r, tower } = hudRig();
    await r.overview(0);
    r.setInsets(HUD);
    const boxes: THREE.Box3[] = [];
    const frameBox = r.frameBox.bind(r);
    r.frameBox = (b, ms) => { boxes.push(b.clone()); return frameBox(b, 0); };
    const view = createExplode({ tower, arch, rig: r, loadWeights: async () => { throw new Error('no weights'); }, label: () => new THREE.Object3D(), ms: 0 });
    rigs.push(view);
    await view.explode('L20.bank');
    expect(view.depth()).toBe(2);
    const box = boxes[boxes.length - 1]!;
    // The bank's twelve experts (not the slab): the box spans them.
    for (let e = 0; e < 12; e++) expect(box.containsPoint(view.root.getObjectByName(`L20.expert.${e}`)!.position)).toBe(true);
    expectFree(camera, boxCorners(box));
  });

  it('the overview row ends sit above the dock and left of the panel', async () => {
    const { camera, rig: r, tower } = hudRig();
    r.setInsets(HUD);
    await r.overview(0);
    expectFree(camera, overviewPoints(tower.rowExtent));
  });

  it('a centred flyTo target lands in the middle of the free rect', async () => {
    const { camera, rig: r } = hudRig();
    r.setInsets(HUD);
    const t = new THREE.Vector3(40, 0, 0);
    await r.flyTo(t, 20, 0);
    const q = ndc(camera, t);
    expect(q.x).toBeCloseTo((-1 + xMax) / 2, 3);
    expect(q.y).toBeCloseTo((yMin + 1) / 2, 3);
  });

  it('changing the insets never moves the camera by itself', async () => {
    const { camera, rig: r } = hudRig();
    await r.overview(0);
    const before = r.pose();
    r.setInsets(HUD);
    r.update(1 / 60);
    r.setInsets({ top: 64, right: 0, bottom: 120, left: 260 });
    r.update(1 / 60);
    expect(r.isFlying()).toBe(false);
    expect(camera.position.distanceTo(before.position)).toBeLessThan(1e-6);
    expect(r.controls.target.distanceTo(before.target)).toBeLessThan(1e-6);
    expect(r.insets()).toEqual({ top: 64, right: 0, bottom: 120, left: 260 });
  });

  it('freeRect falls back to the whole view when the HUD leaves no room', () => {
    expect(freeRect({ top: 0, right: 2000, bottom: 0, left: 0 }, W, H)).toEqual({ x0: -1, x1: 1, y0: -1, y1: 1 });
  });
});

describe('overview refit when a panel opens or closes (Task 11d fix round 1)', () => {
  it('atOverview is true after an overview flight and cleared by a flight elsewhere or by user input', async () => {
    const { camera, rig: r } = rig();
    expect(r.atOverview()).toBe(false);
    void r.overview(0);
    expect(r.atOverview()).toBe(true);
    void r.flyTo(new THREE.Vector3(30, 0, 0), 12, 0);
    expect(r.atOverview()).toBe(false);
    void r.overview(0);
    // a plain click on the canvas fires 'start' and 'end' without moving the camera: still the overview
    r.controls.dispatchEvent({ type: 'start' });
    r.controls.dispatchEvent({ type: 'end' });
    expect(r.atOverview()).toBe(true);
    // an orbit moves the pose
    camera.position.x += 5;
    expect(r.atOverview()).toBe(false);
  });

  it('refits the overview into the area left of the opened panel, only while the camera is still at the overview', async () => {
    const { camera, rig: r } = rig();
    let right = 0;
    r.setInsetsProvider(() => ({ top: 40, right, bottom: 100, left: 0 }));
    await r.overview(0);
    const before = camera.position.clone();
    const tgt = r.controls.target.clone();
    right = 400; // the side panel opens over the right end of the model
    // opening alone moves nothing
    expect(camera.position.distanceTo(before)).toBe(0);
    expect(refitOverview(r, 0)).toBe(true);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.5);
    expect(r.controls.target.x).toBeGreaterThan(tgt.x); // the model shifts left of the panel: the view looks further right
    // closing refits back
    right = 0;
    expect(refitOverview(r, 0)).toBe(true);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
  });

  it('a pose the visitor chose is not touched', async () => {
    const { camera, rig: r } = rig();
    await r.overview(0);
    camera.position.x += 3; // user orbit
    r.controls.dispatchEvent({ type: 'start' });
    const at = camera.position.clone();
    expect(refitOverview(r, 0)).toBe(false);
    expect(camera.position.distanceTo(at)).toBe(0);
    // a flight to a slab is not the overview either
    await r.flyTo(new THREE.Vector3(30, 0, 0), 12, 0);
    expect(refitOverview(r, 0)).toBe(false);
  });
});

describe('B: opening the sidebar refits the overview, the way the browser does it (Explore, skip the intro, edge tab)', () => {
  function world() {
    const { camera, rig: r } = rig();
    const sidebar = createSidebar({ win: { innerWidth: 1568 } });
    document.body.append(sidebar.element, sidebar.edgeTab);
    // the app's insets: the open sidebar covers its width plus the margin and the gap
    r.setInsetsProvider(() => ({ top: 36, right: sidebar.isOpen() ? sidebar.width() + 20 : 0, bottom: 82, left: 0 }));
    const overview = vi.spyOn(r, 'overview');
    refitOnToggle(sidebar, r);
    return { camera, r, sidebar, overview };
  }

  it('opened by the edge tab: one refit with the new insets; closed again: one more; a width drag refits nothing', async () => {
    const { camera, r, sidebar, overview } = world();
    // Explore: the overview flight at the start, the intro skip does not move the camera, the visitor clicks the canvas once
    await r.overview(0);
    overview.mockClear();
    r.controls.dispatchEvent({ type: 'start' });
    r.controls.dispatchEvent({ type: 'end' });
    const before = camera.position.clone();
    const insetsClosed = r.insets();
    sidebar.edgeTab.click();
    expect(overview).toHaveBeenCalledTimes(1);
    expect(r.insets().right).toBe(sidebar.width() + 20);
    expect(r.insets().right).not.toBe(insetsClosed.right);
    for (let i = 0; i < 120 && r.isFlying(); i++) r.update(1 / 30);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.5);
    const opened = camera.position.clone();
    // dragging the grip changes only the width: no refit
    sidebar.setWidth(sidebar.width() + 40);
    expect(overview).toHaveBeenCalledTimes(1);
    // closing refits back into the full area
    sidebar.element.querySelector<HTMLButtonElement>('.sidebar-close')!.click();
    expect(overview).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 120 && r.isFlying(); i++) r.update(1 / 30);
    expect(camera.position.distanceTo(opened)).toBeGreaterThan(0.5);
  });

  it('after the visitor orbited, opening or closing the sidebar does not move the camera', async () => {
    const { camera, r, sidebar, overview } = world();
    await r.overview(0);
    overview.mockClear();
    camera.position.x += 4; // an orbit
    r.controls.dispatchEvent({ type: 'start' });
    r.controls.dispatchEvent({ type: 'end' });
    sidebar.open();
    sidebar.close();
    expect(overview).not.toHaveBeenCalled();
  });

  it('the gear opens a dropdown, not the sidebar: no refit', async () => {
    const { r, overview } = world();
    await r.overview(0);
    overview.mockClear();
    const top = createTopBar(null);
    document.body.append(top.element);
    top.gear.click();
    expect(overview).not.toHaveBeenCalled();
    top.dispose();
  });
});

describe('reduced motion', () => {
  const make = (reduced: boolean) => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(10, -10, 5);
    const dom = document.createElement('canvas');
    document.body.appendChild(dom);
    const r = createControls(camera, dom, EXTENT, { reducedMotion: () => reduced });
    rigs.push(r);
    return { camera, rig: r };
  };

  it('every flight is a cut: the pose is final at once and nothing keeps flying', async () => {
    const { camera, rig: r } = make(true);
    const p = r.flyTo(new THREE.Vector3(30, 0, 0), 12, 900);
    expect(r.isFlying()).toBe(false);
    await p;
    expect(r.pose().target.x).toBeCloseTo(30, 5);
    expect(camera.position.distanceTo(r.pose().target)).toBeCloseTo(12, 3);
  });

  it('without the preference a flight still takes time', () => {
    const { rig: r } = make(false);
    void r.flyTo(new THREE.Vector3(30, 0, 0), 12, 900);
    expect(r.isFlying()).toBe(true);
  });
});

describe('fly keys (WASD, Q/E)', () => {
  const press = (code: string, init: KeyboardEventInit = {}): void => { document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init })); };
  const release = (code: string): void => { document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); };

  it('W moves camera and pivot together along the view direction; releasing the key stops it', () => {
    const { camera, rig: r } = rig();
    const p0 = camera.position.clone();
    const t0 = r.controls.target.clone();
    const dir = t0.clone().sub(p0).normalize();
    press('KeyW');
    r.update(0.1);
    const moved = camera.position.clone().sub(p0);
    expect(moved.length()).toBeGreaterThan(0.1);
    expect(moved.clone().normalize().dot(dir)).toBeGreaterThan(0.999);
    expect(r.controls.target.clone().sub(t0).distanceTo(moved)).toBeLessThan(1e-6);
    release('KeyW');
    const p1 = camera.position.clone();
    r.update(0.1);
    expect(camera.position.distanceTo(p1)).toBeLessThan(1e-3);
  });

  it('S goes back, A and D go sideways, E goes up (+z) and Q down', () => {
    const { camera, rig: r } = rig();
    const step = (code: string): THREE.Vector3 => { const a = camera.position.clone(); press(code); r.update(0.1); release(code); return camera.position.clone().sub(a); };
    const dir = r.controls.target.clone().sub(camera.position).normalize();
    expect(step('KeyS').dot(dir)).toBeLessThan(-0.1);
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    expect(step('KeyD').dot(right)).toBeGreaterThan(0.1);
    expect(step('KeyA').dot(right)).toBeLessThan(-0.1);
    expect(step('KeyE').z).toBeGreaterThan(0.1);
    expect(step('KeyQ').z).toBeLessThan(-0.1);
  });

  it('Shift is faster; Ctrl, Meta and Alt combinations, typing in a field and a disabled state do nothing', () => {
    const { camera, rig: r } = rig();
    const dist = (code: string, init: KeyboardEventInit = {}): number => { const a = camera.position.clone(); press(code, init); r.update(0.1); release(code); return camera.position.distanceTo(a); };
    const plain = dist('KeyW');
    expect(dist('KeyW', { shiftKey: true })).toBeGreaterThan(plain * 2);
    expect(dist('KeyW', { ctrlKey: true })).toBe(0);
    expect(dist('KeyW', { metaKey: true })).toBe(0);
    const input = document.createElement('input');
    document.body.append(input);
    const a = camera.position.clone();
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true, cancelable: true }));
    r.update(0.1);
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    expect(camera.position.distanceTo(a)).toBe(0);
    input.remove();
  });

  it('keysEnabled false (lobby, intro, dialogs) blocks the keys', () => {
    let on = false;
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(10, -10, 5);
    const dom = document.createElement('canvas');
    document.body.appendChild(dom);
    const r = createControls(camera, dom, EXTENT, { keysEnabled: () => on });
    rigs.push(r);
    const a = camera.position.clone();
    press('KeyW');
    r.update(0.1);
    release('KeyW');
    expect(camera.position.distanceTo(a)).toBe(0);
    on = true;
    press('KeyW');
    r.update(0.1);
    release('KeyW');
    expect(camera.position.distanceTo(a)).toBeGreaterThan(0.1);
  });

  it('a running flight is not disturbed by the keys, and a dropped rig no longer listens', () => {
    const { camera, rig: r } = rig();
    void r.flyTo(new THREE.Vector3(50, 0, 0), 20, 1000);
    press('KeyW');
    r.update(0.1);
    const a = camera.position.clone();
    r.update(0.1);
    // the flight keeps moving the camera along its own path (towards 50,0,0), the key adds nothing on top
    expect(camera.position.distanceTo(a)).toBeGreaterThan(0);
    release('KeyW');
    r.dispose();
    const b = camera.position.clone();
    press('KeyW');
    r.update(0.1);
    expect(camera.position.distanceTo(b)).toBeLessThan(1e-6);
  });
});
