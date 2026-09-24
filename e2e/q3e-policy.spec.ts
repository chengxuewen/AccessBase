import { test, expect, type Page } from '@playwright/test';

async function shell(page: Page, captchaOn = false) {
  await page.route('**/api/v1/setup/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) }),
  );
  await page.route('**/api/v1/auth/oauth/providers', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { providers: [] } }) }),
  );
  await page.route('**/api/v1/auth/saml/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) }),
  );
  await page.route('**/api/v1/auth/sms/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) }),
  );
  await page.route('**/api/v1/auth/captcha/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: captchaOn } }) }),
  );
}

test.describe('Q3E policy surface', () => {
  test('captcha OFF hides the widget on register', async ({ page }) => {
    await shell(page, false);
    await page.goto('/register');
    await expect(page.getByTestId('captcha-field')).toHaveCount(0);
  });

  test('captcha ON shows the widget and its fields ride the POST', async ({ page }) => {
    await shell(page, true);
    await page.route('**/api/v1/auth/captcha', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'cap-1', svg: '<svg data-testid="inline-svg" width="10" height="10"><text>AB12</text></svg>' } }) }),
    );
    let captured: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/register', (r) => {
      captured = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'u', email: 'n@t.local', name: 'N', status: 'pending' } }) });
    });
    await page.goto('/register');
    await expect(page.getByTestId('captcha-field')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('register-name').fill('N');
    await page.getByTestId('register-email').fill('n@t.local');
    await page.getByTestId('register-password').fill('Abcdef12!');
    await page.getByTestId('register-confirm').fill('Abcdef12!');
    await page.getByTestId('captcha-answer').fill('ab12');
    await page.getByTestId('register-submit').click();
    await expect.poll(() => captured).toEqual(
      expect.objectContaining({ captchaId: 'cap-1', captchaAnswer: 'ab12' }),
    );
  });

  test('enroll arm hands off to the wizard and the pair completes the session', async ({ page }) => {
    await shell(page);
    await page.route('**/api/v1/auth/login', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { mfaRequired: true, enroll: true, flowToken: 'enroll-tok-1' } }) }),
    );
    let setupBody: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/mfa/setup', (r) => {
      setupBody = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { secret: 'S', otpauthUrl: 'otpauth://t/x', qrDataUrl: 'data:image/png;base64,AAA', recoveryCodes: ['r1', 'r2'], flowToken: 'enroll-tok-2' } }) });
    });
    let enableBody: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/mfa/enable', (r) => {
      enableBody = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { accessToken: 'at', refreshToken: 'rt' } }) });
    });
    await page.route('**/api/v1/auth/me', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'u1', email: 'a@b.c', name: 'A', roles: [], permissions: ['users:read'], mfaEnabled: true, emailVerified: true, tenantId: 't1', tenantIsDefault: true } }) }),
    );
    await page.goto('/login');
    await page.locator('input#email').fill('enroll@test.local');
    await page.locator('input#password').fill('x');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/enroll-mfa/, { timeout: 10000 });
    await expect(page.getByTestId('enroll-qr')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => setupBody).toEqual({ flowToken: 'enroll-tok-1' });
    await page.getByTestId('enroll-code').fill('123456');
    await page.getByTestId('enroll-confirm').click();
    await expect.poll(() => enableBody).toEqual({ code: '123456', flowToken: 'enroll-tok-2' });
    await expect(page).toHaveURL(/\/users|\/dashboard|\/profile/, { timeout: 10000 });
  });
});
