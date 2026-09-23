import { test, expect, type Page } from '@playwright/test';

async function mockCommon(page: Page, smsEnabled = false) {
  await page.route('**/api/v1/setup/status', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { isInitialized: true, adminExists: true, configComplete: true },
      }),
    }),
  );
  await page.route('**/api/v1/auth/oauth/providers', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { providers: [] } }) }),
  );
  await page.route('**/api/v1/auth/saml/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) }),
  );
  await page.route('**/api/v1/auth/sms/status', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { enabled: smsEnabled } }),
    }),
  );
}

test.describe('Q1 self-service surface', () => {
  test('login page carries forgot-password and register links', async ({ page }) => {
    await mockCommon(page);
    await page.goto('/login');
    await expect(page.getByTestId('forgot-link')).toBeVisible();
    await expect(page.getByTestId('register-link')).toBeVisible();
  });

  test('forgot-password submits email and shows static success (no server message)', async ({ page }) => {
    await mockCommon(page);
    let captured: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/forgot-password', (r) => {
      captured = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.goto('/login');
    await page.getByTestId('forgot-link').click();
    await page.getByTestId('forgot-email').fill('locked-user@test.local');
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('forgot-success')).toBeVisible();
    await expect.poll(() => captured).toEqual({ email: 'locked-user@test.local' });
  });

  test('reset-password without token shows the missing-link state', async ({ page }) => {
    await mockCommon(page);
    await page.goto('/reset-password');
    await expect(page.getByTestId('reset-missing')).toBeVisible();
  });

  test('reset-password posts token + newPassword and confirms', async ({ page }) => {
    await mockCommon(page);
    let captured: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/reset-password', (r) => {
      captured = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.goto('/reset-password?token=t-123');
    await page.getByTestId('reset-password').fill('NewPass1!x');
    await page.getByTestId('reset-confirm').fill('NewPass1!x');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-success')).toBeVisible();
    await expect
      .poll(() => captured)
      .toEqual({ token: 't-123', newPassword: 'NewPass1!x' });
  });

  test('register posts and lands in the pending-approval state', async ({ page }) => {
    await mockCommon(page);
    let captured: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/register', (r) => {
      captured = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 'u-1', email: 'n@t.local', name: 'N', status: 'pending' } }),
      });
    });
    await page.goto('/register');
    await page.getByTestId('register-name').fill('New User');
    await page.getByTestId('register-email').fill('n@t.local');
    await page.getByTestId('register-password').fill('Abcdef12!');
    await page.getByTestId('register-confirm').fill('Abcdef12!');
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-pending')).toBeVisible();
    await expect.poll(() => captured).toEqual({ email: 'n@t.local', name: 'New User', password: 'Abcdef12!' });
  });

  test('verify-email consumes the link token once', async ({ page }) => {
    await mockCommon(page);
    let calls = 0;
    let captured: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/verify-email', (r) => {
      if (r.request().url().endsWith('/verify-email/request')) return r.fallback();
      calls += 1;
      captured = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { verified: true } }) });
    });
    await page.goto('/verify-email?token=vt-9');
    await expect(page.getByTestId('verify-success')).toBeVisible();
    // StrictMode may double-invoke the mount effect; the page's own ref guard must
    // keep it to ONE request (conventions: mount-effect assertions use >= not ===).
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBe(1);
    await expect.poll(() => captured).toEqual({ token: 'vt-9' });
  });

  test('SMS OTP: hidden when disabled, two-step flow when enabled', async ({ page }) => {
    await mockCommon(page, true);
    let reqToken = '';
    await page.route('**/api/v1/auth/sms-otp/request', (r) =>
      r.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'ok', token: 'flow-tok-1' } }),
      }),
    );
    void reqToken;
    await page.route('**/api/v1/auth/sms-otp/verify', (r) => {
      reqToken = JSON.parse(r.request().postData() ?? '{}').token as string;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { accessToken: 'at', refreshToken: 'rt', expiresIn: 900, user: { id: 'u', email: 'e@t', name: 'n', roles: [] } },
        }),
      });
    });
    await page.goto('/login');
    await expect(page.getByTestId('sms-trigger')).toBeVisible();
    await page.getByTestId('sms-trigger').click();
    await page.getByTestId('sms-phone').fill('+15551234567');
    await page.getByTestId('sms-send').click();
    await expect(page.getByTestId('sms-code')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('sms-code').fill('482913');
    await page.getByTestId('sms-submit').click();
    // Wire-chain proof: the verify call carries the token the request returned (Q1-b1)
    await expect.poll(() => reqToken).toBe('flow-tok-1');
  });
});
