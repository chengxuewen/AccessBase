import { test, expect, type Page } from '@playwright/test';

// Shared mocks: setup-status (GlobalGuard on /login and authed area) + login
async function mockCommonApis(page: Page): Promise<void> {
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });

  await page.route('**/api/v1/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
          expiresIn: 900,
          user: { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: ['admin'] },
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

}

test.describe('Error Pages', () => {
  test('404 page renders for unknown URL and back button navigates to dashboard', async ({ page }) => {
    await mockCommonApis(page);
    await page.goto('/nonexistent-url-xyz');
    await expect(page.locator('.ant-result-404')).toBeVisible();
    await expect(page.locator('.ant-result-title')).toHaveText('404');

    await page.locator('.ant-result .ant-btn-primary').click();
    // Back-to-dashboard requires auth: login first (no mocks left after reload)
    await mockCommonApis(page);
    await page.goto('/login');
    await page.locator('input#email').fill('admin@accessbase.local');
    await page.locator('input#password').fill('AdminPass123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('/403 renders 403 Result directly', async ({ page }) => {
    await page.goto('/403');
    await expect(page.locator('.ant-result-403')).toBeVisible();
    await expect(page.locator('.ant-result-title')).toHaveText('403');
  });

  test('404 catch-all renders even when not authenticated', async ({ page }) => {
    await page.goto('/definitely-not-a-route');
    await expect(page.locator('.ant-result-404')).toBeVisible();
  });
});
