import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assetUrl } from '../src/data/assetUrl';
import { pagehideHandler } from '../src/scene/exhibit';

describe('assetUrl', () => {
  it('prefixes the base, with or without trailing slash', () => {
    expect(assetUrl('data/x.json', '/')).toBe('/data/x.json');
    expect(assetUrl('data/x.json', '/albert/')).toBe('/albert/data/x.json');
    expect(assetUrl('/data/x.json', '/albert')).toBe('/albert/data/x.json');
  });
  it('is the only way src builds asset and data URLs (no hard-coded root paths)', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(new URL('../src', import.meta.url).pathname);
    const bad = files.filter((f) => /['"`]\/(data|assets)\//.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});

describe('pagehideHandler (bfcache)', () => {
  it('keeps the exhibit on a persisted pagehide and disposes it on a real unload', () => {
    const exhibit = { dispose: vi.fn() };
    const close = vi.fn();
    const h = pagehideHandler(exhibit, close);
    h({ persisted: true });
    expect(exhibit.dispose).not.toHaveBeenCalled();
    h({ persisted: false });
    expect(exhibit.dispose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
