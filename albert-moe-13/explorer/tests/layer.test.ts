// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateTrace, type Trace } from '../src/data/trace';
import { layerSteps, STEP_IDS } from '../src/layer/steps';
import { renderStep, renderView } from '../src/layer/views';

const a = validateArchitecture(arch);
const modules = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const kjv: Trace = validateTrace(modules['../public/data/trace/kjv.json'], a);
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
