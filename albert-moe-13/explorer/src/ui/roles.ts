import { type ComponentId, parseId } from '../scene/ids';
import { PALETTE } from '../scene/palette';
import type { StringKey } from './strings';
import { layerLabel, t } from './prefs';

/**
 * Colour roles. The legend shows the seven of Simeon's mockup (ROLES, in the mockup's order); the stream
 * lanes and the ternary cells keep their scene colours and their role for tooltips, panel chips and the
 * step line, but they have no legend row. Ternary has three colours but is one role.
 */
export type Role =
  | 'input' | 'router' | 'expert' | 'expertIdle' | 'merge' | 'output' | 'gate'
  | 'streamA' | 'streamB' | 'ternary';
/** The legend rows, in order: Eingabe, MoE Router, Experten (aktiv), Experten (inaktiv), Zusammenführung, Ausgabe, Austausch-Tor. */
export const ROLES: Role[] = ['input', 'router', 'expert', 'expertIdle', 'merge', 'output', 'gate'];

/** CSS custom property of a role (src/style/tokens.css). */
export const ROLE_VAR: Record<Role, string> = {
  input: 'var(--c-input)',
  router: 'var(--c-router)',
  expert: 'var(--c-expert)',
  expertIdle: 'var(--c-expert-idle)',
  merge: 'var(--c-merge)',
  output: 'var(--c-output)',
  gate: 'var(--c-gate)',
  streamA: 'var(--c-stream-a)',
  streamB: 'var(--c-stream-b)',
  ternary: 'var(--c-ternary-plus)',
};

export const ROLE_COLOR: Record<Role, number> = {
  input: PALETTE.input,
  router: PALETTE.router,
  expert: PALETTE.expert,
  expertIdle: PALETTE.expertIdle,
  merge: PALETTE.merge,
  output: PALETTE.output,
  gate: PALETTE.gate,
  streamA: PALETTE.streamA,
  streamB: PALETTE.streamB,
  ternary: PALETTE.ternaryPlus,
};

/**
 * Colour role of a scene component, by the same rules the scene uses to tint it: per-stream parts
 * (norms, attention, its heads and Q/K/V/O) take their stream, the router and its gate matrix are
 * violet, the bank and everything inside an expert teal, the anastomosis gate red; the embedding is the
 * input, the final norm the merge and the LM head the output. Null for the neutral parts (slab glass).
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
    case 'embed': return 'input';
    case 'ln_f': return 'merge';
    case 'lm_head': return 'output';
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
  if (role === 'ternary') return isTernaryBearing(id);
  // Active and inactive experts are the same parts: which of them is lit depends on the token (the flow
  // lights the picked ones), so both rows point at every expert.
  if (role === 'expertIdle') return roleOf(id) === 'expert';
  return roleOf(id) === role;
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

/**
 * Name of a part on its canvas label in the scene. The norms get a short form in Simple ("Norm (before
 * attention)"; the panel title keeps the long name) and their code names in Advanced; every other part
 * uses componentName.
 */
export function sceneName(id: ComponentId): string {
  const p = parseId(id);
  if (p && (p.type === 'ln1' || p.type === 'ln2')) return t(p.type === 'ln1' ? 'scene.ln1' : 'scene.ln2', { s: p.stream });
  return componentName(id);
}
