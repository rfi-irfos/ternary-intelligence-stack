import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { buildTower } from '../src/scene/tower';
import { attnId, expertId, gateId, parseId, routerId } from '../src/scene/ids';

const a = validateArchitecture(arch);

describe('ids', () => {
  it('round-trips', () => {
    expect(parseId(expertId(45, 11))).toEqual({ type: 'expert', layer: 45, expert: 11 });
    expect(parseId(attnId(12, 'A'))).toEqual({ type: 'attn', layer: 12, stream: 'A' });
    expect(parseId(gateId(13))).toEqual({ type: 'gate', layer: 13 });
    expect(parseId('shaft.B')).toEqual({ type: 'shaft', stream: 'B' });
    expect(parseId('nonsense')).toBeNull();
    expect(expertId(12, 7)).toBe('L12.expert.7');
  });
});

describe('tower', () => {
  const tower = buildTower(a);

  it('counts equal architecture', () => {
    expect(tower.counts()).toEqual({
      expert: 552, router: 92, attn: 92, ln1: 92, ln2: 92,
      gate: 7, embed: 1, lm_head: 1, ln_f: 1,
    });
  });

  it('places gates only on fusion floors', () => {
    const have = [...Array(46).keys()].filter((i) => tower.has(gateId(i)));
    expect(have).toEqual([2, 3, 5, 8, 13, 21, 34]);
  });

  it('lays slabs out along +X, embed before and head after', () => {
    for (let i = 1; i < 46; i++) expect(tower.slabX(i)).toBeGreaterThan(tower.slabX(i - 1));
    expect(tower.anchor('embed').x).toBeLessThan(tower.slabX(0));
    expect(tower.anchor('ln_f').x).toBeGreaterThan(tower.slabX(45));
    expect(tower.anchor('lm_head').x).toBeGreaterThan(tower.anchor('ln_f').x);
  });

  it('puts stream A at lower y than stream B and experts between', () => {
    const ya = tower.anchor(routerId(5, 'A')).y;
    const yb = tower.anchor(routerId(5, 'B')).y;
    const ye = tower.anchor(expertId(5, 0)).y;
    expect(ya).toBeLessThan(ye);
    expect(ye).toBeLessThan(yb);
  });

  it('keeps draw calls under 200', () => {
    let meshes = 0;
    tower.root.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh || (o as { isLine?: boolean }).isLine) meshes++; });
    expect(meshes).toBeLessThan(200);
  });

  it('throws for unknown anchors', () => {
    expect(() => tower.anchor(gateId(4))).toThrow();
  });
});
