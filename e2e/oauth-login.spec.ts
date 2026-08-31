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

  await page.route('**/api/v1/auth/me', async (route) => {
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

test.describe('OAuth login flow', () => {
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
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('login page shows GitHub and Google provider buttons', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-testid="oauth-github"]')).toBeVisible();
    await expect(page.locator('[data-testid="oauth-google"]')).toBeVisible();
    await expect(page.locator('[data-testid="oauth-divider"]')).toBeVisible();
  });

  test('clicking GitHub navigates browser to authorize URL', async ({ page }) => {
    let authorizeHit = false;
    await page.route('**/api/v1/auth/oauth/github/authorize*', async (route) => {
      authorizeHit = true;
      await route.fulfill({
        status: 302,
        headers: { location: 'https://github.com/login/oauth/authorize?state=test' },
      });
    });
    await page.goto('/login');
    await expect(page.locator('[data-testid="oauth-github"]')).toBeVisible();
    // Fulfill the follow-up external navigation so the test never hits real github.com
    await page.route('**github.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>gh</body></html>' });
    });
    await page.click('[data-testid="oauth-github"]');
    // The document request to the authorize endpoint proves the click wired up
    await expect.poll(() => authorizeHit, { timeout: 10000 }).toBe(true);
  });

  test('oauthCode in URL triggers exchange and redirects to dashboard', async ({ page }) => {
    let exchangeBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/auth/oauth/exchange', async (route) => {
      exchangeBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: 'oauth-access',
            refreshToken: 'oauth-refresh',
            expiresIn: 900,
            user: { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: ['admin'] },
          },
        }),
      });
    });

    await page.goto('/login?oauthCode=one-time-code');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    expect(exchangeBody?.code).toBe('one-time-code');
  });

  test('oauthError=state_mismatch shows inline Alert', async ({ page }) => {
    await page.goto('/login?oauthError=state_mismatch');
    const alert = page.locator('[data-testid="oauth-error"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('state_mismatch');
    // params cleaned up
    await expect(page).not.toHaveURL(/oauthError=/);
  });
});

test.describe('Profile linked accounts', () => {
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
    await page.route('**/api/v1/auth/oauth/links', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ provider: 'github', providerAccountId: '4242' }],
        }),
      });
    });
    await page.route('**/api/v1/auth/oauth/github', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      } else {
        await route.continue();
      }
    });
    await login(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('linked accounts card lists github link and unlink removes it', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('[data-testid="linked-accounts"]')).toBeVisible();
    await expect(page.locator('[data-testid="oauth-unlink-github"]')).toBeVisible();
    await expect(page.locator('text=4242')).toBeVisible();

    await page.locator('[data-testid="oauth-unlink-github"]').click();
    await page.locator('.ant-popconfirm button:has-text("Confirm"), .ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes"), .ant-popconfirm button:has-text("确认")').first().click();
    await expect(page.locator('[data-testid="oauth-unlink-github"]')).not.toBeVisible();
  });
});
