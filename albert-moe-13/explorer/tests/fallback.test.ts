// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { CAVEATS, CAVEAT_IDS } from '../src/content/caveats';
import { esc, renderFallbackPage } from '../src/fallback/page';
import { tr } from '../src/ui/strings';

const a = validateArchitecture(arch);
const page = (): Document => new DOMParser().parseFromString(renderFallbackPage(a), 'text/html');

describe('fallback page', () => {
  it('is a complete document that links back to the app and needs no network', () => {
    const html = renderFallbackPage(a);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    const d = page();
    expect(d.querySelector('a[href="./"]')).not.toBeNull();
    expect(d.querySelector('script[src], link[rel=stylesheet], img')).toBeNull();
  });

  it('has one h1 per language and tables with captions and column heads', () => {
    const d = page();
    for (const lang of ['en', 'de'] as const) {
      const root = d.querySelector(`[data-l="${lang}"]`)!;
      expect(root.querySelectorAll('h1').length).toBe(1);
      expect(root.querySelector('h1')!.textContent).toContain(tr('fallback.title', lang, 'advanced'));
      for (const t of root.querySelectorAll('table')) {
        expect(t.querySelector('thead th[scope="col"]')).not.toBeNull();
      }
    }
  });

  it('lists all 46 layers with 1-based numbers, the 7 gates and the real tau', () => {
    const root = page().querySelector('[data-l="en"]')!;
    const layers = [...root.querySelectorAll('table')].find((t) => t.querySelector('caption')!.textContent === tr('fallback.layersCap', 'en', 'advanced'))!;
    const rows = [...layers.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(46);
    expect(rows[0]!.children[0]!.textContent).toBe('1');
    expect(rows[45]!.children[0]!.textContent).toBe('46');
    expect(rows.filter((r) => r.children[2]!.textContent === 'yes').map((r) => Number(r.children[1]!.textContent)))
      .toEqual(a.model.fusion_layers);
    expect(rows[2]!.children[3]!.textContent).toBe(String(+a.layers[2]!.tau.toPrecision(4)));
  });

  it('shows the model numbers, German with German number format', () => {
    const d = page();
    expect(d.querySelector('[data-l="en"]')!.textContent).toContain(a.model.params.toLocaleString('en-US'));
    expect(d.querySelector('[data-l="de"]')!.textContent).toContain(a.model.params.toLocaleString('de-DE'));
    expect(d.body.textContent).toContain(a.checkpoint.sha256);
  });

  it('lists every component with its tensors and shapes', () => {
    const root = page().querySelector('[data-l="en"]')!;
    const caps = [...root.querySelectorAll('caption')].map((c) => c.textContent!);
    for (const [name, c] of Object.entries(a.components)) {
      expect(caps.some((x) => x.startsWith(`${name}:`))).toBe(true);
      for (const tn of c.tensors) expect(root.textContent).toContain(tn.pattern);
    }
    expect(root.textContent).toContain('[1024 × 256]');
  });

  it('carries every caveat in both languages, with its evidence and table', () => {
    const d = page();
    for (const lang of ['en', 'de'] as const) {
      const root = d.querySelector(`[data-l="${lang}"]`)!;
      const arts = [...root.querySelectorAll('article.caveat')];
      expect(arts).toHaveLength(CAVEAT_IDS.length);
      CAVEAT_IDS.forEach((id, i) => {
        const c = CAVEATS[id];
        expect(arts[i]!.querySelector('h3')!.textContent).toBe(`${id}. ${c.title[lang]}`);
        expect(arts[i]!.textContent).toContain(c.body[lang]);
        expect(arts[i]!.querySelector('.evidence')!.textContent).toContain(c.evidence[lang]);
        if (c.table) expect(arts[i]!.querySelectorAll('tbody tr')).toHaveLength(c.table.rows.length);
      });
    }
  });

  it('escapes text', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
