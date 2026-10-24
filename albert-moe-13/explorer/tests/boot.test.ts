import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tr } from '../src/ui/strings';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('loading state in index.html', () => {
  it('says the same words as strings.ts in both languages', () => {
    for (const lang of ['en', 'de'] as const) {
      const m = html.match(new RegExp(`<p data-l="${lang}" lang="${lang}">([^<]*)</p>`));
      expect(m?.[1]).toBe(tr('boot.loading', lang, 'simple'));
    }
  });

  it('is plain text: no progress bar, no percentage', () => {
    const boot = html.slice(html.indexOf('id="boot"'), html.indexOf('</noscript>'));
    expect(boot).not.toMatch(/<progress|role="progressbar"|\d\s?%/);
    expect(boot).toContain('role="status"');
  });

  it('picks the page language before any script of the app runs', () => {
    expect(html.indexOf('document.documentElement.lang')).toBeGreaterThan(0);
    expect(html.indexOf('document.documentElement.lang')).toBeLessThan(html.indexOf('src="/src/main.ts"'));
    expect(html).toContain("localStorage.getItem('albert.lang')");
  });
});
