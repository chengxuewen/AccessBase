import { test, expect, type Page } from '@playwright/test';

// PIT-033: mocks mirror the real server contract (apps/server/src/oidc/interaction.ts):
// GET  /api/v1/oidc/interaction/:uid → { success, data: { clientName, requestedScopes, promptName, uid } }
// POST /api/v1/oidc/interaction/:uid body { decision } → 303 resume
const ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Admin',
  roles: [{ id: 'r-1', name: 'admin' }],
  permissions: ['stats:read', 'users:read'],
  mfaEnabled: false,
};

const INTERACTION = {
  clientName: 'Third Party App',
  requestedScopes: ['openid', 'profile', 'email'],
  promptName: 'consent',
  uid: 'uid-123',
};

async function trackConsoleErrors(page: Page): Promise<string[]> {
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

async function seedSession(page: Page): Promise<void> {
  const persisted = JSON.stringify({
    state: { token: 'test-token', refreshToken: 'test-refresh', user: ME, isAuthenticated: true },
    version: 0,
  });
  await page.addInitScript((value) => {
    window.localStorage.setItem('auth-storage', value);
  }, persisted);
}

function mockSetupAndStats(page: Page): void {
  void page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });
  void page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
    });
  });
}

function mockInteractionGet(page: Page, data: Record<string, unknown>): void {
  void page.route('**/api/v1/oidc/interaction/uid-123', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

test.describe('OIDC consent page + login redirect glue', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = await trackConsoleErrors(page);
    mockSetupAndStats(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('consent renders clientName and scopes from mocked GET', async ({ page }) => {
    await seedSession(page);
    mockInteractionGet(page, INTERACTION);
    await page.goto('/consent?uid=uid-123');
    await expect(page.getByTestId('consent-client-name')).toContainText('Third Party App');
    const scopes = page.getByTestId('consent-scopes');
    await expect(scopes.locator('.ant-checkbox-wrapper')).toHaveCount(3);
    await expect(scopes).toContainText('Verify your identity (openid)');
    await expect(scopes).toContainText('View your basic profile (profile)');
    await expect(scopes).toContainText('View your email address (email)');
    await expect(page.getByTestId('consent-approve')).toBeVisible();
    await expect(page.getByTestId('consent-deny')).toBeVisible();
  });

  test('approve posts {decision:"approve"} and navigates to /oidc/auth/:uid', async ({ page }) => {
    await seedSession(page);
    mockInteractionGet(page, INTERACTION);
    let postedDecision: string | undefined;
    await page.route('**/api/v1/oidc/interaction/uid-123', async (route) => {
      if (route.request().method() === 'POST') {
        postedDecision = route.request().postDataJSON()?.decision;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ok: true } }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: INTERACTION }),
      });
    });
    await page.goto('/consent?uid=uid-123');
    await expect(page.getByTestId('consent-client-name')).toBeVisible();
    await page.getByTestId('consent-approve').click();
    expect(postedDecision).toBe('approve');
    await page.waitForURL('/oidc/auth/uid-123');
  });

  test('deny posts {decision:"deny"}', async ({ page }) => {
    await seedSession(page);
    let postedDecision: string | undefined;
    await page.route('**/api/v1/oidc/interaction/uid-123', async (route) => {
      if (route.request().method() === 'POST') {
        postedDecision = route.request().postDataJSON()?.decision;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ok: true } }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: INTERACTION }),
      });
    });
    await page.goto('/consent?uid=uid-123');
    await expect(page.getByTestId('consent-client-name')).toBeVisible();
    await page.getByTestId('consent-deny').click();
    expect(postedDecision).toBe('deny');
  });

  test('consent without token redirects to login with redirect param', async ({ page }) => {
    await page.goto('/consent?uid=uid-123');
    await page.waitForURL(/\/login\?redirect=/);
    expect(page.url()).toContain(encodeURIComponent('/oidc/auth/uid-123'));
  });

  test('login with valid redirect param navigates there after login', async ({ page }) => {
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 900,
            user: ME,
          },
        }),
      });
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: ME }),
      });
    });
    const redirect = encodeURIComponent('/oidc/auth/xyz');
    await page.goto(`/login?redirect=${redirect}`);
    await page.locator('input[id="email"]').fill('admin@example.com');
    await page.locator('input[id="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('/oidc/auth/xyz');
  });

  test('redirect param not matching /oidc/auth/ is ignored — lands on landingPath', async ({ page }) => {
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 900,
            user: ME,
          },
        }),
      });
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: ME }),
      });
    });
    // stats mock needed — landingPath('/') → dashboard mounts stats
    const redirect = encodeURIComponent('https://evil.example.com/oidc/auth/x');
    await page.goto(`/login?redirect=${redirect}`);
    await page.locator('input[id="email"]').fill('admin@example.com');
    await page.locator('input[id="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('/');
    expect(page.url()).not.toContain('evil.example.com');
  });
});
