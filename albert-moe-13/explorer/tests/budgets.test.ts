import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDGETS, evaluate, initialAssets, measure, report } from '../tools/check_budgets.mjs';

const MB = 1024 * 1024;

describe('budget verdict', () => {
  it('passes at the limits and fails one byte over', () => {
    expect(evaluate({ initial: BUDGETS.initialGzip, total: BUDGETS.totalDist, glbs: [{ path: 'a.glb', bytes: BUDGETS.glb }] }).ok).toBe(true);
    expect(evaluate({ initial: BUDGETS.initialGzip + 1, total: 0, glbs: [] }).ok).toBe(false);
    expect(evaluate({ initial: 0, total: BUDGETS.totalDist + 1, glbs: [] }).ok).toBe(false);
    expect(evaluate({ initial: 0, total: 0, glbs: [{ path: 'big.glb', bytes: BUDGETS.glb + 1 }] }).ok).toBe(false);
  });
  it('uses the numbers of the plan: 5 MB gzip, 40 MB dist, 6 MB per glb', () => {
    expect(BUDGETS).toEqual({ initialGzip: 5 * MB, totalDist: 40 * MB, glb: 6 * MB });
  });
  it('names the failing glb and prints PASS or FAIL per line', () => {
    const r = evaluate({ initial: 1, total: 2, glbs: [{ path: 'assets/big.glb', bytes: 7 * MB }] });
    const text = report(r);
    expect(text).toContain('FAIL  glb assets/big.glb');
    expect(text).toContain('PASS  dist/ total');
    expect(text.endsWith('budgets: FAIL')).toBe(true);
  });
});

describe('initial assets of index.html', () => {
  const html = `<link rel="modulepreload" crossorigin href="/assets/vendor-1.js"><link rel="stylesheet" href="/assets/index-2.css">
    <link rel="icon" href="/favicon.svg"><link rel="preload" as="font" href="/fonts/a.woff2"><link href="https://x.test/e.css" rel="stylesheet">
    <script type="module" crossorigin src="/assets/index-3.js"></script>`;
  it('takes scripts, module preloads and stylesheets, local only', () => {
    expect(initialAssets(html)).toEqual(['assets/index-2.css', 'assets/index-3.js', 'assets/vendor-1.js']);
  });
});

describe('measure on a fake dist', () => {
  it('counts gzip of the initial files and raw size of everything', () => {
    const d = mkdtempSync(join(tmpdir(), 'budgets-'));
    mkdirSync(join(d, 'assets'));
    mkdirSync(join(d, 'data'));
    writeFileSync(join(d, 'index.html'), '<script type="module" src="/assets/i.js"></script>');
    writeFileSync(join(d, 'assets', 'i.js'), 'a'.repeat(100_000));
    writeFileSync(join(d, 'assets', 'lazy.js'), 'b'.repeat(100_000));
    writeFileSync(join(d, 'assets', 'm.glb'), 'g'.repeat(1000));
    writeFileSync(join(d, 'data', 'architecture.json'), '{}');
    const m = measure(d);
    expect(m.initialFiles).toEqual(['assets/i.js', 'data/architecture.json']);
    expect(m.initial).toBeLessThan(1000); // repetitive text compresses; the lazy chunk is not counted
    expect(m.total).toBeGreaterThan(200_000);
    expect(m.glbs).toEqual([{ path: 'assets/m.glb', bytes: 1000 }]);
  });
});
