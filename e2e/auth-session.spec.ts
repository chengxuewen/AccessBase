import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Phase 0 RED regression net (2026-09-03-admin-ui-fix-plan §0.2).
 * Covers A1/A3/A4/A5/B2/B3 — refresh interceptor, MFA step-up, token adoption
 * after change-password, single-flight refresh, logout server call, fetchUser
 * error tolerance. Every test encodes the CORRECT behavior and is marked
 * test.fail() until its Phase 1/2 fix task lands (removing the annotation and
 * passing is the fix's acceptance criterion).
 *
 * Mock response shapes are copied verbatim from the real handlers:
 *   apps/server/src/routes/auth.ts (login/me/refresh/change-password/logout/mfa/verify)
 *   apps/server/src/routes/oauth.ts (oauth/exchange)
 */

// /auth/me returns the envelope {success,data:{id,email,name,roles:[{id,name}]}} (T2-4 contract)
const MOCK_ME_USER = { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: [] };
const MOCK_USER_ROW = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  isActive: true,
  tenantId: 't1',
  tokenVersion: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const UNAUTHORIZED_401 = { success: false, error: { code: 'AUTH_001', message: 'token expired' } };

/** Console error gate — same filter set as users-crud/profile specs */
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
      text.includes('Failed to load resource') ||
      text.includes('[antd: compatible]') ||
      text.includes('[antd: message]');
    if (!isNoise) errors.push(text);
  });
  return errors;
}

async function mockInitialized(page: Page): Promise<void> {
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });
}

async function mockStats(page: Page): Promise<void> {
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
    });
  });
}

/**
 * Seed a persisted session the way the zustand auth store writes it
 * (persist key 'auth-storage' — apps/admin-ui/src/stores/auth.ts:96).
 */
async function seedSession(page: Page, token: string, refreshToken: string): Promise<void> {
  const persisted = JSON.stringify({
    state: { token, refreshToken, user: MOCK_ME_USER, isAuthenticated: true },
    version: 0,
  });
  await page.addInitScript((value) => {
    window.localStorage.setItem('auth-storage', value);
  }, persisted);
}

const menuUsersSelector = '.ant-menu li:has-text("Users"), .ant-menu li:has-text("用户")';

test.describe('Auth session lifecycle (RED regression net)', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await mockInitialized(page);
    await mockStats(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('R1: 401 refresh adopts the envelope token and the retry carries it — session survives', async ({ page }) => {
    await seedSession(page, 'stale-token', 'refresh-1');

    let refreshCalls = 0;
    let refreshBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/refresh', async (route) => {
      refreshCalls++;
      refreshBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Real shape (routes/auth.ts:374-377): envelope {success, data:{accessToken,refreshToken,expiresIn}}
        body: JSON.stringify({ success: true, data: { accessToken: 't2', refreshToken: 'r2', expiresIn: 900 } }),
      });
    });

    const usersAuthHeaders: string[] = [];
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const auth = route.request().headers()['authorization'] ?? '';
      usersAuthHeaders.push(auth);
      if (auth === 'Bearer t2') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [MOCK_USER_ROW], total: 1 }),
        });
        return;
      }
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(UNAUTHORIZED_401) });
    });

    await page.goto('/users');

    // Refresh must fire, then the retried business request must carry the NEW token
    await expect.poll(() => refreshCalls, { timeout: 10000 }).toBeGreaterThan(0);
    expect(refreshBody).toEqual({ refreshToken: 'refresh-1' });
    await expect
      .poll(() => usersAuthHeaders.includes('Bearer t2'), { timeout: 10000 })
      .toBe(true);
    // ...and the user must NOT have been logged out of the protected page
    await expect(page).toHaveURL(/\/users/);
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
  });

  test('R2: three concurrent 401s trigger exactly ONE /auth/refresh (single-flight)', async ({ page }) => {
    await seedSession(page, 'stale-token', 'refresh-1');

    const hold = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let refreshCalls = 0;
    await page.route('**/api/v1/auth/refresh', async (route) => {
      refreshCalls++;
      await hold(2000); // hold the refresh open so later 401s must join it, not start their own
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { accessToken: 't2', refreshToken: 'r2', expiresIn: 900 } }),
      });
    });

    const denyThenServe = async (route: Route, data: unknown[]) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const auth = route.request().headers()['authorization'] ?? '';
      if (auth === 'Bearer t2') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data, total: data.length }),
        });
        return;
      }
      await hold(600); // stagger the 401s into a tight burst
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(UNAUTHORIZED_401) });
    };

    // Settings mounts TWO concurrent requests (sessions + passkeys)...
    await page.route('**/api/v1/auth/sessions', (route) => denyThenServe(route, []));
    await page.route('**/api/v1/auth/webauthn/credentials', (route) => denyThenServe(route, []));
    // ...the SPA navigation below adds a THIRD concurrent one (users list)
    await page.route('**/api/v1/users**', (route) => denyThenServe(route, [MOCK_USER_ROW]));

    await page.goto('/settings');
    // SPA-internal navigation: keeps the two in-flight 401s alive and fires request #3
    await page.locator(menuUsersSelector).first().click();
    await expect(page).toHaveURL(/\/users/);

    await page.waitForTimeout(5000); // let every interceptor settle
    expect(refreshCalls, `expected single-flight refresh, observed ${refreshCalls} refresh calls`).toBe(1);
  });

  test('R3: change-password adopts the returned token pair — later requests use the NEW access token', async ({ page }) => {
    await seedSession(page, 'old-token', 'old-refresh');

    await page.route('**/api/v1/users/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_USER_ROW }),
      });
    });
    await page.route('**/api/v1/auth/oauth/links', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });
    await page.route('**/api/v1/auth/change-password', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Real shape (routes/auth.ts:436): the server revokes ALL sessions and hands this
        // client a fresh pair — the app must store it.
        body: JSON.stringify({ success: true, data: { accessToken: 'new-a', refreshToken: 'new-r', expiresIn: 900 } }),
      });
    });
    // All pre-change sessions are gone server-side: refreshing with the old pair fails.
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'AUTH_003', message: 'Invalid refresh token' } }) });
    });

    const usersAuthHeaders: string[] = [];
    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const auth = route.request().headers()['authorization'] ?? '';
      usersAuthHeaders.push(auth);
      if (auth === 'Bearer new-a') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [MOCK_USER_ROW], total: 1 }),
        });
        return;
      }
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(UNAUTHORIZED_401) });
    });

    await page.goto('/profile');
    await page.locator('input#oldPassword').fill('OldPass123!');
    await page.locator('input#newPassword').fill('NewStrongPass123!');
    await page.locator('input#confirmPassword').fill('NewStrongPass123!');
    await page.locator('.profile-password-submit').click();
    await expect(page.locator('input#oldPassword')).toHaveValue(''); // success = form cleared

    // SPA-navigate to a business page — its request must carry the NEW token
    await page.locator(menuUsersSelector).first().click();
    await expect
      .poll(() => usersAuthHeaders.includes('Bearer new-a'), { timeout: 10000 })
      .toBe(true);
    await expect(page).toHaveURL(/\/users/); // never logged out
  });

  test('R4: logout notifies the server with POST /auth/logout carrying the refreshToken', async ({ page }) => {
    await seedSession(page, 'test-token', 'test-refresh');

    let logoutBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/logout', async (route) => {
      logoutBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.goto('/dashboard');
    const trigger = page.getByTestId('user-dropdown');
    await expect(trigger).toBeVisible();
    await trigger.hover();
    await page.locator('.ant-dropdown-menu li:has-text("Logout"), .ant-dropdown-menu li:has-text("退出登录")').first().click();
    await expect(page).toHaveURL(/\/login/);

    // The server MUST have been told to revoke the DB session (routes/auth.ts:244-268)
    expect(logoutBody, 'logout() never called POST /auth/logout — session left alive server-side').toBeDefined();
    expect(logoutBody).toEqual({ refreshToken: 'test-refresh' });
  });

  test('R5: a 500 from /auth/me during session boot keeps the session and shows an error, no forced logout', async ({ page }) => {
    // Drive fetchUser through the OAuth-exchange path (the only mount-time caller without a
    // browser ceremony): exchange succeeds → /auth/me 500 → store must keep the session.
    await page.route('**/api/v1/auth/oauth/exchange', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Real shape (routes/oauth.ts:327-335)
        body: JSON.stringify({ success: true, data: { accessToken: 'tok-a', refreshToken: 'tok-r', expiresIn: 900, user: { id: '1', email: 'admin@accessbase.local' } } }),
      });
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'transient failure' } }) });
    });

    await page.goto('/login?oauthCode=e2e-transient-code');

    // Correct behavior (T1-5): transient /auth/me failure → stay logged in, show retryable error
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    const stored = await page.evaluate(() => localStorage.getItem('auth-storage'));
    expect(stored, 'session must survive a 500 from /auth/me').toContain('tok-a');
    await expect(page.locator('.ant-alert-error')).toBeVisible();
  });

  test('R6: login with mfaRequired shows the TOTP step and /mfa/verify completes the session', async ({ page }) => {
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Real shape (routes/auth.ts:141-144): no tokens, step-up challenge instead
        body: JSON.stringify({ success: true, data: { mfaRequired: true, flowToken: 'flow-1' } }),
      });
    });
    let verifyBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/mfa/verify', async (route) => {
      verifyBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Real shape (routes/auth.ts:664-667)
        body: JSON.stringify({ success: true, data: { accessToken: 't-mfa', refreshToken: 'r-mfa', expiresIn: 900 } }),
      });
    });

    await page.goto('/login');
    await page.locator('input#email').fill('admin@accessbase.local');
    await page.locator('input#password').fill('AdminPass123!');
    await page.locator('button[type="submit"]').click();

    // Step-up UI must appear and the user must stay on /login (no session yet)
    const codeInput = page.locator('[data-testid="mfa-code-input"], input#code, input[name="code"]').first();
    await expect(codeInput).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);

    await codeInput.fill('123456');
    await page.keyboard.press('Enter');

    await expect
      .poll(() => verifyBody, { timeout: 10000 })
      .toEqual({ flowToken: 'flow-1', code: '123456' });
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });
});
