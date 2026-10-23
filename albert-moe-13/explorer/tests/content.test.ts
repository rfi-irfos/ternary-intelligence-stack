// @vitest-environment jsdom
import caveatsMd from '../CAVEATS.md?raw';
import { describe, expect, it } from 'vitest';
import { CAVEATS, CAVEAT_IDS, renderCaveats } from '../src/content/caveats';
import arch from '../public/data/architecture.json';
import { COMMIT, COMPONENTS, type ComponentType, componentTypeOf, contentFor, resolveText, sourceUrl } from '../src/content/components';
import { NUM_TOKEN } from '../src/data/labeled';
import { type Architecture, validateArchitecture } from '../src/data/architecture';
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

describe('citations', () => {
  it('every cited range contains its distinctive tokens', () => {
    for (const [type, c] of Object.entries(COMPONENTS)) {
      for (const s of c.source) {
        expect(s.tokens.length, `${type}: ${s.file}:${s.lines} has tokens`).toBeGreaterThan(0);
        const [a, b] = s.lines.split('-').map(Number);
        const body = (rust[`../../moe-llm-core/src/${s.file}`] ?? '').split('\n').slice((a ?? 1) - 1, b ?? a).join('\n');
        for (const t of s.tokens) expect(body, `${type}: ${s.file}:${s.lines} lacks "${t}"`).toContain(t);
      }
    }
  });

  it('gamma = mean|w| cites the lines that compute it, ln1 and ln2 cite their blocks', () => {
    const m = COMPONENTS.matrix.source;
    expect(m.some((s) => s.file === 'model/ste.rs' && s.lines === '5-8' && s.tokens.includes('abs') && s.tokens.includes('mean_all'))).toBe(true);
    expect(m.some((s) => s.file === 'model/ternary_linear.rs' && s.tokens.includes('mean_all'))).toBe(true);
    expect(m.some((s) => s.file === 'model/ternary_linear.rs' && s.lines === '1-40')).toBe(false);
    for (const t of ['ln1', 'ln2'] as const) {
      const all = JSON.stringify(COMPONENTS[t]);
      expect(all).not.toContain('transformer.rs:145');
      expect(COMPONENTS[t].source.some((s) => s.file === 'model/transformer.rs' && s.tokens.includes(`pp("${t}")`))).toBe(true);
    }
  });
});

describe('prose wording', () => {
  it('seed_bias and expert say what the source says, with its numbers', () => {
    for (const t of ['seed_bias', 'expert'] as const) {
      const all = JSON.stringify(COMPONENTS[t].text).toLowerCase();
      expect(all, t).not.toContain('decides which');
      expect(all, t).not.toContain('does most of the shaping');
    }
    for (const t of ['seed_bias', 'expert'] as const) {
      const tech = COMPONENTS[t].text.technical;
      expect(tech).toContain("dominates the expert's input");
      expect(tech).toContain('about 0.7');
      expect(tech).toContain('about 0.003');
      expect(tech).toContain('mlp.rs:40-42');
    }
  });
});

describe('numbers come from the architecture', () => {
  const real = validateArchitecture(arch);
  const synthetic = {
    ...real,
    model: { ...real.model, num_layers: 9, num_streams: 3, num_experts: 10, hidden: 40, ffn_inner: 160, num_heads: 6, head_dim: 11, vocab: 777, fusion_layers: [1, 6, 9] },
  } as Architecture;
  const types = Object.keys(COMPONENTS) as ComponentType[];
  const strip = (s: string): string => s.replace(/[A-Za-z_]+\.rs:[\d,\- ]+/g, '');
  const tokensOf = (a: Architecture): string[] =>
    types.flatMap((t) => {
      const r = contentFor(t, a);
      return [r.title, r.formula, r.inputs, r.outputs, ...Object.values(r.text)].flatMap((x) => strip(x).match(NUM_TOKEN) ?? []);
    });

  it('component texts contain no structure number that is not derived from architecture', () => {
    const forbidden = ['46', '552', '1,104', '92', '1,024', '256', '64', '12', '4', '7', '32,000', '13', '21', '34', '8', '5'];
    const got = new Set(tokensOf(synthetic));
    for (const f of forbidden) expect(got.has(f), `real-architecture number ${f} typed into the texts`).toBe(false);
    for (const t of types) expect(JSON.stringify(COMPONENTS[t])).not.toMatch(/\b(?:552|1,104|1,024|32,000)\b/);
  });

  it('changed architecture numbers appear in the rendered texts', () => {
    const all = types.map((t) => JSON.stringify(contentFor(t, synthetic))).join('\n');
    for (const want of [
      '27 attentions', '27 routers', '90 physical experts', '270 routing slots', '9 layers', '3 × 10 routing slots',
      '40 → 160 → 40', '6 heads of 11 dimensions', '[1, 6, 9]', '3 layers', '[777 × 40]', 'c_fc output (160 values)',
      'An F32 vector of 40 values',
    ]) expect(all, want).toContain(want);
    expect(all).toContain('160 inner neurons');
    const realAll = types.map((t) => JSON.stringify(contentFor(t, real))).join('\n');
    for (const want of ['92 attentions', '552 physical experts', '1,104 routing slots', '256 → 1,024 → 256', '[2, 3, 5, 8, 13, 21, 34]']) {
      expect(realAll, want).toContain(want);
    }
  });

  it('an unknown placeholder throws', () => {
    expect(() => resolveText('{nope}', real)).toThrow(/placeholder/);
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
