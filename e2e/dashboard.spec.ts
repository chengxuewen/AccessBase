import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Stub auth to simulate logged-in state
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            token: 'test-token',
            refreshToken: 'test-refresh',
            user: { id: '1', email: 'admin@example.com', name: 'Admin', roles: ['admin'] },
            isAuthenticated: true,
          },
          version: 0,
        }),
      );
    });

    // Stub user fetch
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '1',
          email: 'admin@example.com',
          name: 'Admin',
          roles: ['admin'],
        }),
      });
    });
  });

  test('loads dashboard page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h2')).toContainText('Dashboard');
  });

  test('displays stat cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ant-statistic')).toHaveCount(4);
  });

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ant-layout-sider')).toBeVisible();

    // Click on Users nav item
    await page.locator('text=Users').click();
    await expect(page).toHaveURL(/.*users/);
  });
});
