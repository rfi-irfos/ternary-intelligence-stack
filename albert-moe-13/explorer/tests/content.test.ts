// @vitest-environment jsdom
import caveatsMd from '../CAVEATS.md?raw';
import { describe, expect, it } from 'vitest';
import { CAVEATS, CAVEAT_IDS, renderCaveats } from '../src/content/caveats';
import { COMMIT, COMPONENTS, componentTypeOf, sourceUrl } from '../src/content/components';
import { DEPTHS, getDepth, setDepth, attachDepthKeys } from '../src/ui/depth';

const rust = import.meta.glob('../../moe-llm-core/src/**/*.rs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('component content', () => {
  it('every component type has all three depths, non-empty', () => {
    for (const [type, c] of Object.entries(COMPONENTS)) {
      expect(c.title.length, type).toBeGreaterThan(0);
      for (const d of DEPTHS) expect(c.text[d].trim().length, `${type}/${d}`).toBeGreaterThan(20);
      expect(c.formula.length, type).toBeGreaterThan(0);
      expect(c.inputs.length, type).toBeGreaterThan(0);
      expect(c.outputs.length, type).toBeGreaterThan(0);
      expect(c.source.length, type).toBeGreaterThan(0);
    }
  });

  it('every caveat id referenced exists', () => {
    for (const [type, c] of Object.entries(COMPONENTS)) {
      for (const id of c.caveats) expect(CAVEATS[id], `${type} -> ${id}`).toBeDefined();
    }
    expect(CAVEAT_IDS).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9']);
  });

  it('router content references A3 and A9', () => {
    expect(COMPONENTS.router.caveats).toEqual(expect.arrayContaining(['A3', 'A9']));
    expect(COMPONENTS.router.text.researcher).toMatch(/A3/);
    expect(COMPONENTS.router.text.researcher).toMatch(/A9/);
  });

  it('anastomosis content references A1 and A2', () => {
    expect(COMPONENTS.anastomosis.caveats).toEqual(expect.arrayContaining(['A1', 'A2']));
    expect(COMPONENTS.anastomosis.text.researcher).toMatch(/A1/);
    expect(COMPONENTS.anastomosis.text.researcher).toMatch(/A2/);
  });

  it('expert content references A4', () => {
    expect(COMPONENTS.expert.caveats).toContain('A4');
    expect(COMPONENTS.expert.text.researcher).toMatch(/A4/);
  });

  it('makes no first-of-its-kind claim', () => {
    const all = JSON.stringify(COMPONENTS).toLowerCase();
    expect(all).not.toMatch(/first ternary|world'?s first|first of its kind/);
  });

  it('maps ids to component types', () => {
    expect(componentTypeOf('L12.expert.7')).toBe('expert');
    expect(componentTypeOf('L5.gate')).toBe('anastomosis');
    expect(componentTypeOf('L5')).toBe('slab');
    expect(componentTypeOf('L5.A.attn.q')).toBe('matrix');
    expect(componentTypeOf('nonsense')).toBeNull();
  });

  it('every cited source file exists and the line range is inside it', () => {
    expect(Object.keys(rust).length).toBeGreaterThan(10);
    for (const [type, c] of Object.entries(COMPONENTS)) {
      for (const s of c.source) {
        const src = rust[`../../moe-llm-core/src/${s.file}`];
        expect(src, `${type}: ${s.file}`).toBeDefined();
        const n = (src ?? '').split('\n').length;
        const [a, b] = s.lines.split('-').map(Number);
        expect(a, `${type}: ${s.file}:${s.lines}`).toBeGreaterThan(0);
        expect(b ?? a, `${type}: ${s.file}:${s.lines}`).toBeLessThanOrEqual(n);
      }
    }
  });
});

describe('sourceUrl', () => {
  it('pins commit hash, not a branch name', () => {
    const u = sourceUrl('model/moe.rs', '197-381');
    expect(COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(u).toBe(
      `https://github.com/rfi-irfos/ternary-intelligence-stack/blob/${COMMIT}/albert-moe-13/moe-llm-core/src/model/moe.rs#L197-L381`,
    );
    expect(u).not.toMatch(/\/blob\/(main|master|HEAD)\//);
    expect(sourceUrl('bin/train_bible.rs', '1582')).toMatch(/train_bible\.rs#L1582$/);
  });
});

describe('caveats page', () => {
  it('explorer/CAVEATS.md text equals the rendered caveats', () => {
    const file = caveatsMd;
    expect(file).toBe(renderCaveats());
    for (const id of CAVEAT_IDS) expect(file).toContain(`## ${id}.`);
  });
});

describe('depth', () => {
  it('persists and responds to keys 1-3', () => {
    const off = attachDepthKeys(document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(getDepth()).toBe('researcher');
    expect(localStorage.getItem('albert.depth')).toBe('researcher');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    expect(getDepth()).toBe('technical');
    off();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(getDepth()).toBe('technical');
    setDepth('intuition');
  });
});
