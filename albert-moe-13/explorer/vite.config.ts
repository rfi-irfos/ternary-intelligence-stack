import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { validateArchitecture } from './src/data/architecture';
import { renderFallbackPage } from './src/fallback/page';

/**
 * Emits fallback.html (no WebGL 2) from public/data/architecture.json and the caveats at build time, and
 * serves it in the dev server. The page is never committed: the data cannot drift from the explorer.
 */
function fallbackPage(): Plugin {
  const html = (): string =>
    renderFallbackPage(validateArchitecture(JSON.parse(readFileSync(new URL('./public/data/architecture.json', import.meta.url), 'utf8'))));
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

export default defineConfig(() => ({
  base: '/',
  plugins: [fallbackPage()],
  test: {
    environment: 'node',
    testTimeout: 20000, // the panel tests render every component type; 27 parallel workers can be slow
    include: ['tests/**/*.test.ts'],
  },
}));
