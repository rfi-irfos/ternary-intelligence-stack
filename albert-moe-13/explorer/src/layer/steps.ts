import type { CaveatId } from '../content/caveats';
import type { Architecture } from '../data/architecture';
import { type LabelKind, type Labeled, illustrative, measured, structure } from '../data/labeled';
import { type Trace, type TraceEvent, decodeToken } from '../data/trace';
import { type LayerWeights, ternarySlice } from '../data/weights';
import type { Depth } from '../ui/depth';
import type { Lang } from '../ui/strings';
import { type ComponentId, type Stream, headId, attnId, attnMatrixId, bankId, expertId, expertPartId, gateId, ln1Id, ln2Id, routerId } from '../scene/ids';

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
  | {
    kind: 'bars'; label: LabelKind; title: string; values: number[]; marked: number[];
    /** Bar labels (expert ids); defaults to the index. */
    labels?: string[];
    /** Chosen experts whose logit the A3 clamp may have changed (flag set for this token, expert 0-3). */
    clamped?: number[];
  }
  /** Numbers with their own labels, listed. */
  | { kind: 'readout'; items: { name: string; value: Labeled<number | string> }[] }
  /**
   * 4x4 ternary matmul y = gamma * (W x). `label` is the kind of x and y: always illustrative (the trace holds no activation
   * vectors). `wKind` is the kind of W: structure when it is the real top-left 4x4 corner of `wFrom` read from the layer's
   * weight file (with that matrix's `gamma`), illustrative for the toy W used while no weight file is loaded.
   * `tiles` are the real weight matrices of this layer shown beside it.
   */
  | {
    kind: 'matmul'; label: 'illustrative'; w: number[][]; x: number[]; y: number[]; tiles: string[];
    wKind: 'structure' | 'illustrative'; gamma: number | null; wFrom: string | null;
  }
  /** Pairwise rotation of Q and K: angle = position * 10000^(-2i/d), d = head_dim (rotate_half pairing). */
  | { kind: 'rope'; label: 'structure'; position: number; headDim: number; pairs: { pair: number; freq: number; angle: number }[]; pairing: string };

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

function toyMatmul(seed: number, tiles: string[], weights: LayerWeights | null = null): ViewSpec {
  const rnd = toyRandom(seed);
  const tri = (): number => { const v = rnd(); return v < -0.34 ? -1 : v > 0.34 ? 1 : 0; };
  const toy = Array.from({ length: 4 }, () => Array.from({ length: 4 }, tri));
  const x = Array.from({ length: 4 }, () => r3(rnd()));
  // The real corner and scale of the first tile matrix when the layer's weight file is loaded (Simeon 2026-10-23: real data only).
  const real = weights && tiles[0] ? ternarySlice(weights, tiles[0]) : null;
  if (real) {
    const g = real.gamma ?? 1;
    const y = real.w.map((row) => r3(g * row.reduce((s, c, j) => s + c * (x[j] ?? 0), 0)));
    return { kind: 'matmul', label: 'illustrative', w: real.w, x, y, tiles, wKind: 'structure', gamma: real.gamma, wFrom: real.name };
  }
  const y = toy.map((row) => r3(row.reduce((s, c, j) => s + c * (x[j] ?? 0), 0)));
  return { kind: 'matmul', label: 'illustrative', w: toy, x, y, tiles, wKind: 'illustrative', gamma: null, wFrom: null };
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
  t: Trace | null, layer: number, stream: Stream, position: number, a: Architecture, lang: Lang = 'en',
  weights: LayerWeights | null = null,
): Step[] {
  /** Content text as an { en, de } pair, resolved for `lang` (formulas and tensor names are not translated). */
  const L = (x: { en: string; de: string }): string => x[lang];
  const k = a.model.top_k;
  if (!Number.isInteger(layer) || layer < 0 || layer >= a.model.num_layers) throw new Error(`layer ${layer} out of range`);
  if (!Number.isInteger(position) || position < 0) throw new Error(`position ${position} out of range`);
  const n = t ? t.provenance.token_ids.length : TOY_TOKENS;
  if (position >= n) throw new Error(`position ${position} out of range 0..${n - 1}`);
  const s = stream === 'A' ? 'a' : 'b';
  const seed = layer * 131 + (stream === 'A' ? 1 : 2) * 17 + position;
  const fusion = a.model.fusion_layers.includes(layer);
  // Fixture traces are test data: never labelled measured.
  const isFixture = t?.provenance.mode === 'fixture';
  const m = <V>(v: V): Labeled<V> => (isFixture ? illustrative(v) : measured(v, (t as Trace).provenance));

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
        intuition: L({ en: 'Tidy the numbers first', de: 'Erst die Zahlen ordnen' }),
        technical: L({ en: 'ln1: normalise the residual stream', de: 'ln1: den Residualstrom normieren' }),
        researcher: L({ en: 'ln1: per-token mean/variance normalisation before attention', de: 'ln1: Normierung von Mittelwert und Varianz je Token vor der Attention' }),
      },
      formula: 'y = (x - mean(x)) / sqrt(var(x) + eps) · γ + β',
      view: {
        kind: 'heat', label: 'illustrative', title: L({ en: `toy ${hidden}-vector before and after (not a recorded activation)`, de: `Beispielvektor mit ${hidden} Werten vorher und nachher (keine aufgezeichnete Aktivierung)` }),
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
      intuition: L({ en: 'Three questions from every token', de: 'Drei Fragen aus jedem Wort' }),
      technical: L({ en: 'Q, K, V projections with ternary weights', de: 'Projektionen Q, K, V mit ternären Gewichten' }),
      researcher: L({ en: 'Q, K, V = ln1(x) W{q,k,v}, W in {-1, 0, +1} with scale gamma', de: 'Q, K, V = ln1(x) W{q,k,v}, W in {-1, 0, +1} mit Skala gamma' }),
    },
    formula: 'Q = x Wq, K = x Wk, V = x Wv',
    view: toyMatmul(seed + 1, tiles(['q', 'k', 'v']), weights),
    data: illustrative({ note: 'the input x is an example; W is the real 4x4 corner of the weight tile when the weight file is loaded' }),
    caveats: [], open: attnOpen,
    highlight: (['q', 'k', 'v'] as const).map((x) => attnMatrixId(layer, stream, x)),
  });

  // 3 rope: position, head_dim and the frequency law are structure.
  {
    const d = a.model.head_dim;
    const half = d / 2;
    const idx = [...new Set([0, 1, 2, 3, half - 1].filter((k) => k >= 0 && k < half))];
    const pairs = idx.map((k) => {
      const freq = 10000 ** (-(2 * k) / d);
      return { pair: k, freq, angle: position * freq };
    });
    steps.push({
      id: 'rope',
      title: {
        intuition: L({ en: 'Mark where each token sits', de: 'Markieren, wo jedes Wort steht' }),
        technical: L({ en: 'RoPE rotates Q and K by position', de: 'RoPE dreht Q und K je nach Position' }),
        researcher: L({
          en: `RoPE: dimension i pairs with i+${half} (rotate_half), angle = position * 10000^(-2i/${d})`,
          de: `RoPE: Dimension i bildet ein Paar mit i+${half} (rotate_half), Winkel = Position * 10000^(-2i/${d})`,
        }),
      },
      formula: `angle_i = position * 10000^(-2i/d), d = ${d}; pair (i, i + d/2)`,
      view: {
        kind: 'rope', label: 'structure', position, headDim: d, pairs,
        pairing: L({ en: `rotate_half: dimension i is rotated together with dimension i + ${half}`, de: `rotate_half: Dimension i wird zusammen mit Dimension i + ${half} gedreht` }),
      },
      data: structure({ position, headDim: d, base: 10000 }),
      caveats: [], open: attnOpen, highlight: [attnMatrixId(layer, stream, 'q'), attnMatrixId(layer, stream, 'k')],
    });
  }

  // 4 scores: only the causal mask is structure; pre-softmax scores are not in the trace.
  steps.push({
    id: 'scores',
    title: {
      intuition: L({ en: 'Each token looks only backwards', de: 'Jedes Wort schaut nur zurück' }),
      technical: L({ en: 'Scores Q.K^T / sqrt(d) with a causal mask', de: 'Scores Q.K^T / sqrt(d) mit kausaler Maske' }),
      researcher: L({ en: 'S = Q K^T / sqrt(d_head); S[i][j] = -inf for j > i', de: 'S = Q K^T / sqrt(d_head); S[i][j] = -inf für j > i' }),
    },
    formula: 'S = Q K^T / sqrt(d_head), masked where key > query',
    view: { kind: 'mask', label: 'structure', position, size: n },
    data: structure({ position, allowedKeys: position + 1, maskedKeys: n - position - 1 }),
    caveats: [], open: attnOpen, highlight: [attnMatrixId(layer, stream, 'q'), attnMatrixId(layer, stream, 'k')],
  });

  // 5 softmax: measured rows from the trace; rows are cut to the causal keys. With attention_window W the
  // events hold the last W query positions (row = position - (n - W)); earlier positions are truncated.
  {
    const window = t?.provenance.attention_window;
    const windowStart = window !== undefined ? Math.max(0, n - window) : 0;
    const truncated = window !== undefined && position < windowStart;
    const sorted = [...heads].sort((x, y) => x.head - y.head);
    const hasTrace = sorted.length > 0 && !truncated;
    const base = windowStart;
    let rows: { head: number; row: number[] }[];
    let matrix: number[][];
    if (hasTrace) {
      rows = sorted.map((h) => ({ head: h.head, row: (h.weights[position - base] ?? []).slice(0, position + 1) }));
      matrix = (sorted[0]?.weights ?? []).slice(0, position - base + 1).map((r, i) => r.slice(0, base + i + 1));
    } else {
      const count = Math.max(1, a.model.num_heads);
      rows = Array.from({ length: count }, (_, h) => ({ head: h, row: toySoftmax(seed + 7 * h, position + 1) }));
      matrix = Array.from({ length: position + 1 }, (_, i) => toySoftmax(seed + 99 + i, i + 1));
    }
    const label = hasTrace && !isFixture ? 'measured' : 'illustrative';
    const note = truncated
      ? L({
        en: `truncated: position ${position} lies before the recorded window (positions ${windowStart}..${n - 1}); toy rows shown`,
        de: `abgeschnitten: Position ${position} liegt vor dem aufgezeichneten Fenster (Positionen ${windowStart}..${n - 1}); Beispielzeilen gezeigt`,
      })
      : hasTrace
        ? (isFixture ? L({ en: 'fixture rows, not a measurement', de: 'Testdaten, keine Messung' })
          : L({ en: 'recorded attention weights of this layer and stream', de: 'aufgezeichnete Attention-Gewichte dieser Ebene und dieses Stroms' }))
        : L({ en: 'toy rows; no measured trace', de: 'Beispielzeilen; keine gemessene Spur' });
    steps.push({
      id: 'softmax',
      title: {
        intuition: L({ en: 'Decide whom to listen to', de: 'Entscheiden, wem man zuhört' }),
        technical: L({ en: 'Softmax per head, then the weighted sum of V', de: 'Softmax je Kopf, dann die gewichtete Summe von V' }),
        researcher: L({ en: 'A = softmax(S) per head; out_h = A V_h; heads concatenated', de: 'A = softmax(S) je Kopf; out_h = A V_h; Köpfe aneinandergehängt' }),
      },
      formula: 'A = softmax(S), out = A V',
      view: {
        kind: 'attention', label, position, tokens: t ? t.provenance.tokens.slice(0, position + 1).map(decodeToken) : null,
        heads: rows, matrix, truncated, note,
      },
      data: hasTrace ? m({ position, heads: rows, truncated: false }) : illustrative({ position, heads: rows, truncated, note }),
      caveats: [], open: attnOpen,
      highlight: Array.from({ length: a.model.num_heads }, (_, h) => headId(layer, stream, h)),
    });
  }

  // 6 o_resid
  {
    const r = resid.get('post_attn');
    const norm = r?.norm[position];
    const noTrace = L({ en: 'no trace', de: 'keine Spur' });
    const nv: Labeled<number | string> = r && norm !== undefined ? m(norm) : illustrative(noTrace);
    steps.push({
      id: 'o_resid',
      title: {
        intuition: L({ en: 'Mix the answers and add them back', de: 'Antworten mischen und aufaddieren' }),
        technical: L({ en: 'O projection, then the residual add', de: 'O-Projektion, dann die Residual-Addition' }),
        researcher: L({ en: 'x1 = x + concat(heads) Wo', de: 'x1 = x + concat(heads) Wo' }),
      },
      formula: 'x1 = x + out Wo',
      view: { kind: 'readout', items: [{ name: L({ en: 'norm of x1 (post attention)', de: 'Norm von x1 (nach der Attention)' }), value: nv }] },
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
  // the selected slots of the weight bars: as many as the config's top_k
  const picks = Array.from({ length: k }, (_, i) => i);
  const routerLabel = router && !isFixture ? 'measured' : 'illustrative';
  steps.push({
    id: 'router',
    title: {
      intuition: L({ en: 'Which experts fit this token?', de: 'Welche Experten passen zu diesem Wort?' }),
      technical: L({ en: `Router: one logit per expert (${a.model.num_experts})`, de: `Router: ein Logit je Experte (${a.model.num_experts})` }),
      researcher: L({
        en: 'Router: ln2(x1) Wg gives gate logits after temperature and traffic-light modifiers',
        de: 'Router: ln2(x1) Wg liefert Gate-Logits nach Temperatur und Ampel-Modifikatoren',
      }),
    },
    formula: 'logits = ln2(x1) Wg',
    view: {
      kind: 'bars', label: routerLabel, title: L({ en: 'gate logits per expert', de: 'Gate-Logits je Experte' }), values: logits, marked: [...top3],
      ...(clamped ? { clamped: top3.filter((e) => e < 4) } : {}),
    },
    data: router ? m(rd) : illustrative(rd),
    caveats: ['A5'], open: slabOpen, highlight: [ln2Id(layer, stream), routerId(layer, stream)],
  });

  // 8 top3: weights exactly as recorded.
  steps.push({
    id: 'top3',
    title: {
      intuition: L({ en: `Pick the best ${k}`, de: `Die besten ${k} wählen` }),
      technical: L({ en: `Top-${k} selection and softmax weights`, de: `Top-${k}-Auswahl und Softmax-Gewichte` }),
      researcher: L({
        en: `top-${k} of the logits; softmax over those ${k} after the A3 clamp, before the output scales`,
        de: `Top-${k} der Logits; Softmax über diese ${k} nach der A3-Klemme, vor den Ausgabeskalen`,
      }),
    },
    formula: `w = softmax(logits[top${k}])`,
    view: {
      kind: 'bars', label: routerLabel, title: L({ en: 'weights of the selected experts', de: 'Gewichte der gewählten Experten' }), values: [...wts], marked: picks,
      labels: top3.map((e) => `E${e}`), ...(clamped ? { clamped: picks.filter((i) => (top3[i] ?? 9) < 4) } : {}),
    },
    data: router ? m(rd) : illustrative(rd),
    caveats: a3Involved || clamped ? ['A3'] : [], open: slabOpen,
    highlight: [bankId(layer), ...top3.map((e) => expertId(layer, e))],
  });

  // 9 expert: the choice of expert is measured, the arithmetic inside is a toy.
  {
    const heavy = wts.indexOf(Math.max(...wts));
    const e0 = top3[heavy] ?? top3[0];
    steps.push({
      id: 'expert',
      title: {
        intuition: L({ en: 'One expert does its work', de: 'Ein Experte macht seine Arbeit' }),
        technical: L({
          en: `Expert ${e0} (heaviest chosen expert): seed_bias, c_fc, GELU, c_proj`,
          de: `Experte ${e0} (am stärksten gewichteter gewählter Experte): seed_bias, c_fc, GELU, c_proj`,
        }),
        researcher: L({
          en: `Expert ${e0}: h = GELU((x + seed_bias) Wfc) ; y = h Wproj, inner width ${inner}`,
          de: `Experte ${e0}: h = GELU((x + seed_bias) Wfc) ; y = h Wproj, innere Breite ${inner}`,
        }),
      },
      formula: 'y = GELU((x + seed_bias) W_fc) W_proj  (heaviest chosen expert)',
      view: toyMatmul(seed + 2, [`experts.${e0}.c_fc.weight`, `experts.${e0}.c_proj.weight`], weights),
      data: router ? m({ expert: e0, weight: wts[heavy], note: 'heaviest chosen expert' }) : illustrative({ expert: e0, note: 'no trace' }),
      caveats: ['A4'], open: [`L${layer}`, bankId(layer), expertId(layer, e0)],
      highlight: (['seed_bias', 'c_fc', 'gelu', 'c_proj'] as const).map((p) => expertPartId(layer, e0, p)),
    });
  }

  // 10 moe_resid
  {
    const r = resid.get('post_moe');
    const norm = r?.norm[position];
    const items: { name: string; value: Labeled<number | string> }[] = top3.map((e, i) => ({
      name: L({ en: `weight x output scale, expert ${e}`, de: `Gewicht x Ausgabeskala, Experte ${e}` }),
      value: router ? m(`${r3(wts[i] ?? 0)} x ${router.output_scales[e] ?? 'n/a'}`) : illustrative(L({ en: 'no trace', de: 'keine Spur' })),
    }));
    items.push({
      name: L({ en: 'norm of x2 (post MoE)', de: 'Norm von x2 (nach dem MoE)' }),
      value: r && norm !== undefined ? m(norm) : illustrative(L({ en: 'no trace', de: 'keine Spur' })),
    });
    steps.push({
      id: 'moe_resid',
      title: {
        intuition: L({ en: `Blend the ${k} answers and add them back`, de: `Die ${k} Antworten mischen und aufaddieren` }),
        technical: L({ en: 'Weighted expert sum, then the residual add', de: 'Gewichtete Summe der Experten, dann die Residual-Addition' }),
        researcher: L({ en: 'x2 = x1 + sum_i scale_i * w_i * expert_i(ln2(x1))', de: 'x2 = x1 + sum_i scale_i * w_i * expert_i(ln2(x1))' }),
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
        intuition: L({ en: 'The two streams swap a little', de: 'Die zwei Ströme tauschen sich ein wenig aus' }),
        technical: L({ en: 'Anastomosis: each stream adds a gated share of the other', de: 'Austausch-Tor: jeder Strom addiert einen dosierten Anteil des anderen' }),
        researcher: L({ en: 'A += g_a * B ; B += g_b * A with g = sigmoid(Wg x + b), per token', de: 'A += g_a * B ; B += g_b * A mit g = sigmoid(Wg x + b), je Token' }),
      },
      formula: 'g = σ(W_g [h_A; h_B] + b); A\' = A + g_a * B, B\' = B + g_b * A',
      view: { kind: 'readout', items: [{ name: 'g_a', value: lv(gA, 0.5) }, { name: 'g_b', value: lv(gB, 0.5) }] },
      data: real ? m({ gA, gB }) : illustrative({ gA: 0.5, gB: 0.5, note: 'no trace; 0.5 is a placeholder' }),
      caveats: ['A1', 'A2'], open: slabOpen, highlight: [gateId(layer)],
    });
  }
  return steps;
}
