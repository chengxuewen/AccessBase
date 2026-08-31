import { test, expect, type Page } from '@playwright/test';

interface RoleFixture {
  id: string;
  name: string;
  description: string;
  permissionIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface PermissionFixture {
  id: string;
  resource: string;
  action: string;
  description?: string;
  createdAt?: string;
}

const MOCK_ROLES: RoleFixture[] = [
  {
    id: 'role-1',
    name: 'Admin',
    description: 'Full access',
    permissionIds: ['perm-1'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-2',
    name: 'Viewer',
    description: 'Read-only access',
    permissionIds: [],
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

const MOCK_PERMISSIONS: PermissionFixture[] = [
  { id: 'perm-1', resource: 'users', action: 'read', description: 'Read users' },
  { id: 'perm-2', resource: 'users', action: 'write', description: 'Write users' },
];

const nowIso = () => new Date().toISOString();

async function mockCommonApis(page: Page): Promise<void> {
  // Setup status → initialized (skip setup wizard)
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });

  // Login
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

  // Permissions list (Transfer source)
  await page.route('**/api/v1/permissions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_PERMISSIONS, total: MOCK_PERMISSIONS.length }),
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

test.describe('Roles CRUD', () => {
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
        // antd v5 emits compat/static-API warnings under React 19 — pre-existing framework noise, not app errors
        text.includes('[antd: compatible]') ||
        text.includes('[antd: message]');
      if (!isNoise) consoleErrors.push(text);
    });

    await mockCommonApis(page);

    // Roles list — dynamic so create/update/delete mutations reflect in subsequent reads
    const roles = [...MOCK_ROLES];
    await page.route('**/api/v1/roles**', async (route) => {
      const req = route.request();
      const method = req.method();
      const url = new URL(req.url());
      const idMatch = url.pathname.match(/\/api\/v1\/roles\/([^/]+)$/);

      if (method === 'GET' && !idMatch) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: roles, total: roles.length }),
        });
        return;
      }

      if (method === 'POST' && !idMatch) {
        const body = req.postDataJSON() as { name: string; description?: string; permissionIds?: string[] };
        const created: RoleFixture = {
          id: `role-${Date.now()}`,
          name: body.name,
          description: body.description ?? '',
          permissionIds: body.permissionIds ?? [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        roles.push(created);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: created }),
        });
        return;
      }

      if (method === 'PUT' && idMatch) {
        const body = req.postDataJSON() as { name?: string; description?: string; permissionIds?: string[] };
        const role = roles.find((r) => r.id === idMatch[1]);
        if (!role) {
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false }) });
          return;
        }
        if (body.name !== undefined) role.name = body.name;
        if (body.description !== undefined) role.description = body.description;
        if (body.permissionIds !== undefined) role.permissionIds = body.permissionIds;
        role.updatedAt = nowIso();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: role }),
        });
        return;
      }

      if (method === 'DELETE' && idMatch) {
        const idx = roles.findIndex((r) => r.id === idMatch[1]);
        if (idx >= 0) roles.splice(idx, 1);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: roles[0], total: 1 }) });
    });

    await login(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('list renders 2 role rows', async ({ page }) => {
    await page.goto('/roles');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(2);
    await expect(page.locator('td:has-text("Admin")').first()).toBeVisible();
    await expect(page.locator('td:has-text("Viewer")').first()).toBeVisible();
  });

  test('create role via modal with Transfer', async ({ page }) => {
    const ts = Date.now();
    const roleName = `Editor ${ts}`;

    await page.goto('/roles');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(2);

    await page.locator('button:has-text("Create"), button:has-text("创建")').first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // Transfer visible in modal
    await expect(page.locator('.ant-modal .ant-transfer')).toBeVisible();

    await page.locator('.ant-modal input#name').fill(roleName);
    await page.locator('.ant-modal textarea#description').fill('Can edit content');

    await page.locator('.ant-modal-footer .ant-btn-primary, .ant-modal button:has-text("Confirm"), .ant-modal button:has-text("确认")').first().click();

    // New row appears after reload
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(3);
    await expect(page.locator(`td:has-text("${roleName}")`)).toBeVisible();
  });

  test('edit role prefills modal and saves', async ({ page }) => {
    const ts = Date.now();
    const updatedName = `Admin ${ts}`;

    await page.goto('/roles');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(2);

    await page.locator('tbody tr').first().locator('a:has-text("Edit"), a:has-text("编辑")').click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // Modal prefilled with existing values
    await expect(page.locator('.ant-modal input#name')).toHaveValue('Admin');
    await expect(page.locator('.ant-modal textarea#description')).toHaveValue('Full access');
    // Transfer pre-selects existing permissions
    await expect(page.locator('.ant-modal .ant-transfer')).toBeVisible();

    await page.locator('.ant-modal input#name').fill(updatedName);
    await page.locator('.ant-modal-footer .ant-btn-primary, .ant-modal button:has-text("Confirm"), .ant-modal button:has-text("确认")').first().click();

    await expect(page.locator(`td:has-text("${updatedName}")`)).toBeVisible();
  });

  test('delete role via popconfirm removes row', async ({ page }) => {
    await page.goto('/roles');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(2);

    await page.locator('tbody tr').first().locator('a:has-text("Delete"), a:has-text("删除")').click();
    await page.locator('.ant-popconfirm button:has-text("Confirm"), .ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes"), .ant-popconfirm button:has-text("确认")').first().click();

    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
    await expect(page.locator('td:has-text("Viewer")')).toBeVisible();
  });
});
