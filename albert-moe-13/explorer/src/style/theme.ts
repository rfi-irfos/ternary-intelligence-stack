/**
 * Neutral UI theme: values that are not scene role colours. The scene palette (src/scene/palette.ts)
 * re-exports `ACCENT` and `cssHex` from here for compatibility. src/style/tokens.css mirrors every
 * colour below and every PALETTE colour as a CSS custom property; tests/tokens.test.ts keeps the two
 * files in agreement.
 */

/**
 * UI accent for "measured" badges, caveat chips, formulas, links and active controls. Near-white
 * (about 17:1 on the dark surfaces) and drawn with a solid border, so it never reads as a role colour.
 */
export const ACCENT = 0xf3f0e8;

/** Neutral UI colours (sRGB). Text colours pass WCAG AA on SURFACE and on black. */
export const UI = {
  /** Main text. */
  text: 0xf3f0e8,
  /** Secondary text; about 11:1 on black, never used for crucial information alone. */
  textMuted: 0xc3cad6,
  /** Solid fill behind controls (glass panels use it at 82 % opacity). */
  surface: 0x0d0f14,
  /** Raised fill of a control (buttons, selects). */
  raised: 0x1b1f28,
  /** Hairline borders, like the thin white outlines of the slabs. */
  hairline: 0x4a5262,
} as const;

/** `#rrggbb` for CSS / SVG use. */
export function cssHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/**
 * Font stacks. Inter for the UI body, Space Grotesk (display) for the title, headings and scene
 * labels, STIX Two Text (a math serif) only inside formulas.
 */
export const FONT = {
  ui: '"Inter", system-ui, sans-serif',
  display: '"Space Grotesk", "Inter", system-ui, sans-serif',
  math: '"STIX Two Text", "Times New Roman", serif',
} as const;
