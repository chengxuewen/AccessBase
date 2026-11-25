import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // W0.3 visual determinism (defaults for the `visual` project; behavior
    // specs are unaffected by screenshot-specific options).
    expect: {
      toHaveScreenshot: {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.002,
      },
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/setup-real-.*\.spec\.ts/, /visual\/.*\.spec\.ts/, /real-stack-smoke\.spec\.ts/],
    },
    {
      name: 'visual',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /visual\/.*\.spec\.ts/,
      // Visual determinism: one worker, serial describe — CSS-in-JS + fonts
      // settle in a stable order; parallel runs amplify timing noise.
      workers: 1,
      fullyParallel: false,
    },
    {
      name: 'setup-real',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [/setup-real-.*\.spec\.ts/, /real-stack-smoke\.spec\.ts/],
      // fullyParallel 默认 false + serial describe —— 真后端全库操作不能并行
      timeout: 180_000,
    },
  ],
  webServer: {
    // CI: recursive `pnpm -r run dev` never exits (tsc --watch) and starves vite —
    // serve the admin-ui dev server only (mock e2e needs no backend). Flows R2.
    command: process.env['CI'] ? 'pnpm --filter @accessbase/admin-ui dev' : 'pnpm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
  },
});
