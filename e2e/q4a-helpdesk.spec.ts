import { test, expect, type Page } from '@playwright/test';

const UID = '550e8400-e29b-41d4-a716-446655440001';

async function adminSession(page: Page) {
  await page.route('**/api/v1/setup/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) }),
  );
  await page.route('**/api/v1/auth/login', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { accessToken: 'at', refreshToken: 'rt', expiresIn: 900, user: { id: 'a', email: 'admin@x.local', name: 'A', roles: [] } } }) }),
  );
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'a', email: 'admin@x.local', name: 'Admin', roles: [{ id: 'r1', name: 'admin' }],
          permissions: ['users:read', 'users:write', 'users:delete', 'roles:read', 'stats:read', 'audit:read'],
          mfaEnabled: false, emailVerified: true, tenantId: 't1', tenantIsDefault: true,
        },
      }),
    }),
  );
}

test.describe('Q4a helpdesk surface', () => {
  test('force-change round trip: login handoff → reset page → back to login', async ({ page }) => {
    await page.route('**/api/v1/auth/oauth/providers', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { providers: [] } }) }));
    await page.route('**/api/v1/auth/saml/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) }));
    await page.route('**/api/v1/auth/sms/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) }));
    await page.route('**/api/v1/auth/captcha/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) }));
    await page.route('**/api/v1/setup/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) }));
    let resetBody: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/reset-password', (r) => {
      resetBody = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.route('**/api/v1/auth/login', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { passwordChangeRequired: true, flowToken: 'ft-force-1' } }) }),
    );
    await page.goto('/login');
    await page.locator('input#email').fill('armed@test.local');
    await page.locator('input#password').fill('Anything-123');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/reset-password\?token=ft-force-1&mode=force/, { timeout: 10000 });
    await page.getByTestId('reset-password').fill('FreshPass-123');
    await page.getByTestId('reset-confirm').fill('FreshPass-123');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-success')).toBeVisible();
    await expect.poll(() => resetBody).toEqual({ token: 'ft-force-1', newPassword: 'FreshPass-123' });
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 }); // B6 auto-return
  });

  test('UserDetail: admin reset (dialog) + invite hit their endpoints', async ({ page }) => {
    await adminSession(page);
    await page.route(`**/api/v1/users/${UID}`, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: UID, email: 't@x.local', name: 'T', isActive: true, status: 'active', roleIds: [] } }),
      }),
    );
    await page.route('**/api/v1/roles*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], total: 0 }) }),
    );
    let resetPayload: Record<string, unknown> | null = null;
    await page.route(`**/api/v1/users/${UID}/reset-password`, (r) => {
      resetPayload = JSON.parse(r.request().postData() ?? '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    let invited = false;
    await page.route(`**/api/v1/users/${UID}/invite`, (r) => {
      invited = true;
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ success: true, data: { message: 'sent' } }) });
    });
    await page.goto('/login');
    await page.locator('input#email').fill('admin@x.local');
    await page.locator('input#password').fill('Admin-123');
    await page.locator('button[type="submit"]').click();
    await page.goto(`/users/${UID}`);
    await expect(page.getByTestId('user-admin-reset')).toBeVisible({ timeout: 10000 });
    page.once('dialog', (d) => void d.accept('TempPass-123'));
    await page.getByTestId('user-admin-reset').click();
    await expect.poll(() => resetPayload).toEqual({ newPassword: 'TempPass-123' });
    await page.getByTestId('user-invite').click();
    await expect.poll(() => invited).toBe(true);
  });
});
