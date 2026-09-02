import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts on purpose.
 *
 * vite.config.ts sets `root: 'dashboard'` so the front-end build resolves from
 * there. Vitest would otherwise inherit that root and look for the server test
 * suite inside dashboard/, finding nothing. This file pins the test root back
 * to the repo.
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
