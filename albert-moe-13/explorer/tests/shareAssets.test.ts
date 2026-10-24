import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, SHARE_IMAGE, SHARE_IMAGE_SIZE } from '../src/site/seo';

const pub = (f: string): URL => new URL(`../public/${f}`, import.meta.url);
const dist = (f: string): URL => new URL(`../dist/${f}`, import.meta.url);
const built = existsSync(dist('index.html')); // the Colony run builds first; without a build only public/ is checked

describe('share image and icons', () => {
  const file = readFileSync(pub(SHARE_IMAGE));
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  it('og-image is a PNG of 1200 x 630 under 300 KB', () => {
    expect(String.fromCharCode(view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('PNG');
    expect(view.getUint32(16)).toBe(SHARE_IMAGE_SIZE.width); // IHDR width, big endian
    expect(view.getUint32(20)).toBe(SHARE_IMAGE_SIZE.height);
    expect(file.byteLength).toBeLessThan(300 * 1024);
  });
  it('the manifest names icons that exist, with the right sizes', () => {
    const m = JSON.parse(readFileSync(pub('site.webmanifest'), 'utf8'));
    expect(m.name).toBe('Xperience albert.');
    for (const i of m.icons as Array<{ src: string; sizes: string; type: string }>) {
      expect(existsSync(pub(i.src.slice(1))), i.src).toBe(true);
      if (i.type === 'image/png') {
        const b = readFileSync(pub(i.src.slice(1)));
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        expect(`${v.getUint32(16)}x${v.getUint32(20)}`).toBe(i.sizes);
      }
    }
    const apple = readFileSync(pub('apple-touch-icon.png'));
    expect(new DataView(apple.buffer, apple.byteOffset, apple.byteLength).getUint32(16)).toBe(180);
  });
});

describe.runIf(built)('built dist/', () => {
  const text = (f: string): string => readFileSync(dist(f), 'utf8');
  it('contains the image, the icons and the manifest', () => {
    for (const f of [SHARE_IMAGE, 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'site.webmanifest', 'favicon.svg']) expect(existsSync(dist(f)), f).toBe(true);
  });
  it('robots.txt and sitemap.xml use the site origin; lastmod is a date', () => {
    expect(text('robots.txt')).toContain(`Sitemap: ${DEFAULT_SITE_URL}sitemap.xml`);
    expect(text('robots.txt')).toContain('Allow: /');
    expect(text('sitemap.xml')).toContain(`<loc>${DEFAULT_SITE_URL}</loc>`);
    expect(text('sitemap.xml')).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });
  it('index.html, fallback.html, robots and sitemap have no localhost and no unfilled token', () => {
    for (const f of ['index.html', 'robots.txt', 'sitemap.xml', 'fallback.html']) expect(text(f), f).not.toMatch(/localhost|127\.0\.0\.1|@@[A-Z_]+@@/);
  });
  it('fallback.html is noindex and has its own title', () => {
    expect(text('fallback.html')).toContain('<meta name="robots" content="noindex,follow" />');
    expect(text('fallback.html')).toContain('<title>Xperience albert. – albert. without the 3D view</title>');
  });
});
