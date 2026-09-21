import { test, expect, type Page } from '@playwright/test';

// Mock-first Tenants admin page suite (batch L' T4). Response shapes copied
// verbatim from apps/server/src/routes/tenants.ts returns + the spec D2
// error-code table (PIT-033: mocks mirror real route returns; the bootstrap
// endpoint is contracted against spec D2 while T2 lands it in parallel).

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

type BootstrapMode = 'success' | 'replay' | 'email-exists';

interface TenantMockStats {
  listRequests: number;
  searchTerm: string | null;
  created: { name: string; slug: string } | null;
  lastStatusPut: string | null;
  deleted: boolean;
  bootstrapAttempts: number;
}

// Copied verbatim from clients.spec.ts (PIT-033).
async function seedSessionWithMe(page: Page, me: Record<string, unknown>): Promise<void> {
  const persisted = JSON.stringify({
    state: { token: 'test-token', refreshToken: 'test-refresh', user: me, isAuthenticated: true },
    version: 0,
  });
  await page.addInitScript((value) => {
    window.localStorage.setItem('lng', 'zh');
    window.localStorage.setItem('auth-storage', value);
  }, persisted);
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: me }),
    });
  });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const isNoise =
      text.includes('findDOMNode') ||
      text.includes('chrome-extension') ||
      text.includes('moz-extension') ||
      text.includes('ResizeObserver loop') ||
      text.includes('Failed to load resource') ||
      text.includes('[antd: compatible]') ||
      text.includes('[antd: message]');
    if (!isNoise) errors.push(text);
  });
  return errors;
}

const FULL_PERMS_ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  roles: [{ id: 'r-1', name: 'admin' }],
  permissions: [
    'stats:read', 'users:read', 'users:write', 'roles:read', 'roles:write', 'roles:delete',
    'audit:read', 'audit:delete', 'stats:write', 'stats:delete', 'clients:read', 'clients:write',
    'apikeys:read', 'apikeys:write', 'apikeys:delete',
    'tenants:read', 'tenants:write', 'tenants:delete',
  ],
  mfaEnabled: false,
};

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  const now = new Date().toISOString();
  return {
    id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: 'Acme Corp',
    slug: 'acme-corp',
    status: 'active',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const MOCK_TENANTS = (): TenantRow[] => [
  makeTenant({ id: 'tenant-platform', name: 'Platform Home', slug: 'platform-home', isDefault: true }),
  makeTenant({ id: 'tenant-acme', name: 'Acme Corp', slug: 'acme-corp' }),
  makeTenant({ id: 'tenant-globex', name: 'Globex', slug: 'globex' }),
];

async function mockCommonApis(page: Page): Promise<void> {
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
    });
  });
  // F/T4 precedent: unmocked probes hit the vite proxy 500 → console-error net fails
  await page.route('**/api/v1/auth/saml/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
}

/**
 * Backs GET/POST /v1/tenants, PUT/DELETE /v1/tenants/:id and
 * POST /v1/tenants/:id/bootstrap off one mutable in-browser "DB".
 * Envelope shapes are the routes/tenants.ts returns { success, data, total }.
 */
async function mockTenantsApis(
  page: Page,
  tenants: TenantRow[],
  stats: TenantMockStats,
  bootstrapMode: BootstrapMode,
): Promise<void> {
  await page.route('**/api/v1/tenants**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean); // e.g. api,v1,tenants,<id>,bootstrap
    const isCollection = segments[segments.length - 1] === 'tenants';
    const id = segments[3];

    if (isCollection && method === 'GET') {
      stats.listRequests += 1;
      const term = url.searchParams.get('search');
      stats.searchTerm = term;
      const filtered = term
        ? tenants.filter((tn) => tn.name.toLowerCase().includes(term.toLowerCase()) || tn.slug.includes(term.toLowerCase()))
        : tenants;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // routes/tenants.ts list: { success, data, total }
        body: JSON.stringify({ success: true, data: filtered, total: filtered.length }),
      });
      return;
    }

    if (isCollection && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { name?: string; slug?: string };
      const created = makeTenant({ name: body.name ?? '', slug: body.slug ?? '' });
      tenants.push(created);
      stats.created = { name: created.name, slug: created.slug };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: created }),
      });
      return;
    }

    if (method === 'PUT' && id && segments.length === 4) {
      const body = JSON.parse(request.postData() ?? '{}') as { name?: string; slug?: string; status?: string };
      const row = tenants.find((tn) => tn.id === id);
      if (!row) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }),
        });
        return;
      }
      if (typeof body.name === 'string') row.name = body.name;
      if (typeof body.slug === 'string') row.slug = body.slug;
      if (body.status) {
        row.status = body.status === 'suspended' ? 'suspended' : 'active';
        stats.lastStatusPut = body.status;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: row }),
      });
      return;
    }

    if (method === 'DELETE' && id && segments.length === 4) {
      const row = tenants.find((tn) => tn.id === id);
      if (row) {
        row.status = 'suspended'; // soft delete suspends via manager
        stats.deleted = true;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: row ?? null }),
      });
      return;
    }

    if (method === 'POST' && id && segments[4] === 'bootstrap') {
      stats.bootstrapAttempts += 1;
      if (bootstrapMode === 'email-exists') {
        // Spec D2 pinned code table: 409 EMAIL_EXISTS
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'EMAIL_EXISTS', message: 'Email already in use' } }),
        });
        return;
      }
      if (bootstrapMode === 'replay') {
        // Spec D2 step 4: 200 idempotent replay
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { userId: 'u-boot', roleId: 'r-boot', tenantId: id, alreadyBootstrapped: true } }),
        });
        return;
      }
      // Spec D2 step 8: 201 first run
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { userId: 'u-boot', roleId: 'r-boot', tenantId: id, alreadyBootstrapped: false } }),
      });
      return;
    }

    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
}

function freshStats(): TenantMockStats {
  return { listRequests: 0, searchTerm: null, created: null, lastStatusPut: null, deleted: false, bootstrapAttempts: 0 };
}

test.describe('Tenants admin page', () => {
  let consoleErrors: string[];
  let tenants: TenantRow[];
  let stats: TenantMockStats;

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await mockCommonApis(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  async function gotoTenants(page: Page, bootstrapMode: BootstrapMode = 'success'): Promise<void> {
    tenants = MOCK_TENANTS();
    stats = freshStats();
    await mockTenantsApis(page, tenants, stats, bootstrapMode);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/tenants');
    await expect(page.getByTestId('tenants-page')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Acme Corp', exact: true })).toBeVisible();
  }

  test('list renders rows; search sends the term to the API and filters', async ({ page }) => {
    await gotoTenants(page);
    await expect(page.getByRole('cell', { name: 'Globex', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Platform Home', exact: true })).toBeVisible();
    // status Tags from the projection
    await expect(page.locator('tr', { has: page.getByRole('cell', { name: 'Acme Corp', exact: true }) }).getByText('正常', { exact: true })).toBeVisible();
    await expect(page.locator('tr', { has: page.getByRole('cell', { name: 'Platform Home', exact: true }) }).getByText('已停用', { exact: true })).toHaveCount(0);

    const searchInput = page.locator('input[placeholder]').first();
    await searchInput.fill('Acme');
    // AntD renders CJK 2-char labels with a space ("查 询") — allow optional whitespace
    await page.locator('button').filter({ hasText: /search|查\s*询|submit/i }).first().click();

    // expect.poll (not sync expect): click → request dispatch is async (K convention)
    await expect.poll(() => stats.searchTerm, { timeout: 5000 }).toBe('Acme');
    await expect(page.getByRole('cell', { name: 'Acme Corp', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Globex', exact: true })).toBeHidden();
  });

  test('create tenant: modal → POST 201 → row appears', async ({ page }) => {
    const unique = `Tenant ${Date.now()}`;
    await gotoTenants(page);
    await page.getByTestId('tenants-create').click();
    await page.getByTestId('tenants-name-input').fill(unique);
    await page.getByTestId('tenants-slug-input').fill(`tenant-${Date.now()}`);
    await page.getByTestId('tenants-form-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    await expect.poll(() => stats.created, { timeout: 5000 }).not.toBeNull();
    await expect(page.locator('.ant-message')).toContainText('租户已创建');
    await expect(page.getByRole('cell', { name: unique, exact: true })).toBeVisible();
  });

  test('init admin happy path: 201 → inline success alert', async ({ page }) => {
    await gotoTenants(page, 'success');
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Acme Corp', exact: true }) });
    await row.getByRole('button', { name: /初始化管理员/ }).click();
    // Assert the FORM field, not the ant-modal-root wrapper (root divs can stay
    // computed-hidden while the dialog body is fully interactive).
    await expect(page.getByTestId('init-admin-email')).toBeVisible();
    await page.getByTestId('init-admin-email').fill(`init-${Date.now()}@acme.test`);
    await page.getByTestId('init-admin-name').fill('Acme Admin');
    await page.getByTestId('init-admin-password').fill('Passw0rd123');
    await page.getByTestId('tenants-init-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    await expect.poll(() => stats.bootstrapAttempts, { timeout: 5000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('init-admin-success')).toBeVisible();
    await expect(page.getByTestId('init-admin-success')).toContainText('租户管理员已创建');
    // Done closes the modal (200-replay and 201 share the same dismiss path)
    await page.getByTestId('tenants-init-modal').locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(page.getByTestId('tenants-init-modal')).toBeHidden();
  });

  test('init admin replay: 200 alreadyBootstrapped → inline replay alert', async ({ page }) => {
    await gotoTenants(page, 'replay');
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Acme Corp', exact: true }) });
    await row.getByRole('button', { name: /初始化管理员/ }).click();
    await page.getByTestId('init-admin-email').fill(`dup-${Date.now()}@acme.test`);
    await page.getByTestId('init-admin-name').fill('Acme Admin');
    await page.getByTestId('init-admin-password').fill('Passw0rd123');
    await page.getByTestId('tenants-init-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    await expect.poll(() => stats.bootstrapAttempts, { timeout: 5000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('init-admin-success')).toBeVisible();
    await expect(page.getByTestId('init-admin-success')).toContainText(/管理员已初始化——角色绑定已重新校验/);
  });

  test('init admin 409 EMAIL_EXISTS → server message inline on the email field', async ({ page }) => {
    await gotoTenants(page, 'email-exists');
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Acme Corp', exact: true }) });
    await row.getByRole('button', { name: /初始化管理员/ }).click();
    await page.getByTestId('init-admin-email').fill(`taken-${Date.now()}@acme.test`);
    await page.getByTestId('init-admin-name').fill('Acme Admin');
    await page.getByTestId('init-admin-password').fill('Passw0rd123');
    await page.getByTestId('tenants-init-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    await expect.poll(() => stats.bootstrapAttempts, { timeout: 5000 }).toBeGreaterThan(0);
    // Mock body copies the spec D2 409 EMAIL_EXISTS envelope; frontend passes
    // the server message through verbatim (apiErrorMessage, K-R6).
    await expect(page.locator('.ant-form-item-explain-error')).toContainText('Email already in use');
    await expect(page.getByTestId('init-admin-success')).toHaveCount(0);
  });

  test('suspend toggle: PUT status suspended → tag flips → activate restores', async ({ page }) => {
    await gotoTenants(page);
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Acme Corp', exact: true }) });
    await row.getByRole('button', { name: '停用', exact: true }).click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();

    await expect.poll(() => stats.lastStatusPut, { timeout: 5000 }).toBe('suspended');
    await expect(page.locator('.ant-message')).toContainText('租户已停用');
    await expect(row.getByText('已停用', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: '启用', exact: true }).click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();
    await expect.poll(() => stats.lastStatusPut, { timeout: 5000 }).toBe('active');
    await expect(row.getByText('正常', { exact: true })).toBeVisible();
  });

  test('default-tenant row: mutating actions disabled with lock icon', async ({ page }) => {
    await gotoTenants(page);
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Platform Home', exact: true }) });
    await expect(row.getByRole('button', { name: /初始化管理员/ })).toBeDisabled();
    await expect(row.getByRole('button', { name: /编辑/ })).toBeDisabled();
    await expect(row.getByRole('button', { name: '停用', exact: true })).toBeDisabled();
    await expect(row.getByRole('button', { name: /删除/ })).toBeDisabled();
    await expect(row.locator('.anticon-lock').first()).toBeVisible();
    // Non-default rows keep the same actions enabled
    const other = page.locator('tr', { has: page.getByRole('cell', { name: 'Acme Corp', exact: true }) });
    await expect(other.getByRole('button', { name: /编辑/ })).toBeEnabled();
  });
});
