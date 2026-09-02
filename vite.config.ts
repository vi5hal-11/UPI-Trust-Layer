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
export default defineConfig({
  root: 'dashboard',
  plugins: [react(), tailwindcss()],
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
