/**
 * Branding slice (Q4 proposal #5 minimal): site.logo_url + site.primary_color
 * from the options table, read via the public /setup/status probe.
 * B1: configured logo + color render on Login. B2: unset → built-in chrome.
 */
import { test, expect } from '@playwright/test';

const MOCK_ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  roles: [{ id: 'role-1', name: 'admin' }],
};

function mockShell(page: import('@playwright/test').Page, branding: Record<string, string>) {
  void page.route('**/api/v1/setup/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          isInitialized: true,
          adminExists: true,
          configComplete: true,
          siteName: 'Acme',
          ...branding,
        },
      }),
    }),
  );
  void page.route('**/api/v1/auth/sms/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { enabled: false } }),
    }),
  );
  void page.route('**/api/v1/auth/saml/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { enabled: false } }),
    }),
  );
  void page.route('**/api/v1/auth/captcha', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { enabled: false } }),
    }),
  );
  void page.route('**/api/v1/auth/captcha/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { enabled: false } }),
    }),
  );
  void page.route('**/api/v1/auth/oauth/providers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );
  void page.route('**/api/v1/auth/oauth/links**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );
}

test.describe('branding slice', () => {
  let consoleErrors: string[];
  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !/findDOMNode|chrome-extension|moz-extension|ResizeObserver/.test(msg.text())
      ) {
        consoleErrors.push(msg.text());
      }
    });
  });

  test('B1: configured logo renders above the login card', async ({ page }) => {
    // 1x1 transparent png as data URL — no external fetch (logo <img> loads for real)
    const PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    mockShell(page, { logoUrl: PNG, primaryColor: '#ff4400' });
    await page.route('**/api/v1/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_ME }),
      }),
    );
    await page.goto('/login');
    await expect(page.getByTestId('branding-logo')).toBeVisible();
    await expect(page.getByTestId('branding-logo')).toHaveAttribute('src', /data:image\/png/);
    expect(consoleErrors).toEqual([]);
  });

  test('B3: forgot-password page renders the configured logo (self-service reach)', async ({
    page,
  }) => {
    // 1x1 transparent png data URL (no external fetch)
    const PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    mockShell(page, { logoUrl: PNG, primaryColor: '#ff4400' });
    await page.goto('/forgot-password');
    await expect(page.getByTestId('branding-logo')).toBeVisible();
    await expect(page.getByTestId('branding-logo')).toHaveAttribute('src', /data:image\/png/);
    expect(consoleErrors).toEqual([]);
  });

  test('B2: no branding configured → built-in chrome, zero console errors', async ({ page }) => {
    mockShell(page, {});
    await page.route('**/api/v1/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_ME }),
      }),
    );
    await page.goto('/login');
    await expect(page.locator('[data-testid="branding-logo"]')).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });
});
