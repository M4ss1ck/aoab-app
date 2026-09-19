import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Gate tests only: deterministic, local, and fast enough to run on every
    // commit. Anything needing a browser lives in the Playwright suite.
    testTimeout: 5000,
  },
});
