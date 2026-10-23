// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { buildTower } from '../src/scene/tower';
import { createControls, overviewPose } from '../src/camera/controls';
import { createSlabRail } from '../src/ui/slabRail';

const tower = buildTower(validateArchitecture(arch));

const rigs: Array<{ dispose(): void }> = [];
afterEach(() => {
  while (rigs.length) rigs.pop()!.dispose();
});

function make() {
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
  const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
  rigs.push(rig);
  const onSelect = vi.fn();
  const rail = createSlabRail(tower, rig, onSelect);
  document.body.appendChild(rail.element);
  return { rail, onSelect };
}

describe('slab rail', () => {
  it('slab rail has 46 entries, 7 marked fusion', () => {
    const { rail } = make();
    const items = rail.element.querySelectorAll('button');
    expect(items).toHaveLength(46);
    const fusion = [...items].filter((b) => b.dataset.fusion === 'true').map((b) => Number(b.dataset.layer));
    expect(fusion).toEqual([2, 3, 5, 8, 13, 21, 34]);
  });

  it('rail and overview derive from a synthetic 4-layer architecture', () => {
    const small = buildTower(
      validateArchitecture({
        ...arch,
        model: { ...arch.model, num_layers: 4, fusion_layers: [2] },
        layers: arch.layers.slice(0, 4),
      }),
    );
    expect(small.layerCount).toBe(4);
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), small.rowExtent);
    rigs.push(rig);
    const rail = createSlabRail(small, rig, vi.fn());
    expect(rail.element.querySelectorAll('button')).toHaveLength(4);
    expect(small.rowExtent).toEqual({ minX: -3, maxX: 15 });
    const pose = overviewPose(1.5, 45, small.rowExtent);
    expect(pose.target.x).toBeCloseTo(6, 6);
    expect(pose.distance).toBeLessThan(overviewPose(1.5, 45, tower.rowExtent).distance);
  });

  it('click selects, arrows move selection', () => {
    const { rail, onSelect } = make();
    const btn = rail.element.querySelectorAll('button')[4]!;
    btn.click();
    expect(onSelect).toHaveBeenLastCalledWith(4);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onSelect).toHaveBeenLastCalledWith(5);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onSelect).toHaveBeenLastCalledWith(4);
    expect(rail.selected()).toBe(4);
  });
});
