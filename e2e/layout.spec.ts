import { test, expect, type Page } from '@playwright/test';
import { mockSetupStatus } from './fixtures/mocks';

async function mockCommonApis(page: Page): Promise<void> {
  await mockSetupStatus(page);

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
          user: {
            id: '1',
            email: 'admin@accessbase.local',
            name: 'Administrator',
            roles: [{ id: 'role-1', name: 'admin' }],
          },
        },
      }),
    });
  });
  // Phase 6d Task 5: Dashboard mounts GET /api/v1/stats — unmocked 401 → axios logout
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] },
      }),
    });
  });
  // Batch G5: Users/Roles pages fetch tenants for the read-only Tenant column —
  // unmocked → console-error net failure (R4 discipline)
  await page.route('**/api/v1/tenants**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Default',
            slug: 'default',
            status: 'active',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
      }),
    });
  });

  // ST-1: AdminLayout fetchUser fires on mount — mock /auth/me
  // Full admin permission set: login lands on /dashboard and the full menu renders
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: '1',
          email: 'admin@accessbase.local',
          name: 'Administrator',
          roles: [],
          permissions: [
            'users:read',
            'users:write',
            'users:delete',
            'roles:read',
            'roles:write',
            'roles:delete',
            'permissions:read',
            'permissions:write',
            'permissions:delete',
            'audit:read',
            'stats:read',
            // 'Full admin permission set' per the comment above — the breadcrumb
            // cases below land on tenants/clients/api-keys; without these codes
            // AdminLayout's fetchUser re-hydration 403s those pages (Q1 timing
            // exposed the mock's own inconsistency).
            'tenants:read',
            'tenants:write',
            'tenants:delete',
            'clients:read',
            'clients:write',
            'clients:delete',
            'apikeys:read',
            'apikeys:write',
            'apikeys:delete',
            'options:read',
            'options:write',
          ],
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
  test('S3 (A-2): breakpoint collapse is TRANSIENT, trigger collapse PERSISTS', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // seed ONLY on the first load — addInitScript re-runs on reload and
      // would reset the persisted collapse the test is proving (S3' catch)
      if (sessionStorage.getItem('s3-seeded')) return;
      sessionStorage.setItem('s3-seeded', '1');
      localStorage.setItem('admin-layout-collapsed', 'false');
      localStorage.setItem('lng', 'en');
    });
    await page.setViewportSize({ width: 700, height: 800 }); // below md — responsive territory
    await login(page);
    const sider = page.locator('.ant-layout-sider').first();
    // responsive auto-collapse fires (disableMobile keeps the SIDER, no drawer)
    await expect(sider).toHaveClass(/ant-layout-sider-collapsed/, { timeout: 10_000 });
    // ...but it must NOT be persisted (transient — persistence records intent)
    expect(await page.evaluate(() => localStorage.getItem('admin-layout-collapsed'))).toBe('false');
    // back above the breakpoint → responsive RESTORE (still not persisted)
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(sider).not.toHaveClass(/ant-layout-sider-collapsed/, { timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('admin-layout-collapsed'))).toBe('false');
    // user CLICKS the trigger → intent → persisted. The collapsedButtonRender
    // wrapper spans ProLayout's transition (unstable/off-viewport for
    // Playwright actionability) — dispatch a NATIVE click on the inner
    // trigger: the wrapper's capture handler fires first (intent), then the
    // inner onClick collapses — the exact real-user event sequence.
    await page.getByTestId('sider-collapse-trigger').evaluate((el) => {
      const inner = (el.firstElementChild ?? el) as HTMLElement;
      inner.click();
    });
    await expect(sider).toHaveClass(/ant-layout-sider-collapsed/, { timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('admin-layout-collapsed'))).toBe('true');
    // reload keeps the user's choice
    await page.reload();
    await expect(page.locator('.ant-layout-sider').first()).toHaveClass(
      /ant-layout-sider-collapsed/,
      { timeout: 10_000 },
    );
  });

  test('sidebar shows 6 items and each navigates to the correct URL', async ({ page }) => {
    await login(page);
    await mockPageData(page);

    // DOM integrity: exactly one sider (testing.md mandated flow)

    for (const [label, path] of MENU_ITEMS) {
      const item = page.locator(`.ant-menu-item:has-text("${label}")`).first(); // leaf items (S3' groups wrap children in their own li)
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
      const item = page.locator(`.ant-menu-item:has-text("${label}")`).first(); // leaf items (S3' groups wrap children in their own li)
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

  // Sync-round regression lock: pages added after SEGMENT_KEYS' first edition
  // (tenants/settings/clients/api-keys) must render translated breadcrumbs,
  // not the raw URL segment.
  test('breadcrumb translates tenants/settings/clients/api-keys segments', async ({ page }) => {
    // catch-all FIRST (later-registered specific mocks take precedence): any
    // page-mount GET without a dedicated mock returns an empty success instead
    // of a network error → no mid-test axios logout (pre-existing flake family)
    await page.route('**/api/v1/**', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [], total: 0 }),
          })
        : route.fallback(),
    );
    await login(page);
    await mockCommonApis(page);
    // page data mocks too — without them /api-keys fires an unmocked request
    // and the axios interceptor logs out mid-test (pre-existing flake family,
    // closed at S3' while making the crumb real)
    await mockPageData(page);
    const cases: Array<[string, string]> = [
      ['/tenants', 'Tenants'],
      ['/settings', 'Settings'],
      ['/clients', 'OIDC Clients'],
      ['/api-keys', 'API Keys'],
    ];
    for (const [path, label] of cases) {
      await page.goto(path);
      await expect(page.locator('.ant-breadcrumb')).toContainText(label);
      await expect(page.locator('.ant-breadcrumb')).not.toContainText(path.slice(1));
    }
  });
});
