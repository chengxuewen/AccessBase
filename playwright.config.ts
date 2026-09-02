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
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /setup-real-.*\.spec\.ts/,
    },
    {
      name: 'setup-real',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /setup-real-.*\.spec\.ts/,
      // fullyParallel 默认 false + serial describe —— 真后端全库操作不能并行
      timeout: 180_000,
    },
  ],
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
  },
});
