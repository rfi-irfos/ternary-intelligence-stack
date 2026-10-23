export type ComponentId = string;
export type Stream = 'A' | 'B';

export type MatrixName = 'q' | 'k' | 'v' | 'o' | 'gate' | 'c_fc' | 'c_proj';
export type ExpertPart = 'seed_bias' | 'c_fc' | 'gelu' | 'c_proj';

export type ParsedId =
  | { type: 'slab' | 'bank'; layer: number }
  | { type: 'head'; layer: number; stream: Stream; head: number }
  | { type: 'matrix'; layer: number; name: MatrixName; stream?: Stream; expert?: number }
  | { type: 'seed_bias' | 'gelu'; layer: number; expert: number }
  | { type: 'expert'; layer: number; expert: number }
  | { type: 'attn' | 'router' | 'ln1' | 'ln2'; layer: number; stream: Stream }
  | { type: 'gate'; layer: number }
  | { type: 'embed' | 'lm_head' | 'ln_f' }
  | { type: 'shaft'; stream: Stream };

export const expertId = (layer: number, e: number): ComponentId => `L${layer}.expert.${e}`;
export const attnId = (layer: number, s: Stream): ComponentId => `L${layer}.${s}.attn`;
export const routerId = (layer: number, s: Stream): ComponentId => `L${layer}.${s}.router`;
export const ln1Id = (layer: number, s: Stream): ComponentId => `L${layer}.${s}.ln1`;
export const ln2Id = (layer: number, s: Stream): ComponentId => `L${layer}.${s}.ln2`;
export const gateId = (layer: number): ComponentId => `L${layer}.gate`;
export const embedId = (): ComponentId => 'embed';
export const lmHeadId = (): ComponentId => 'lm_head';
export const lnFId = (): ComponentId => 'ln_f';
export const slabId = (layer: number): ComponentId => `L${layer}`;
export const bankId = (layer: number): ComponentId => `L${layer}.bank`;
export const headId = (layer: number, s: Stream, h: number): ComponentId => `L${layer}.${s}.attn.head${h}`;
export const attnMatrixId = (layer: number, s: Stream, n: 'q' | 'k' | 'v' | 'o'): ComponentId => `L${layer}.${s}.attn.${n}`;
export const routerMatrixId = (layer: number, s: Stream): ComponentId => `L${layer}.${s}.router.gate`;
export const expertPartId = (layer: number, e: number, part: ExpertPart): ComponentId => `L${layer}.expert.${e}.${part}`;
export const shaftId = (s: Stream): ComponentId => `shaft.${s}`;

const LAYER_RE = /^L(\d+)\.(.+)$/;
const SLAB_RE = /^L(\d+)$/;
const isInt = (x: string | undefined): x is string => x !== undefined && /^\d+$/.test(x);

export function parseId(id: ComponentId): ParsedId | null {
  if (id === 'embed' || id === 'lm_head' || id === 'ln_f') return { type: id };
  if (id === 'shaft.A' || id === 'shaft.B') return { type: 'shaft', stream: id[6] as Stream };
  const sm = SLAB_RE.exec(id);
  if (sm) return { type: 'slab', layer: Number(sm[1]) };
  const m = LAYER_RE.exec(id);
  if (!m) return null;
  const layer = Number(m[1]);
  const rest = (m[2] ?? '').split('.');
  if (rest.length === 1 && rest[0] === 'bank') return { type: 'bank', layer };
  if (rest.length === 3 && rest[0] === 'expert' && isInt(rest[1])) {
    const part = rest[2];
    const expert = Number(rest[1]);
    if (part === 'seed_bias' || part === 'gelu') return { type: part, layer, expert };
    if (part === 'c_fc' || part === 'c_proj') return { type: 'matrix', layer, name: part, expert };
    return null;
  }
  if (rest.length === 3 && (rest[0] === 'A' || rest[0] === 'B')) {
    const stream = rest[0];
    const [, kind, leaf] = rest;
    if (kind === 'attn' && (leaf === 'q' || leaf === 'k' || leaf === 'v' || leaf === 'o')) {
      return { type: 'matrix', layer, name: leaf, stream };
    }
    if (kind === 'attn' && /^head\d+$/.test(leaf ?? '')) {
      return { type: 'head', layer, stream, head: Number((leaf ?? '').slice(4)) };
    }
    if (kind === 'router' && leaf === 'gate') return { type: 'matrix', layer, name: 'gate', stream };
    return null;
  }
  if (rest.length === 2 && rest[0] === 'expert' && /^\d+$/.test(rest[1] ?? '')) {
    return { type: 'expert', layer, expert: Number(rest[1]) };
  }
  if (rest.length === 1 && rest[0] === 'gate') return { type: 'gate', layer };
  const [stream, kind] = rest;
  if (rest.length === 2 && (stream === 'A' || stream === 'B') &&
      (kind === 'attn' || kind === 'router' || kind === 'ln1' || kind === 'ln2')) {
    return { type: kind, layer, stream };
  }
  return null;
}
