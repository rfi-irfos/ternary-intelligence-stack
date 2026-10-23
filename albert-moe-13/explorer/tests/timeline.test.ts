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

  it('real traces: op A3 flag equals the raw a3_clamped of the trace events', () => {
    let clamped = 0;
    for (const id of ['kjv', 'de', 'ternary']) {
      const t = load(id);
      const raw = new Map<string, boolean[]>();
      for (const e of t.events) if (e.type === 'router') raw.set(`${e.layer}${e.stream}`, e.a3_clamped);
      for (let pos = 0; pos < t.provenance.token_ids.length; pos++) {
        for (const o of buildTimeline(t, a, pos)) {
          if (o.kind !== 'router' && o.kind !== 'experts') continue;
          const flag = raw.get(`${o.layer}${(o.stream as string).toLowerCase()}`)?.[pos];
          expect(typeof flag).toBe('boolean');
          expect(o.caveats.includes('A3')).toBe(flag);
          if (o.kind === 'router' && flag) clamped++;
        }
      }
    }
    // count over all positions of the three traces, computed from the raw events
    let rawCount = 0;
    for (const id of ['kjv', 'de', 'ternary']) {
      for (const e of load(id).events) if (e.type === 'router') rawCount += e.a3_clamped.filter(Boolean).length;
    }
    expect(clamped).toBe(rawCount);
    expect(clamped).toBeGreaterThan(0);
    console.log(`A3-clamped router positions across kjv, de, ternary: ${clamped}`);
  });

  it('op order: embed, per layer stream A then B (7 ops each), gate after B on fusion layers, then merge, ln_f, lm_head', () => {
    const ops = buildTimeline(kjv, a, 2);
    const seven = ['ln1', 'attn', 'resid', 'ln2', 'router', 'experts', 'resid'];
    expect(ops[0]?.kind).toBe('embed');
    expect(ops.slice(-3).map((o) => o.kind)).toEqual(['merge', 'ln_f', 'lm_head']);
    const layerOps = (l: number) => ops.filter((o) => o.layer === l);
    // layer 0 is not a fusion layer: A(7) then B(7), no gate
    const l0 = layerOps(0);
    expect(l0.map((o) => o.kind)).toEqual([...seven, ...seven]);
    expect(l0.map((o) => o.stream)).toEqual([...Array(7).fill('A'), ...Array(7).fill('B')]);
    expect(ops.indexOf(l0[0] as never)).toBe(1);
    // layer 2 is a fusion layer: gate follows stream B
    expect(a.model.fusion_layers).toContain(2);
    const l2 = layerOps(2);
    expect(l2.map((o) => o.kind)).toEqual([...seven, ...seven, 'gate']);
    expect(l2.at(-1)?.stream).toBeUndefined();
    // layers are contiguous and ascending
    const layers = ops.map((o) => o.layer).filter((l): l is number => l !== undefined);
    expect(layers).toEqual([...layers].sort((x, y) => x - y));
    // resid ops come in pairs: post_attn then post_moe
    const phases = ops.filter((o) => o.kind === 'resid').map((o) => (o.data.value as { phase: string }).phase);
    expect(phases).toHaveLength(a.model.num_layers * 4);
    phases.forEach((ph, i) => expect(ph).toBe(i % 2 === 0 ? 'post_attn' : 'post_moe'));
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
  it('post_moe resid pulses at the router, post_attn at attn', () => {
    const r = ops.filter((o) => o.kind === 'resid' && o.layer === 5 && o.stream === 'A');
    expect(opTarget(r[0] as never, tower).pulse).toBe('L5.A.attn');
    expect(opTarget(r[1] as never, tower).pulse).toBe('L5.A.router');
  });
  it('every op resolves to an anchor', () => {
    for (const o of ops) expect(tower.has(opTarget(o, tower).pulse)).toBe(true);
  });
});
