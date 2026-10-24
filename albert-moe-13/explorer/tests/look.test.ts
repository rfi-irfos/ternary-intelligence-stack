// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import {
  HAZE_DENSITY, PRESETS, PROBE_WARMUP, QUALITY_STORAGE_KEY, type KeyValueStore,
  chooseQuality, createProbe, hazeDensity, loadOverride, resolveQuality, saveOverride, usesPost,
} from '../src/scene/look';
import { BLOOM_LAYER, lookMaterial } from '../src/scene/materials';
import { PALETTE, cssHex } from '../src/scene/palette';
import { LANE_Y, buildTower, streamColor } from '../src/scene/tower';
import { attnId } from '../src/scene/ids';
import { createQualityMenu } from '../src/ui/qualityMenu';

const a = validateArchitecture(arch);

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

describe('quality probe', () => {
  it('slow probe selects low', () => {
    expect(chooseQuality([31, 28, 40, 35, 26, 90, 33])).toBe('low');
    // A probe that measured nothing usable is treated as a weak device, never as High.
    expect(chooseQuality([])).toBe('low');
    expect(chooseQuality([NaN, Infinity])).toBe('low');
    // The running probe gives up early on a clearly slow device (no long stay on High).
    const p = createProbe(30, 2);
    const seq = [200, 200, 60, 70, 65, 80, 75];
    let picked = null;
    for (const ms of seq) picked = p.add(ms) ?? picked;
    expect(picked).toBe('low');
    expect(p.done()).toBe(true);
  });

  it('fast probe selects high', () => {
    expect(chooseQuality([8, 9, 10, 11, 7, 30])).toBe('high');
    expect(chooseQuality([12, 12, 12])).toBe('high');
    const p = createProbe(4, 1);
    const results = [50, 9, 8, 10, 9].map((ms) => p.add(ms));
    expect(results.slice(0, 4)).toEqual([null, null, null, null]); // warm-up frame ignored
    expect(results[4]).toBe('high');
    expect(p.add(100)).toBeNull(); // reports once
    expect(p.medianMs()).toBe(9); // logged with console.debug for calibration
    expect(p.count()).toBe(4);
  });

  it('default probe skips 8 warm-up frames', () => {
    expect(PROBE_WARMUP).toBe(8);
    const p = createProbe(3);
    const out = [...Array(PROBE_WARMUP).fill(500), 9, 9, 9].map((ms) => p.add(ms));
    expect(out.slice(0, PROBE_WARMUP + 2).every((r) => r === null)).toBe(true);
    expect(out[PROBE_WARMUP + 2]).toBe('high');
  });

  it('middle band selects medium', () => {
    expect(chooseQuality([16.7, 16.7, 18, 15])).toBe('medium');
    expect(chooseQuality([22, 22, 23])).toBe('medium');
    expect(chooseQuality([22.5, 23, 24])).toBe('low');
  });

  it('override persists over probe', () => {
    const store = memoryStore();
    expect(resolveQuality('high', store)).toBe('high');
    saveOverride('low', store);
    expect(store.data.get(QUALITY_STORAGE_KEY)).toBe('low');
    expect(loadOverride(store)).toBe('low');
    expect(resolveQuality('high', store)).toBe('low');
    saveOverride(null, store); // "Auto"
    expect(resolveQuality('medium', store)).toBe('medium');
    store.setItem(QUALITY_STORAGE_KEY, 'ultra'); // garbage is ignored
    expect(resolveQuality('medium', store)).toBe('medium');
  });

  it('settings menu stores the choice and reports it', () => {
    const store = memoryStore();
    saveOverride('medium', store);
    const onChange = vi.fn();
    const menu = createQualityMenu(onChange, store);
    const sel = menu.element.querySelector('select')!;
    expect(sel.value).toBe('medium');
    sel.value = 'low';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('low');
    expect(loadOverride(store)).toBe('low');
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(loadOverride(store)).toBeNull();
    menu.setAuto('high');
    expect(sel.options[0]!.text).toBe('Auto (High)');
  });
});

describe('presets', () => {
  it('low has no post-processing and no transmission; high has both', () => {
    expect(usesPost('low')).toBe(false);
    expect(PRESETS.low.transmission).toBe(false);
    // Low keeps the haze (fog is a per-fragment term, not post-processing) and the identity.
    expect(PRESETS.low.haze).toBe(true);
    expect(PRESETS.low.fresnel).toBe(false);
    expect(usesPost('medium')).toBe(true);
    expect(PRESETS.medium.transmission).toBe(false);
    expect(usesPost('high')).toBe(true);
    expect(PRESETS.high.transmission).toBe(true);
    for (const q of ['low', 'medium'] as const) {
      const m = lookMaterial('slab-glass', q) as THREE.MeshPhysicalMaterial;
      expect(m.transmission ?? 0).toBe(0);
    }
    expect((lookMaterial('slab-glass', 'high') as THREE.MeshPhysicalMaterial).transmission).toBeGreaterThan(0);
    expect(lookMaterial('part-glass', 'low')).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('low keeps the 3Blue1Brown identity: thin white edges, low-alpha slab glass, tinted parts', () => {
    const slab = lookMaterial('slab-glass', 'low') as THREE.MeshBasicMaterial;
    expect(slab.transparent).toBe(true);
    expect(slab.opacity).toBeLessThanOrEqual(0.1); // glass, never a white fill
    expect(slab.depthWrite).toBe(false);
    const part = lookMaterial('part-glass', 'low') as THREE.MeshBasicMaterial;
    const edge = lookMaterial('part-edge', 'low') as THREE.LineBasicMaterial;
    const edgeHigh = lookMaterial('part-edge', 'high') as THREE.LineBasicMaterial;
    expect(edge.color.getHex()).toBe(PALETTE.edge);
    // Fainter outlines and a denser tinted body on low: the role colour wins over the white lines.
    expect(edge.opacity).toBeLessThan(edgeHigh.opacity);
    expect(part.opacity).toBeGreaterThan(edge.opacity);
    expect(part.opacity).toBeLessThan(0.5);
  });

  it('reduced motion holds the haze still', () => {
    for (const t of [0, 1.3, 7, 20]) expect(hazeDensity(t, true)).toBe(HAZE_DENSITY);
    expect(new Set([0, 3.5, 7, 10.5].map((t) => hazeDensity(t, false))).size).toBeGreaterThan(1);
  });
});

describe('palette in the scene', () => {
  const tower = buildTower(a);
  const mesh = (name: string): THREE.Mesh => tower.root.getObjectByName(name) as THREE.Mesh;
  const instanceHex = (name: string, i = 0): number => {
    const m = mesh(name) as THREE.InstancedMesh;
    const c = new THREE.Color();
    m.getColorAt(i, c);
    return c.getHex();
  };

  it('stream and ternary hues: A cyan near 185 deg, B amber near 40 deg, +1 warm, -1 cold', () => {
    const hue = (hex: number): number => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).h * 360; // hue as authored (sRGB)
    expect(Math.abs(hue(PALETTE.streamA) - 185)).toBeLessThan(8);
    expect(Math.abs(hue(PALETTE.streamB) - 40)).toBeLessThan(8);
    const plus = new THREE.Color(PALETTE.ternaryPlus);
    const minus = new THREE.Color(PALETTE.ternaryMinus);
    expect(plus.r).toBeGreaterThan(plus.b);
    expect(minus.b).toBeGreaterThan(minus.r);
  });

  it('streamColor for A and B uses palette.streamA / palette.streamB', () => {
    expect(streamColor('A')).toBe(PALETTE.streamA);
    expect(streamColor('B')).toBe(PALETTE.streamB);
    // Lane A (y = -1.8) is cyan, lane B amber.
    expect(LANE_Y.A).toBe(-1.8);
    const laneA = mesh('shaft.A');
    expect(laneA.position.y).toBe(LANE_Y.A);
    expect((laneA.material as THREE.MeshBasicMaterial).color.getHex()).toBe(PALETTE.streamA);
    expect((mesh('shaft.B').material as THREE.MeshBasicMaterial).color.getHex()).toBe(PALETTE.streamB);
  });

  it('parts carry their role colour: experts green, routers violet, gate red, per-stream attention', () => {
    expect(instanceHex('experts')).toBe(PALETTE.expertIdle);
    expect(instanceHex('router')).toBe(PALETTE.router);
    expect(instanceHex('gates')).toBe(PALETTE.gate);
    const ids = mesh('attn').userData.ids as string[];
    expect(instanceHex('attn', ids.indexOf(attnId(3, 'A')))).toBe(PALETTE.streamA);
    expect(instanceHex('attn', ids.indexOf(attnId(3, 'B')))).toBe(PALETTE.streamB);
    expect(cssHex(PALETTE.streamA)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('parts are glass with white outlines that share the instance matrices', () => {
    for (const name of ['experts', 'router', 'attn', 'ln1', 'ln2']) {
      const m = mesh(name) as THREE.InstancedMesh;
      expect(m.userData.look).toBe('part-glass');
      expect((m.material as THREE.Material).transparent).toBe(true);
      const edges = m.getObjectByName(`${name}-edges`) as THREE.LineSegments & { instanceMatrix?: unknown };
      expect(edges).toBeDefined();
      expect(edges.instanceMatrix).toBe(m.instanceMatrix);
      expect((edges.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(m.count);
      expect(edges.userData.look).toBe('part-edge');
    }
    expect(mesh('slabs').userData.look).toBe('slab-glass');
  });

  it('only lanes are on the bloom layer in the row', () => {
    const bloom: string[] = [];
    const probe = new THREE.Layers();
    probe.set(BLOOM_LAYER);
    tower.root.traverse((o) => { if (o.layers.test(probe)) bloom.push(o.name); });
    expect(bloom.sort()).toEqual(['shaft.A', 'shaft.B']);
  });
});
