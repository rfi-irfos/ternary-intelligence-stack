import { type ComponentId, parseId } from '../scene/ids';
import { PALETTE } from '../scene/palette';
import type { StringKey } from './strings';
import { layerLabel, t } from './prefs';

/** The six colour roles of the legend (spec §5). Ternary has three colours but is one role. */
export type Role = 'streamA' | 'streamB' | 'expert' | 'router' | 'gate' | 'ternary';
export const ROLES: Role[] = ['streamA', 'streamB', 'expert', 'router', 'gate', 'ternary'];

/** CSS custom property of a role (src/style/tokens.css). */
export const ROLE_VAR: Record<Role, string> = {
  streamA: 'var(--c-stream-a)',
  streamB: 'var(--c-stream-b)',
  expert: 'var(--c-expert)',
  router: 'var(--c-router)',
  gate: 'var(--c-gate)',
  ternary: 'var(--c-ternary-plus)',
};

export const ROLE_COLOR: Record<Role, number> = {
  streamA: PALETTE.streamA,
  streamB: PALETTE.streamB,
  expert: PALETTE.expert,
  router: PALETTE.router,
  gate: PALETTE.gate,
  ternary: PALETTE.ternaryPlus,
};

/**
 * Colour role of a scene component, by the same rules the scene uses to tint it: per-stream parts
 * (norms, attention, its heads and Q/K/V/O) take their stream, the router and its gate matrix are
 * violet, the bank and everything inside an expert green, the anastomosis gate red. Null for the
 * neutral parts (slab glass, embed, ln_f, lm_head).
 */
export function roleOf(id: ComponentId): Role | null {
  const p = parseId(id);
  if (!p) return null;
  switch (p.type) {
    case 'shaft': case 'attn': case 'ln1': case 'ln2': case 'head':
      return p.stream === 'A' ? 'streamA' : 'streamB';
    case 'router': return 'router';
    case 'matrix':
      if (p.name === 'gate') return 'router';
      if (p.expert !== undefined) return 'expert';
      return p.stream === 'B' ? 'streamB' : 'streamA';
    case 'bank': case 'expert': case 'seed_bias': case 'gelu': return 'expert';
    case 'gate': return 'gate';
    default: return null;
  }
}

/**
 * True for components whose weights are ternary {-1, 0, +1} (architecture.json: attention Q/K/V/O,
 * expert c_fc/c_proj, lm_head); the router gate, norms, seed_bias and the anastomosis gate are F32.
 */
export function isTernaryBearing(id: ComponentId): boolean {
  const p = parseId(id);
  if (!p) return false;
  switch (p.type) {
    case 'attn': case 'head': case 'expert': case 'bank': case 'lm_head': return true;
    case 'matrix': return p.name !== 'gate';
    default: return false;
  }
}

/** Does `id` belong to `role` for highlighting? */
export function matchesRole(id: ComponentId, role: Role): boolean {
  return role === 'ternary' ? isTernaryBearing(id) : roleOf(id) === role;
}

/** Name shown in the hover tooltip, in the current language and mode. */
export function hoverText(id: ComponentId): string {
  const p = parseId(id);
  const name = componentName(id);
  return p && 'layer' in p && p.type !== 'slab' ? `${name} · ${t('comp.inLayer', { l: layerLabel(p.layer) })}` : name;
}

/** Short name of a component (no layer), in the current language and mode. */
export function componentName(id: ComponentId): string {
  const p = parseId(id);
  if (!p) return id;
  const v: Record<string, string | number> = {};
  if ('layer' in p) v.l = layerLabel(p.layer);
  if ('stream' in p && p.stream) v.s = p.stream;
  if ('expert' in p && p.expert !== undefined) v.e = p.expert;
  let key: StringKey;
  switch (p.type) {
    case 'slab': return t('comp.slab', v);
    case 'head': key = 'comp.head'; v.h = p.head; break;
    case 'matrix': key = 'comp.matrix'; v.m = p.name === 'gate' ? 'gate' : p.name.length === 1 ? p.name.toUpperCase() : p.name; break;
    default: key = `comp.${p.type}` as StringKey;
  }
  return t(key, v);
}
