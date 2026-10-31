import about from '../data/about.json';
import type { Architecture } from '../data/architecture';
import { APP_NAME } from '../content/brand';
import { tr } from '../ui/strings';

/**
 * Sharing and SEO (Task 20): the head tags, the static summary and the JSON-LD of index.html, the robots.txt and
 * the sitemap. index.html holds @@TOKENS@@; the Vite plugin in vite.config.ts fills them at build time from this
 * file and from public/data/architecture.json, so the numbers cannot drift from the explorer. The site origin is
 * ONE constant: VITE_SITE_URL at build time, else DEFAULT_SITE_URL. Pure functions only, no DOM.
 */

export const DEFAULT_SITE_URL = 'https://albert.rfi-irfos.com/';
export const THEME_COLOR = '#050914'; // --bg-bottom of src/style/tokens.css, the navy of the scene
export const SHARE_IMAGE = 'og-image.png';
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const PUBLISHER = 'RFI-IRFOS';
export const PUBLISHER_URL = 'https://rfi-irfos.com/';

/** The site origin with exactly one trailing slash. */
export function siteUrl(env: string | undefined): string {
  const raw = (env ?? '').trim() || DEFAULT_SITE_URL;
  return `${raw.replace(/\/+$/, '')}/`;
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const int = (n: number): string => n.toLocaleString('en-US');

/** The numbers shown in the summary, from the architecture data. */
export function facts(a: Architecture): { layers: number; streams: number; experts: number; topk: number; gates: number; params: number } {
  const m = a.model;
  return { layers: m.num_layers, streams: m.num_streams, experts: m.num_experts, topk: m.top_k, gates: m.fusion_layers.length, params: m.params };
}

/** Page title (<= 60 characters), English. */
export const pageTitle = (): string => tr('app.pageTitle', 'en', 'advanced');

/** Meta description (<= 160 characters): only what the About text and the README state. */
export function description(a: Architecture): string {
  const f = facts(a);
  return `Explore albert., a ternary dual-stream mixture-of-experts model by ${PUBLISHER}, in 3D: ${f.layers} layers per stream, ${f.streams} streams, ${f.experts} shared experts per layer.`;
}

/** The About facts as plain English sentences (the same strings as the About section of the lobby). */
export function factLines(a: Architecture): string[] {
  const f = facts(a);
  const T = (k: 'about.nLayers' | 'about.nExperts' | 'about.nGates' | 'about.nParams'): string =>
    tr(k, 'en', 'advanced', { ...f, params: int(f.params), router: 'router' });
  return [T('about.nLayers'), T('about.nExperts'), T('about.nGates'), T('about.nParams')];
}

/** Visually hidden but semantic summary for crawlers and screen readers (the page itself is a canvas). */
export function summaryHtml(a: Architecture): string {
  const lines = factLines(a).map((l) => `<li>${esc(l)}</li>`).join('');
  return `<section class="seo-summary" lang="en" aria-label="${esc(APP_NAME)}">
      <h2>${esc(APP_NAME)}</h2>
      <p>${esc(tr('about.what', 'en', 'advanced'))}</p>
      <ul>${lines}</ul>
      <p><a href="${esc(about.links.repo)}" tabindex="-1">Source code and model card</a> · <a href="${esc(about.links.huggingface)}" tabindex="-1">Model on Hugging Face</a> · <a href="${PUBLISHER_URL}" tabindex="-1">Built by RFI-IRFOS, research institute in Graz</a></p>
    </section>`;
}

/** What the visitor without JavaScript reads, inside the <noscript> of index.html. */
export function noscriptHtml(a: Architecture): string {
  return `<div class="boot"><div>
        <p>albert. needs JavaScript. / albert. braucht JavaScript.</p>
        <p>${esc(tr('about.what', 'en', 'advanced'))}</p>
        <p>${esc(factLines(a).join('. '))}.</p>
        <p><a href="${esc(about.links.repo)}" style="color:#22d3ee">${esc(about.links.repo)}</a></p>
      </div></div>`;
}

/** JSON-LD WebApplication. ScientificApplication is the honest category: the page is a model card, not a course. */
export function jsonLd(a: Architecture, site: string): string {
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: APP_NAME,
    url: site,
    description: description(a),
    applicationCategory: 'ScientificApplication',
    operatingSystem: 'Any (web browser with WebGL 2)',
    inLanguage: ['en', 'de'],
    isAccessibleForFree: true,
    image: `${site}${SHARE_IMAGE}`,
    publisher: { '@type': 'Organization', name: PUBLISHER, url: PUBLISHER_URL },
    codeRepository: about.links.repo,
    sameAs: [about.links.repo, about.links.huggingface],
  };
  return JSON.stringify(doc, null, 2).replace(/</g, '\\u003c');
}

const imageAlt = (a: Architecture): string => `${APP_NAME}: the ${a.model.num_layers} layers of albert. as a row of glass slabs in 3D`;

/** The meta block shared by every token of the <head> of index.html. */
export function headMeta(a: Architecture, site: string): string {
  const title = esc(pageTitle());
  const desc = esc(description(a));
  const img = `${site}${SHARE_IMAGE}`;
  const alt = esc(imageAlt(a));
  return [
    `<meta name="description" content="${desc}" />`,
    `<meta name="robots" content="index,follow" />`,
    `<meta name="theme-color" content="${THEME_COLOR}" />`,
    `<meta name="color-scheme" content="dark" />`,
    `<link rel="canonical" href="${site}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(APP_NAME)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${site}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${SHARE_IMAGE_SIZE.width}" />`,
    `<meta property="og:image:height" content="${SHARE_IMAGE_SIZE.height}" />`,
    `<meta property="og:image:alt" content="${alt}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:locale:alternate" content="de_DE" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
    `<meta name="twitter:image" content="${img}" />`,
    `<meta name="twitter:image:alt" content="${alt}" />`,
  ].join('\n    ');
}

/** Fills every @@TOKEN@@ of index.html. */
export function fillIndex(html: string, a: Architecture, site: string): string {
  const parts: Record<string, string> = {
    TITLE: esc(pageTitle()),
    HEAD_META: headMeta(a, site),
    JSONLD: `<script type="application/ld+json">\n${jsonLd(a, site)}\n    </script>`,
    SUMMARY: summaryHtml(a),
    NOSCRIPT: noscriptHtml(a),
  };
  return html.replace(/@@([A-Z_]+)@@/g, (m, k: string) => parts[k] ?? m);
}

export function robotsTxt(site: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site}sitemap.xml\n`;
}

/** `lastmod` is the build date, passed in by the build. */
export function sitemapXml(site: string, lastmod: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${site}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n</urlset>\n`;
}

/** The fallback page is an error path: not indexed, own title, same look in a share. */
export function fallbackMeta(a: Architecture, site: string): string {
  return [
    `<meta name="description" content="${esc(description(a))}" />`,
    `<meta name="robots" content="noindex,follow" />`,
    `<meta name="theme-color" content="${THEME_COLOR}" />`,
    `<meta name="color-scheme" content="dark" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(APP_NAME)}" />`,
    `<meta property="og:title" content="${esc(`${APP_NAME} – ${tr('fallback.title', 'en', 'advanced')}`)}" />`,
    `<meta property="og:image" content="${site}${SHARE_IMAGE}" />`,
  ].join('\n');
}
