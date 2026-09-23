import { test, expect, type Page } from '@playwright/test';

// Copied verbatim from route-guard-403.spec.ts (PIT-033: mocks mirror real route returns).
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

const FULL_PERMS_ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  roles: [{ id: 'r-1', name: 'admin' }],
  permissions: ['options:read', 'options:write', 'options:delete', 'users:read', 'audit:read', 'stats:read'],
  mfaEnabled: false,
};

const NO_OPTIONS_PERMS_ME = {
  id: '1',
  email: 'limited@accessbase.local',
  name: 'Limited',
  roles: [{ id: 'r-2', name: 'staff' }],
  permissions: ['users:read'],
  mfaEnabled: false,
};

const now = Date.now();
const MOCK_OPTIONS = [
  { key: 'site.banner', value: 'Welcome', updatedAt: new Date(now - 60_000).toISOString() },
  { key: 'site.api_key', value: '******', updatedAt: new Date(now - 120_000).toISOString() },
];

type OptionsRouteHooks = { onPut?: (body: string) => void };

async function mockOptionsApis(
  page: Page,
  options: typeof MOCK_OPTIONS = MOCK_OPTIONS,
  hooks: OptionsRouteHooks = {},
): Promise<void> {
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
  await page.route('**/api/v1/auth/sessions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
  await page.route('**/api/v1/auth/webauthn/credentials', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
  await page.route('**/api/v1/options', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: options }),
      });
      return;
    }
    if (route.request().method() === 'PUT') {
      const body = route.request().postData() ?? '';
      hooks.onPut?.(body);
      const parsed = JSON.parse(body) as { key: string; value: unknown };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { key: parsed.key, value: parsed.value } }),
      });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
  await page.route('**/api/v1/options/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
}

test.describe('Settings Options tab', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    // F/T4: Login mounts a SAML status probe — unmocked → vite proxy 500 → console-error net fails (B2 providers precedent)
    await page.route('**/api/v1/auth/saml/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
    });
    await page.route('**/api/v1/auth/sms/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
    });
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('admin with options:read sees the tab and the list renders', async ({ page }) => {
    await mockOptionsApis(page);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/settings');
    await page.locator('.ant-tabs-tab', { hasText: 'Options' }).click();
    await expect(page.getByTestId('options-table')).toBeVisible();
    await expect(page.getByTestId('option-value-site.banner')).toHaveText('"Welcome"');
  });

  test('add option flow: modal → fill → save → toast + row appears', async ({ page }) => {
    await mockOptionsApis(page, []);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/settings');
    await page.locator('.ant-tabs-tab', { hasText: 'Options' }).click();

    await page.getByTestId('add-option').click();
    await page.getByTestId('option-key-input').fill('site.feature_flag');
    // valid JSON value, e.g. a string
    await page.getByTestId('option-value-input').fill('"enabled"');
    await page.locator('.ant-modal .ant-btn-primary').click();

    await expect(page.locator('.ant-message')).toContainText('Option saved');
    await expect(page.getByTestId('option-value-site.feature_flag')).toHaveText('"enabled"');
  });

  test('sensitive key value is masked in the list', async ({ page }) => {
    await mockOptionsApis(page);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/settings');
    await page.locator('.ant-tabs-tab', { hasText: 'Options' }).click();
    await expect(page.getByTestId('option-value-site.api_key')).toHaveText('******');
  });

  test('editing a sensitive row with blank value does not fire PUT (mask write-back guard)', async ({ page }) => {
    const putCalls: string[] = [];
    // single LIFO-final route: tracks AND fulfills PUTs (registering a tracking
    // route before mockOptionsApis would be swallowed by its echo route —
    // Playwright routes are last-registered-wins)
    await mockOptionsApis(page, undefined, { onPut: (body) => putCalls.push(body) });
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/settings');
    await page.locator('.ant-tabs-tab', { hasText: 'Options' }).click();

    await page.getByTestId('edit-option-site.api_key').click();
    // value field must NOT be prefilled with the mask
    await expect(page.getByTestId('option-value-input')).toHaveValue('');
    // blank save → guard returns before the PUT: modal stays open, no call fired
    await page.locator('.ant-modal .ant-btn-primary').click();
    await expect(page.locator('.ant-modal')).toBeVisible();
    await expect(page.getByTestId('option-value-site.api_key')).toHaveText('******');
    expect(putCalls, 'PUT must not fire when the value is blank on sensitive edit').toEqual([]);
  });

  test('delete flow: Popconfirm → row disappears', async ({ page }) => {
    await mockOptionsApis(page);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/settings');
    await page.locator('.ant-tabs-tab', { hasText: 'Options' }).click();
    await expect(page.getByTestId('option-value-site.banner')).toBeVisible();

    await page.getByTestId('delete-option-site.banner').click();
    await page.locator('.ant-popconfirm .ant-btn-primary, .ant-popover .ant-btn-primary').first().click();
    await expect(page.getByTestId('option-value-site.banner')).toHaveCount(0);
  });

  test('user without options:read has no Options tab', async ({ page }) => {
    await mockOptionsApis(page);
    await seedSessionWithMe(page, NO_OPTIONS_PERMS_ME);
    await page.goto('/settings');
    await expect(page.locator('.ant-tabs-tab', { hasText: 'Options' })).toHaveCount(0);
    // General + Security still render
    await expect(page.locator('.ant-tabs-tab', { hasText: 'General' })).toBeVisible();
  });
});
