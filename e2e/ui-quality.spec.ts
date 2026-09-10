import { test, expect, type Page } from '@playwright/test';

// Mock response shapes copied from apps/server/src/routes/
const MOCK_ME_USER = { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: [] };

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

async function seedSession(page: Page, token: string, refreshToken: string): Promise<void> {
  const persisted = JSON.stringify({
    state: { token, refreshToken, user: MOCK_ME_USER, isAuthenticated: true },
    version: 0,
  });
  await page.addInitScript((value) => {
    window.localStorage.setItem('auth-storage', value);
  }, persisted);
  // ST-1: AdminLayout mounts fetchUser on mount — mock /auth/me so the real backend doesn't 401
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_ME_USER }),
    });
  });
}

test.describe('UI quality — language persistence', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);

    // Setup status — isInitialized so the SPA doesn't redirect to /setup
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });

    // Stats — Dashboard calls this on mount
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

  test('language switch persists across reload (I18-4)', async ({ page }) => {
    // Seed session — no lng seed: Playwright chromium defaults to en-US → probed = 'en'
    await seedSession(page, 'test-token', 'test-refresh');

    await page.goto('/dashboard');

    // Verify English sidebar is showing
    await expect(page.locator('.ant-layout-sider')).toContainText('Users');

    // Toggle to Chinese — toggleLanguage calls changeLanguage('zh') + localStorage.setItem('lng', 'zh')
    const langToggle = page.getByTestId('lang-toggle');
    await expect(langToggle).toBeVisible();
    await langToggle.click();

    // Sidebar should now show Chinese
    await expect(page.locator('.ant-layout-sider')).toContainText('用户管理');

    // Verify localStorage has 'zh' (set by toggleLanguage, NOT by addInitScript)
    const lngVal = await page.evaluate(() => localStorage.getItem('lng'));
    expect(lngVal).toBe('zh');

    // Reload — i18n init reads localStorage['lng'] → 'zh'
    await page.reload();

    // Sidebar should STILL show Chinese after reload (persistence verified)
    await expect(page.locator('.ant-layout-sider')).toContainText('用户管理');
  });

  test('dashboard stats card shows loading skeleton before data arrives (ST-2)', async ({ page }) => {
    await seedSession(page, 'test-token', 'test-refresh');

    // Mock stats with 300ms delay
    await page.route('**/api/v1/stats', async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { users: 5, roles: 2, activeSessions: 3, audits: 10, recentActivity: [] } }),
      });
    });

    await page.goto('/dashboard');

    // Before the delayed response arrives, AntD Statistic with loading={true} shows a skeleton, not "0"
    await expect(page.locator('.ant-layout-sider')).toBeVisible();
    await expect(page.locator('.ant-statistic-content')).toHaveCount(4);
    // The skeleton replaces the value — no "0" text should be in any statistic content
    const statTexts = await page.locator('.ant-statistic-content').allTextContents();
    for (const text of statTexts) {
      expect(text).not.toBe('0');
    }

    // Wait for data to arrive — actual values should appear
    await expect(page.locator('.ant-statistic-content').first()).toContainText('5');
  });

  test('roles list error state shows alert when API returns 500 (ST-3)', async ({ page }) => {
    await seedSession(page, 'test-token', 'test-refresh');

    // Mock roles list as 500
    await page.route('**/api/v1/roles**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'Server error' } }),
      });
    });

    // Mock permissions to avoid unrelated error
    await page.route('**/api/v1/permissions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], total: 0 }),
      });
    });

    await page.goto('/roles');
    // Roles error Alert should be visible
    await expect(page.getByTestId('roles-load-error')).toBeVisible({ timeout: 10000 });
    // Retry button should be present
    await expect(page.getByTestId('roles-load-error').locator('button')).toBeVisible();
  });

  test('table header sort sends sortBy/sortOrder query params (TA-1)', async ({ page }) => {
    await seedSession(page, 'test-token', 'test-refresh');

    const userUrls: string[] = [];
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      userUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ id: '1', email: 'a@x.local', name: 'Admin', isActive: true, tenantId: 't1', tokenVersion: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }], total: 1 }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(1);
    const requestCountAfterLoad = userUrls.length;

    // Click the Name column header — antd's sorter trigger is inside th.ant-table-column-has-sorters
    await page.locator('th.ant-table-column-has-sorters').first().click();

    // Wait for a new request carrying sort params (may be followed by trailing unsorted refetch)
    await expect
      .poll(
        () => userUrls.slice(requestCountAfterLoad).some((u) => new URL(u).searchParams.get('sortBy') === 'name'),
        { timeout: 10000 },
      )
      .toBe(true);
    const sortedUrl = userUrls
      .slice(requestCountAfterLoad)
      .map((u) => new URL(u))
      .find((u) => u.searchParams.get('sortBy') === 'name');
    expect(sortedUrl!.searchParams.get('sortOrder')).toBe('asc');
  });

  test('row actions are keyboard-focusable (AC-1)', async ({ page }) => {
    await seedSession(page, 'test-token', 'test-refresh');

    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ id: '1', email: 'a@x.local', name: 'Admin', isActive: true, tenantId: 't1', tokenVersion: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }], total: 1 }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(1);

    // Focus the row's name link, then Tab through: name → Edit button → Delete button
    await page.locator('tbody tr.ant-table-row').first().locator('a').first().focus();
    await page.keyboard.press('Tab');
    const focusedEdit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return el?.textContent?.includes('Edit') || el?.textContent?.includes('编辑') || false;
    });
    expect(focusedEdit, 'Edit action should be focusable via Tab').toBe(true);

    await page.keyboard.press('Tab');
    const focusedDelete = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return el?.textContent?.includes('Delete') || el?.textContent?.includes('删除') || false;
    });
    expect(focusedDelete, 'Delete action should be focusable via Tab').toBe(true);
  });
});
