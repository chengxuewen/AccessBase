import { test, expect, type Page } from '@playwright/test';

interface UserFixture {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  tenantId: string;
  tokenVersion: number;
  createdAt: string;
  updatedAt: string;
  roles?: { id: string; name: string }[];
  roleIds?: string[];
}

const nowIso = () => new Date().toISOString();

const makeUser = (overrides: Partial<UserFixture> = {}): UserFixture => ({
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  isActive: true,
  tenantId: 't1',
  tokenVersion: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const MOCK_ROLES = [
  { id: 'role-1', name: 'Admin', description: 'Full access', permissionIds: [], createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'role-2', name: 'Viewer', description: 'Read-only', permissionIds: [], createdAt: nowIso(), updatedAt: nowIso() },
];

/** Console error gate — per testing.md, filtered noise is not app errors */
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
      // antd v5 compat/static-API warnings under React 19 — pre-existing framework noise
      text.includes('[antd: compatible]') ||
      text.includes('[antd: message]');
    if (!isNoise) errors.push(text);
  });
  return errors;
}

test.describe('Users CRUD (dedicated routes)', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);

    // Setup status → initialized (skip setup wizard)
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });

    // Mock login
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
            user: { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: [{ id: 'role-1', name: 'admin' }] },
          },
        }),
      });
    });

    // Phase 6d Task 5: Dashboard mounts GET /api/v1/stats — unmocked 401 → axios logout
    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
      });
    });

    // ST-1: AdminLayout fetchUser fires on mount — mock /auth/me
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: [] } }),
      });
    });

    // Roles list for create/edit role selects
    await page.route('**/api/v1/roles**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_ROLES, total: MOCK_ROLES.length }),
      });
    });

    await page.goto('/login');
    await page.locator('input#email').fill('admin@accessbase.local');
    await page.locator('input#password').fill('AdminPass123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test.afterEach(async () => {
    // Browsers log "Failed to load resource" for mocked non-2xx responses — network noise, not app errors
    const appErrors = consoleErrors.filter((e) => !e.includes('Failed to load resource'));
    expect(appErrors, 'console errors should be empty').toEqual([]);
  });

  test('list renders users table', async ({ page }) => {
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [makeUser()], total: 1 }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
    await expect(page.locator('td:has-text("Administrator")')).toBeVisible();
    await expect(page.locator('td:has-text("admin@accessbase.local")')).toBeVisible();
  });

  test('list empty state shows AntD empty render', async ({ page }) => {
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], total: 0 }),
      });
    });

    await page.goto('/users');
    // AntD renders a placeholder <tr> for the empty state — assert on the empty widget
    await expect(page.locator('.ant-table-tbody .ant-empty')).toBeVisible();
  });

  test('list error state shows error display on GET 500', async ({ page }) => {
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } }),
      });
    });

    await page.goto('/users');
    // AntD table renders the placeholder/empty state — no crash, no data rows
    await expect(page.locator('.ant-empty')).toBeVisible();
  });

  // T0.5 companion (RED): the existing 500 case above accepts the degraded bare
  // empty state. This case encodes the CORRECT expectation from T2-5: a list GET
  // 500 must surface an error/retry Alert, not a silent AntD empty.
  test('list GET 500 shows a real error/retry UI (not bare ant-empty)', async ({ page }) => {
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } }),
      });
    });

    await page.goto('/users');
    // Inline error Alert (Audit page `.audit-load-error` is the target pattern) + retry affordance
    await expect(page.locator('.ant-alert-error')).toBeVisible({ timeout: 10000 });
  });

  // T0.4: migrated from e2e/users.spec.ts (deleted legacy spec — weak duplicate coverage)
  test('pagination navigates between pages', async ({ page }) => {
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = new URL(route.request().url());
      const pageNum = parseInt(url.searchParams.get('page') || '1');
      const pageSize = parseInt(url.searchParams.get('pageSize') || '10');
      const users = Array.from({ length: 25 }, (_, i) => makeUser({
        id: String(i + 1),
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
      }));
      const start = (pageNum - 1) * pageSize;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: users.slice(start, start + pageSize), total: users.length }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-pagination')).toBeVisible();
    await page.locator('.ant-pagination-next').click();
    await expect(page.locator('.ant-pagination-item-active')).toContainText('2');
  });

  // R7 (GREEN): frontend contract — UserCreate must send isActive + roleIds in the
  // POST /v1/users payload (server-side handling is T2-2's concern, verified by curl).
  test('create user POST payload includes isActive and roleIds', async ({ page }) => {
    const ts = Date.now();
    const created = makeUser({ id: '2', email: `r7-${ts}@test.local`, name: `R7 User ${ts}` });
    let postBody: Record<string, unknown> | undefined;

    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [makeUser(), created], total: 2 }),
      });
    });
    await page.route('**/api/v1/users', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      postBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: created }),
      });
    });

    await page.goto('/users');
    await page.locator('button:has-text("Create User"), button:has-text("创建用户")').first().click();
    await expect(page).toHaveURL(/\/users\/create/);

    const card = page.locator('.ant-card');
    await card.locator('input#name').fill(created.name);
    await card.locator('input#email').fill(created.email);
    await card.locator('input#password').fill('E2ePass123!');

    // No dropdown interaction: UserCreate initialValues already register isActive/roleIds,
    // and an open antd Select popup intercepts pointer events on the submit button.
    // The payload contract below is what this test asserts.

    await card.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/users$/, { timeout: 10000 });

    expect(postBody, 'POST /v1/users was issued').toBeDefined();
    expect(postBody).toHaveProperty('isActive');
    expect(postBody).toHaveProperty('roleIds');
    expect(postBody?.roleIds).toEqual([]);
  });

  test('delete user success renders visible .ant-message feedback', async ({ page }) => {
    let deleted = false;
    await page.route('**/api/v1/users/1', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const rows = deleted ? [] : [makeUser()];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: rows, total: rows.length }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
    await page.locator('tbody tr').first().locator('a:has-text("Delete"), a:has-text("删除")').click();
    await page.locator('.ant-popconfirm button:has-text("Confirm"), .ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes"), .ant-popconfirm button:has-text("确认")').first().click();
    await expect.poll(() => deleted).toBe(true);

    // Static antd message.* never mounts (PIT-023) — after the T1-6 feedback bridge
    // fix the toast renders inside App context and this locator becomes visible.
    await expect(page.locator('.ant-message .ant-message-notice-content')).toBeVisible({ timeout: 5000 });
  });

  test('create user via dedicated /users/create page', async ({ page }) => {
    const ts = Date.now();
    const created = makeUser({
      id: '2',
      email: `e2e-${ts}@test.local`,
      name: `E2E User ${ts}`,
    });

    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // After create, list includes the new user
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [makeUser(), created], total: 2 }),
      });
    });
    await page.route('**/api/v1/users', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: created }),
      });
    });

    await page.goto('/users');
    await page.locator('button:has-text("Create User"), button:has-text("创建用户")').first().click();
    await expect(page).toHaveURL(/\/users\/create/);

    const card = page.locator('.ant-card');
    const nameInput = card.locator('input#name');
    const emailInput = card.locator('input#email');
    await nameInput.fill(created.name);
    await emailInput.fill(created.email);
    await card.locator('input#password').fill('E2ePass123!');

    // Guard against AntD controlled-input timing: values must be committed before submit
    await expect(nameInput).toHaveValue(created.name);
    await expect(emailInput).toHaveValue(created.email);

    await card.locator('button[type="submit"]').click();

    // Navigates back to list, new row visible
    await expect(page).toHaveURL(/\/users$/, { timeout: 10000 });
    await expect(page.locator(`td:has-text("E2E User ${ts}")`)).toBeVisible();
  });

  test('edit user via dedicated /users/:id/edit page', async ({ page }) => {
    const ts = Date.now();
    const updatedName = `Updated ${ts}`;

    await page.route('**/api/v1/users/1', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: makeUser() }),
        });
        return;
      }
      if (method === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: makeUser({ name: updatedName }) }),
        });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [makeUser()], total: 1 }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);

    await page.locator('tbody tr').first().locator('a:has-text("Edit"), a:has-text("编辑")').first().click();
    await expect(page).toHaveURL(/\/users\/1\/edit/);

    // Prefilled name
    await expect(page.locator('.ant-card input#name')).toHaveValue('Administrator');

    await page.locator('.ant-card input#name').fill(updatedName);
    await page.locator('.ant-card button[type="submit"]').click();

    await expect(page).toHaveURL(/\/users\/1$/, { timeout: 10000 });
  });

  test('search users filters via list request', async ({ page }) => {
    let searched = false;
    await page.route('**/api/v1/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = new URL(route.request().url());
      const term = url.searchParams.get('search');
      if (term) searched = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [makeUser()], total: 1 }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);

    const searchInput = page.locator('input[placeholder]').first();
    await searchInput.fill('admin');
    // AntD renders CJK 2-char labels with a space ("查 询") — allow optional whitespace
    await page.locator('button').filter({ hasText: /search|查\s*询|submit/i }).first().click();

    // Search param reached the API and table still renders
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
    expect(searched, 'search param was sent to API').toBe(true);
  });

  test('delete user from list removes row', async ({ page }) => {
    let deleted = false;
    await page.route('**/api/v1/users/1', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const rows = deleted ? [] : [makeUser()];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: rows, total: rows.length }),
      });
    });

    await page.goto('/users');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);

    await page.locator('tbody tr').first().locator('a:has-text("Delete"), a:has-text("删除")').click();
    await page.locator('.ant-popconfirm button:has-text("Confirm"), .ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes"), .ant-popconfirm button:has-text("确认")').first().click();

    // AntD placeholder row ("暂无数据") lives in tbody — assert on the empty description
    await expect(page.locator('.ant-table-tbody .ant-empty-description')).toBeVisible({ timeout: 10000 });
    expect(deleted, 'DELETE was called').toBe(true);
  });
});
