import { test, expect, type Page } from '@playwright/test';

const MOCK_ME = {
  id: 'u-1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  isActive: true,
};

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
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill('admin@accessbase.local');
  await page.locator('input#password').fill('AdminPass123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

test.describe('Profile Center', () => {
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
        text.includes('[antd: compatible]') ||
        text.includes('[antd: message]');
      if (!isNoise) consoleErrors.push(text);
    });

    await mockCommonApis(page);
    await login(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('displays current user info', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('.profile-name')).toHaveText('Administrator');
    await expect(page.locator('text=admin@accessbase.local')).toBeVisible();
  });

  test('name edit issues PUT /users/:id and updates display', async ({ page }) => {
    let putBody: Record<string, unknown> | undefined;
    let putHit = false;
    await page.route('**/api/v1/users/u-1', async (route) => {
      const method = route.request().method();
      if (method === 'PUT') {
        putHit = true;
        putBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { ...MOCK_ME, name: putBody.name } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: MOCK_ME }),
        });
      }
    });

    await page.goto('/profile');
    await expect(page.locator('.profile-name')).toHaveText('Administrator');

    await page.locator('.profile-name-edit').click();
    await page.locator('.profile-name-form input').fill(`Renamed-${Date.now()}`);
    await page.locator('.profile-name-save').click();

    await expect.poll(() => putHit).toBe(true);
    expect(putBody?.name).toContain('Renamed-');
  });

  test('change password submits POST and clears form on success', async ({ page }) => {
    let changePwdBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/change-password', async (route) => {
      changePwdBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { accessToken: 'new-a', refreshToken: 'new-r', expiresIn: 900 } }),
      });
    });

    await page.goto('/profile');
    await page.locator('input#oldPassword').fill('OldPass123!');
    await page.locator('input#newPassword').fill('NewStrongPass123!');
    await page.locator('input#confirmPassword').fill('NewStrongPass123!');
    await page.locator('.profile-password-submit').click();

    await expect.poll(() => changePwdBody).toBeDefined();
    expect(changePwdBody?.oldPassword).toBe('OldPass123!');
    expect(changePwdBody?.newPassword).toBe('NewStrongPass123!');
    // Success = form cleared
    await expect(page.locator('input#oldPassword')).toHaveValue('');
  });

  test('backend 400 on change-password surfaces inline error message', async ({ page }) => {
    await page.route('**/api/v1/auth/change-password', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'VALIDATION_001', message: 'newPassword: must contain a special character' },
        }),
      });
    });

    await page.goto('/profile');
    await page.locator('input#oldPassword').fill('OldPass123!');
    await page.locator('input#newPassword').fill('NoSpecial1234');
    await page.locator('input#confirmPassword').fill('NoSpecial1234');
    await page.locator('.profile-password-submit').click();

    const err = page.locator('.profile-pwd-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('special character');
  });

  test('revoke-others button issues POST with current refreshToken', async ({ page }) => {
    let revokeBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/sessions/revoke-others', async (route) => {
      revokeBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/profile');
    await page.locator('.profile-revoke-others').click();
    // Popconfirm confirm
    await page.locator('.ant-popconfirm button:has-text("Confirm"), .ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes"), .ant-popconfirm button:has-text("确认")').first().click();

    await expect.poll(() => revokeBody).toBeDefined();
    expect(revokeBody?.refreshToken).toBe('test-refresh');
  });
});
