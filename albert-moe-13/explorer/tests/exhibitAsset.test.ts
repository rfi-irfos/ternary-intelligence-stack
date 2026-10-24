import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Node environment: the file URL points at the real tree.
describe('exhibit asset', () => {
  it('ships the real 1871 x 932 dashboard screenshot in public/ and no video', () => {
    const path = new URL('../public/assets/exhibits/dashboard-live.png', import.meta.url).pathname;
    expect(existsSync(path)).toBe(true);
    const r = readFileSync(path);
    expect(r.byteLength).toBeGreaterThan(100_000);
    expect(r.byteLength).toBeLessThan(400_000);
    const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
    expect([v.getUint32(16), v.getUint32(20)]).toEqual([1871, 932]);
    expect(existsSync(new URL('../public/assets/exhibits/dashboard-live.mp4', import.meta.url).pathname)).toBe(false);
  });
});
