import { test, expect, type Page } from '@playwright/test';

const MOCK_ME = {
  id: 'u-1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  isActive: true,
};

const MOCK_SESSIONS = [
  { id: 's-1', userAgent: 'Chrome/macOS', ip: '10.0.0.2', createdAt: '2026-08-30T10:00:00Z', expiresAt: '2026-09-06T10:00:00Z' },
  { id: 's-2', userAgent: 'Firefox/Linux', ip: '10.0.0.3', createdAt: '2026-08-31T08:00:00Z', expiresAt: '2026-09-07T08:00:00Z' },
];

const MOCK_PASSKEYS = [
  { id: 'pk-1', transports: ['internal', 'hybrid'], createdAt: '2026-08-30T10:00:00Z', lastUsedAt: '2026-08-31T09:00:00Z' },
];

/** Mocks every endpoint the layout + Settings page touches (mock-API default per testing.md). */
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

  await page.route('**/api/v1/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_ME }),
    });
  });

  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_ME }),
    });
  });

  // Settings page mounts fetch these two (PIT: any new endpoint called by an
  // existing page must be mocked in older specs — see profile.spec lesson)
  await page.route('**/api/v1/auth/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_SESSIONS }),
    });
  });

  await page.route('**/api/v1/auth/webauthn/credentials', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_PASSKEYS }),
    });
  });

  // Layout is also reachable via /profile links; keep passthrough mocks safe
  await page.route('**/api/v1/auth/oauth/links', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill('admin@accessbase.local');
  await page.locator('input#password').fill('AdminPass123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

async function gotoSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.locator('.ant-tabs')).toBeVisible();
}

test.describe('Settings page', () => {
  test('renders General and Security tabs', async ({ page }) => {
    await mockCommonApis(page);
    await login(page);
    await gotoSettings(page);

    await expect(page.locator('.ant-tabs-tab:has-text("General")')).toBeVisible();
    await expect(page.locator('.ant-tabs-tab:has-text("Security")')).toBeVisible();
    // General tab active by default
    await expect(page.locator('[data-testid="general-settings"]')).toBeVisible();
  });

  test('Security tab lists mocked sessions and passkeys', async ({ page }) => {
    await mockCommonApis(page);
    await login(page);
    await gotoSettings(page);

    await page.locator('.ant-tabs-tab:has-text("Security")').click();
    await expect(page.locator('[data-testid="active-sessions"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-s-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-s-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="passkeys"]')).toBeVisible();
    await expect(page.locator('[data-testid="passkey-pk-1"]')).toBeVisible();
    // no console errors so far
  });

  test('revoke button issues POST /auth/sessions/revoke and removes the row', async ({ page }) => {
    await mockCommonApis(page);
    let revokeBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/sessions/revoke', async (route) => {
      revokeBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await login(page);
    await gotoSettings(page);

    await page.locator('.ant-tabs-tab:has-text("Security")').click();
    await page.locator('[data-testid="revoke-session-s-1"]').click();
    // confirm popover
    await page.locator('.ant-popconfirm .ant-btn-primary').click();

    await expect(page.locator('[data-testid="session-s-1"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="session-s-2"]')).toBeVisible();
    expect(revokeBody).toEqual({ sessionId: 's-1' });
  });

  test('delete passkey issues DELETE /auth/webauthn/credentials/:id and removes the row', async ({ page }) => {
    await mockCommonApis(page);
    let deleteHit = false;
    await page.route('**/api/v1/auth/webauthn/credentials/pk-1', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteHit = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: MOCK_PASSKEYS }),
        });
      }
    });
    await login(page);
    await gotoSettings(page);

    await page.locator('.ant-tabs-tab:has-text("Security")').click();
    await page.locator('[data-testid="delete-passkey-pk-1"]').click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();

    await expect(page.locator('[data-testid="passkey-pk-1"]')).toHaveCount(0);
    expect(deleteHit).toBe(true);
  });

  test('General tab save shows success alert (localStorage persist)', async ({ page }) => {
    await mockCommonApis(page);
    await login(page);
    await gotoSettings(page);

    await page.locator('[data-testid="general-settings"] input').first().fill('My AccessBase');
    await page.locator('[data-testid="save-site-settings"]').click();

    await expect(page.locator('[data-testid="site-save-success"]')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('accessbase.site-settings'));
    expect(stored).toContain('My AccessBase');
  });

  test('passkey login button surfaces inline error on failure (PIT-023)', async ({ page }) => {
    await mockCommonApis(page);
    // login/options fails → inline error Alert (browser WebAuthn ceremony NOT exercised)
    await page.route('**/api/v1/auth/webauthn/login/options', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'AUTH_WEBAUTHN_004', message: 'not available' } }),
      });
    });
    await page.goto('/login');
    await page.locator('[data-testid="passkey-login"]').click();
    await expect(page.locator('[data-testid="passkey-error"]')).toBeVisible();
  });

  test.afterEach(async ({ page }, testInfo) => {
    // testing.md: console listener per spec — 0 application errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('findDOMNode') &&
        !msg.text().includes('chrome-extension') &&
        !msg.text().includes('moz-extension') &&
        !msg.text().includes('ResizeObserver')
      ) {
        errors.push(msg.text());
      }
    });
    if (errors.length > 0) {
      throw new Error(`Console errors in ${testInfo.title}: ${errors.join(' | ')}`);
    }
  });
});
