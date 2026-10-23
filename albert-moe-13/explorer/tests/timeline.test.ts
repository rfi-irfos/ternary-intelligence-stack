import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { decodeToken, validateTrace, type Trace } from '../src/data/trace';
import { OP_KINDS, buildTimeline, timelineLength, type ExpertsData, type LmHeadData, type RouterData } from '../src/flow/timeline';
import { opTarget } from '../src/flow/animate';
import { buildTower } from '../src/scene/tower';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const modules = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const load = (id: string): Trace => validateTrace(modules[`../public/data/trace/${id}.json`], a);
const kjv = load('kjv');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('buildTimeline', () => {
  it('timeline length = 1 + layers*2*7 + gates + 3, computed and literal 655 (brief said 654: 1+644+7+3 is 655)', () => {
    const ops = buildTimeline(kjv, a, 0);
    const expected = 1 + a.model.num_layers * 2 * 7 + a.model.fusion_layers.length + 3;
    expect(ops).toHaveLength(expected);
    expect(timelineLength(a)).toBe(expected);
    expect(ops).toHaveLength(1 + 46 * 2 * 7 + 7 + 3);
    expect(ops).toHaveLength(655);
    expect(ops.every((o) => OP_KINDS.includes(o.kind))).toBe(true);
    expect(ops.filter((o) => o.kind === 'gate').map((o) => o.layer)).toEqual(a.model.fusion_layers);
  });

  it('router op top3 equals trace for kjv, layer 12, stream A', () => {
    const pos = 4;
    const ev = kjv.events.find((e) => e.type === 'router' && e.layer === 12 && e.stream === 'a');
    if (!ev || ev.type !== 'router') throw new Error('trace has no L12 A router');
    const op = buildTimeline(kjv, a, pos).find((o) => o.kind === 'router' && o.layer === 12 && o.stream === 'A');
    const d = op?.data.value as RouterData;
    expect(d.top3).toEqual(ev.top3[pos]);
    expect(d.weights).toEqual(ev.weights[pos]); // as recorded, not recomputed
    expect(d.outputScales).toEqual(ev.output_scales);
    expect(op?.data.kind).toBe('measured');
    expect(op?.data.provenance?.prompt_id).toBe('kjv');
  });

  it('A3 flag set when safety clamp changed a logit', () => {
    const t = clone(kjv);
    const ev = t.events.find((e) => e.type === 'router' && e.layer === 12 && e.stream === 'a');
    if (!ev || ev.type !== 'router') throw new Error('no router');
    // fixture: force the clamp flag on one token; not a measurement
    ev.a3_clamped[2] = true;
    const ops = buildTimeline(t, a, 2);
    const hit = (k: string): boolean => ops.find((o) => o.kind === k && o.layer === 12 && o.stream === 'A')?.caveats.includes('A3') ?? false;
    expect(hit('router')).toBe(true);
    expect(hit('experts')).toBe(true);
    const other = buildTimeline(t, a, 3).find((o) => o.kind === 'router' && o.layer === 12 && o.stream === 'A');
    expect(other?.caveats).not.toContain('A3');
  });

  it('real clamped rows carry A3, unclamped ones do not', () => {
    for (const id of ['kjv', 'de', 'ternary']) {
      const t = load(id);
      for (let pos = 0; pos < t.provenance.token_ids.length; pos++) {
        for (const o of buildTimeline(t, a, pos)) {
          if (o.kind === 'router') expect(o.caveats.includes('A3')).toBe((o.data.value as RouterData).a3Clamped);
        }
      }
    }
  });

  it('lm_head op data is measured top-5 with provenance', () => {
    const last = kjv.provenance.token_ids.length - 1;
    const ops = buildTimeline(kjv, a, last);
    const head = ops[ops.length - 1];
    expect(head?.kind).toBe('lm_head');
    expect(head?.data.kind).toBe('measured');
    expect(head?.data.provenance).toEqual(kjv.provenance);
    const d = head?.data.value as LmHeadData;
    expect(d.topK).toHaveLength(5);
    expect(d.topK.map((k) => k.tokenId)).toEqual(kjv.top_k.map((k) => k.token_id));
    expect(d.topK[0]?.token).toBe(decodeToken(kjv.top_k[0]?.token ?? ''));
  });

  it('earlier positions have no recorded top 5 and say so (structure, empty)', () => {
    const head = buildTimeline(kjv, a, 0).at(-1);
    expect(head?.data.kind).toBe('structure');
    expect((head?.data.value as LmHeadData).topK).toEqual([]);
  });

  it('every measured op carries the trace provenance', () => {
    for (const o of buildTimeline(kjv, a, 1)) {
      if (o.data.kind === 'measured') expect(o.data.provenance).toEqual(kjv.provenance);
      else expect(o.data.provenance).toBeUndefined();
    }
  });

  it('rejects a position outside the prompt', () => {
    expect(() => buildTimeline(kjv, a, kjv.provenance.token_ids.length)).toThrow(/out of range/);
  });
});

describe('opTarget', () => {
  const ops = buildTimeline(kjv, a, 4);
  it('experts: 3 lit and 9 dark cubes from the router top-3', () => {
    const op = ops.find((o) => o.kind === 'experts' && o.layer === 5 && o.stream === 'B');
    if (!op) throw new Error('no op');
    const t = opTarget(op, tower);
    expect(t.lit).toHaveLength(3);
    expect(t.dark).toHaveLength(a.model.num_experts - 3);
    expect(t.lit.map((l) => l.id)).toEqual((op.data.value as ExpertsData).lit.map((e) => `L5.expert.${e}`));
    for (const id of [...t.lit.map((l) => l.id), ...t.dark]) expect(tower.has(id)).toBe(true);
  });
  it('gate: valves from g_a and g_b', () => {
    const op = ops.find((o) => o.kind === 'gate');
    if (!op) throw new Error('no gate');
    const t = opTarget(op, tower);
    const g = op.data.value as { gA: number; gB: number };
    expect(t.valves?.A).toBeCloseTo(Math.max(0, Math.min(1, g.gA)));
    expect(t.valves?.B).toBeCloseTo(Math.max(0, Math.min(1, g.gB)));
  });
  it('every op resolves to an anchor', () => {
    for (const o of ops) expect(tower.has(opTarget(o, tower).pulse)).toBe(true);
  });
});
