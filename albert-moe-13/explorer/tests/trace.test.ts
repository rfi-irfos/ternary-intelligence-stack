import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { type Trace, decodeToken, decodeTokens, validateTrace } from '../src/data/trace';

const a = validateArchitecture(arch);
const modules = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const files = Object.keys(modules).map((k) => k.split('/').pop() as string).sort();
const read = (f: string): unknown => modules[`../public/data/trace/${f}`];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('measured traces (public/data/trace)', () => {
  it('has the three demo traces', () => {
    expect(files).toEqual(['de.json', 'kjv.json', 'ternary.json']);
  });

  for (const f of files) it(`${f} passes validateTrace and matches the pinned checkpoint`, () => {
    const t = validateTrace(read(f), a);
    expect(t.provenance.checkpoint_sha256).toBe(a.checkpoint.sha256);
    expect(t.provenance.num_layers).toBe(46);
    expect(t.provenance.router_weights_note).toMatch(/before traffic-light output scales/);
  });

  for (const f of files) it(`${f}: every layer has 2 router events`, () => {
    const t: Trace = validateTrace(read(f), a);
    const routers = t.events.filter((e) => e.type === 'router');
    expect(routers).toHaveLength(2 * a.model.num_layers);
    for (let layer = 0; layer < a.model.num_layers; layer++) {
      expect(routers.filter((e) => e.layer === layer).map((e) => e.stream).sort()).toEqual(['a', 'b']);
    }
  });

  for (const f of files) it(`${f}: shapes follow the token count`, () => {
    const t = validateTrace(read(f), a);
    const n = t.provenance.token_ids.length;
    for (const e of t.events) {
      if (e.type === 'router') {
        expect(e.logits).toHaveLength(n);
        expect(e.logits[0]).toHaveLength(a.model.num_experts);
        expect(e.output_scales).toHaveLength(a.model.num_experts);
      }
      if (e.type === 'gate') expect(a.model.fusion_layers).toContain(e.layer);
    }
  });
});

describe('validateTrace', () => {
  const base = files.length > 0 ? read(files[0] as string) : {};

  it('rejects sha mismatch', () => {
    const t = clone(base) as { provenance: { checkpoint_sha256: string } };
    t.provenance.checkpoint_sha256 = '0'.repeat(64);
    expect(() => validateTrace(t, a)).toThrow(/checkpoint_sha256/);
  });

  it('rejects a layer-count mismatch', () => {
    const t = clone(base) as { provenance: { num_layers: number } };
    t.provenance.num_layers = 38;
    expect(() => validateTrace(t, a)).toThrow(/num_layers/);
  });

  it('rejects a missing router event', () => {
    const t = clone(base) as { events: { type: string }[] };
    t.events.splice(t.events.findIndex((e) => e.type === 'router'), 1);
    expect(() => validateTrace(t, a)).toThrow(/router event/);
  });

  it('rejects missing provenance fields', () => {
    const t = clone(base) as { provenance: Record<string, unknown> };
    delete t.provenance.tau_schedule;
    expect(() => validateTrace(t, a)).toThrow(/tau_schedule/);
  });
});

describe('decodeToken', () => {
  it('maps byte-level pieces to display text', () => {
    expect(decodeToken('Ġthe')).toBe(' the');
    expect(decodeToken('Ċ')).toBe('\n');
    expect(decodeToken('Ã¤')).toBe('ä');
    expect(decodeToken('ĠStraÃŁe')).toBe(' Straße');
  });

  it('joins bytes across pieces before UTF-8 decoding', () => {
    expect(decodeTokens(['Ã', '¤'])).toBe('ä');
    expect(decodeTokens(['Der', 'ĠH', 'und', 'Ġl', 'Ã¤', 'uft'])).toBe('Der Hund läuft');
  });
});
