import { type ParsedId } from '../scene/ids';

export interface MatrixData {
  name: string;
  shape: number[];
  dtype: string;
  ternary: boolean;
  gamma: number | null;
  tau: number | null;
  frac_neg: number | null;
  frac_zero: number | null;
  frac_pos: number | null;
  /** Ternary: strings of '-', '0', '+'. F32: rows of floats rounded to 3 decimals. */
  tile: (string | number[])[];
  hist?: { min: number; max: number; counts: number[] } | null;
}

export interface VectorData {
  name: string;
  shape: number[];
  mean: number;
  std: number;
  min: number;
  max: number;
  head: number[];
}

export interface LayerWeights {
  layer: number;
  tau: number;
  fusion: boolean;
  matrices: MatrixData[];
  vectors: VectorData[];
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export type WeightsLoader = (layer: number) => Promise<LayerWeights>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateLayerWeights(w: unknown): LayerWeights {
  if (!isObj(w) || typeof w.layer !== 'number' || !Array.isArray(w.matrices) || !Array.isArray(w.vectors)) {
    throw new Error('invalid weights file');
  }
  for (const m of w.matrices) {
    if (!isObj(m) || typeof m.name !== 'string' || !Array.isArray(m.tile) || typeof m.ternary !== 'boolean') {
      throw new Error('invalid weights matrix entry');
    }
  }
  return w as unknown as LayerWeights;
}

/** Lazily fetches `weights/L{n}.json`; each layer is fetched once. */
export function createWeightsLoader(
  fetchFn: FetchLike = (u) => fetch(u),
  base = '/data/weights',
): WeightsLoader {
  const cache = new Map<number, Promise<LayerWeights>>();
  return (layer) => {
    let p = cache.get(layer);
    if (!p) {
      p = (async () => {
        const res = await fetchFn(`${base}/L${layer}.json`);
        if (!res.ok) throw new Error(`failed to load weights for layer ${layer}: ${res.status}`);
        return validateLayerWeights(await res.json());
      })();
      p.catch(() => cache.delete(layer));
      cache.set(layer, p);
    }
    return p;
  };
}

/** Name of the matrix/vector inside `L{n}.json` for an id, or null if it has no tile. */
export function weightKey(p: ParsedId): { matrix?: string; vector?: string } | null {
  if (p.type === 'matrix') {
    const s = p.stream ? `stream_${p.stream.toLowerCase()}` : '';
    switch (p.name) {
      case 'q': case 'k': case 'v': case 'o': return { matrix: `${s}.attn.${p.name}_proj.weight` };
      case 'gate': return { matrix: `${s}.moe.gate.weight` };
      case 'c_fc': case 'c_proj': return { matrix: `experts.${p.expert ?? 0}.${p.name}.weight` };
    }
  }
  if (p.type === 'seed_bias') return { vector: `experts.${p.expert}.seed_bias` };
  return null;
}

export function findMatrix(w: LayerWeights, name: string): MatrixData | undefined {
  return w.matrices.find((m) => m.name === name);
}

export function findVector(w: LayerWeights, name: string): VectorData | undefined {
  return w.vectors.find((v) => v.name === name);
}
