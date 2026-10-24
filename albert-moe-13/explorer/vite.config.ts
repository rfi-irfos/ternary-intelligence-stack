import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { validateArchitecture } from './src/data/architecture';
import { renderFallbackPage } from './src/fallback/page';
import { fillIndex, robotsTxt, siteUrl, sitemapXml } from './src/site/seo';

declare const process: { env: Record<string, string | undefined> };

/** The site origin: the one build-time constant (VITE_SITE_URL, default in src/site/seo.ts). */
const SITE = siteUrl(process.env.VITE_SITE_URL);

/**
 * Emits fallback.html (no WebGL 2) from public/data/architecture.json and the caveats at build time, and
 * serves it in the dev server. The page is never committed: the data cannot drift from the explorer.
 */
function fallbackPage(): Plugin {
  const html = (): string => renderFallbackPage(architecture(), './', SITE);
  return {
    name: 'albert-fallback-page',
    configureServer(server) {
      server.middlewares.use('/fallback.html', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'fallback.html', source: html() });
    },
  };
}

const architecture = (): ReturnType<typeof validateArchitecture> =>
  validateArchitecture(JSON.parse(readFileSync(new URL('./public/data/architecture.json', import.meta.url), 'utf8')));

/**
 * Fills the @@TOKENS@@ of index.html (head tags, JSON-LD, static summary) and emits robots.txt and sitemap.xml.
 * The site origin is the one build-time constant VITE_SITE_URL (default in src/site/seo.ts); the sitemap date is
 * the build date.
 */
function seo(site: string): Plugin {
  return {
    name: 'albert-seo',
    transformIndexHtml: { order: 'pre', handler: (html) => fillIndex(html, architecture(), site) },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(site) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(site, new Date().toISOString().slice(0, 10)) });
    },
  };
}

export default defineConfig(() => ({
  base: process.env.VITE_BASE ?? '/',
  plugins: [fallbackPage(), seo(SITE)],
  test: {
    environment: 'node',
    testTimeout: 20000, // the panel tests render every component type; 27 parallel workers can be slow
    include: ['tests/**/*.test.ts'],
  },
}));
