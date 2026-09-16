import { test, expect, type Page } from '@playwright/test';

// Copied verbatim from auth-rbac-ui.spec.ts (PIT-033: mocks mirror real route returns).
async function seedSessionWithMe(page: Page, me: Record<string, unknown>): Promise<void> {
  const persisted = JSON.stringify({
    state: { token: 'test-token', refreshToken: 'test-refresh', user: me, isAuthenticated: true },
    version: 0,
  });
  await page.addInitScript((value) => {
    window.localStorage.setItem('auth-storage', value);
  }, persisted);
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: me }),
    });
  });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const isNoise =
      text.includes('findDOMNode') ||
      text.includes('chrome-extension') ||
      text.includes('moz-extension') ||
      text.includes('ResizeObserver loop') ||
      text.includes('Failed to load resource') ||
      text.includes('[antd: compatible]') ||
      text.includes('[antd: message]');
    if (!isNoise) errors.push(text);
  });
  return errors;
}

test.describe('Route guard 403 behavior', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    // setup/status: GlobalGuard checks this before rendering any authed page
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    // stats: Dashboard page mounts GET /api/v1/stats — must be mocked to avoid 401 cascade
    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
      });
    });
  // F/T4: Login mounts a SAML status probe — unmocked → vite proxy 500 → console-error net fails (B2 providers precedent)
  await page.route('**/api/v1/auth/saml/status', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('audit page shows 403 for user without audit:read', async ({ page }) => {
    await seedSessionWithMe(page, {
      id: '1', email: 'limited@accessbase.local', name: 'Limited',
      roles: [{ id: 'r-2', name: 'staff' }], permissions: ['users:read'], mfaEnabled: false,
    }); // no audit:read
    await page.goto('/audit');
    await expect(page.locator('.ant-result-403')).toBeVisible();
  });

  test('direct /dashboard shows 403 for user without stats:read', async ({ page }) => {
    await seedSessionWithMe(page, {
      id: '1', email: 'limited@accessbase.local', name: 'Limited',
      roles: [{ id: 'r-2', name: 'staff' }], permissions: ['users:read'], mfaEnabled: false,
    });
    await page.goto('/dashboard');
    await expect(page.locator('.ant-result-403')).toBeVisible();
  });
});
