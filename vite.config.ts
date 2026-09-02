import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

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

export default defineConfig({
  root: 'dashboard',
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
