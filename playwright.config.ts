import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests are deliberately NOT part of `npm test`.
 *
 * `npm test` stays the fast 68-test unit suite that needs no browser, no build
 * and no server. These tests need all three, so they live behind
 * `npm run test:e2e`.
 *
 * Scope is the demo path: the four scenarios a judge actually watches.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // The suite mutates one shared SQLite audit trail, so it must run in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    // Reuse the server you already have running while developing.
    reuseExistingServer: !process.env.CI,
    // `npm start` runs a Vite build first, so allow for it.
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
