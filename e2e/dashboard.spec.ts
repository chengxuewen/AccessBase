import { test, expect } from '@playwright/test';

const MOCK_STATS = {
  success: true,
  data: {
    users: 5,
    roles: 3,
    activeSessions: 2,
    audits: 42,
    recentActivity: [
      { id: 'a-1', userId: 'u-1', action: 'POST /api/v1/users', resourceType: 'user', createdAt: new Date().toISOString() },
      { id: 'a-2', userId: 'u-2', action: 'DELETE /api/v1/roles/1', resourceType: 'role', createdAt: new Date(Date.now() - 3600_000).toISOString() },
    ],
  },
};

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

    // Phase 6d Task 5: Dashboard mounts GET /api/v1/stats — unmocked 401 → axios logout
    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_STATS),
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

  test('stat cards show real values from /stats', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ant-statistic')).toHaveCount(4);
    await expect(page.locator('text=Total Users').locator('..').locator('.ant-statistic-content-value')).toHaveText('5');
    await expect(page.locator('text=Audit Logs').locator('..').locator('.ant-statistic-content-value')).toHaveText('42');
  });

  test('recent activity list renders mocked entries', async ({ page }) => {
    await page.goto('/');
    const list = page.getByTestId('recent-activity');
    await expect(list).toBeVisible();
    await expect(list.locator('.ant-list-item')).toHaveCount(2);
    await expect(list.locator('text=POST /api/v1/users').first()).toBeVisible();
  });

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ant-layout-sider')).toBeVisible();

    // Click on Users nav item
    await page.locator('text=Users').click();
    await expect(page).toHaveURL(/.*users/);
  });
});
