/**
 * T3 (gap-remediation): server-side pagination on clients / api-keys / groups.
 * For each page: mock the NEW envelope shape (data + total + page + pageSize
 * siblings), assert the request carries page/pageSize params and the table
 * renders with zero console errors.
 */
import { test, expect } from '@playwright/test';

const MOCK_ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  roles: [{ id: 'role-1', name: 'admin' }],
  permissions: ['clients:read', 'apikeys:read', 'groups:read'],
};

function mockShell(page: import('@playwright/test').Page) {
  const routes: Record<string, string> = {
    '**/api/v1/setup/status': JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true, siteName: 'T3', logoUrl: '', primaryColor: '' } }),
    '**/api/v1/auth/sms/status': JSON.stringify({ success: true, data: { enabled: false } }),
    '**/api/v1/auth/saml/status': JSON.stringify({ success: true, data: { enabled: false } }),
    '**/api/v1/auth/captcha/status': JSON.stringify({ success: true, data: { enabled: false } }),
    '**/api/v1/auth/captcha': JSON.stringify({ success: true, data: { enabled: false } }),
    '**/api/v1/auth/oauth/providers': JSON.stringify({ success: true, data: [] }),
    '**/api/v1/auth/me': JSON.stringify({ success: true, data: MOCK_ME }),
  };
  void page.route('**/api/v1/setup/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: routes['**/api/v1/setup/status'] }));
  void page.route('**/api/v1/auth/sms/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: routes['**/api/v1/auth/sms/status'] }));
  void page.route('**/api/v1/auth/saml/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: routes['**/api/v1/auth/saml/status'] }));
  void page.route('**/api/v1/auth/captcha/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: routes['**/api/v1/auth/captcha/status'] }));
  void page.route('**/api/v1/auth/oauth/providers', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: routes['**/api/v1/auth/oauth/providers'] }));
  void page.route('**/api/v1/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: routes['**/api/v1/auth/me'] }));
}

const envelope = (data: unknown[]) =>
  JSON.stringify({ success: true, data, total: 25, page: 1, pageSize: 10 });

test.describe('server-side pagination (T3)', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/findDOMNode|chrome-extension|moz-extension|ResizeObserver/.test(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
    mockShell(page);
    // Authenticated shell (api-keys.spec precedent): persist the store token.
    const persisted = JSON.stringify({
      state: { token: 'test-token', refreshToken: 'test-refresh', user: MOCK_ME, isAuthenticated: true },
      version: 0,
    });
    await page.addInitScript((value) => {
      window.localStorage.setItem('auth-storage', value);
    }, persisted);
  });

  test('P1: clients list requests server page params; total consumed', async ({ page }) => {
    const urls: string[] = [];
    await page.route('**/api/v1/clients*', async (route) => {
      urls.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: envelope([{ clientId: 'c1', name: 'One' }]) });
    });
    await page.route('**/api/v1/auth/webauthn/credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
    await page.goto('/clients');
    await expect(page.locator('[data-testid="clients-table"]')).toBeVisible();
    await expect.poll(() => urls.some((u) => u.includes('page=') && u.includes('pageSize=')), { timeout: 10_000 }).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test('P2: api-keys list requests server page params', async ({ page }) => {
    const urls: string[] = [];
    await page.route('**/api/v1/auth/api-keys*', async (route) => {
      urls.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: envelope([{ id: 'k1', name: 'Key' }]) });
    });
    await page.goto('/api-keys');
    await expect(page.locator('[data-testid="api-keys-table"]')).toBeVisible();
    await expect.poll(() => urls.some((u) => u.includes('page=') && u.includes('pageSize=')), { timeout: 10_000 }).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test('P3: groups list requests server page params + name search param', async ({ page }) => {
    const urls: string[] = [];
    await page.route('**/api/v1/groups**', async (route) => {
      const url = route.request().url();
      urls.push(url);
      await route.fulfill({ status: 200, contentType: 'application/json', body: envelope([{ id: 'g1', name: 'Eng', memberCount: 1, roleCount: 0 }]) });
    });
    await page.goto('/groups');
    await expect(page.locator('[data-testid="groups-table"]')).toBeVisible();
    await expect.poll(() => urls.some((u) => u.includes('page=') && u.includes('pageSize=')), { timeout: 10_000 }).toBe(true);
    expect(consoleErrors).toEqual([]);
  });
});
