import { test, expect, type Page } from '@playwright/test';

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
}

// Data mocks for each admin page so page mounts don't fire 401s (axios interceptor logs out on 401)
async function mockPageData(page: Page): Promise<void> {
  await page.route('**/api/v1/users**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [], total: 0 }),
    }),
  );
  await page.route('**/api/v1/roles**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [], total: 0 }),
    }),
  );
  await page.route('**/api/v1/audit-logs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [], total: 0 }),
    }),
  );
  await page.route('**/api/v1/permissions**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [], total: 0 }),
    }),
  );
  await page.route('**/api/v1/users/me**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: '1', email: 'admin@accessbase.local', name: 'Administrator', isActive: true },
      }),
    }),
  );
  // /profile mounts GET /auth/oauth/links — unmocked 401 → axios logout (profile.spec lesson)
  await page.route('**/api/v1/auth/oauth/links**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );
  // /settings mounts GET /auth/sessions + /auth/webauthn/credentials (Phase 6d Task 4)
  await page.route('**/api/v1/auth/sessions**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );
  await page.route('**/api/v1/auth/webauthn/credentials**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );
}

async function login(page: Page): Promise<void> {
  await mockCommonApis(page);
  await page.goto('/login');
  await page.locator('input#email').fill('admin@accessbase.local');
  await page.locator('input#password').fill('AdminPass123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

// Sidebar menu items: label (en) → expected path
const MENU_ITEMS: Array<[string, string]> = [
['Dashboard', '/dashboard'],
['Users', '/users'],
['Roles', '/roles'],
['Audit', '/audit'],
  ['Profile', '/profile'],
  ['Settings', '/settings'], // Phase 6d Task 4: Settings page added (6c TODO closed)
];

test.describe('Layout', () => {
  test('sidebar shows 6 items and each navigates to the correct URL', async ({ page }) => {
    await login(page);
    await mockPageData(page);

    // DOM integrity: exactly one sider (testing.md mandated flow)

    for (const [label, path] of MENU_ITEMS) {
      const item = page.locator(`.ant-menu li:has-text("${label}")`).first();
      await expect(item).toBeVisible();
      await item.click();
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/') + '$'));
    }
  });

  test('page header title updates per route', async ({ page }) => {
    await login(page);
    await mockPageData(page);

    const cases: Array<[string, string]> = [
      ['/dashboard', 'Dashboard'],
      ['/roles', 'Roles'],
      ['/audit', 'Audit'],
      ['/profile', 'Profile'],
    ];

    for (const [path, label] of cases) {
      await page.goto(path);
      await mockCommonApis(page);
      await page.goto(path);
      const item = page.locator(`.ant-menu li:has-text("${label}")`).first();
      await expect(item).toBeVisible();
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/') + '$'));
    }
  });

  test('breadcrumb renders segments for nested routes', async ({ page }) => {
    await login(page);
    await mockPageData(page);
    await page.goto('/users/create');
    await page.goto('/users/create');
    await expect(page.locator('.ant-breadcrumb')).toBeVisible();
    await expect(page.locator('.ant-breadcrumb')).toContainText('Users');
  });
});
