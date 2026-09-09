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
      text.includes('ResizeObserver') ||
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
}

/**
 * Seed lng directly into localStorage via page.evaluate AFTER load.
 * Used to ensure a specific language state without relying on addInitScript
 * (which re-runs on page.reload and would overwrite the toggle's value).
 */
async function ensureLng(page: Page, lng: string): Promise<void> {
  // evaluate runs after page load — set localStorage for NEXT reload's i18n init
  await page.evaluate((value) => localStorage.setItem('lng', value), lng);
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
});
