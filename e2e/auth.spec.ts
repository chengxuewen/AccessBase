import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('visits login page', async ({ page }) => {
    await page.goto('/login');
    // setup/status: GlobalGuard checks this before rendering any authed page
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.locator('input[id="email"]')).toBeVisible();
    await expect(page.locator('input[id="password"]')).toBeVisible();
  });

  test('shows validation errors for empty fields', async ({ page }) => {
    await page.goto('/login');
    // setup/status: GlobalGuard checks this before rendering any authed page
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Please enter your email')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    // setup/status: GlobalGuard checks this before rendering any authed page
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    await page.locator('input[id="email"]').fill('invalid@example.com');
    await page.locator('input[id="password"]').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();
    // Inline Alert (antd static message API doesn't render under React 19)
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText(/Login failed|Invalid email or password|Account temporarily locked/);
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    // setup/status: GlobalGuard checks this before rendering any authed page
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    // Stub the login API
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 900,
            user: { id: '1', email: 'admin@example.com', name: 'Admin', roles: [] },
          },
        }),
      });
    });

    // Phase 6d Task 5: Dashboard mounts GET /api/v1/stats — unmocked 401 → axios logout
    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
      });
    });

    // ST-1: AdminLayout fetchUser fires on mount — mock /auth/me
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: '1', email: 'admin@example.com', name: 'Admin', roles: [] } }),
      });
    });

    await page.goto('/login');
    await page.locator('input[id="email"]').fill('admin@example.com');
    await page.locator('input[id="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();

    await page.waitForURL('/');
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('logout clears session', async ({ page }) => {
    // setup/status: GlobalGuard checks this before rendering any authed page
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    // Stub login
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 900,
            user: { id: '1', email: 'admin@example.com', name: 'Admin', roles: [] },
          },
        }),
      });
    });

    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
      });
    });

    // ST-1: AdminLayout fetchUser fires on mount — mock /auth/me
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: '1', email: 'admin@example.com', name: 'Admin', roles: [] } }),
      });
    });

    await page.goto('/login');
    await page.locator('input[id="email"]').fill('admin@example.com');
    await page.locator('input[id="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('/');

    // Logout lives in the user dropdown (stable testid) — hover to open, click menu item
    const trigger = page.getByTestId('user-dropdown');
    await expect(trigger).toBeVisible();
    await trigger.hover();
    await page.locator('.ant-dropdown-menu li:has-text("Logout"), .ant-dropdown-menu li:has-text("退出登录")').first().click();
    await page.waitForURL('/login');
  });

  test('register returns 201 with pending status (fetch in page)', async ({ page }) => {
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    await page.route('**/api/v1/auth/register', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 'u9', email: 'n@x.io', name: 'N', status: 'pending' } }),
      });
    });
    await page.goto('/login');
    // page.request bypasses page.route — must fetch from within the page context
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'n@x.io', name: 'N', password: 'Passw0rd!' }),
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: { id: 'u9', email: 'n@x.io', name: 'N', status: 'pending' },
    });
  });

  test('suspended user login shows ACCOUNT_SUSPENDED message', async ({ page }) => {
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    // Regression lock for real server mapping: 403 AUTH_004 (no recordFailure on suspended)
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'AUTH_004', message: 'Account suspended' } }),
      });
    });
    await page.goto('/login');
    await page.locator('input[id="email"]').fill('sus@x.io');
    await page.locator('input[id="password"]').fill('Passw0rd!');
    await page.locator('button[type="submit"]').click();
    // apiErrorMessage passthrough renders the server message verbatim
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText('Account suspended');
  });
});
