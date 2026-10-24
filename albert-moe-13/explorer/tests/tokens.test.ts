import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE, cssHex } from '../src/scene/palette';
import { ACCENT, BACKDROP, FONT, PILL, UI } from '../src/style/theme';
import { HEADING_FONT } from '../src/content/brand';
import { ROLE_COLOR, ROLE_VAR, type Role } from '../src/ui/roles';

// Read from disk: vitest stubs CSS imports (even ?raw) to an empty string.
const raw = readFileSync(new URL('../src/style/tokens.css', import.meta.url));
const tokensCss = new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
const uiRaw = readFileSync(new URL('../src/style/ui.css', import.meta.url));
const uiCss = new TextDecoder().decode(new Uint8Array(uiRaw.buffer, uiRaw.byteOffset, uiRaw.byteLength));
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

  it('the in-scene pill label colours (canvas textures) equal the --c-pill-* tokens', () => {
    expect(vars.get('--c-pill-fill')).toBe(cssHex(PILL.fill));
    expect(vars.get('--c-pill-line')).toBe(cssHex(PILL.line));
  });

  it('the backdrop gradient tokens equal src/style/theme.ts', () => {
    expect(vars.get('--bg-top')).toBe(cssHex(BACKDROP.top));
    expect(vars.get('--bg-bottom')).toBe(cssHex(BACKDROP.bottom));
  });

  it('the mockup card tokens and the sidebar / dock sizes exist', () => {
    for (const k of ['--c-glass-panel', '--c-card-line', '--c-card-solid', '--c-wash', '--c-wash-strong', '--bg-top', '--bg-bottom']) {
      expect(vars.has(k), k).toBe(true);
    }
    expect(vars.get('--c-glass-panel')).toBe('rgba(12, 20, 44, 0.82)');
    expect(vars.get('--side-w')).toMatch(/^clamp\(280px, /);
    expect(Number.parseFloat(vars.get('--timeline-h') ?? '0')).toBeGreaterThanOrEqual(32);
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

describe('focus ring', () => {
  it('buttons, icons, selects and number fields draw the ring inside (outline-offset -3px)', () => {
    const css = uiCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)?.find((r) => /outline-offset:\s*-3px/.test(r));
    expect(rule, 'a :focus-visible rule with outline-offset: -3px').toBeDefined();
    for (const sel of ['.hud-btn:focus-visible', '.hud-icon:focus-visible', '.hud-select:focus-visible', '.hud-number:focus-visible']) {
      expect(rule!, sel).toContain(sel);
    }
    expect(rule!).toMatch(/outline:\s*2px solid/);
  });
});

describe('role colours in the sidebar (Task 11d fix round 2, item H)', () => {
  const css = uiCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const roles = Object.keys(ROLE_VAR) as Role[];
  /** sRGB mix like CSS color-mix(in srgb, a p%, b). */
  const mix = (a: number, b: number, p: number): number =>
    [16, 8, 0].reduce((acc, sh) => acc | (Math.round((((a >> sh) & 255) * p + ((b >> sh) & 255) * (1 - p))) << sh), 0);
  const CARD = 0x0c142c; // --c-card-solid / --c-glass-panel over the black scene

  it('every role colour used by pills, icon chips and accent borders comes from the palette tokens (no literal)', () => {
    for (const r of roles) {
      const m = /^var\((--c-[\w-]+)\)$/.exec(ROLE_VAR[r]);
      expect(m, r).not.toBeNull();
      expect(vars.get(m![1] as string), r).toBe(cssHex(ROLE_COLOR[r]));
    }
  });

  it('ui.css adds no colour literal: only #000 / #fff and the existing black, white and paper rgba shades', () => {
    expect([...new Set(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [])].sort()).toEqual(['#000', '#fff']);
    const rgba = new Set(css.match(/rgba?\([^)]*\)/g) ?? []);
    for (const c of rgba) expect(c, c).toMatch(/^rgba\((0, 0, 0|255, 255, 255|243, 240, 232), [\d.]+\)$/);
  });

  it('key numbers use the role colour mixed 28 % towards the text colour; every role keeps at least 4.5:1 on the card', () => {
    expect(css).toMatch(/\.info-card \.stat-value, \.stat-tile \.stat-value \{ color: color-mix\(in srgb, var\(--role-panel, var\(--c-accent\)\) 72%, var\(--c-text\)\); \}/);
    for (const r of roles) {
      const num = mix(ROLE_COLOR[r], UI.text, 0.72);
      expect(contrast(num, CARD), `${r} number`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(num, PALETTE.background), `${r} number on black`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the role pill keeps its text readable: the text colour on the 26 % role tint passes 4.5:1 for every role', () => {
    expect(css).toMatch(/\.role-chip \{[^}]*border: 1px solid var\(--role\);[^}]*color-mix\(in srgb, var\(--role\) 26%, transparent\)/);
    for (const r of roles) expect(contrast(UI.text, mix(ROLE_COLOR[r], CARD, 0.26)), r).toBeGreaterThanOrEqual(4.5);
  });

  it('the section icons, the facts bar and the active tab underline take their colour from the role (Session cyan, Model the selection, Inspection violet, Analysis amber)', () => {
    expect(css).toContain('.side-sec { --sec: var(--c-accent); }');
    expect(css).toContain('.side-sec[data-side="model"] { --sec: var(--sel-role, var(--c-neutral)); }');
    expect(css).toContain('.side-sec[data-side="inspect"] { --sec: var(--c-router); }');
    expect(css).toContain('.side-sec[data-side="analysis"] { --sec: var(--c-merge); }');
    expect(css).toContain('.side-sec-icon { display: inline-grid; place-items: center; flex: none; margin-right: var(--space-3); color: var(--sec); }');
    expect(css).toMatch(/\.info-card \{[^}]*border-left: 3px solid var\(--role-panel, var\(--c-accent\)\)/);
    expect(css).toMatch(/\.panel-tab\.active \{[^}]*border-bottom-color: var\(--role-panel, var\(--c-accent\)\)/);
    expect(PALETTE.accent).toBe(ACCENT); // Session cyan is the accent token
  });
});
