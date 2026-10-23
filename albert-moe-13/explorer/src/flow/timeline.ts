import type { Architecture } from '../data/architecture';
import { type Labeled, type LabeledValue, measured, structure } from '../data/labeled';
import { type Trace, type TraceEvent, decodeToken } from '../data/trace';
import type { CaveatId } from '../content/caveats';

export type OpKind =
  | 'embed' | 'ln1' | 'attn' | 'resid' | 'ln2' | 'router' | 'experts' | 'gate' | 'merge' | 'ln_f' | 'lm_head';

export const OP_KINDS: OpKind[] = [
  'embed', 'ln1', 'attn', 'resid', 'ln2', 'router', 'experts', 'gate', 'merge', 'ln_f', 'lm_head',
];

export interface Op {
  kind: OpKind;
  layer?: number;
  stream?: 'A' | 'B';
  data: Labeled<unknown>;
  caveats: CaveatId[];
}

/** Value shapes carried by `Op.data.value`, per kind. Plain numbers; labelling is on `Op.data`. */
export interface EmbedData { position: number; tokenId: number; token: string }
export interface AttnData { position: number; heads: { head: number; row: number[] }[] }
export interface ResidData { position: number; phase: 'post_attn' | 'post_moe'; norm: number }
export interface RouterData {
  position: number;
  top3: [number, number, number];
  /** Softmax over the top-3 after the A3 clamp, before the output scales. As recorded, never recomputed. */
  weights: [number, number, number];
  /** Gate logits of the top-3 experts, same order as `top3`. */
  top3Logits: [number, number, number];
  a3Clamped: boolean;
  /** Traffic-light output scale per expert (12), applied after `weights`. */
  outputScales: number[];
}
export interface ExpertsData {
  position: number;
  lit: number[];
  dark: number[];
  weights: [number, number, number];
  /** Output scale of each lit expert, same order as `lit`. */
  litOutputScales: number[];
}
export interface GateData {
  position: number;
  gA: number;
  gB: number;
  /** Residual norm after the gate (post_gate), per stream, when recorded. */
  postGateNorm: { A?: number; B?: number };
}
export interface MergeData { position: number; mergedNorm: number }
export interface LmHeadData {
  position: number;
  /** True when `topK` is the recorded next-token top 5 (only the last position has one). */
  available: boolean;
  topK: { tokenId: number; token: string; prob: number }[];
  note: string;
}
export interface PlainData { note: string }

const LAST_ONLY = 'the next-token top 5 was recorded for the last position of the prompt only';

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`trace is missing ${what}`);
  return v;
}

/** Number of ops for an architecture: embed + layers x streams x 7 + gates + merge, ln_f, lm_head. */
export function timelineLength(a: Architecture): number {
  return 1 + a.model.num_layers * 2 * 7 + a.model.fusion_layers.length + 3;
}

/**
 * Ops of one forward pass (forward_prefill) for the token at `position`, in execution order:
 * embed; per layer stream A then stream B (ln1, attn, resid, ln2, router, experts, resid);
 * the gate after the two streams of each fusion layer; then merge, ln_f, lm_head.
 * Values come from the trace only; ops without a recorded number carry `structure` data.
 */
export function buildTimeline(t: Trace, a: Architecture, position: number): Op[] {
  const prov = t.provenance;
  const n = prov.token_ids.length;
  if (!Number.isInteger(position) || position < 0 || position >= n) {
    throw new Error(`position ${position} out of range 0..${n - 1}`);
  }
  const m = <V>(v: V): Labeled<V> => measured(v, prov);
  const fusion = new Set(a.model.fusion_layers);

  const router = new Map<string, Extract<TraceEvent, { type: 'router' }>>();
  const attn = new Map<string, Extract<TraceEvent, { type: 'attention' }>[]>();
  const resid = new Map<string, Extract<TraceEvent, { type: 'residual' }>>();
  const gate = new Map<number, Extract<TraceEvent, { type: 'gate' }>>();
  let final: Extract<TraceEvent, { type: 'final' }> | undefined;
  for (const e of t.events) {
    if (e.type === 'router') router.set(`${e.layer}${e.stream}`, e);
    else if (e.type === 'attention') {
      const k = `${e.layer}${e.stream}`;
      attn.set(k, [...(attn.get(k) ?? []), e]);
    } else if (e.type === 'residual') resid.set(`${e.layer}${e.stream}${e.phase}`, e);
    else if (e.type === 'gate') gate.set(e.layer, e);
    else final = e;
  }

  const ops: Op[] = [];
  const tok = decodeToken(need(prov.tokens[position], 'token'));
  ops.push({
    kind: 'embed',
    data: m<EmbedData>({ position, tokenId: need(prov.token_ids[position], 'token id'), token: tok }),
    caveats: [],
  });

  for (let layer = 0; layer < a.model.num_layers; layer++) {
    for (const stream of ['A', 'B'] as const) {
      const s = stream === 'A' ? 'a' : 'b';
      const base = { layer, stream } as const;
      const ev = need(router.get(`${layer}${s}`), `router event L${layer} ${stream}`);
      const top3 = need(ev.top3[position], 'router top3');
      const weights = need(ev.weights[position], 'router weights');
      const logits = need(ev.logits[position], 'router logits');
      const clamped = need(ev.a3_clamped[position], 'router a3_clamped');
      const top3Logits = top3.map((e) => need(logits[e], 'router logit')) as [number, number, number];
      const a3: CaveatId[] = clamped ? ['A3'] : [];

      ops.push({ ...base, kind: 'ln1', data: structure<PlainData>({ note: 'layer norm before attention' }), caveats: [] });
      const heads = (attn.get(`${layer}${s}`) ?? [])
        .map((h) => ({ head: h.head, row: need(h.weights[position], 'attention row') }))
        .sort((x, y) => x.head - y.head);
      ops.push({ ...base, kind: 'attn', data: m<AttnData>({ position, heads }), caveats: [] });
      const rn = (phase: 'post_attn' | 'post_moe'): Labeled<ResidData> => {
        const r = need(resid.get(`${layer}${s}${phase}`), `residual L${layer} ${stream} ${phase}`);
        return m<ResidData>({ position, phase, norm: need(r.norm[position], 'residual norm') });
      };
      ops.push({ ...base, kind: 'resid', data: rn('post_attn'), caveats: [] });
      ops.push({ ...base, kind: 'ln2', data: structure<PlainData>({ note: 'layer norm before the experts' }), caveats: [] });
      ops.push({
        ...base, kind: 'router',
        data: m<RouterData>({
          position, top3, weights, top3Logits, a3Clamped: clamped, outputScales: ev.output_scales,
        }),
        caveats: ['A5', ...a3],
      });
      const lit = [...top3];
      const dark = Array.from({ length: a.model.num_experts }, (_, i) => i).filter((i) => !lit.includes(i));
      ops.push({
        ...base, kind: 'experts',
        data: m<ExpertsData>({
          position, lit, dark, weights, litOutputScales: lit.map((i) => need(ev.output_scales[i], 'output scale')),
        }),
        caveats: ['A4', ...a3],
      });
      ops.push({ ...base, kind: 'resid', data: rn('post_moe'), caveats: [] });
    }
    if (fusion.has(layer)) {
      const g = need(gate.get(layer), `gate event L${layer}`);
      const post = (s: 'a' | 'b'): number | undefined => resid.get(`${layer}${s}post_gate`)?.norm[position];
      const pa = post('a');
      const pb = post('b');
      ops.push({
        kind: 'gate', layer,
        data: m<GateData>({
          position,
          gA: need(g.g_a[position], 'g_a'),
          gB: need(g.g_b[position], 'g_b'),
          postGateNorm: { ...(pa !== undefined ? { A: pa } : {}), ...(pb !== undefined ? { B: pb } : {}) },
        }),
        caveats: ['A1', 'A2'],
      });
    }
  }

  const fin = need(final, 'final event');
  ops.push({ kind: 'merge', data: m<MergeData>({ position, mergedNorm: need(fin.merged_norm[position], 'merged_norm') }), caveats: [] });
  ops.push({ kind: 'ln_f', data: structure<PlainData>({ note: 'final layer norm' }), caveats: [] });
  const isLast = position === n - 1;
  ops.push({
    kind: 'lm_head',
    data: isLast
      ? m<LmHeadData>({
        position, available: true, note: 'inference path (forward_prefill), last position',
        topK: t.top_k.map((k) => ({ tokenId: k.token_id, token: decodeToken(k.token), prob: k.prob })),
      })
      : structure<LmHeadData>({ position, available: false, topK: [], note: LAST_ONLY }),
    caveats: [],
  });
  return ops;
}

/** Type guard helper for UI code that wants the data of one op kind. */
export function dataOf<T>(op: Op): T {
  return op.data.value as T;
}

export type FieldValue = Labeled<LabeledValue>;
