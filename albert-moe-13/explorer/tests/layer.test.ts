// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { measured } from '../src/data/labeled';
import { validateTrace, type Trace } from '../src/data/trace';
import realL12 from '../public/data/weights/L12.json';
import { validateLayerWeights, ternarySlice } from '../src/data/weights';
import * as THREE from 'three';
import { layerSteps, STEP_IDS } from '../src/layer/steps';
import { applyHighlight, createLayerMode, renderStep, renderView, type LayerModeDeps } from '../src/layer/views';

const a = validateArchitecture(arch);
const modules = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const kjv: Trace = validateTrace(modules['../public/data/trace/kjv.json'], a);
import windowed from './fixtures/fixture_windowed.json';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const nonFusion = [0, 1, 4, 12].find((l) => !a.model.fusion_layers.includes(l)) as number;
const fusion = a.model.fusion_layers[2] as number;

describe('layerSteps', () => {
  it('11 steps in spec order (gate only on fusion layers, read from the architecture)', () => {
    const all = layerSteps(kjv, fusion, 'A', 3, a);
    expect(all).toHaveLength(11);
    expect(all.map((s) => s.id)).toEqual(STEP_IDS);
    expect(all.map((s) => s.id)).toEqual(['ln1', 'qkv', 'rope', 'scores', 'softmax', 'o_resid', 'router', 'top3', 'expert', 'moe_resid', 'gate']);
    const ten = layerSteps(kjv, nonFusion, 'B', 3, a);
    expect(ten).toHaveLength(10);
    expect(ten.some((s) => s.id === 'gate')).toBe(false);
    for (let l = 0; l < a.model.num_layers; l++) {
      expect(layerSteps(null, l, 'A', 0, a).length).toBe(a.model.fusion_layers.includes(l) ? 11 : 10);
    }
  });

  it('router step measured when trace present, illustrative when null', () => {
    const find = (t: Trace | null) => layerSteps(t, 12, 'A', 4, a).find((s) => s.id === 'router');
    const withTrace = find(kjv);
    expect(withTrace?.data.kind).toBe('measured');
    expect(withTrace?.data.provenance?.prompt_id).toBe('kjv');
    const ev = kjv.events.find((e) => e.type === 'router' && e.layer === 12 && e.stream === 'a');
    if (!ev || ev.type !== 'router') throw new Error('no router');
    const v = withTrace?.data.value as { top3: number[]; weights: number[]; logits: number[] };
    expect(v.top3).toEqual(ev.top3[4]);
    expect(v.weights).toEqual(ev.weights[4]); // as recorded, never recomputed
    expect(v.logits).toEqual(ev.logits[4]);
    expect(withTrace?.view).toMatchObject({ kind: 'bars', label: 'measured' });
    const without = find(null);
    expect(without?.data.kind).toBe('illustrative');
    expect(without?.view).toMatchObject({ label: 'illustrative' });
  });

  it('position 0 attention is a single 1.0', () => {
    const sm = layerSteps(kjv, 12, 'A', 0, a).find((s) => s.id === 'softmax');
    const view = sm?.view;
    if (view?.kind !== 'attention') throw new Error('wrong view');
    expect(view.heads.length).toBe(a.model.num_heads);
    for (const h of view.heads) expect(h.row).toEqual([1]);
    expect(view.matrix).toEqual([[1]]);
    const toy = layerSteps(null, 12, 'A', 0, a).find((s) => s.id === 'softmax');
    if (toy?.view.kind !== 'attention') throw new Error('wrong view');
    for (const h of toy.view.heads) expect(h.row).toEqual([1]);
  });

  it('truncated attention is labelled when position < trace window start', () => {
    const t = clone(kjv);
    t.provenance.attention_window = 4; // window = last 4 of 11 positions: starts at 7
    const sm = (pos: number) => layerSteps(t, 12, 'A', pos, a).find((s) => s.id === 'softmax');
    const cut = sm(2);
    if (cut?.view.kind !== 'attention') throw new Error('wrong view');
    expect(cut.view.truncated).toBe(true);
    expect(cut.view.note).toMatch(/truncated/);
    expect(cut.data.kind).toBe('illustrative');
    expect(renderStep(cut, 'technical').querySelector('[data-truncated="true"]')).not.toBeNull();
    const inside = sm(8);
    if (inside?.view.kind !== 'attention') throw new Error('wrong view');
    expect(inside.view.truncated).toBe(false);
    expect(inside.data.kind).toBe('measured');
  });

  it('ternary toy matmul values are illustrative', () => {
    for (const trace of [kjv, null]) {
      const steps = layerSteps(trace, 12, 'A', 3, a);
      for (const id of ['qkv', 'expert']) {
        const s = steps.find((x) => x.id === id);
        if (s?.view.kind !== 'matmul') throw new Error('wrong view');
        expect(s.view.label).toBe('illustrative');
        expect(s.view.w.flat().every((x) => x === -1 || x === 0 || x === 1)).toBe(true);
        const html = renderView(s.view, null);
        expect(html.querySelector('.layer-kind--illustrative')).not.toBeNull();
        expect(html.querySelector('.layer-kind--measured')).toBeNull();
      }
      expect(steps.find((x) => x.id === 'qkv')?.data.kind).toBe('illustrative');
    }
  });

  it('the qkv and expert matmuls use the real 4x4 corner and gamma of the layer file, with the input still illustrative', () => {
    const w = validateLayerWeights(realL12);
    const steps = layerSteps(kjv, 12, 'A', 3, a, 'en', w);
    const qkv = steps.find((x) => x.id === 'qkv')!;
    if (qkv.view.kind !== 'matmul') throw new Error('wrong view');
    const qv = qkv.view;
    const q = ternarySlice(w, 'stream_a.attn.q_proj.weight')!;
    expect(qkv.view.w).toEqual(q.w);
    expect(qkv.view.gamma).toBe(q.gamma);
    expect(qkv.view.wKind).toBe('structure');
    expect(qkv.view.wFrom).toBe('stream_a.attn.q_proj.weight');
    expect(qkv.view.label).toBe('illustrative');
    expect(qkv.view.y).toEqual(q.w.map((row) => Math.round(q.gamma! * row.reduce((s, c, j) => s + c * qv.x[j]!, 0) * 1000) / 1000));
    const html = renderView(qkv.view, w);
    expect(html.querySelector('.layer-kind--structure')).not.toBeNull();
    expect(html.querySelector('.layer-kind--illustrative')).not.toBeNull();
    const ex = steps.find((x) => x.id === 'expert')!;
    if (ex.view.kind !== 'matmul') throw new Error('wrong view');
    expect(ex.view.wFrom).toMatch(/^experts\.\d+\.c_fc\.weight$/);
    expect(ex.view.w).toEqual(ternarySlice(w, ex.view.wFrom!)!.w);
    // the other stream reads its own matrices
    const b = layerSteps(kjv, 12, 'B', 3, a, 'en', w).find((x) => x.id === 'qkv')!;
    if (b.view.kind !== 'matmul') throw new Error('wrong view');
    expect(b.view.wFrom).toBe('stream_b.attn.q_proj.weight');
    // without a weight file the toy W stays and says so
    const toy = layerSteps(kjv, 12, 'A', 3, a).find((x) => x.id === 'qkv')!;
    if (toy.view.kind !== 'matmul') throw new Error('wrong view');
    expect(toy.view.wKind).toBe('illustrative');
    expect(toy.view.wFrom).toBeNull();
  });

  it('A3 caveat when experts 0-3 are involved or the clamp fired; gate uses measured g', () => {
    const steps = layerSteps(kjv, 12, 'A', 4, a);
    const top3 = (steps.find((s) => s.id === 'top3')?.data.value as { top3: number[] }).top3;
    expect(steps.find((s) => s.id === 'top3')?.caveats.includes('A3')).toBe(top3.some((e) => e < 4));
    const g = layerSteps(kjv, fusion, 'A', 4, a).find((s) => s.id === 'gate');
    expect(g?.data.kind).toBe('measured');
    expect(layerSteps(null, fusion, 'A', 4, a).find((s) => s.id === 'gate')?.data.kind).toBe('illustrative');
  });

  it('rejects out-of-range layer and position', () => {
    expect(() => layerSteps(kjv, a.model.num_layers, 'A', 0, a)).toThrow();
    expect(() => layerSteps(kjv, 0, 'A', kjv.provenance.token_ids.length, a)).toThrow();
  });
});

describe('windowed attention fixture', () => {
  const fx = validateTrace(windowed, a);
  const sm = (pos: number) => layerSteps(fx, 12, 'A', pos, a).find((s) => s.id === 'softmax');
  it('rows are indexed position - (S - W); earlier positions are truncated and labelled', () => {
    expect(fx.provenance.mode).toBe('fixture');
    const cut = sm(1);
    if (cut?.view.kind !== 'attention') throw new Error('view');
    expect(cut.view.truncated).toBe(true);
    expect(cut.view.note).toMatch(/truncated/);
    expect(cut.data.kind).toBe('illustrative');
    const inWin = sm(3);
    if (inWin?.view.kind !== 'attention') throw new Error('view');
    expect(inWin.view.truncated).toBe(false);
    expect(inWin.view.heads[0]?.row).toEqual([0.1, 0.2, 0.3, 0.4]);
    const v2 = sm(2)?.view;
    if (v2?.kind !== 'attention') throw new Error('view');
    expect(v2.heads.every((h) => h.row.join() === '0.2,0.3,0.5')).toBe(true);
    expect(inWin.data.kind).toBe('illustrative'); // fixtures are never measured
  });
  it('validateTrace checks the row count against attention_window', () => {
    const bad = clone(windowed) as { events: { type: string; weights?: number[][] }[] };
    const ev = bad.events.find((e) => e.type === 'attention');
    if (ev?.weights) ev.weights.pop();
    expect(() => validateTrace(bad, a)).toThrow(/attention_window/);
  });
});

function fakeDeps(over: Partial<LayerModeDeps> = {}): { deps: LayerModeDeps; opened: string[][]; calls: string[] } {
  const stack: string[] = [];
  const opened: string[][] = [];
  const calls: string[] = [];
  const view = {
    root: new THREE.Group(),
    depth: () => stack.length,
    current: () => stack[stack.length - 1] ?? null,
    explode: async (id: string) => { await Promise.resolve(); calls.push(`+${id}`); stack.push(id); opened.push([...stack]); },
    reassemble: async () => { await Promise.resolve(); calls.push(`-${stack.pop()}`); },
  };
  const pose = { position: new THREE.Vector3(1, 2, 3), target: new THREE.Vector3() };
  const rig = {
    pose: () => pose,
    flyToPose: async () => { calls.push('back'); },
    frame: async () => { calls.push('frame'); },
  };
  const deps: LayerModeDeps = {
    arch: a, view: view as unknown as LayerModeDeps['view'], rig, slabCenter: () => new THREE.Vector3(),
    loadWeights: () => Promise.reject(new Error('none')), load: (id) => Promise.resolve(id === 'kjv' ? kjv : kjv),
    reducedMotion: () => true, ...over,
  };
  return { deps, opened, calls };
}

describe('layer mode', () => {
  it('V1: selecting layer 2 then entering gives layer 2 and 11 steps', async () => {
    const { deps } = fakeDeps({ selectedLayer: () => 2 });
    const lm = createLayerMode(deps);
    await lm.enter();
    expect(lm.layer()).toBe(2);
    expect(lm.steps()).toHaveLength(11);
  });

  it('V2: starts on the player prompt and position, not on "no trace"', async () => {
    const { deps } = fakeDeps({ defaults: () => ({ promptId: 'kjv', position: 5 }) });
    const lm = createLayerMode(deps);
    await lm.enter(12);
    const sel = lm.element.querySelectorAll('select');
    expect((sel[0] as HTMLSelectElement).value).toBe('kjv');
    expect(lm.position()).toBe(5);
    expect(lm.steps().find((s) => s.id === 'router')?.data.kind).toBe('measured');
  });

  it('V3: token select, step data position and rendered attention agree; position 0 is one bar of 1.0', async () => {
    const { deps } = fakeDeps({ defaults: () => ({ promptId: 'kjv', position: 3 }) });
    const lm = createLayerMode(deps);
    await lm.enter(12);
    const tokenSel = lm.element.querySelector('select[aria-label="Token"]') as HTMLSelectElement;
    for (const pos of [3, 0, 7]) {
      tokenSel.value = String(pos);
      tokenSel.dispatchEvent(new Event('change'));
      await lm.idle();
      const sm = lm.steps().find((s) => s.id === 'softmax');
      expect((sm?.data.value as { position: number }).position).toBe(Number(tokenSel.value));
      await lm.goto(lm.steps().findIndex((s) => s.id === 'softmax'));
      expect(lm.element.textContent).toContain(`attention of position ${pos}`);
    }
    tokenSel.value = '0';
    tokenSel.dispatchEvent(new Event('change'));
    await lm.idle();
    await lm.goto(lm.steps().findIndex((s) => s.id === 'softmax'));
    const rows = lm.element.querySelectorAll('.layer-attn-row');
    expect(rows.length).toBe(a.model.num_heads);
    for (const r of rows) {
      const cells = r.querySelectorAll('[data-weight]');
      expect(cells).toHaveLength(1);
      expect((cells[0] as HTMLElement).dataset.weight).toBe('1');
    }
  });

  it('three rapid Next clicks land on step+3 with a consistent open level', async () => {
    const { deps } = fakeDeps({ defaults: () => ({ promptId: 'kjv', position: 4 }) });
    const lm = createLayerMode(deps);
    await lm.enter(12);
    const next = [...lm.element.querySelectorAll('button')].find((b) => b.textContent === 'Next') as HTMLButtonElement;
    next.click();
    next.click();
    next.click();
    await lm.idle();
    expect(lm.index()).toBe(3);
    const open = (deps.view as unknown as { depth(): number; current(): string | null });
    const want = lm.steps()[3]?.open ?? [];
    expect(open.depth()).toBe(want.length);
    expect(open.current()).toBe(want[want.length - 1]);
  });

  it('skips reassemble/explode when the open path is already right; camera frames on enter and returns on leave', async () => {
    const { deps, calls } = fakeDeps({ defaults: () => ({ promptId: 'kjv', position: 4 }) });
    const lm = createLayerMode(deps);
    await lm.enter(12);
    expect(calls).toContain('frame');
    const n = calls.length;
    await lm.goto(0); // same path again
    expect(calls.length).toBe(n);
    await lm.exit();
    expect(calls[calls.length - 1]).toBe('back');
    expect(document.body.classList.contains('layer-mode')).toBe(false);
  });

  it('re-frames when a step grows the open group beyond the frame, never when it shrinks', async () => {
    const { deps, calls } = fakeDeps({ defaults: () => ({ promptId: 'kjv', position: 4 }) });
    const v = deps.view as unknown as { depth(): number; box?: () => THREE.Box3 | null };
    // Depth 1 (the slab) spans x -10..10; depth 2 (attention) grows the group to x 30.
    v.box = () => (v.depth() === 0 ? null
      : new THREE.Box3(new THREE.Vector3(-10, -3, -2), new THREE.Vector3(v.depth() > 1 ? 30 : 10, 3, 2)));
    const lm = createLayerMode(deps);
    await lm.enter(12);
    const frames = (): number => calls.filter((c) => c === 'frame').length;
    expect(frames()).toBe(1);
    await lm.goto(1); // attention level: wider than the frame
    expect(frames()).toBe(2);
    await lm.goto(0); // back to the slab: smaller, the frame stays
    expect(frames()).toBe(2);
    await lm.goto(1); // fits the current frame
    expect(frames()).toBe(2);
  });

  it('a stream change re-opens the matching level', async () => {
    const { deps } = fakeDeps({ defaults: () => ({ promptId: 'kjv', position: 4 }) });
    const lm = createLayerMode(deps);
    await lm.enter(12, 'A');
    await lm.goto(1); // attention level of stream A
    const sel = lm.element.querySelector('select[aria-label="Stream"]') as HTMLSelectElement;
    sel.value = 'B';
    sel.dispatchEvent(new Event('change'));
    await lm.idle();
    const want = lm.steps()[1]?.open ?? [];
    expect(want.join()).toContain('.B.');
    const v = deps.view as unknown as { current(): string | null };
    expect(v.current()).toBe(want[want.length - 1]);
  });
});

describe('router chart and highlight', () => {
  it('draws chosen and negative bars with classes, a zero line and a legend', () => {
    const step = layerSteps(kjv, 12, 'A', 4, a).find((s) => s.id === 'router');
    if (!step) throw new Error('no step');
    const html = renderView(step.view);
    expect(html.querySelector('.layer-bars-zero')).not.toBeNull();
    expect(html.querySelectorAll('.layer-bar--chosen')).toHaveLength(3);
    expect(html.querySelectorAll('.layer-bar-chosen')).toHaveLength(3);
    expect(html.querySelector('.layer-legend')).not.toBeNull();
    expect(html.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
    const neg = a.model.num_experts;
    expect(html.querySelectorAll('.layer-bar-fill')).toHaveLength(neg);
  });

  it('applyHighlight disposes stale outlines', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.name = 'L1.A.attn.q';
    root.add(mesh);
    expect(applyHighlight(root, ['L1.A.attn.q'])).toBe(1);
    const line = mesh.children[0] as THREE.LineSegments;
    let g = 0;
    let m = 0;
    line.geometry.addEventListener('dispose', () => g++);
    (line.material as THREE.Material).addEventListener('dispose', () => m++);
    applyHighlight(root, []);
    expect([g, m]).toEqual([1, 1]);
    expect(mesh.children).toHaveLength(0);
  });
});

describe('fixture and sign handling', () => {
  it('measured() throws for a fixture provenance', () => {
    expect(() => measured(1, { ...kjv.provenance, mode: 'fixture' })).toThrow();
  });
  it('fixture trace: router and top3 views, and every data label, are illustrative', () => {
    const fx = validateTrace(windowed, a);
    const steps = layerSteps(fx, 12, 'A', 3, a);
    for (const id of ['router', 'top3']) {
      const v = steps.find((s) => s.id === id)?.view;
      if (v?.kind !== 'bars') throw new Error('view');
      expect(v.label).toBe('illustrative');
      expect(renderView(v).querySelector('.layer-kind--measured')).toBeNull();
    }
    expect(steps.every((s) => s.data.kind !== 'measured')).toBe(true);
  });
  it('a negative logit renders a --neg bar', () => {
    const t = clone(kjv);
    const ev = t.events.find((e) => e.type === 'router' && e.layer === 12 && e.stream === 'a');
    if (!ev || ev.type !== 'router') throw new Error('no router');
    (ev.logits[4] as number[])[11] = -2.5;
    const v = layerSteps(t, 12, 'A', 4, a).find((s) => s.id === 'router')?.view;
    if (v?.kind !== 'bars') throw new Error('view');
    expect(renderView(v).querySelectorAll('.layer-bar--neg').length).toBeGreaterThan(0);
  });
});
