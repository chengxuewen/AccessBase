import { test, expect, type Page } from '@playwright/test';

// Copied verbatim from clients.spec.ts (PIT-033: mocks mirror real route returns).
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
  ],
  mfaEnabled: false,
};

const NO_APIKEYS_PERMS_ME = {
  id: '1',
  email: 'limited@accessbase.local',
  name: 'Limited',
  roles: [{ id: 'r-2', name: 'staff' }],
  permissions: ['users:read'],
  mfaEnabled: false,
};

// Route truth (apps/server/src/routes/api-keys.ts): list = SafeApiKey[] rows
// (id/name/prefix/scopes/expiresAt/lastUsedAt/revokedAt/tenantId/createdAt/updatedAt),
// create 201 = row + plaintext (ab_[a-z0-9]{32}), revoke = 200 envelope.
const MOCK_KEYS = [
  {
    id: 'k-1',
    name: 'CI Pipeline',
    prefix: 'ab_cipipe',
    scopes: ['*'],
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    tenantId: '00000000-0000-0000-0000-000000000001',
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
  },
  {
    id: 'k-2',
    name: 'Legacy Export',
    prefix: 'ab_legacyx',
    scopes: ['users:read'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: '2026-09-11T09:00:00.000Z',
    tenantId: '00000000-0000-0000-0000-000000000001',
    createdAt: '2026-09-09T10:00:00.000Z',
    updatedAt: '2026-09-11T09:00:00.000Z',
  },
];

// Chinese locale so AntD-internal strings are deterministic (clients.spec precedent).
const PLAINTEXT = 'ab_abcdefghijklmnopqrstuvwxyz012345';

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
}

/** GET/POST/DELETE /api/v1/auth/api-keys backed by a mutable list so CRUD mutates the "DB". */
async function mockApiKeysApis(page: Page, keys: (typeof MOCK_KEYS)[number][]): Promise<void> {
  await page.route('**/api/v1/auth/api-keys', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: keys }),
      });
      return;
    }
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      const now = new Date().toISOString();
      const created = {
        id: `k-${Date.now()}`,
        name: body['name'] as string,
        prefix: PLAINTEXT.slice(0, 8),
        scopes: ['*'],
        expiresAt: (body['expiresAt'] as string | undefined) ?? null,
        lastUsedAt: null,
        revokedAt: null,
        tenantId: '00000000-0000-0000-0000-000000000001',
        createdAt: now,
        updatedAt: now,
      };
      keys.push(created);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { ...created, plaintext: PLAINTEXT } }),
      });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
  await page.route('**/api/v1/auth/api-keys/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      const id = route.request().url().match(/api-keys\/([^/]+)$/)?.[1] ?? '';
      const idx = keys.findIndex((k) => k.id === id);
      if (idx >= 0) keys.splice(idx, 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id, revoked: true } }),
      });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
}

test.describe('API keys management', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await mockCommonApis(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('page renders the table with mocked keys', async ({ page }) => {
    const keys = structuredClone(MOCK_KEYS);
    await mockApiKeysApis(page, keys);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/api-keys');
    await expect(page.getByTestId('api-keys-page')).toBeVisible();
    await expect(page.getByTestId('api-keys-table')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'CI Pipeline' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Legacy Export' })).toBeVisible();
    // list must never contain plaintext key material
    await expect(page.locator('body')).not.toContainText(PLAINTEXT);
  });

  test('create flow: reveal modal shows plaintext once (format ab_[a-z0-9]{32})', async ({ page }) => {
    const keys = structuredClone(MOCK_KEYS);
    await mockApiKeysApis(page, keys);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/api-keys');

    await page.getByTestId('api-keys-create').click();
    await page.getByTestId('api-keys-name-input').fill('Gamma Key');
    const reveal = page.locator('.ant-modal', { has: page.getByTestId('api-key-reveal-value') });
    await page.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(reveal).toBeVisible();
    const value = await page.getByTestId('api-key-reveal-value').inputValue();
    expect(value).toMatch(/^ab_[a-z0-9]{32}$/);
    // Chromium's headless permission policy can deny clipboard-write — pre-grant it
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('api-key-reveal-copy').click();
    await expect(page.getByTestId('api-key-reveal-copy')).toContainText('已复制');

    await reveal.locator('.ant-btn-primary').click();
    await expect(reveal).toBeHidden();
  });

  test('after close, the list does NOT contain the plaintext key', async ({ page }) => {
    const keys = structuredClone(MOCK_KEYS);
    await mockApiKeysApis(page, keys);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/api-keys');

    await page.getByTestId('api-keys-create').click();
    await page.getByTestId('api-keys-name-input').fill('Gamma Key');
    await page.locator('.ant-modal-footer .ant-btn-primary').click();
    const reveal = page.locator('.ant-modal', { has: page.getByTestId('api-key-reveal-value') });
    await expect(reveal).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Gamma Key' })).toBeHidden();
    await reveal.locator('.ant-btn-primary').click();
    await expect(reveal).toBeHidden();

    await expect(page.getByRole('cell', { name: 'Gamma Key' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(PLAINTEXT);
  });

  test('revoke: Popconfirm → 200 → row status flips', async ({ page }) => {
    const keys = structuredClone(MOCK_KEYS);
    await mockApiKeysApis(page, keys);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/api-keys');
    await expect(page.getByRole('cell', { name: 'CI Pipeline' })).toBeVisible();

    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'CI Pipeline' }) });
    await row.getByRole('button', { name: '撤销' }).click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();

    await expect(page.locator('.ant-message')).toContainText('API 密钥已撤销');
    await expect(page.getByRole('cell', { name: 'CI Pipeline' })).toBeHidden();
  });

  test('user without apikeys:read → 403 page', async ({ page }) => {
    const keys = structuredClone(MOCK_KEYS);
    await mockApiKeysApis(page, keys);
    await seedSessionWithMe(page, NO_APIKEYS_PERMS_ME);
    await page.goto('/api-keys');
    await expect(page.locator('.ant-result-403')).toBeVisible();
  });
});
