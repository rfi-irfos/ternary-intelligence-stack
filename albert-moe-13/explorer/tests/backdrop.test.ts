import { describe, expect, it } from 'vitest';
import { createBackdrop, backdropMid } from '../src/scene/backdrop';
import { BACKDROP } from '../src/style/theme';

describe('scene backdrop gradient', () => {
  it('is an opaque 1 x 256 texture from the token bottom (row 0) to the token top (last row)', () => {
    const tex = createBackdrop();
    const d = tex.image.data as Uint8Array;
    expect(tex.image.width).toBe(1);
    expect(tex.image.height).toBe(256);
    const px = (row: number) => (d[row * 4]! << 16) | (d[row * 4 + 1]! << 8) | d[row * 4 + 2]!;
    expect(px(0)).toBe(BACKDROP.bottom);
    expect(px(255)).toBe(BACKDROP.top);
    for (let i = 0; i < 256; i++) expect(d[i * 4 + 3]).toBe(255);
    // monotone from dark to lighter (the top is the lighter navy)
    expect(d[255 * 4 + 2]!).toBeGreaterThan(d[2]!);
  });

  it('the haze colour lies between the two', () => {
    const m = backdropMid();
    expect(m.b).toBeGreaterThan(0);
  });
});
