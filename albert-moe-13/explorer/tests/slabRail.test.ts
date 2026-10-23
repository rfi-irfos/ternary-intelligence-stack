// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { buildTower } from '../src/scene/tower';
import { createControls } from '../src/camera/controls';
import { createSlabRail } from '../src/ui/slabRail';

const tower = buildTower(validateArchitecture(arch));

function make() {
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
  const rig = createControls(camera, document.createElement('canvas'));
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
