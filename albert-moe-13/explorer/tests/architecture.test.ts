import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';

describe('validateArchitecture', () => {
  it('accepts the committed architecture.json', () => {
    const a = validateArchitecture(arch);
    expect(a.model.num_layers).toBe(46);
    expect(a.layers).toHaveLength(46);
  });

  it('rejects layer mismatch', () => {
    const bad = { ...arch, layers: arch.layers.slice(0, 45) };
    expect(() => validateArchitecture(bad)).toThrow(/layers/);
  });

  it('rejects a missing field', () => {
    const { model: _model, ...rest } = arch;
    expect(() => validateArchitecture(rest)).toThrow(/model/);
  });
});
