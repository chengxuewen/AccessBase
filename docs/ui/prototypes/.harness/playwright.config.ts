import { defineConfig, devices } from '@playwright/test';

// Reproducible harness for the single-file admin-console prototype (adjudication 9 = A).
// Static file:// target — NO webServer (unlike the app e2e config). Serial single worker so
// the spec's module-level results object is shared and written once in afterAll.
export default defineConfig({
  testDir: '.',
  testMatch: /prototype\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './.test-results',
  use: {
    ...devices['Desktop Chrome'],
    // file:// navigation is done explicitly in the spec; no baseURL.
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});