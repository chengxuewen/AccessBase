import { test, expect, type Page } from '@playwright/test';

interface AuditLogFixture {
  id: string;
  action: string;
  actor?: string;
  resource?: string;
  status?: number;
  ipAddress?: string;
  createdAt: string;
}

const MOCK_LOGS: AuditLogFixture[] = [
  {
    id: 'log-1',
    action: 'POST /api/v1/users',
    actor: 'u-1',
    resource: 'user u-9',
    status: 201,
    ipAddress: '10.0.0.1',
    createdAt: '2026-08-30T10:00:00Z',
  },
  {
    id: 'log-2',
    action: 'DELETE /api/v1/roles/1',
    actor: 'u-2',
    resource: 'role 1',
    status: 200,
    ipAddress: '10.0.0.2',
    createdAt: '2026-08-30T11:00:00Z',
  },
  {
    id: 'log-3',
    action: 'PUT /api/v1/users/2',
    actor: 'u-1',
    resource: 'user 2',
    status: 200,
    ipAddress: '10.0.0.1',
    createdAt: '2026-08-30T12:00:00Z',
  },
];

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
  // Phase 6d Task 5: Dashboard mounts GET /api/v1/stats — unmocked 401 → axios logout
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
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

test.describe('Audit Log Viewer', () => {
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
        text.includes('[antd: compatible]') ||
        text.includes('[antd: message]');
      if (!isNoise) consoleErrors.push(text);
    });

    await mockCommonApis(page);
    await login(page);
  });

  test.afterEach(async () => {
    // Browsers log "Failed to load resource" for mocked non-2xx responses — network noise, not app errors
    const appErrors = consoleErrors.filter((e) => !e.includes('Failed to load resource'));
    expect(appErrors, 'console errors should be empty').toEqual([]);
  });

  test('renders 3 log rows', async ({ page }) => {
    await page.route('**/api/v1/audit-logs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_LOGS, total: MOCK_LOGS.length }),
      });
    });

    await page.goto('/audit');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(3);
    await expect(page.locator('td:has-text("POST /api/v1/users")').first()).toBeVisible();
    await expect(page.locator('td:has-text("DELETE /api/v1/roles/1")').first()).toBeVisible();
  });

  test('action filter narrows results and request URL carries query', async ({ page }) => {
    let lastQuery = '';
    await page.route('**/api/v1/audit-logs**', async (route) => {
      const url = new URL(route.request().url());
      lastQuery = url.search;
      const action = url.searchParams.get('action');

      if (action === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [MOCK_LOGS[1]], total: 1 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: MOCK_LOGS, total: MOCK_LOGS.length }),
        });
      }
    });

    await page.goto('/audit');
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(3);

    await page.locator('.audit-action-filter').click();
    await page.locator('.ant-select-dropdown .ant-select-item:has-text("DELETE")').click();
    await page.locator('button:has-text("Search"), button:has-text("查询")').click();

    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
    await expect(page.locator('td:has-text("DELETE /api/v1/roles/1")')).toBeVisible();
    expect(lastQuery).toContain('action=DELETE');
  });

  test('empty state renders ant-empty when 0 rows', async ({ page }) => {
    await page.route('**/api/v1/audit-logs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], total: 0 }),
      });
    });

    await page.goto('/audit');
    await expect(page.locator('.ant-empty')).toBeVisible();
    // antd renders a measure-row <tr> even with 0 data rows
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
  });

  test('error state shows error message on 500', async ({ page }) => {
    await page.route('**/api/v1/audit-logs**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'boom' } }),
      });
    });

    await page.goto('/audit');
    // Static message API is broken under React 19 (pre-existing: auth.spec toast tests fail too) — assert inline Alert instead
    await expect(page.locator('.audit-load-error')).toBeVisible();
    await expect(page.locator('.audit-load-error')).toContainText(/Failed to load audit logs|加载审计日志失败/);
    // antd renders a measure-row <tr> even with 0 data rows
    await expect(page.locator('.ant-table-tbody tr')).toHaveCount(1);
  });

  test('export button is visible', async ({ page }) => {
    await page.route('**/api/v1/audit-logs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_LOGS, total: MOCK_LOGS.length }),
      });
    });

    await page.goto('/audit');
    await expect(page.locator('.audit-export')).toBeVisible();
  });
});
