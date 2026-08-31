import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('visits login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.locator('input[id="email"]')).toBeVisible();
    await expect(page.locator('input[id="password"]')).toBeVisible();
  });

  test('shows validation errors for empty fields', async ({ page }) => {
    await page.goto('/login');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Please enter your email')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[id="email"]').fill('invalid@example.com');
    await page.locator('input[id="password"]').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();
    // Inline Alert (antd static message API doesn't render under React 19)
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText('Login failed');
  });

  test('successful login redirects to dashboard', async ({ page }) => {
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
            expiresIn: 3600,
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

    await page.goto('/login');
    await page.locator('input[id="email"]').fill('admin@example.com');
    await page.locator('input[id="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();

    await page.waitForURL('/');
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('logout clears session', async ({ page }) => {
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
            expiresIn: 3600,
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
});
