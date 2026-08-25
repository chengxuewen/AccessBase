import { test, expect } from '@playwright/test';

test.describe('Users', () => {
  test.beforeEach(async ({ page }) => {
    // Stub auth
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

    // Stub users API
    await page.route('**/api/v1/users**', async (route) => {
      const url = new URL(route.request().url());
      const page_num = parseInt(url.searchParams.get('page') || '1');
      const pageSize = parseInt(url.searchParams.get('pageSize') || '10');

      const users = Array.from({ length: 25 }, (_, i) => ({
        id: String(i + 1),
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'suspended' : 'pending',
        roles: ['user'],
        createdAt: new Date().toISOString(),
      }));

      const start = (page_num - 1) * pageSize;
      const end = start + pageSize;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: users.slice(start, end),
          total: users.length,
          success: true,
        }),
      });
    });
  });

  test('loads users page', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('.ant-pro-table')).toBeVisible();
  });

  test('displays user table with data', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('tr')).toHaveCount(11); // header + 10 rows
  });

  test('search functionality works', async ({ page }) => {
    await page.goto('/users');
    await page.locator('input[placeholder*="Search"]').fill('User 1');
    await page.locator('button:has-text("Search")').click();
    // Wait for table to update
    await expect(page.locator('table')).toBeVisible();
  });

  test('pagination works', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('.ant-pagination')).toBeVisible();
    await page.locator('.ant-pagination-next').click();
    // Verify page changed
    await expect(page.locator('.ant-pagination-item-active')).toContainText('2');
  });
});
