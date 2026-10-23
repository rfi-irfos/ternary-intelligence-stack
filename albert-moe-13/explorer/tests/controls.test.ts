// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createControls, overviewPose } from '../src/camera/controls';

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
