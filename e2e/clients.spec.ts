import { test, expect, type Page } from '@playwright/test';

// Copied verbatim from route-guard-403.spec.ts (PIT-033: mocks mirror real route returns).
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
  ],
  mfaEnabled: false,
};

const NO_CLIENTS_PERMS_ME = {
  id: '1',
  email: 'limited@accessbase.local',
  name: 'Limited',
  roles: [{ id: 'r-2', name: 'staff' }],
  permissions: ['users:read'],
  mfaEnabled: false,
};

const MOCK_CLIENTS = [
  {
    id: 'c-1',
    clientId: 'client-alpha',
    name: 'Alpha App',
    redirectUris: ['https://alpha.example.com/cb'],
    grantTypes: ['authorization_code'],
    scope: 'openid profile email',
    tokenAuthMethod: 'client_secret_basic',
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
  },
  {
    id: 'c-2',
    clientId: 'client-beta',
    name: 'Beta Service',
    redirectUris: ['https://beta.example.com/cb'],
    grantTypes: ['client_credentials'],
    scope: 'openid',
    tokenAuthMethod: 'client_secret_post',
    createdAt: '2026-09-11T10:00:00.000Z',
    updatedAt: '2026-09-11T10:00:00.000Z',
  },
];

// Chinese locale so AntD-internal strings (pagination, buttons, tooltips) are
// deterministic — i18n init reads localStorage['lng'] (mfa-panel.spec precedent).
const SECRET_1 = 'test-plaintext-secret-ONE-TIME';
const SECRET_2 = 'test-plaintext-secret-ROTATED';

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

/** GET /api/v1/clients backed by a mutable list so create/delete mutate the "DB". */
async function mockClientsApis(
  page: Page,
  clients: (typeof MOCK_CLIENTS)[number][],
): Promise<void> {
  await page.route('**/api/v1/clients', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: clients }),
      });
      return;
    }
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      const created = {
        id: `c-${Date.now()}`,
        clientId: `client-${Date.now()}`,
        name: body['name'] as string,
        redirectUris: body['redirectUris'] as string[],
        grantTypes: body['grantTypes'] as string[],
        scope: body['scope'] as string,
        tokenAuthMethod: (body['tokenAuthMethod'] as string) ?? 'client_secret_basic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      clients.push(created);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { ...created, clientSecret: SECRET_1 } }),
      });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
  await page.route('**/api/v1/clients/*/rotate-secret', async (route) => {
    if (route.request().method() === 'POST') {
      const clientId = route.request().url().match(/clients\/([^/]+)\/rotate-secret/)?.[1] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { clientId, clientSecret: SECRET_2 } }),
      });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
  await page.route('**/api/v1/clients/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      const clientId = route.request().url().match(/clients\/([^/]+)$/)?.[1] ?? '';
      const idx = clients.findIndex((c) => c.clientId === clientId);
      if (idx >= 0) clients.splice(idx, 1);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
}

test.describe('OIDC clients management', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await mockCommonApis(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  test('page renders the table with mocked clients', async ({ page }) => {
    const clients = structuredClone(MOCK_CLIENTS);
    await mockClientsApis(page, clients);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/clients');
    await expect(page.getByTestId('clients-page')).toBeVisible();
    await expect(page.getByTestId('clients-table')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Alpha App' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Beta Service' })).toBeVisible();
    // list must never contain secret material
    await expect(page.locator('body')).not.toContainText(SECRET_1);
  });

  test('create flow: secret reveal modal shows the plaintext once', async ({ page }) => {
    const clients = structuredClone(MOCK_CLIENTS);
    await mockClientsApis(page, clients);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/clients');

    await page.getByTestId('clients-create').click();
    await page.getByTestId('clients-name-input').fill('Gamma App');
    await page.getByTestId('clients-redirect-uris-input').fill('https://gamma.example.com/cb');
    await page.getByTestId('clients-scope-input').fill('openid profile email');
    const reveal = page.locator('.ant-modal', { has: page.getByTestId('secret-reveal-value') });
    await page.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(reveal).toBeVisible();
    await expect(page.getByTestId('secret-reveal-value')).toHaveValue(SECRET_1);
    // Chromium's headless permission policy can deny clipboard-write — pre-grant it
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('secret-reveal-copy').click();
    await expect(page.getByTestId('secret-reveal-copy')).toContainText('已复制');

    await reveal.locator('.ant-btn-primary').click();
    await expect(reveal).toBeHidden();
  });

  test('after close, the list does NOT contain the plaintext secret', async ({ page }) => {
    const clients = structuredClone(MOCK_CLIENTS);
    await mockClientsApis(page, clients);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/clients');

    await page.getByTestId('clients-create').click();
    await page.getByTestId('clients-name-input').fill('Gamma App');
    await page.getByTestId('clients-redirect-uris-input').fill('https://gamma.example.com/cb');
    await page.locator('.ant-modal-footer .ant-btn-primary').click();
    const reveal = page.locator('.ant-modal', { has: page.getByTestId('secret-reveal-value') });
    await expect(reveal).toBeVisible();
    await reveal.locator('.ant-btn-primary').click();
    await expect(reveal).toBeHidden();

    await expect(page.getByRole('cell', { name: 'Gamma App' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(SECRET_1);
  });

  test('rotate → new secret revealed once', async ({ page }) => {
    const clients = structuredClone(MOCK_CLIENTS);
    await mockClientsApis(page, clients);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/clients');

    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Alpha App' }) });
    await row.getByRole('button', { name: '轮换密钥' }).click();
    const reveal = page.locator('.ant-modal', { has: page.getByTestId('secret-reveal-value') });
    await expect(reveal).toBeVisible();
    await expect(page.getByTestId('secret-reveal-value')).toHaveValue(SECRET_2);
  });

  test('delete: Popconfirm → 204 → row removed', async ({ page }) => {
    const clients = structuredClone(MOCK_CLIENTS);
    await mockClientsApis(page, clients);
    await seedSessionWithMe(page, FULL_PERMS_ME);
    await page.goto('/clients');
    await expect(page.getByRole('cell', { name: 'Alpha App' })).toBeVisible();

    const row = page.locator('tr', { has: page.getByRole('cell', { name: 'Alpha App' }) });
    await row.getByRole('button', { name: '删除' }).click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();

    await expect(page.locator('.ant-message')).toContainText('客户端已删除');
    await expect(page.getByRole('cell', { name: 'Alpha App' })).toBeHidden();
  });

  test('user without clients:read → 403 page', async ({ page }) => {
    const clients = structuredClone(MOCK_CLIENTS);
    await mockClientsApis(page, clients);
    await seedSessionWithMe(page, NO_CLIENTS_PERMS_ME);
    await page.goto('/clients');
    await expect(page.locator('.ant-result-403')).toBeVisible();
  });
});
