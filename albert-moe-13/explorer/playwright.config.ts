import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks of the built explorer in headless Chromium (run them on the Colony:
 * `colony-run -- 'cd albert-moe-13/explorer && npm ci && npx playwright install chromium && npm run build && npx playwright test'`).
 * The server runs a separate build with VITE_E2E=1 (adds the window.__albert test hook; the normal build has none).
 * Headless Chromium has no GPU: WebGL 2 comes from SwiftShader, which is slow, so the timeouts are long and the
 * quality preset of the tests is Low unless a test says otherwise.
 */
const PORT = 4181;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/out',
  webServer: {
    command: `VITE_E2E=1 npx vite build --outDir dist-e2e --logLevel error && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
});
