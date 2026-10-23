import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  base: '/',
  // Tests read the Rust sources next to the explorer to check cited line ranges; the dev server stays confined.
  server: mode === 'test' ? { fs: { allow: ['..', '../..'] } } : {},
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
