import { test, expect, type Page } from '@playwright/test';

/** Seed an authed session the same way dashboard.spec does. */
async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: {
          token: 'test-token',
          refreshToken: 'test-refresh',
          user: { id: '1', email: 'admin@example.com', name: 'Admin', roles: [{ id: 'role-1', name: 'admin' }] },
          isAuthenticated: true,
        },
        version: 0,
      }),
    );
  });

  // GlobalGuard checks this before rendering any authed page
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: '1', email: 'admin@example.com', name: 'Admin', roles: [{ id: 'role-1', name: 'admin' }] } }),
    });
  });
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
    });
  });
}

test.describe('Theme toggle', () => {
  test('toggle switches html[data-theme] to dark and persists across reload', async ({ page }) => {
    await seedSession(page);
    await page.goto('/dashboard');
    await expect(page.getByTestId('theme-toggle')).toBeVisible();

    // light by default
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // persisted preference survives reload (zustand persist → ui-storage)
    await page.reload();
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('second click returns to light', async ({ page }) => {
    await seedSession(page);
    await page.goto('/dashboard');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
