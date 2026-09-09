import { test, expect, type Page } from '@playwright/test';

// Mock response shapes copied from apps/server/src/routes/auth.ts:573-745 (MFA endpoints).
// Chinese locale per task ruling: localStorage 'lng' = 'zh' is read by i18n init.

const QR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const MOCK_SETUP_DATA = {
  otpauthUrl: 'otpauth://totp/AccessBase:admin@accessbase.local?secret=JBSWY3DPEHPK3PXP&issuer=AccessBase',
  qrDataUrl: QR_DATA_URL,
  recoveryCodes: ['kx7d-2mp4-qa10', 'zv3c-8hn6-rt92', 'b5qw-jl2f-yx48'],
};

interface MfaState {
  mfaEnabled: boolean;
}

async function mockCommonApis(page: Page, state: MfaState): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('lng', 'zh');
  });

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
          user: { id: 'u-1', email: 'admin@accessbase.local', name: 'Administrator', roles: [{ id: 'role-1', name: 'admin' }], mfaEnabled: state.mfaEnabled },
        },
      }),
    });
  });

  // /auth/me is re-fetched after enable/disable — serve the live mfaEnabled flag
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'u-1', email: 'admin@accessbase.local', name: 'Administrator', roles: [{ id: 'role-1', name: 'admin' }], mfaEnabled: state.mfaEnabled },
      }),
    });
  });

  // Settings page mounts these (empty samples, same boilerplate as ui-quality/settings)
  await page.route('**/api/v1/auth/sessions**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/v1/auth/webauthn/credentials', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
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

async function openSecurityTab(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.locator('.ant-tabs-tab:has-text("安全")').click();
  await expect(page.getByTestId('mfa-card')).toBeVisible();
}

test.describe('Settings TOTP panel (mfa-card)', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('findDOMNode') &&
        !msg.text().includes('chrome-extension') &&
        !msg.text().includes('moz-extension') &&
        !msg.text().includes('ResizeObserver') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('[antd: compatible]') &&
        !msg.text().includes('[antd: message]')
      ) {
        consoleErrors.push(msg.text());
      }
    });
  });

  test.afterEach(async ({}, testInfo) => {
    if (consoleErrors.length > 0) {
      throw new Error(`Console errors in ${testInfo.title}: ${consoleErrors.join(' | ')}`);
    }
  });

  test('full enable flow: QR → verify code → recovery gate → card shows enabled', async ({ page }) => {
    const state: MfaState = { mfaEnabled: false };
    await mockCommonApis(page, state);
    await page.route('**/api/v1/auth/mfa/setup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_SETUP_DATA }),
      });
    });
    await page.route('**/api/v1/auth/mfa/enable', async (route) => {
      const body = route.request().postDataJSON() as { code?: string };
      expect(body.code).toBe('123456');
      state.mfaEnabled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await login(page);
    await openSecurityTab(page);

    // disabled state: description + setup button
    await expect(page.getByText('登录时需要额外输入身份验证器动态码，建议开启以提升账号安全性。', { exact: true })).toBeVisible();
    await page.getByTestId('mfa-setup-btn').click();

    // setup modal: QR image + manual secret + code input
    const modal = page.locator('.ant-modal:has([data-testid="mfa-qr"])');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('mfa-qr')).toHaveAttribute('src', /^data:image\//);
    await expect(modal.getByText(MOCK_SETUP_DATA.otpauthUrl)).toBeVisible();
    await page.getByTestId('mfa-code-input').fill('123456');
    await page.getByTestId('mfa-enable-btn').click();

    // one-time recovery codes modal, gated by the saved checkbox
    const recovery = page.getByTestId('mfa-recovery-modal');
    await expect(recovery).toBeVisible();
    for (const code of MOCK_SETUP_DATA.recoveryCodes) {
      await expect(recovery.getByText(code, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('mfa-recovery-done')).toBeDisabled();
    await page.getByTestId('mfa-saved-confirm').click();
    await expect(page.getByTestId('mfa-recovery-done')).toBeEnabled();
    await page.getByTestId('mfa-recovery-done').click();

    await expect(recovery).toHaveCount(0);
    await expect(page.locator('.ant-message').getByText('双重验证已开启', { exact: true })).toBeVisible();

    // card flips to enabled state with a disable entry
    await expect(page.getByTestId('mfa-enabled-alert')).toBeVisible();
    await expect(page.getByTestId('mfa-disable-btn')).toBeVisible();
    await expect(page.getByTestId('mfa-setup-btn')).toHaveCount(0);
  });

  test('wrong TOTP code shows inline error inside setup modal (AUTH_MFA_003)', async ({ page }) => {
    const state: MfaState = { mfaEnabled: false };
    await mockCommonApis(page, state);
    await page.route('**/api/v1/auth/mfa/setup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_SETUP_DATA }),
      });
    });
    await page.route('**/api/v1/auth/mfa/enable', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'AUTH_MFA_003', message: 'Invalid TOTP code' } }),
      });
    });

    await login(page);
    await openSecurityTab(page);
    await page.getByTestId('mfa-setup-btn').click();
    await page.getByTestId('mfa-code-input').fill('000000');
    await page.getByTestId('mfa-enable-btn').click();

    await expect(page.getByTestId('mfa-enable-error')).toBeVisible();
    await expect(page.getByTestId('mfa-enable-error')).toContainText('Invalid TOTP code');
    await expect(page.getByTestId('mfa-recovery-modal')).toHaveCount(0);
    expect(state.mfaEnabled).toBe(false);
  });

  test('disable flow: password confirm → card back to disabled state', async ({ page }) => {
    const state: MfaState = { mfaEnabled: true };
    await mockCommonApis(page, state);
    let disableBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/mfa/disable', async (route) => {
      disableBody = route.request().postDataJSON() as Record<string, unknown>;
      state.mfaEnabled = false;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await login(page);
    await openSecurityTab(page);
    await expect(page.getByTestId('mfa-enabled-alert')).toBeVisible();
    await page.getByTestId('mfa-disable-btn').click();

    const modal = page.locator('.ant-modal:has([data-testid="mfa-password-input"])');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('请输入当前账号密码以确认关闭。', { exact: true })).toBeVisible();
    await page.getByTestId('mfa-password-input').fill('AdminPass123!');
    await page.getByTestId('mfa-disable-confirm').click();

    expect(disableBody).toEqual({ password: 'AdminPass123!' });
    await expect(page.locator('.ant-message').getByText('双重验证已关闭', { exact: true })).toBeVisible();
    await expect(page.getByTestId('mfa-enabled-alert')).toHaveCount(0);
    await expect(page.getByTestId('mfa-setup-btn')).toBeVisible();
  });
});
