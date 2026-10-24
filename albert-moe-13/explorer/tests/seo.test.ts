// @vitest-environment jsdom
import raw from '../index.html?raw';
import { describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { renderFallbackPage } from '../src/fallback/page';
import {
  DEFAULT_SITE_URL, SHARE_IMAGE, SHARE_IMAGE_SIZE, description, factLines, fillIndex, pageTitle, robotsTxt, siteUrl, sitemapXml,
} from '../src/site/seo';
import { getLang, setLang } from '../src/ui/prefs';
import { tr } from '../src/ui/strings';

const a = validateArchitecture(arch);
const SITE = DEFAULT_SITE_URL;
const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');
const meta = (d: Document, key: string, attr: 'name' | 'property' = 'name'): string | null =>
  d.querySelector(`meta[${attr}="${key}"]`)?.getAttribute('content') ?? null;

/** The built dist/index.html when a build exists (the Colony run builds first), else the filled source. */
const dist = import.meta.glob('../dist/index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const built = '../dist/index.html' in dist;
const html = built ? dist['../dist/index.html']! : fillIndex(raw, a, SITE);
const d = parse(html);

describe('site origin', () => {
  it('is one constant: default, override, one trailing slash', () => {
    expect(siteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('')).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('https://example.org///')).toBe('https://example.org/');
    expect(siteUrl('https://example.org/x')).toBe('https://example.org/x/');
  });
  it('is not typed anywhere else in the source of the page', () => {
    expect(raw).not.toContain('rfi-irfos.com');
    expect(raw).not.toContain('og-image');
  });
});

describe('head tags', () => {
  it('has lang, viewport, a short title and a description within bounds', () => {
    expect(d.documentElement.lang).toBe('en');
    expect(d.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(d.title).toBe(tr('app.pageTitle', 'en', 'advanced'));
    expect(d.title.length).toBeLessThanOrEqual(60);
    const desc = meta(d, 'description')!;
    expect(desc.length).toBeGreaterThan(70);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc).toBe(description(a));
    expect(desc).toContain(`${a.model.num_layers} layers per stream`);
    expect(desc).toContain(`${a.model.num_streams} streams`);
    expect(desc).toContain(`${a.model.num_experts} shared experts`);
  });

  it('has robots, theme colour, colour scheme, canonical and manifest links', () => {
    expect(meta(d, 'robots')).toBe('index,follow');
    expect(meta(d, 'theme-color')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(meta(d, 'color-scheme')).toBe('dark');
    expect(d.querySelector('link[rel="canonical"]')!.getAttribute('href')).toBe(SITE);
    expect(d.querySelector('link[rel="manifest"]')).not.toBeNull();
    expect(d.querySelector('link[rel="apple-touch-icon"]')).not.toBeNull();
  });

  it('has the Open Graph and Twitter set with absolute URLs on the site origin', () => {
    const og = (k: string): string | null => meta(d, `og:${k}`, 'property');
    expect(og('type')).toBe('website');
    expect(og('site_name')).toBe('Xperience albert.');
    expect(og('title')).toBe(d.title);
    expect(og('description')).toBe(meta(d, 'description'));
    expect(og('url')).toBe(d.querySelector('link[rel="canonical"]')!.getAttribute('href'));
    expect(og('image')).toBe(`${SITE}${SHARE_IMAGE}`);
    expect(Number(og('image:width'))).toBe(SHARE_IMAGE_SIZE.width);
    expect(Number(og('image:height'))).toBe(SHARE_IMAGE_SIZE.height);
    expect(og('image:alt')!.length).toBeGreaterThan(10);
    expect(og('locale')).toBe('en_US');
    expect(og('locale:alternate')).toBe('de_DE');
    expect(meta(d, 'twitter:card')).toBe('summary_large_image');
    expect(meta(d, 'twitter:title')).toBe(d.title);
    expect(meta(d, 'twitter:description')).toBe(meta(d, 'description'));
    expect(meta(d, 'twitter:image')).toBe(`${SITE}${SHARE_IMAGE}`);
    expect(meta(d, 'twitter:image:alt')).toBe(og('image:alt'));
  });
});

describe('crawlable content', () => {
  it('has the hidden summary with the numbers of architecture.json and the repo link', () => {
    const s = d.querySelector('.seo-summary')!;
    expect(s.querySelector('h2')!.textContent).toBe('Xperience albert.');
    for (const line of factLines(a)) expect(s.textContent).toContain(line);
    expect(s.textContent).toContain(`${a.model.num_layers} layers per stream, ${a.model.num_streams} streams`);
    expect(s.textContent).toContain(`${a.model.num_experts} shared experts per layer`);
    expect(s.textContent).toContain(`${a.model.fusion_layers.length} exchange gates`);
    expect(s.textContent).toContain(a.model.params.toLocaleString('en-US'));
    expect(s.textContent).toContain(tr('about.what', 'en', 'advanced'));
    expect(s.querySelector('a[href^="https://github.com/rfi-irfos/"]')).not.toBeNull();
    // hidden links must not take Tab stops before the app (the e2e keyboard test caught it)
    for (const l of s.querySelectorAll('a')) expect(l.getAttribute('tabindex')).toBe('-1');
  });
  it('has a noscript with the same facts', () => {
    const ns = html.match(/<noscript>([\s\S]*?)<\/noscript>/)![1]!;
    expect(ns).toContain(tr('about.what', 'en', 'advanced'));
    expect(ns).toContain(`${a.model.num_layers} layers per stream`);
    expect(ns).toContain('albert. braucht JavaScript.');
  });
  it('has exactly one h1', () => {
    expect(d.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('JSON-LD', () => {
  const ld = JSON.parse(d.querySelector('script[type="application/ld+json"]')!.textContent!);
  it('is a WebApplication with the required keys and nothing invented', () => {
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('WebApplication');
    expect(ld.name).toBe('Xperience albert.');
    expect(ld.url).toBe(SITE);
    expect(ld.description).toBe(meta(d, 'description'));
    expect(ld.applicationCategory).toBe('ScientificApplication');
    expect(ld.inLanguage).toEqual(['en', 'de']);
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.publisher).toEqual({ '@type': 'Organization', name: 'RFI-IRFOS' });
    expect(ld.codeRepository).toBe('https://github.com/rfi-irfos/ternary-intelligence-stack');
    expect(ld.sameAs).toEqual([ld.codeRepository, 'https://huggingface.co/rfi-irfos/albert']);
    for (const k of ['aggregateRating', 'review', 'offers', 'address']) expect(ld).not.toHaveProperty(k);
    expect(JSON.stringify(ld)).not.toContain('eriirfos-eng');
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('robots allows all and names the sitemap on the site origin', () => {
    expect(robotsTxt(SITE)).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
  });
  it('sitemap has the single URL and a date', () => {
    const x = parse(sitemapXml(SITE, '2026-10-24'));
    expect(x.querySelectorAll('url')).toHaveLength(1);
    expect(x.querySelector('loc')!.textContent).toBe(SITE);
    expect(x.querySelector('lastmod')!.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('no leftovers in the output', () => {
  it('has no localhost, no placeholder token and no foreign repo URL', () => {
    expect(html).not.toMatch(/localhost|127\.0\.0\.1|@@[A-Z_]+@@|example\.(com|org)|TODO|lorem/i);
    expect(html).not.toContain('eriirfos-eng');
  });
});

describe('fallback page', () => {
  const f = parse(renderFallbackPage(a, './', SITE));
  it('is not indexed, has its own title and the description', () => {
    expect(meta(f, 'robots')).toBe('noindex,follow');
    expect(f.title).not.toBe(d.title);
    expect(f.title).toContain('Xperience albert.');
    expect(meta(f, 'description')!.length).toBeLessThanOrEqual(160);
    expect(meta(f, 'theme-color')).toBe(meta(d, 'theme-color'));
    expect(f.querySelector('link[rel="canonical"]')).toBeNull();
  });
});

describe('language follows the DE | EN toggle', () => {
  it('sets document.documentElement.lang and document.title', () => {
    setLang('de');
    expect(getLang()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(document.title).toBe(tr('app.pageTitle', 'de', 'advanced'));
    expect(document.title).not.toBe(pageTitle());
    setLang('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe(pageTitle());
  });
});
