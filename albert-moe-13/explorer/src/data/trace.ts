import { assetUrl } from './assetUrl';
import type { Architecture } from './architecture';
import type { TraceProvenance } from './labeled';

/** Provenance written by `albert_trace` (TraceProvenance incl. the optional router_weights_note). */
export type TraceMeta = TraceProvenance;

export type Stream = 'a' | 'b';

export type TraceEvent =
  | {
    type: 'router'; layer: number; stream: Stream;
    /** [S][E] gate logits after temperature and traffic-light modifiers. */
    logits: number[][];
    top3: [number, number, number][];
    /**
     * Softmax over the top-3 logits AFTER the A3 safety clamp and BEFORE the traffic-light output scales.
     * They need not descend (clamped rows can reorder them). Never recompute them from `logits`.
     */
    weights: [number, number, number][];
    a3_clamped: boolean[];
    /** Traffic-light output scale per expert (12). */
    output_scales: number[];
  }
  /**
   * `weights[q][k]`: full prompt = S rows (one per query position). When `provenance.attention_window = W` is set,
   * the rows are the last W query positions only: row r belongs to position r + (S - W), and keys stay 0..S-1.
   */
  | { type: 'attention'; layer: number; stream: Stream; head: number; weights: number[][] }
  | { type: 'gate'; layer: number; g_a: number[]; g_b: number[] }
  | { type: 'residual'; layer: number; stream: Stream; phase: 'post_attn' | 'post_moe' | 'post_gate'; norm: number[] }
  | { type: 'final'; merged_norm: number[] };

export interface TopK { token_id: number; token: string; prob: number }

export interface Trace {
  provenance: TraceMeta;
  events: TraceEvent[];
  /** Next-token top 5 of the inference path (forward_prefill, last position). */
  top_k: TopK[];
  /** Same from forward() (training path, no anastomosis). */
  top_k_training_path: TopK[];
}

function fail(msg: string): never {
  throw new Error(`invalid trace: ${msg}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const EVENT_TYPES = new Set(['router', 'attention', 'gate', 'residual', 'final']);

function checkTopK(name: string, k: unknown): void {
  if (!Array.isArray(k) || k.length !== 5) fail(`${name} needs 5 entries`);
  for (const t of k) {
    if (!isObj(t) || typeof t.token_id !== 'number' || typeof t.token !== 'string' || typeof t.prob !== 'number') {
      fail(`${name} entry`);
    }
  }
}

/**
 * Checks a trace against the architecture it was recorded from. Throws if the layer count or the
 * checkpoint hash differs, a provenance field is missing, or a layer lacks its two router events.
 */
export function validateTrace(t: unknown, a: Architecture): Trace {
  if (!isObj(t) || !isObj(t.provenance)) fail('provenance');
  const p = t.provenance;
  for (const k of ['prompt_id', 'prompt', 'checkpoint_sha256', 'git_commit', 'ttl_rule', 'date'] as const) {
    if (typeof p[k] !== 'string') fail(`provenance.${k}`);
  }
  for (const k of ['token_ids', 'tokens', 'tau_schedule'] as const) {
    if (!Array.isArray(p[k])) fail(`provenance.${k}`);
  }
  if (typeof p.num_layers !== 'number') fail('provenance.num_layers');
  if ((p.mode !== 'eval' && p.mode !== 'fixture') || p.path !== 'forward_prefill') fail('provenance.mode / path');
  if (p.attention_window !== undefined && typeof p.attention_window !== 'number') fail('provenance.attention_window');
  if (p.router_weights_note !== undefined && typeof p.router_weights_note !== 'string') fail('provenance.router_weights_note');

  if (p.num_layers !== a.model.num_layers) {
    fail(`num_layers ${p.num_layers} differs from architecture ${a.model.num_layers}`);
  }
  if (p.checkpoint_sha256 !== a.checkpoint.sha256) {
    fail(`checkpoint_sha256 ${String(p.checkpoint_sha256)} differs from architecture ${a.checkpoint.sha256}`);
  }
  const ids = p.token_ids as unknown[];
  if (ids.length === 0 || ids.length !== (p.tokens as unknown[]).length) fail('token_ids / tokens length');
  if ((p.tau_schedule as unknown[]).length !== p.num_layers) fail('tau_schedule length');

  if (!Array.isArray(t.events)) fail('events');
  const routers = new Map<string, number>();
  for (const e of t.events) {
    if (!isObj(e) || typeof e.type !== 'string' || !EVENT_TYPES.has(e.type)) fail('event type');
    if (e.type === 'router') {
      const layer = e.layer;
      if (typeof layer !== 'number' || (e.stream !== 'a' && e.stream !== 'b')) fail('router layer / stream');
      if (layer < 0 || layer >= p.num_layers) fail(`router layer ${layer} out of range`);
      const key = `${layer}${e.stream}`;
      routers.set(key, (routers.get(key) ?? 0) + 1);
      if (!Array.isArray(e.output_scales)) fail('router.output_scales');
    }
    if (e.type === 'attention' && typeof p.attention_window === 'number'
      && (!Array.isArray(e.weights) || e.weights.length !== p.attention_window)) {
      fail(`attention weights need ${p.attention_window} rows (attention_window)`);
    }
  }
  for (let layer = 0; layer < p.num_layers; layer++) {
    for (const s of ['a', 'b']) {
      if (routers.get(`${layer}${s}`) !== 1) fail(`layer ${layer} needs exactly one router event for stream ${s}`);
    }
  }
  checkTopK('top_k', t.top_k);
  checkTopK('top_k_training_path', t.top_k_training_path);
  return t as unknown as Trace;
}

export async function loadTrace(id: string, a: Architecture, base = assetUrl('data/trace')): Promise<Trace> {
  const url = `${base}/${id}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return validateTrace(await res.json(), a);
}

/** GPT-2 byte-level BPE: printable unicode character -> original byte. */
const BYTE_OF: ReadonlyMap<string, number> = (() => {
  const bs: number[] = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const m = new Map<string, number>(bs.map((b) => [String.fromCodePoint(b), b]));
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) m.set(String.fromCodePoint(256 + n++), b);
  }
  return m;
})();

function piecesToBytes(pieces: string[]): Uint8Array {
  const out: number[] = [];
  for (const p of pieces) {
    for (const ch of p) {
      const b = BYTE_OF.get(ch);
      if (b === undefined) out.push(...new TextEncoder().encode(ch)); // special token text: keep as is
      else out.push(b);
    }
  }
  return Uint8Array.from(out);
}

/** Display text of one raw byte-level BPE piece (Ġ -> space, Ċ -> newline, Ã¤ -> ä). */
export function decodeToken(piece: string): string {
  return new TextDecoder().decode(piecesToBytes([piece]));
}

/** Display text of a piece sequence: bytes are joined across pieces before UTF-8 decoding. */
export function decodeTokens(pieces: string[]): string {
  return new TextDecoder().decode(piecesToBytes(pieces));
}
