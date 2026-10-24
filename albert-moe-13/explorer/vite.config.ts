import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  base: '/',
  test: {
    environment: 'node',
    testTimeout: 20000, // the panel tests render every component type; 27 parallel workers can be slow
    include: ['tests/**/*.test.ts'],
  },
}));
