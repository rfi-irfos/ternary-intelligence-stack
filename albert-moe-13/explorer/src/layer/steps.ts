import type { CaveatId } from '../content/caveats';
import type { Architecture } from '../data/architecture';
import { type LabelKind, type Labeled, illustrative, measured, structure } from '../data/labeled';
import { type Trace, type TraceEvent, decodeToken } from '../data/trace';
import type { Depth } from '../ui/depth';
import { type ComponentId, type Stream, attnId, attnMatrixId, bankId, expertId, expertPartId, gateId, ln1Id, ln2Id, routerId } from '../scene/ids';

export type StepId =
  | 'ln1' | 'qkv' | 'rope' | 'scores' | 'softmax' | 'o_resid' | 'router' | 'top3' | 'expert' | 'moe_resid' | 'gate';

export const STEP_IDS: StepId[] = [
  'ln1', 'qkv', 'rope', 'scores', 'softmax', 'o_resid', 'router', 'top3', 'expert', 'moe_resid', 'gate',
];

/** What a step shows. Each variant carries the label of the numbers it draws. */
export type ViewSpec =
  /** Heat strip of a long vector with a zoomable slice [from, to). */
  | { kind: 'heat'; label: LabelKind; title: string; series: { name: string; values: number[] }[]; slice: [number, number] }
  /** Attention per head for the query at `position`; keys are 0..position. `matrix` is head 0 over all queries <= position. */
  | {
    kind: 'attention'; label: LabelKind; position: number; tokens: string[] | null;
    heads: { head: number; row: number[] }[]; matrix: number[][]; truncated: boolean; note: string;
  }
  /** Causal mask: allowed keys 0..position, masked keys position+1..n-1. Structure. */
  | { kind: 'mask'; label: 'structure'; position: number; size: number }
  /** 12-bar chart; `marked` are the top-3 experts. */
  | { kind: 'bars'; label: LabelKind; title: string; values: number[]; marked: number[] }
  /** Numbers with their own labels, listed. */
  | { kind: 'readout'; items: { name: string; value: Labeled<number | string> }[] }
  /** 4x4 toy of a ternary matmul (W in {-1,0,+1}). Always illustrative. `tiles` are real weight matrices of this layer (structure). */
  | { kind: 'matmul'; label: 'illustrative'; w: number[][]; x: number[]; y: number[]; tiles: string[] }
  /** Pairwise rotation of Q and K by position-dependent angles. Illustrative frequencies, real position. */
  | { kind: 'rope'; label: 'illustrative'; position: number; angles: number[] };

export interface Step {
  id: StepId;
  title: Record<Depth, string>;
  formula: string;
  view: ViewSpec;
  data: Labeled<unknown>;
  caveats: CaveatId[];
  /** Level to open in the exploded slab for this step (a slab, attention block or the expert bank, then one expert). */
  open: ComponentId[];
  /** Parts of the open level to highlight. */
  highlight: ComponentId[];
}

export interface RouterStepData {
  position: number;
  logits: number[];
  top3: [number, number, number];
  weights: [number, number, number];
  a3Clamped: boolean;
  outputScales: number[];
}

type Ev<T extends TraceEvent['type']> = Extract<TraceEvent, { type: T }>;

/** Deterministic pseudo-random in [-1, 1) (mulberry32); keeps toy figures stable between renders. */
export function toyRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

function toyMatmul(seed: number, tiles: string[]): ViewSpec {
  const rnd = toyRandom(seed);
  const tri = (): number => { const v = rnd(); return v < -0.34 ? -1 : v > 0.34 ? 1 : 0; };
  const w = Array.from({ length: 4 }, () => Array.from({ length: 4 }, tri));
  const x = Array.from({ length: 4 }, () => r3(rnd()));
  const y = w.map((row) => r3(row.reduce((s, c, j) => s + c * (x[j] ?? 0), 0)));
  return { kind: 'matmul', label: 'illustrative', w, x, y, tiles };
}

function toySoftmax(seed: number, n: number): number[] {
  const rnd = toyRandom(seed);
  const e = Array.from({ length: n }, () => Math.exp(rnd() * 2));
  const s = e.reduce((p, c) => p + c, 0);
  return e.map((v) => v / s);
}

const TOY_TOKENS = 12;
const toyVector = (seed: number, n: number, mean: number, spread: number): number[] => {
  const rnd = toyRandom(seed);
  return Array.from({ length: n }, () => r3(mean + spread * rnd()));
};

function normalise(v: number[]): number[] {
  const mu = v.reduce((s, c) => s + c, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, c) => s + (c - mu) ** 2, 0) / v.length) || 1;
  return v.map((c) => r3((c - mu) / sd));
}

/**
 * The steps of one layer for one stream at one token position (spec 4.8), in order. The gate step exists only on
 * fusion layers (read from the architecture). With a trace, router, attention, residual and gate values are
 * measured; without one every figure is illustrative. Tensors the trace does not hold (the 256-vectors, pre-softmax
 * scores, expert activations) are always illustrative toys.
 */
export function layerSteps(
  t: Trace | null, layer: number, stream: Stream, position: number, a: Architecture,
): Step[] {
  if (!Number.isInteger(layer) || layer < 0 || layer >= a.model.num_layers) throw new Error(`layer ${layer} out of range`);
  if (!Number.isInteger(position) || position < 0) throw new Error(`position ${position} out of range`);
  const n = t ? t.provenance.token_ids.length : TOY_TOKENS;
  if (position >= n) throw new Error(`position ${position} out of range 0..${n - 1}`);
  const s = stream === 'A' ? 'a' : 'b';
  const seed = layer * 131 + (stream === 'A' ? 1 : 2) * 17 + position;
  const fusion = a.model.fusion_layers.includes(layer);
  const m = <V>(v: V): Labeled<V> => measured(v, (t as Trace).provenance);

  let router: Ev<'router'> | undefined;
  const heads: Ev<'attention'>[] = [];
  const resid = new Map<string, Ev<'residual'>>();
  let gate: Ev<'gate'> | undefined;
  for (const e of t?.events ?? []) {
    if (e.type === 'router' && e.layer === layer && e.stream === s) router = e;
    else if (e.type === 'attention' && e.layer === layer && e.stream === s) heads.push(e);
    else if (e.type === 'residual' && e.layer === layer && e.stream === s) resid.set(e.phase, e);
    else if (e.type === 'gate' && e.layer === layer) gate = e;
  }
  if (t && !router) throw new Error(`trace has no router event for L${layer} ${stream}`);

  const hidden = a.model.hidden;
  const inner = a.model.ffn_inner;
  const tiles = (names: string[]): string[] => names.map((x) => `stream_${s}.attn.${x}_proj.weight`);
  const slabOpen: ComponentId[] = [`L${layer}`];
  const attnOpen: ComponentId[] = [`L${layer}`, attnId(layer, stream)];
  const steps: Step[] = [];

  // 1 ln1: the trace holds no activation vectors, so the strip is a toy.
  {
    const x = toyVector(seed, hidden, 0.4, 3);
    steps.push({
      id: 'ln1',
      title: {
        intuition: 'Tidy the numbers first',
        technical: 'ln1: normalise the residual stream',
        researcher: 'ln1: per-token mean/variance normalisation before attention',
      },
      formula: 'y = (x - mean(x)) / sqrt(var(x) + eps)',
      view: {
        kind: 'heat', label: 'illustrative', title: `toy ${hidden}-vector before and after (not a recorded activation)`,
        series: [{ name: 'x', values: x }, { name: 'ln1(x)', values: normalise(x) }], slice: [0, Math.min(64, hidden)],
      },
      data: illustrative({ vectorLength: hidden, note: 'toy vector, the trace holds no activation vectors' }),
      caveats: [], open: slabOpen, highlight: [ln1Id(layer, stream)],
    });
  }

  // 2 qkv: toy ternary matmul beside the real tiles.
  steps.push({
    id: 'qkv',
    title: {
      intuition: 'Three questions from every token',
      technical: 'Q, K, V projections with ternary weights',
      researcher: 'Q, K, V = ln1(x) W{q,k,v}, W in {-1, 0, +1} with scale gamma',
    },
    formula: 'Q = x Wq, K = x Wk, V = x Wv',
    view: toyMatmul(seed + 1, tiles(['q', 'k', 'v'])),
    data: illustrative({ note: 'toy 4x4 matmul; the weight tiles in the slab are structure' }),
    caveats: [], open: attnOpen,
    highlight: (['q', 'k', 'v'] as const).map((x) => attnMatrixId(layer, stream, x)),
  });

  // 3 rope: the position is real, the frequencies are a toy.
  steps.push({
    id: 'rope',
    title: {
      intuition: 'Mark where each token sits',
      technical: 'RoPE rotates Q and K by position',
      researcher: 'RoPE: pairwise rotation of Q and K, angle = position * frequency_i',
    },
    formula: 'angle_i = position * freq_i',
    view: { kind: 'rope', label: 'illustrative', position, angles: [1, 0.1, 0.01, 0.001].map((f) => r3(position * f)) },
    data: illustrative({ position, note: 'the position is real; the four frequencies are a toy' }),
    caveats: [], open: attnOpen, highlight: [attnMatrixId(layer, stream, 'q'), attnMatrixId(layer, stream, 'k')],
  });

  // 4 scores: only the causal mask is structure; pre-softmax scores are not in the trace.
  steps.push({
    id: 'scores',
    title: {
      intuition: 'Each token looks only backwards',
      technical: 'Scores Q.K^T / sqrt(d) with a causal mask',
      researcher: 'S = Q K^T / sqrt(d_head); S[i][j] = -inf for j > i',
    },
    formula: 'S = Q K^T / sqrt(d_head), masked where key > query',
    view: { kind: 'mask', label: 'structure', position, size: n },
    data: structure({ position, allowedKeys: position + 1, maskedKeys: n - position - 1 }),
    caveats: [], open: attnOpen, highlight: [attnMatrixId(layer, stream, 'q'), attnMatrixId(layer, stream, 'k')],
  });

  // 5 softmax: measured rows from the trace; rows are cut to the causal keys.
  {
    const window = t?.provenance.attention_window;
    const windowStart = window !== undefined ? Math.max(0, n - window) : 0;
    const truncated = window !== undefined && position < windowStart;
    const sorted = [...heads].sort((x, y) => x.head - y.head);
    const hasTrace = sorted.length > 0 && !truncated;
    let rows: { head: number; row: number[] }[];
    let matrix: number[][];
    if (hasTrace) {
      rows = sorted.map((h) => ({ head: h.head, row: (h.weights[position] ?? []).slice(0, position + 1) }));
      matrix = (sorted[0]?.weights ?? []).slice(0, position + 1).map((r, i) => r.slice(0, i + 1));
    } else {
      const count = Math.max(1, a.model.num_heads);
      rows = Array.from({ length: count }, (_, h) => ({ head: h, row: toySoftmax(seed + 7 * h, position + 1) }));
      matrix = Array.from({ length: position + 1 }, (_, i) => toySoftmax(seed + 99 + i, i + 1));
    }
    const label = hasTrace ? 'measured' : 'illustrative';
    const note = truncated
      ? `truncated: position ${position} lies before the recorded window (positions ${windowStart}..${n - 1}); toy rows shown`
      : hasTrace ? 'recorded attention weights of this layer and stream' : 'toy rows; no measured trace';
    steps.push({
      id: 'softmax',
      title: {
        intuition: 'Decide whom to listen to',
        technical: 'Softmax per head, then the weighted sum of V',
        researcher: 'A = softmax(S) per head; out_h = A V_h; heads concatenated',
      },
      formula: 'A = softmax(S), out = A V',
      view: {
        kind: 'attention', label, position, tokens: t ? t.provenance.tokens.slice(0, position + 1).map(decodeToken) : null,
        heads: rows, matrix, truncated, note,
      },
      data: hasTrace ? m({ position, heads: rows, truncated: false }) : illustrative({ position, heads: rows, truncated, note }),
      caveats: [], open: attnOpen,
      highlight: Array.from({ length: a.model.num_heads }, (_, h) => `L${layer}.${stream}.attn.head${h}`),
    });
  }

  // 6 o_resid
  {
    const r = resid.get('post_attn');
    const norm = r?.norm[position];
    const nv: Labeled<number | string> = r && norm !== undefined ? m(norm) : illustrative('no trace');
    steps.push({
      id: 'o_resid',
      title: {
        intuition: 'Mix the answers and add them back',
        technical: 'O projection, then the residual add',
        researcher: 'x1 = x + concat(heads) Wo',
      },
      formula: 'x1 = x + out Wo',
      view: { kind: 'readout', items: [{ name: 'norm of x1 (post attention)', value: nv }] },
      data: r && norm !== undefined ? m({ phase: 'post_attn', norm }) : illustrative({ phase: 'post_attn', note: 'no trace' }),
      caveats: [], open: attnOpen, highlight: [attnMatrixId(layer, stream, 'o')],
    });
  }

  // 7 router
  const top3Toy: [number, number, number] = [0, 1, 2].map((i) => (seed + 5 * i) % a.model.num_experts) as [number, number, number];
  const logits: number[] = router
    ? router.logits[position] ?? []
    : toyVector(seed + 3, a.model.num_experts, 0, 1);
  const top3: [number, number, number] = router ? (router.top3[position] ?? top3Toy) : top3Toy;
  if (router && (logits.length !== a.model.num_experts || !router.top3[position])) throw new Error('router event has no row for this position');
  const wts: [number, number, number] = router ? (router.weights[position] as [number, number, number]) : [0.5, 0.3, 0.2];
  const clamped = router ? (router.a3_clamped[position] ?? false) : false;
  const rd: RouterStepData = {
    position, logits, top3, weights: wts, a3Clamped: clamped, outputScales: router?.output_scales ?? [],
  };
  const a3Involved = top3.some((e) => e < 4);
  const routerLabel = router ? 'measured' : 'illustrative';
  steps.push({
    id: 'router',
    title: {
      intuition: 'Which experts fit this token?',
      technical: `Router: one logit per expert (${a.model.num_experts})`,
      researcher: 'Router: ln2(x1) Wg gives gate logits after temperature and traffic-light modifiers',
    },
    formula: 'logits = ln2(x1) Wg',
    view: { kind: 'bars', label: routerLabel, title: 'gate logits per expert', values: logits, marked: [...top3] },
    data: router ? m(rd) : illustrative(rd),
    caveats: ['A5'], open: slabOpen, highlight: [ln2Id(layer, stream), routerId(layer, stream)],
  });

  // 8 top3: weights exactly as recorded.
  steps.push({
    id: 'top3',
    title: {
      intuition: 'Pick the best three',
      technical: 'Top-3 selection and softmax weights',
      researcher: 'top-3 of the logits; softmax over those three after the A3 clamp, before the output scales',
    },
    formula: 'w = softmax(logits[top3])',
    view: { kind: 'bars', label: routerLabel, title: 'weights of the selected experts', values: [...wts], marked: [0, 1, 2] },
    data: router ? m(rd) : illustrative(rd),
    caveats: a3Involved || clamped ? ['A3'] : [], open: slabOpen,
    highlight: [bankId(layer), ...top3.map((e) => expertId(layer, e))],
  });

  // 9 expert: the choice of expert is measured, the arithmetic inside is a toy.
  {
    const e0 = top3[0];
    steps.push({
      id: 'expert',
      title: {
        intuition: 'One expert does its work',
        technical: `Expert ${e0}: seed_bias, c_fc, GELU, c_proj`,
        researcher: `Expert ${e0}: h = GELU((x + seed_bias) Wfc) ; y = h Wproj, inner width ${inner}`,
      },
      formula: 'y = GELU((x + seed_bias) W_fc) W_proj',
      view: toyMatmul(seed + 2, [`experts.${e0}.c_fc.weight`, `experts.${e0}.c_proj.weight`]),
      data: router ? m({ expert: e0, weight: wts[0] }) : illustrative({ expert: e0, note: 'no trace' }),
      caveats: ['A4'], open: [`L${layer}`, bankId(layer), expertId(layer, e0)],
      highlight: (['seed_bias', 'c_fc', 'gelu', 'c_proj'] as const).map((p) => expertPartId(layer, e0, p)),
    });
  }

  // 10 moe_resid
  {
    const r = resid.get('post_moe');
    const norm = r?.norm[position];
    const items: { name: string; value: Labeled<number | string> }[] = top3.map((e, i) => ({
      name: `weight x output scale, expert ${e}`,
      value: router ? m(`${r3(wts[i] ?? 0)} x ${router.output_scales[e] ?? 'n/a'}`) : illustrative('no trace'),
    }));
    items.push({ name: 'norm of x2 (post MoE)', value: r && norm !== undefined ? m(norm) : illustrative('no trace') });
    steps.push({
      id: 'moe_resid',
      title: {
        intuition: 'Blend the three answers and add them back',
        technical: 'Weighted expert sum, then the residual add',
        researcher: 'x2 = x1 + sum_i scale_i * w_i * expert_i(ln2(x1))',
      },
      formula: 'x2 = x1 + sum_i w_i * expert_i(x)',
      view: { kind: 'readout', items },
      data: r && norm !== undefined && router ? m({ phase: 'post_moe', norm, weights: wts, outputScales: router.output_scales }) : illustrative({ phase: 'post_moe', note: 'no trace' }),
      caveats: clamped ? ['A5', 'A3'] : ['A5'], open: slabOpen, highlight: [bankId(layer), routerId(layer, stream)],
    });
  }

  // 11 gate: fusion layers only
  if (fusion) {
    const gA = gate?.g_a[position];
    const gB = gate?.g_b[position];
    const real = gate !== undefined && gA !== undefined && gB !== undefined;
    const lv = (v: number | undefined, toy: number): Labeled<number | string> => (real && v !== undefined ? m(v) : illustrative(toy));
    steps.push({
      id: 'gate',
      title: {
        intuition: 'The two streams swap a little',
        technical: 'Anastomosis: each stream adds a gated share of the other',
        researcher: 'A += g_a * B ; B += g_b * A with g = sigmoid(Wg x + b), per token',
      },
      formula: 'A\' = A + g_a * B, B\' = B + g_b * A',
      view: { kind: 'readout', items: [{ name: 'g_a', value: lv(gA, 0.5) }, { name: 'g_b', value: lv(gB, 0.5) }] },
      data: real ? m({ gA, gB }) : illustrative({ gA: 0.5, gB: 0.5, note: 'no trace; 0.5 is a placeholder' }),
      caveats: ['A1', 'A2'], open: slabOpen, highlight: [gateId(layer)],
    });
  }
  return steps;
}
