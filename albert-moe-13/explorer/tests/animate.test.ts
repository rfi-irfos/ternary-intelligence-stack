import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { createAnimator } from '../src/flow/animate';
import type { ExpertsData, Op } from '../src/flow/timeline';
import { expertId } from '../src/scene/ids';
import { BLOOM_LAYER, RENDER_ORDER } from '../src/scene/materials';
import { PALETTE } from '../src/scene/palette';
import { buildTower } from '../src/scene/tower';

const a = validateArchitecture(arch);

describe('experts op overlay', () => {
  it('keeps all 12 experts of the slab visible: 3 lit, 9 dim glass', () => {
    const tower = buildTower(a);
    const anim = createAnimator(tower);
    const layer = 5;
    const lit = [1, 4, 7];
    const dark = [...Array(a.model.num_experts).keys()].filter((e) => !lit.includes(e));
    const value: ExpertsData = { position: 3, lit, dark, weights: [0.5, 0.3, 0.2], litOutputScales: [0.4, 0.4, 0.4] };
    const op = { kind: 'experts', layer, stream: 'A', data: { value }, caveats: [] } as unknown as Op;
    anim.show(op);

    const marks: THREE.Mesh[] = [];
    anim.root.traverse((o) => { if (/^(lit|dark):/.test(o.name)) marks.push(o as THREE.Mesh); });
    const litMarks = marks.filter((m) => m.name.startsWith('lit:'));
    const darkMarks = marks.filter((m) => m.name.startsWith('dark:'));
    expect(litMarks).toHaveLength(3);
    expect(darkMarks).toHaveLength(9);

    // The 12 base expert instances of the slab are untouched (not hidden by the overlay).
    const experts = tower.root.getObjectByName('experts') as THREE.InstancedMesh;
    const ids = experts.userData.ids as string[];
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    for (let e = 0; e < a.model.num_experts; e++) {
      experts.getMatrixAt(ids.indexOf(expertId(layer, e)), m);
      s.setFromMatrixScale(m);
      expect(s.x).toBeGreaterThan(0);
    }

    // Dim marks: a translucent shade drawn after the glass that writes no depth, so the glass and
    // its outline behind it stay visible.
    for (const d of darkMarks) {
      const mat = d.material as THREE.MeshBasicMaterial;
      expect(mat.depthWrite).toBe(false);
      expect(mat.opacity).toBeGreaterThan(0);
      expect(mat.opacity).toBeLessThan(0.6);
      expect(d.renderOrder).toBeGreaterThan(RENDER_ORDER.edge);
    }
    // Lit marks glow in the expert colour and feed the bloom.
    const bloom = new THREE.Layers();
    bloom.set(BLOOM_LAYER);
    for (const l of litMarks) {
      expect((l.material as THREE.MeshBasicMaterial).color.getHex()).toBe(PALETTE.expert);
      expect(l.layers.test(bloom)).toBe(true);
      expect((l.material as THREE.Material).opacity).toBeGreaterThanOrEqual(0.5); // not muted by the bloom pass
    }
    anim.dispose();
  });
});
