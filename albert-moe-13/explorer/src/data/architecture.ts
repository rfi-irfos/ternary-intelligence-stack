import { assetUrl } from './assetUrl';
export interface Checkpoint {
  file: string;
  bytes: number;
  sha256: string;
  tensor_count: number;
}

export interface ModelInfo {
  num_layers: number;
  num_streams: number;
  num_experts: number;
  /** Experts the router picks per token and stream (moe.rs:197-381, written by tools/build_architecture.py). */
  top_k: number;
  hidden: number;
  ffn_inner: number;
  num_heads: number;
  head_dim: number;
  vocab: number;
  fusion_layers: number[];
  params: number;
  tau_top: number;
}

export interface LayerInfo {
  index: number;
  fusion: boolean;
  tau: number;
}

export interface TensorSpec {
  pattern: string;
  shape: number[];
  dtype: string;
  ternary: boolean;
}

export interface ComponentSpec {
  instances: number;
  params_per_instance: number;
  tensors: TensorSpec[];
}

export interface Architecture {
  schema: number;
  checkpoint: Checkpoint;
  model: ModelInfo;
  layers: LayerInfo[];
  components: Record<string, ComponentSpec>;
}

const MODEL_NUMBERS: (keyof ModelInfo)[] = [
  'num_layers', 'num_streams', 'num_experts', 'top_k', 'hidden', 'ffn_inner',
  'num_heads', 'head_dim', 'vocab', 'params', 'tau_top',
];

function fail(msg: string): never {
  throw new Error(`invalid architecture: ${msg}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates untrusted JSON and returns it typed. Throws on any missing field. */
export function validateArchitecture(a: unknown): Architecture {
  if (!isObj(a)) fail('not an object');
  if (typeof a.schema !== 'number') fail('schema');
  const cp = a.checkpoint;
  if (!isObj(cp)) fail('checkpoint');
  for (const k of ['file', 'sha256'] as const) {
    if (typeof cp[k] !== 'string') fail(`checkpoint.${k}`);
  }
  for (const k of ['bytes', 'tensor_count'] as const) {
    if (typeof cp[k] !== 'number') fail(`checkpoint.${k}`);
  }
  const m = a.model;
  if (!isObj(m)) fail('model');
  for (const k of MODEL_NUMBERS) {
    if (typeof m[k] !== 'number') fail(`model.${k}`);
  }
  if (!Array.isArray(m.fusion_layers) || !m.fusion_layers.every((x) => typeof x === 'number')) {
    fail('model.fusion_layers');
  }
  if (!Array.isArray(a.layers)) fail('layers');
  for (const l of a.layers) {
    if (!isObj(l) || typeof l.index !== 'number' || typeof l.fusion !== 'boolean' || typeof l.tau !== 'number') {
      fail('layers entry');
    }
  }
  if (a.layers.length !== m.num_layers) {
    fail(`layers.length ${a.layers.length} !== model.num_layers ${String(m.num_layers)}`);
  }
  if (!isObj(a.components)) fail('components');
  for (const [name, c] of Object.entries(a.components)) {
    if (!isObj(c) || typeof c.instances !== 'number' || typeof c.params_per_instance !== 'number' || !Array.isArray(c.tensors)) {
      fail(`components.${name}`);
    }
  }
  return a as unknown as Architecture;
}

export async function loadArchitecture(url = assetUrl('data/architecture.json')): Promise<Architecture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return validateArchitecture(await res.json());
}
