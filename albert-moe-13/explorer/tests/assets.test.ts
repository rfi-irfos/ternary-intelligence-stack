import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Node environment: the file URLs below point at the real tree.
describe('procedural sound', () => {
  it('ships no audio files', () => {
    const walk = (dir: URL): string[] => readdirSync(dir).flatMap((n) => {
      const u = new URL(`${n}${statSync(new URL(n, dir)).isDirectory() ? '/' : ''}`, dir);
      return statSync(u).isDirectory() ? walk(u) : [u.pathname];
    });
    const files = walk(new URL('../public/', import.meta.url));
    expect(files.filter((f) => /\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i.test(f))).toEqual([]);
  });
});

describe('favicon', () => {
  it('index.html links a real SVG favicon in public/', () => {
    const text = (u: URL): string => {
      const r = readFileSync(u);
      return new TextDecoder().decode(new Uint8Array(r.buffer, r.byteOffset, r.byteLength));
    };
    const html = text(new URL('../index.html', import.meta.url));
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
    const u = new URL('../public/favicon.svg', import.meta.url);
    expect(existsSync(u)).toBe(true);
    expect(text(u)).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
});
