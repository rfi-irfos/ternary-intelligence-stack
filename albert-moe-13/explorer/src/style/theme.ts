/**
 * Neutral UI theme: values that are not scene role colours. The scene palette (src/scene/palette.ts)
 * re-exports `ACCENT` and `cssHex` from here for compatibility. src/style/tokens.css mirrors every
 * colour below and every PALETTE colour as a CSS custom property; tests/tokens.test.ts keeps the two
 * files in agreement.
 */

/**
 * UI accent (Simeon's mockup): cyan, for "measured" badges, caveat chips, formulas, links, the playhead
 * and active controls (about 10:1 on the navy surfaces). It is drawn with a solid border or as a line,
 * and no legend role uses it.
 */
export const ACCENT = 0x22d3ee;

/** Neutral UI colours (sRGB). Text colours pass WCAG AA on SURFACE and on black. */
export const UI = {
  /** Main text. */
  text: 0xe8eefc,
  /** Secondary text (mockup); about 8:1 on black, never used for crucial information alone. */
  textMuted: 0x8fa0c8,
  /** Solid fill behind controls (glass panels use it at 82 % opacity). */
  surface: 0x0a1226,
  /** Raised fill of a control (buttons, selects). */
  raised: 0x141e3c,
  /** Hairline borders, like the thin white outlines of the slabs. */
  hairline: 0x34457a,
} as const;

/**
 * Colours drawn into canvas textures (the in-scene pill labels), where CSS variables do not reach.
 * tokens.css mirrors them (--c-pill-fill, --c-pill-line) and tests/tokens.test.ts keeps both equal.
 */
export const PILL = {
  /** Dark navy fill of a scene label (card colour at full opacity). */
  fill: 0x0c142c,
  /** 1 px border of a scene label: the cyan-blue of the mockup. */
  line: 0x4aa3f0,
} as const;

/**
 * The scene backdrop (Simeon's mockup): a vertical gradient from deep navy at the top to near-black at the
 * bottom, drawn as the scene background texture (src/scene/backdrop.ts). tokens.css mirrors it as
 * --bg-top and --bg-bottom, and tests/tokens.test.ts keeps both equal.
 */
export const BACKDROP = {
  top: 0x0a1226,
  bottom: 0x050914,
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
