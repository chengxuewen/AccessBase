import { test, expect, type Page } from '@playwright/test';

/**
 * Batch F Task 4: SAML sign-in button + exchange wiring + magic link UI.
 * Mock-API specs — response shapes copied verbatim from the real handlers:
 *   apps/server/src/routes/saml.ts (status/exchange)
 *   apps/server/src/routes/auth.ts (magic/request)
 *
 * Strict gate (addendum): the SAML button renders ONLY when /saml/status
 * reports { enabled: true } — no fallback semantics.
 */

const MOCK_ME = { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: [] };

async function mockInitialized(page: Page): Promise<void> {
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });
  // Login page mounts fetchUser-ish calls only when a session exists; /auth/me
  // is mocked defensively for the dashboard landing after exchange.
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_ME }),
    });
  });
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
    });
  });
  // SAML disabled by default — each test overrides via mockSamlStatus.
  await page.route('**/api/v1/auth/saml/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { enabled: false } }),
    });
  await page.route('**/api/v1/auth/sms/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
  });
}

async function mockSamlStatus(page: Page, enabled: boolean): Promise<void> {
  await page.route('**/api/v1/auth/saml/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { enabled } }),
    });
  });
}

test.describe('SAML login flow', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const isNoise =
        text.includes('findDOMNode') ||
        text.includes('chrome-extension') ||
        text.includes('moz-extension') ||
        text.includes('ResizeObserver') ||
        text.includes('Failed to load resource') ||
        text.includes('[antd: compatible]');
      if (!isNoise) consoleErrors.push(text);
    });
    await mockInitialized(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('status disabled → SAML button hidden (strict gate, no fallback)', async ({ page }) => {
    await mockSamlStatus(page, false);
    await page.goto('/login');
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.getByTestId('saml-login')).toHaveCount(0);
  });

  test('status enabled → SAML button visible with anchor href to /saml/login', async ({ page }) => {
    await mockSamlStatus(page, true);
    await page.goto('/login');
    const btn = page.getByTestId('saml-login');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', '/api/v1/auth/saml/login');
  });

  test('samlCode + exchange token-pair mock → dashboard', async ({ page }) => {
    await mockSamlStatus(page, false);
    await page.route('**/api/v1/auth/saml/exchange', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Real shape (routes/saml.ts token-pair arm)
        body: JSON.stringify({ success: true, data: { accessToken: 'tok-s', refreshToken: 'r-s', expiresIn: 900, user: MOCK_ME } }),
      });
    });

    await page.goto('/login?samlCode=e2e-code');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    const stored = await page.evaluate(() => localStorage.getItem('auth-storage'));
    expect(stored).toContain('tok-s');
  });

  test('samlCode + exchange mfaRequired mock → TOTP form, session hygiene', async ({ page }) => {
    await mockSamlStatus(page, false);
    // Pre-seed a stale persisted session — the MFA branch must wipe it (R4 fix at birth).
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { token: 'stale', refreshToken: 'stale-r', user: MOCK_ME, isAuthenticated: true },
          version: 0,
        }),
      );
    });
    await page.route('**/api/v1/auth/saml/exchange', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Real shape (routes/saml.ts mfa arm)
        body: JSON.stringify({ success: true, data: { mfaRequired: true, flowToken: 'saml-flow-1' } }),
      });
    });

    await page.goto('/login?samlCode=e2e-code-mfa');
    const codeInput = page.locator('[data-testid="mfa-code-input"], input#code, input[name="code"]').first();
    await expect(codeInput).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
    // Hygiene + persist exclusion: wiped session tokens AND the flow token must
    // never persist — mfaFlowToken is in-memory only (partialize omits it).
    const stored = await page.evaluate(() => localStorage.getItem('auth-storage'));
    expect(stored).not.toContain('stale');
    expect(stored).not.toContain('saml-flow-1');
  });

  test('samlError=AUTH_SAML_002 → inline Alert', async ({ page }) => {
    await mockSamlStatus(page, false);
    await page.goto('/login?samlError=AUTH_SAML_002');
    const alert = page.getByTestId('saml-error');
    await expect(alert).toBeVisible();
    // Param must be cleared after read
    await expect(page).not.toHaveURL(/samlError=/);
  });

  test('magic trigger → email form → 202 mock → server message shown', async ({ page }) => {
    let reqBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/magic/request', async (route) => {
      reqBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        // Real shape (routes/auth.ts): enumeration-safe constant message
        body: JSON.stringify({ success: true, data: { message: 'If an account exists, a sign-in link has been sent.' } }),
      });
    });

    await page.goto('/login');
    await page.getByTestId('magic-trigger').click();
    await page.getByTestId('magic-email-input').fill('magic@accessbase.local');
    await page.getByTestId('magic-submit').click();

    await expect.poll(() => reqBody, { timeout: 10000 }).toEqual({ email: 'magic@accessbase.local' });
    await expect(page.getByTestId('magic-success')).toBeVisible();
    await expect(page.getByTestId('magic-success')).toContainText('If an account exists, a sign-in link has been sent.');
  });
});
