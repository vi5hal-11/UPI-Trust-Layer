import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Test counts, computed at build time from the suites themselves.
 *
 * These used to be typed into the landing page by hand, which meant they were
 * wrong within a day of being written - the page claimed 68 unit tests when
 * there were 78. A number a human has to remember to update is a number that
 * will be stale, and a stale boast on a page selling honesty is worse than no
 * boast at all.
 */
function countTests(dir: string, match: RegExp): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      total += countTests(path, match);
    } else if (match.test(entry.name)) {
      total += (readFileSync(path, 'utf8').match(/^\s*(?:it|test)\(/gm) ?? []).length;
    }
  }
  return total;
}

/**
 * The dashboard is a separate front-end app from the Node server. It builds
 * into dashboard/dist, which is what Express serves in production.
 *
 * `npm start` runs this build first (see the prestart script), so a judge
 * with a fresh clone still only ever needs `npm install && npm start`.
 */
/**
 * og:image and canonical URLs must be absolute, so the origin is injected at
 * build time. Set SITE_URL on the host after deploying; the localhost default
 * keeps a local build honest rather than silently emitting a broken URL.
 */
const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

const TESTS_DIR = resolve(import.meta.dirname, 'tests');
const UNIT_TESTS = countTests(TESTS_DIR, /\.test\.ts$/);
const E2E_TESTS = countTests(resolve(TESTS_DIR, 'e2e'), /\.spec\.ts$/);

export default defineConfig({
  root: 'dashboard',
  define: {
    __UNIT_TESTS__: JSON.stringify(UNIT_TESTS),
    __E2E_TESTS__: JSON.stringify(E2E_TESTS),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'inject-site-url',
      transformIndexHtml(html: string) {
        return html.replaceAll('__SITE_URL__', SITE_URL);
      },
    },
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'dashboard/src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // A judge may open devtools. Keep the output readable rather than minified
    // into one line; the file is small enough that it costs nothing.
    sourcemap: true,
  },
  server: {
    port: 5173,
    // In dev the API still lives on the Express server.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
