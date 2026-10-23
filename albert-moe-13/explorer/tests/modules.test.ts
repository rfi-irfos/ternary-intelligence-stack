import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { MODULE_FILES, loadModules, parseModules, type Modules } from '../src/scene/modules';
import { buildTower } from '../src/scene/tower';
import { attnId, expertId, gateId, ln1Id, ln2Id, routerId } from '../src/scene/ids';

const a = validateArchitecture(arch);
const asset = (f: string): ArrayBuffer => {
  const b = readFileSync(new URL(`../public/assets/${f}.glb`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const real = async (): Promise<Modules> =>
  parseModules(Object.fromEntries(MODULE_FILES.map((f) => [f, asset(f)])) as never);

afterEach(() => vi.unstubAllGlobals());

describe('modules', () => {
  it('verify_glb.py passes (node contract, slot positions, < 6 MB)', () => {
    const r = spawnSync('python3', ['-I', 'blender/verify_glb.py', 'public/assets'], { encoding: 'utf8' });
    if (r.error) return; // no python3 on this host
    expect(r.stdout).toContain('OK');
    expect(r.status).toBe(0);
  });

  it('buildTower with modules keeps identical counts() and anchors', async () => {
    const m = await real();
    const plain = buildTower(a);
    const mod = buildTower(a, m);
    expect(mod.counts()).toEqual(plain.counts());
    for (const l of [0, 2, 13, 45]) {
      for (const id of [expertId(l, 7), attnId(l, 'A'), routerId(l, 'B'), ln1Id(l, 'A'), ln2Id(l, 'B')]) {
        expect(mod.anchor(id).toArray()).toEqual(plain.anchor(id).toArray());
      }
    }
    expect(mod.has(gateId(13))).toBe(true);
    expect(mod.anchor(gateId(13)).toArray()).toEqual(plain.anchor(gateId(13)).toArray());
    expect(mod.root.getObjectByName('experts')).toBeDefined();
  });

  it('module slot nodes sit exactly at the tower layout', async () => {
    const m = await real();
    const t = buildTower(a);
    const x = t.slabX(5);
    const near = (id: string, slot: string): void => {
      const p = m.slotPositions[slot]!;
      const w = t.anchor(id);
      expect([p.x + x, p.y, p.z].map((v) => +v.toFixed(4))).toEqual([w.x, w.y, w.z].map((v) => +v.toFixed(4)));
    };
    for (let e = 0; e < 12; e++) near(expertId(5, e), `slot_expert_${String(e).padStart(2, '0')}`);
    for (const s of ['A', 'B'] as const) {
      near(attnId(5, s), `slot_attn_${s}`);
      near(routerId(5, s), `slot_router_${s}`);
      near(ln1Id(5, s), `slot_ln1_${s}`);
      near(ln2Id(5, s), `slot_ln2_${s}`);
    }
    near(gateId(5), 'slot_gate');
  });

  it('falls back to procedural when loadModules returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await loadModules('/missing/')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await loadModules('/missing/')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200 })));
    expect(await loadModules('/missing/')).toBeNull();
    const t = buildTower(a, await loadModules('/missing/'));
    expect(t.counts()).toEqual(buildTower(a).counts());
  });
});
