export type ComponentId = string;
export type Stream = 'A' | 'B';

export type ParsedId =
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
export const shaftId = (s: Stream): ComponentId => `shaft.${s}`;

const LAYER_RE = /^L(\d+)\.(.+)$/;

export function parseId(id: ComponentId): ParsedId | null {
  if (id === 'embed' || id === 'lm_head' || id === 'ln_f') return { type: id };
  if (id === 'shaft.A' || id === 'shaft.B') return { type: 'shaft', stream: id[6] as Stream };
  const m = LAYER_RE.exec(id);
  if (!m) return null;
  const layer = Number(m[1]);
  const rest = (m[2] ?? '').split('.');
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
