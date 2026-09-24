import { test, expect, type Page } from '@playwright/test';

// Mock-first Groups admin page suite (Q4b). Response shapes copied verbatim
// from apps/server/src/routes/groups.ts returns + the 409/400 code table
// (PIT-033: mocks mirror real route returns; LAST_ADMIN_GUARD envelope from
// apps/server/src/utils/conflict-mapper.ts).

interface GroupRow {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  roleCount: number;
}

interface MemberRow {
  userId: string;
  email: string;
  name: string;
}

interface GroupMockStats {
  listRequests: number;
  created: { name: string; description?: string } | null;
  lastPut: { id: string; body: Record<string, unknown> } | null;
  deleted: string | null;
  addedMembers: { groupId: string; userId: string }[];
  rolesPut: { groupId: string; roleIds: string[] } | null;
}

// Copied verbatim from tenants-crud.spec.ts (PIT-033).
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

const ADMIN_PERMS = [
  'stats:read', 'users:read', 'users:write', 'roles:read', 'roles:write', 'roles:delete',
  'audit:read', 'audit:delete', 'stats:write', 'stats:delete', 'clients:read', 'clients:write',
  'apikeys:read', 'apikeys:write', 'apikeys:delete',
  'tenants:read', 'tenants:write', 'tenants:delete',
  'groups:read', 'groups:write', 'groups:delete',
];

const FULL_PERMS_ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  roles: [{ id: 'r-1', name: 'admin' }],
  permissions: ADMIN_PERMS,
  mfaEnabled: false,
};

// Reduced set: read-only groups (no write/delete codes) — button-gating test.
const READONLY_ME = {
  id: '1',
  email: 'viewer@accessbase.local',
  name: 'Viewer',
  roles: [{ id: 'r-9', name: 'viewer' }],
  permissions: ['groups:read'],
  mfaEnabled: false,
};

function makeGroup(overrides: Partial<GroupRow> = {}): GroupRow {
  const now = new Date().toISOString();
  return {
    id: `g-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    tenantId: 'tenant-acme',
    name: 'Engineering',
    description: 'Engineers group',
    createdAt: now,
    updatedAt: now,
    memberCount: 1,
    roleCount: 1,
    ...overrides,
  };
}

const MOCK_GROUPS = (): GroupRow[] => [
  makeGroup({ id: 'group-eng', name: 'Engineering', memberCount: 2, roleCount: 1 }),
  makeGroup({ id: 'group-ops', name: 'Operations', description: undefined, memberCount: 0, roleCount: 0 }),
];

// Member rows for group-eng (routes/groups.ts listMembers projection).
const MOCK_MEMBERS = (): MemberRow[] => [
  { userId: 'u-alice', email: 'alice@acme.test', name: 'Alice' },
  { userId: 'u-bob', email: 'bob@acme.test', name: 'Bob' },
];

// Users page for the member picker — GET /v1/users paginated envelope
// (shape copied from users-crud.spec.ts list rows).
const MOCK_USERS = [
  {
    id: 'u-alice', email: 'alice@acme.test', name: 'Alice', isActive: true, status: 'active',
    tenantId: 'tenant-acme', tokenVersion: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'u-bob', email: 'bob@acme.test', name: 'Bob', isActive: true, status: 'active',
    tenantId: 'tenant-acme', tokenVersion: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'u-carol', email: 'carol@acme.test', name: 'Carol', isActive: true, status: 'active',
    tenantId: 'tenant-acme', tokenVersion: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

// Roles page for the binding editor — GET /v1/roles paginated envelope
// (RoleManager.mapToRole wire shape, roles-crud precedent).
const MOCK_ROLES = [
  {
    id: 'role-admin', name: 'admin', description: 'Full access', isSystem: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'role-member', name: 'member', description: 'Default member',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }),
    });
  });
  // PIT-080 roster: /login-shell probes must be mocked in every spec.
  await page.route('**/api/v1/auth/saml/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
  await page.route('**/api/v1/auth/sms/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
  await page.route('**/api/v1/auth/captcha/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
  // Member picker + role binding sources
  await page.route('**/api/v1/users**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // routes/users.ts list: { success, data, total }
      body: JSON.stringify({ success: true, data: MOCK_USERS, total: MOCK_USERS.length }),
    });
  });
  await page.route('**/api/v1/roles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: MOCK_ROLES, total: MOCK_ROLES.length }),
    });
  });
}

/**
 * Backs the whole /v1/groups surface off one mutable in-browser "DB".
 * Envelope shapes are the routes/groups.ts returns ({ success, data } —
 * the list is a PLAIN array, not paginated; PIT-033 literal copy).
 */
async function mockGroupsApis(
  page: Page,
  groups: GroupRow[],
  members: MemberRow[],
  boundRoles: string[],
  stats: GroupMockStats,
  deleteMode: 'success' | 'last-admin',
): Promise<void> {
  await page.route('**/api/v1/groups**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean); // api,v1,groups,<id>,<sub>,<userId>
    const isCollection = segments[segments.length - 1] === 'groups' || (segments[2] === 'groups' && segments.length === 3);
    const id = segments[3];
    const sub = segments[4];

    if (isCollection && method === 'GET') {
      stats.listRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: groups }),
      });
      return;
    }

    if (isCollection && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { name?: string; description?: string };
      const created = makeGroup({ name: body.name ?? '', description: body.description, memberCount: 0, roleCount: 0 });
      groups.push(created);
      stats.created = { name: created.name, ...(created.description !== undefined ? { description: created.description } : {}) };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { id: created.id, tenantId: created.tenantId, name: created.name, description: created.description, createdAt: created.createdAt, updatedAt: created.updatedAt },
        }),
      });
      return;
    }

    if (method === 'GET' && sub === 'members') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: members }) });
      return;
    }

    if (method === 'POST' && sub === 'members') {
      const body = JSON.parse(request.postData() ?? '{}') as { userId?: string };
      const user = MOCK_USERS.find((u) => u.id === body.userId);
      if (user) {
        members.push({ userId: user.id, email: user.email, name: user.name });
      }
      stats.addedMembers.push({ groupId: id ?? '', userId: body.userId ?? '' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) });
      return;
    }

    if (method === 'GET' && sub === 'roles') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: boundRoles }) });
      return;
    }

    if (method === 'PUT' && sub === 'roles') {
      const body = JSON.parse(request.postData() ?? '{}') as { roleIds?: string[] };
      boundRoles.length = 0;
      boundRoles.push(...(body.roleIds ?? []));
      stats.rolesPut = { groupId: id ?? '', roleIds: body.roleIds ?? [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) });
      return;
    }

    if (method === 'PUT' && id && segments.length === 4) {
      const body = JSON.parse(request.postData() ?? '{}') as { name?: string; description?: string };
      const row = groups.find((g) => g.id === id);
      if (!row) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'GROUP_NOT_FOUND', message: 'Group not found' } }),
        });
        return;
      }
      if (typeof body.name === 'string') row.name = body.name;
      if (typeof body.description === 'string') row.description = body.description;
      stats.lastPut = { id, body };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: row.id, tenantId: row.tenantId, name: row.name, description: row.description, createdAt: row.createdAt, updatedAt: row.updatedAt } }),
      });
      return;
    }

    if (method === 'DELETE' && id && segments.length === 4) {
      if (deleteMode === 'last-admin') {
        // conflict-mapper.ts LAST_ADMIN_GUARD 409 envelope, verbatim message.
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'LAST_ADMIN_GUARD', message: 'Operation would leave the tenant with no active administrator' } }),
        });
        return;
      }
      const idx = groups.findIndex((g) => g.id === id);
      if (idx >= 0) groups.splice(idx, 1);
      stats.deleted = id;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) });
      return;
    }

    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
}

function freshStats(): GroupMockStats {
  return { listRequests: 0, created: null, lastPut: null, deleted: null, addedMembers: [], rolesPut: null };
}

test.describe('Groups admin page', () => {
  let consoleErrors: string[];
  let groups: GroupRow[];
  let members: MemberRow[];
  let boundRoles: string[];
  let stats: GroupMockStats;

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await mockCommonApis(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  async function gotoGroups(page: Page, me: Record<string, unknown> = FULL_PERMS_ME, deleteMode: 'success' | 'last-admin' = 'success'): Promise<void> {
    groups = MOCK_GROUPS();
    members = MOCK_MEMBERS();
    boundRoles = ['role-member'];
    stats = freshStats();
    await mockGroupsApis(page, groups, members, boundRoles, stats, deleteMode);
    await seedSessionWithMe(page, me);
    await page.goto('/groups');
    await expect(page.getByTestId('groups-page')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Engineering', exact: true })).toBeVisible();
  }

  test('menu entry visible with groups:read; list renders rows with counts', async ({ page }) => {
    await gotoGroups(page);
    // Sidebar menu entry (i18n zh label)
    await expect(page.locator('.ant-menu').getByText('用户组', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Operations', exact: true })).toBeVisible();
    // count columns from the list projection
    const engRow = page.locator('tr', { has: page.getByRole('cell', { name: 'Engineering', exact: true }) });
    await expect(engRow.getByRole('cell', { name: '2', exact: true })).toBeVisible();
    await expect(engRow.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  });

  test('create group: modal → POST 201 wire payload → row appears', async ({ page }) => {
    const unique = `Group ${Date.now()}`;
    await gotoGroups(page);
    await page.getByTestId('groups-create').click();
    await page.getByTestId('groups-name-input').fill(unique);
    await page.getByTestId('groups-description-input').fill('created by e2e');
    await page.getByTestId('groups-form-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    await expect.poll(() => stats.created, { timeout: 5000 }).toEqual({ name: unique, description: 'created by e2e' });
    await expect(page.locator('.ant-message')).toContainText('用户组已创建');
    await expect(page.getByRole('cell', { name: unique, exact: true })).toBeVisible();
  });

  test('edit group: PUT wire payload carries renamed name', async ({ page }) => {
    await gotoGroups(page);
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Engineering', exact: true }) });
    await row.getByTestId('groups-edit').click();
    await expect(page.getByTestId('groups-name-input')).toHaveValue('Engineering');
    await page.getByTestId('groups-name-input').fill('Engineering 2');
    await page.getByTestId('groups-form-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    await expect.poll(() => stats.lastPut, { timeout: 5000 }).not.toBeNull();
    expect(stats.lastPut?.body.name).toBe('Engineering 2');
    await expect(page.getByRole('cell', { name: 'Engineering 2', exact: true })).toBeVisible();
  });

  test('delete blocked by 409 LAST_ADMIN_GUARD: server message surfaces', async ({ page }) => {
    await gotoGroups(page, FULL_PERMS_ME, 'last-admin');
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Engineering', exact: true }) });
    await row.getByTestId('groups-delete').click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();

    // apiErrorMessage passes the server message through verbatim (K-R6)
    await expect(page.locator('.ant-message')).toContainText('Operation would leave the tenant with no active administrator');
    await expect(page.getByRole('cell', { name: 'Engineering', exact: true })).toBeVisible();
  });

  test('detail drawer: add member POST wire + bound roles PUT wire', async ({ page }) => {
    await gotoGroups(page);
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Engineering', exact: true }) });
    await row.getByTestId('groups-detail-group-eng').click();
    await expect(page.getByTestId('groups-members')).toBeVisible();
    await expect(page.getByTestId('groups-member-u-alice')).toBeVisible();

    // Add member: search-select Carol → POST {userId}
    const memberSelect = page.getByTestId('groups-member-select').getByRole('combobox');
    await memberSelect.click();
    await memberSelect.fill('Carol');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content', { hasText: /^Carol <carol@acme\.test>$/ }).click();
    await page.getByTestId('groups-add-member').click();
    await expect.poll(() => stats.addedMembers.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(stats.addedMembers[0]).toEqual({ groupId: 'group-eng', userId: 'u-carol' });
    await expect(page.getByTestId('groups-member-u-carol')).toBeVisible();

    // Bound roles tab: pre-checked from GET roles, toggle admin on, save → PUT {roleIds}
    await page.getByRole('tab', { name: '绑定角色' }).click();
    await expect(page.getByTestId('groups-roles')).toBeVisible();
    await page.getByRole('checkbox', { name: 'admin' }).check();
    await page.getByTestId('groups-save-roles').click();
    // antd Checkbox.Group emits values in options order, not click order
    await expect.poll(() => stats.rolesPut, { timeout: 5000 }).not.toBeNull();
    expect(stats.rolesPut?.groupId).toBe('group-eng');
    expect([...(stats.rolesPut?.roleIds ?? [])].sort()).toEqual(['role-admin', 'role-member']);
    await expect(page.locator('.ant-message')).toContainText('角色绑定已保存');
  });

  test('read-only user: create/edit/delete buttons hidden', async ({ page }) => {
    await gotoGroups(page, READONLY_ME);
    await expect(page.getByTestId('groups-create')).toHaveCount(0);
    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Engineering', exact: true }) });
    await expect(row.getByTestId('groups-edit')).toHaveCount(0);
    await expect(row.getByTestId('groups-delete')).toHaveCount(0);
    // Manage (read view of members) stays available for groups:read
    await expect(row.getByTestId('groups-detail-group-eng')).toBeVisible();
  });
});
