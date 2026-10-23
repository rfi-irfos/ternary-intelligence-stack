import { ACCENT, cssHex } from '../style/theme';

/**
 * Role colours (spec §5, look per §4.2b). The single source of every scene colour; the UI reads the
 * same values from src/style/tokens.css (tests/tokens.test.ts keeps both equal). Plain 0xRRGGBB (sRGB).
 *
 * Colour is never the only signal: each role also has its own shape (lanes = lines, experts =
 * boxes, routers = octahedra, gate = arc, ternary values = labelled cells).
 */
export const PALETTE = {
  /** Museum black behind the row; also the depth-haze colour. */
  background: 0x000000,
  /** Residual stream A (lane at y = -1.8): cyan. */
  streamA: 0x2fd9f2,
  /** Residual stream B (lane at y = +1.8): amber. */
  streamB: 0xffb22e,
  /** Experts (shared bank): green. */
  expert: 0x4fdc7a,
  /** Routers: violet. */
  router: 0xa98bff,
  /** Anastomosis gate (fusion slabs): red. */
  gate: 0xff4d5e,
  /** Ternary weight +1: warm. */
  ternaryPlus: 0xf4a582,
  /** Ternary weight -1: cold. */
  ternaryMinus: 0x6ab0e8,
  /** Ternary weight 0: dark. */
  ternaryZero: 0x1a1c21,
  /** Thin outlines of slabs and parts. */
  edge: 0xffffff,
  /** Tint of the glass slabs. */
  glass: 0x9fb8d9,
  /** Neutral parts without a role (embed, ln_f, lm_head, weight matrices). */
  neutral: 0xdfe6f2,
  /** UI accent (not a scene colour); defined in src/style/theme.ts, kept here for compatibility. */
  accent: ACCENT,
} as const;

export type PaletteRole = keyof typeof PALETTE;

export { cssHex };

/** Lane colour of a residual stream. */
export function streamColor(s: 'A' | 'B'): number {
  return s === 'A' ? PALETTE.streamA : PALETTE.streamB;
}
