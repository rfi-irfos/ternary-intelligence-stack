import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE, cssHex } from '../src/scene/palette';
import { ACCENT, FONT, UI } from '../src/style/theme';
import { HEADING_FONT } from '../src/content/brand';

// Read from disk: vitest stubs CSS imports (even ?raw) to an empty string.
const raw = readFileSync(new URL('../src/style/tokens.css', import.meta.url));
const tokensCss = new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const vars = new Map([...tokensCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));

/** WCAG 2.x relative luminance of 0xRRGGBB. */
function luminance(hex: number): number {
  const ch = [16, 8, 0].map((s) => ((hex >> s) & 255) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
}
const contrast = (a: number, b: number): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('design tokens', () => {
  it('every palette colour has a --c-<key> token with the same hex', () => {
    for (const [k, v] of Object.entries(PALETTE)) {
      expect(vars.get(`--c-${kebab(k)}`), k).toBe(cssHex(v));
    }
  });

  it('UI neutrals in tokens.css equal src/style/theme.ts', () => {
    for (const [k, v] of Object.entries(UI)) {
      expect(vars.get(`--c-${kebab(k)}`), k).toBe(cssHex(v));
    }
    expect(PALETTE.accent).toBe(ACCENT);
  });

  it('text colours pass WCAG AA (4.5:1) on the panel surface and on black', () => {
    for (const fg of [UI.text, UI.textMuted]) {
      expect(contrast(fg, UI.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, UI.raised)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('base font size is at least 14px', () => {
    expect(Number.parseFloat(vars.get('--fs-base') ?? '0')).toBeGreaterThanOrEqual(14);
  });

  it('only Inter, Space Grotesk and the math serif are declared, and every @font-face url exists under public/fonts', () => {
    const faces = [...tokensCss.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1] as string);
    expect(faces.length).toBe(6);
    const families = new Set(faces.map((f) => /font-family:\s*"([^"]+)"/.exec(f)?.[1]));
    expect([...families].sort()).toEqual(['Inter', 'STIX Two Text', 'Space Grotesk']);
    // No italic face: the title, headings and labels are upright.
    expect(faces.some((f) => /font-style:\s*italic/.test(f))).toBe(false);
    const urls = faces.flatMap((f) => [...f.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] as string));
    expect(urls.length).toBe(6);
    for (const u of urls) {
      expect(u.startsWith('/fonts/'), u).toBe(true);
      expect(existsSync(new URL(`../public${u}`, import.meta.url)), u).toBe(true);
    }
    for (const lic of ['inter/LICENSE.txt', 'stix-two/OFL.txt', 'space-grotesk/OFL.txt']) {
      expect(existsSync(new URL(`../public/fonts/${lic}`, import.meta.url)), lic).toBe(true);
    }
  });

  it('heading font is the display stack; the math serif is kept for formulas only', () => {
    expect(HEADING_FONT).toBe(FONT.display);
    expect(FONT.display.startsWith('"Space Grotesk"')).toBe(true);
    expect(FONT.math.startsWith('"STIX Two Text"')).toBe(true);
    expect(vars.get('--font-display')).toBe(FONT.display);
    expect(FONT.ui.startsWith('"Inter"')).toBe(true);
  });
});
