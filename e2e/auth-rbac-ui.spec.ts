import { test, expect, type Page } from '@playwright/test';

// Task 11 — menu/route permission gates fed by /auth/me permissions (Task 10 contract).
// The 9 codes mirror BUILTIN_PERMISSIONS in apps/server/src/routes/permissions-seed.ts.
const FULL_PERMISSIONS = [
  'users:read', 'users:write', 'users:delete',
  'roles:read', 'roles:write', 'roles:delete',
  'permissions:read', 'permissions:write', 'permissions:delete',
];

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

test.describe('RBAC UI — permission-gated menu and routes', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
      });
    });
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('user with only users:read: Roles entry hidden, direct /roles lands on 403', async ({ page }) => {
    await seedSessionWithMe(page, {
      id: '1', email: 'limited@accessbase.local', name: 'Limited',
      roles: [{ id: 'r-2', name: 'staff' }], permissions: ['users:read'], mfaEnabled: false,
    });

    await page.goto('/dashboard');
    const sider = page.locator('.ant-layout-sider');
    await expect(sider.getByText('Dashboard', { exact: true })).toBeVisible();
    await expect(sider.getByText('Users', { exact: true })).toBeVisible();
    await expect(sider.getByText('Profile', { exact: true })).toBeVisible();
    await expect(sider.getByText('Settings', { exact: true })).toBeVisible();
    // ponytail: audit stays visible by design — no audit:* codes in the 9-code seed yet
    await expect(sider.getByText('Audit', { exact: true })).toBeVisible();
    await expect(sider.getByText('Roles', { exact: true })).toHaveCount(0);

    await page.goto('/roles');
    await expect(
      page.getByText("Sorry, you don't have permission to access this page.", { exact: true }),
    ).toBeVisible();
    expect(page.url()).toContain('/403');
  });

  test('user with all 9 codes sees the full menu', async ({ page }) => {
    await seedSessionWithMe(page, {
      id: '1', email: 'admin@accessbase.local', name: 'Administrator',
      roles: [{ id: 'r-1', name: 'admin' }], permissions: FULL_PERMISSIONS, mfaEnabled: false,
    });

    await page.goto('/dashboard');
    const sider = page.locator('.ant-layout-sider');
    await expect(sider.getByText('Roles', { exact: true })).toBeVisible();
    await expect(sider.getByText('Users', { exact: true })).toBeVisible();
    await expect(sider.getByText('Audit', { exact: true })).toBeVisible();

    await page.goto('/roles');
    await expect(sider.getByText('Roles', { exact: true })).toBeVisible();
    expect(page.url()).toContain('/roles');
  });

  test('legacy backend (no permissions field) keeps every menu visible', async ({ page }) => {
    await seedSessionWithMe(page, {
      id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: [],
    });

    await page.goto('/dashboard');
    const sider = page.locator('.ant-layout-sider');
    await expect(sider.getByText('Roles', { exact: true })).toBeVisible();
    await expect(sider.getByText('Users', { exact: true })).toBeVisible();
    await expect(sider.getByText('Audit', { exact: true })).toBeVisible();
  });
});
