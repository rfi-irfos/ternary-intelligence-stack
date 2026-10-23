import type { Architecture } from '../data/architecture';
import {
  type ComponentId, type Stream,
  attnId, attnMatrixId, bankId, expertId, expertPartId, headId, ln1Id, ln2Id, parseId, routerId,
  routerMatrixId,
} from './ids';
import { LANE_Y } from './tower';

export type PartKind = 'ln' | 'attn' | 'router' | 'bank' | 'expert' | 'matrix' | 'head' | 'seed' | 'gelu';

export interface ChildSpec {
  id: ComponentId;
  label: string;
  kind: PartKind;
  /** 'A' | 'B' for per-stream parts, 'shared' for the expert bank and everything below it. */
  stream: Stream | 'shared';
  /** Offset from the stage centre (x along the row, y depth, z up). */
  pos: [number, number, number];
}

/** Lane depth (y) matches the row: A in front, B behind. B is also lifted so both stay visible. */
const SLAB_X = { ln1: -6.6, attn: -4.4, ln2: -2.2, router: 0, bank: 3.4 } as const;
const SLAB_Z: Record<Stream, number> = { A: -1.0, B: 1.4 };

function slabChildren(layer: number): ChildSpec[] {
  const out: ChildSpec[] = [];
  for (const s of ['A', 'B'] as Stream[]) {
    const y = LANE_Y[s];
    const z = SLAB_Z[s];
    out.push(
      { id: ln1Id(layer, s), label: `ln1 ${s}`, kind: 'ln', stream: s, pos: [SLAB_X.ln1, y, z] },
      { id: attnId(layer, s), label: `Attention ${s}`, kind: 'attn', stream: s, pos: [SLAB_X.attn, y, z] },
      { id: ln2Id(layer, s), label: `ln2 ${s}`, kind: 'ln', stream: s, pos: [SLAB_X.ln2, y, z] },
      { id: routerId(layer, s), label: `Router ${s}`, kind: 'router', stream: s, pos: [SLAB_X.router, y, z] },
    );
  }
  out.push({ id: bankId(layer), label: 'Expert bank', kind: 'bank', stream: 'shared', pos: [SLAB_X.bank, 0, 0.2] });
  return out;
}

/**
 * Parts a component explodes into (empty for leaves). Matrices have no children here: exploding a
 * matrix shows its weight tile instead (see explode.ts).
 */
export function childrenOf(id: ComponentId, a: Architecture): ChildSpec[] {
  const p = parseId(id);
  if (!p) return [];
  switch (p.type) {
    case 'slab': return slabChildren(p.layer);
    case 'attn': {
      const { layer, stream: s } = p;
      const out: ChildSpec[] = (['q', 'k', 'v'] as const).map((n, i) => ({
        id: attnMatrixId(layer, s, n), label: n.toUpperCase(), kind: 'matrix' as const, stream: s,
        pos: [-3.2, 0, 1.6 - i * 1.6] as [number, number, number],
      }));
      for (let h = 0; h < a.model.num_heads; h++) {
        const z = ((a.model.num_heads - 1) / 2 - h) * 1.5;
        out.push({ id: headId(layer, s, h), label: `head ${h}`, kind: 'head', stream: s, pos: [0, 0, z] });
      }
      out.push({ id: attnMatrixId(layer, s, 'o'), label: 'O', kind: 'matrix', stream: s, pos: [3.2, 0, 0] });
      return out;
    }
    case 'router':
      return [{ id: routerMatrixId(p.layer, p.stream), label: 'gate', kind: 'matrix', stream: p.stream, pos: [0, 0, 0] }];
    case 'bank': {
      const n = a.model.num_experts;
      const cols = 4;
      const rows = Math.ceil(n / cols);
      return Array.from({ length: n }, (_, e) => ({
        id: expertId(p.layer, e), label: `Expert ${e}`, kind: 'expert' as const, stream: 'shared' as const,
        pos: [(e % cols - (cols - 1) / 2) * 1.8, 0, ((rows - 1) / 2 - Math.floor(e / cols)) * 1.8] as [number, number, number],
      }));
    }
    case 'expert':
      return [
        { id: expertPartId(p.layer, p.expert, 'seed_bias'), label: 'seed_bias', kind: 'seed', stream: 'shared', pos: [-4.5, 0, 0] },
        { id: expertPartId(p.layer, p.expert, 'c_fc'), label: 'c_fc', kind: 'matrix', stream: 'shared', pos: [-1.5, 0, 0] },
        { id: expertPartId(p.layer, p.expert, 'gelu'), label: 'GELU', kind: 'gelu', stream: 'shared', pos: [1.5, 0, 0] },
        { id: expertPartId(p.layer, p.expert, 'c_proj'), label: 'c_proj', kind: 'matrix', stream: 'shared', pos: [4.5, 0, 0] },
      ];
    default:
      return [];
  }
}

/**
 * Ids lane `s` passes through inside an exploded slab. Each stream has its own ln/attn/router;
 * both lanes meet only in the shared expert bank, so lane B never touches stream A's parts.
 */
export function lanePath(layer: number, s: Stream): ComponentId[] {
  return [ln1Id(layer, s), attnId(layer, s), ln2Id(layer, s), routerId(layer, s), bankId(layer)];
}

/** True when `id` has a view to open (parts or a weight tile). */
export function isExplodable(id: ComponentId, a: Architecture): boolean {
  const p = parseId(id);
  if (!p) return false;
  if (p.type === 'matrix') return true;
  return childrenOf(id, a).length > 0;
}
