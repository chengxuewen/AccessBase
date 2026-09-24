import { test, expect, type Page } from '@playwright/test';

// Mock-first Webhooks admin page suite (Q4c-T5). Response shapes copied
// verbatim from the Q4c API contract (routes/webhooks.ts, spec §6):
// list never carries secret material; create/rotate carry the plaintext
// secret ONCE; ping → 202 {deliveryQueued,eventId}; deliveries ledger rows.

interface WebhookRow {
  id: string;
  url: string;
  description?: string;
  subscribedEvents: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  pending: number;
  dead: number;
}

interface DeliveryRow {
  id: string;
  eventId: string;
  status: 'pending' | 'delivered' | 'dead';
  attempts: number;
  lastError: string | null;
  responseStatus: number | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface WebhookMockStats {
  listRequests: number;
  deliveriesRequests: number;
  created: { url: string; description?: string; subscribedEvents: string[] } | null;
  createSecretRevealed: boolean;
  lastPut: { id: string; body: Record<string, unknown> } | null;
  deleted: string | null;
  pinged: string[];
  rotated: string[];
}

const CREATED_SECRET = 'whsec_created_0f9e8d7c6b5a4321';
const ROTATED_SECRET = 'whsec_rotated_1a2b3c4d5e6f7890';

// Copied verbatim from groups-crud.spec.ts (PIT-033).
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
  'webhooks:read', 'webhooks:write',
  'options:read', 'options:write',
];

const FULL_PERMS_ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  roles: [{ id: 'r-1', name: 'admin' }],
  permissions: ADMIN_PERMS,
  mfaEnabled: false,
};

// Reduced set: read-only webhooks (no write code) — control-gating test.
const READONLY_ME = {
  id: '1',
  email: 'viewer@accessbase.local',
  name: 'Viewer',
  roles: [{ id: 'r-9', name: 'viewer' }],
  permissions: ['webhooks:read'],
  mfaEnabled: false,
};

function makeWebhook(overrides: Partial<WebhookRow> = {}): WebhookRow {
  const now = new Date().toISOString();
  return {
    id: `w-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    url: 'https://hooks.acme.test/new',
    description: undefined,
    subscribedEvents: ['user.created'],
    active: true,
    createdAt: now,
    updatedAt: now,
    pending: 0,
    dead: 0,
    ...overrides,
  };
}

const MOCK_WEBHOOKS = (): WebhookRow[] => [
  makeWebhook({ id: 'hook-a', url: 'https://hooks.acme.test/a', subscribedEvents: ['*'], pending: 3, dead: 0 }),
  makeWebhook({
    id: 'hook-b', url: 'https://hooks.acme.test/b', description: 'secondary lane',
    subscribedEvents: ['user.created', 'user.deleted'], active: false, pending: 0, dead: 2,
  }),
];

// Delivery ledger for GET /:id/deliveries (routes/webhooks.ts projection).
const MOCK_DELIVERIES = (): DeliveryRow[] => {
  const now = new Date().toISOString();
  return [
    { id: 'dlv-1', eventId: 'evt-1', status: 'delivered', attempts: 1, lastError: null, responseStatus: 200, deliveredAt: now, createdAt: now },
    { id: 'dlv-2', eventId: 'evt-2', status: 'pending', attempts: 2, lastError: 'connect timeout', responseStatus: null, deliveredAt: null, createdAt: now },
    { id: 'dlv-3', eventId: 'evt-3', status: 'dead', attempts: 5, lastError: 'ssrf-denied', responseStatus: 403, deliveredAt: null, createdAt: now },
  ];
};

async function mockCommonApis(page: Page): Promise<void> {
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
    });
  });
  // PIT-080 roster: /login-shell probes mocked in every spec (harness copy).
  await page.route('**/api/v1/auth/saml/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
  await page.route('**/api/v1/auth/sms/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
  await page.route('**/api/v1/auth/captcha/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
  });
}

/**
 * Backs the whole /v1/webhooks surface off one mutable in-browser "DB".
 * The GET list projection deliberately OMITS secret material (contract §8.1);
 * create/rotate responses carry the plaintext secret once.
 */
async function mockWebhookApis(
  page: Page,
  webhooks: WebhookRow[],
  deliveries: DeliveryRow[],
  stats: WebhookMockStats,
): Promise<void> {
  await page.route('**/api/v1/webhooks**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean); // api,v1,webhooks,<id>,<action>
    const id = segments[3];
    const action = segments[4];

    if (segments.length === 3 && method === 'GET') {
      stats.listRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: webhooks }),
      });
      return;
    }

    if (segments.length === 3 && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as {
        url?: string; description?: string; subscribedEvents?: string[];
      };
      const created = makeWebhook({
        url: body.url ?? '',
        description: body.description,
        subscribedEvents: body.subscribedEvents ?? [],
        pending: 0,
        dead: 0,
      });
      webhooks.push(created);
      stats.created = {
        url: created.url,
        ...(created.description !== undefined ? { description: created.description } : {}),
        subscribedEvents: created.subscribedEvents,
      };
      stats.createSecretRevealed = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { ...created, secret: CREATED_SECRET } }),
      });
      return;
    }

    if (method === 'GET' && action === 'deliveries') {
      stats.deliveriesRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: deliveries }),
      });
      return;
    }

    if (method === 'POST' && action === 'ping') {
      stats.pinged.push(id ?? '');
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { deliveryQueued: true, eventId: 'evt-ping-1' } }),
      });
      return;
    }

    if (method === 'POST' && action === 'rotate-secret') {
      stats.rotated.push(id ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { secret: ROTATED_SECRET } }),
      });
      return;
    }

    if (method === 'PUT' && id && segments.length === 4) {
      const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      const row = webhooks.find((w) => w.id === id);
      if (!row) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' } }),
        });
        return;
      }
      if (typeof body.url === 'string') row.url = body.url;
      if (typeof body.description === 'string') row.description = body.description;
      if (Array.isArray(body.subscribedEvents)) row.subscribedEvents = body.subscribedEvents as string[];
      if (typeof body.active === 'boolean') row.active = body.active;
      stats.lastPut = { id, body };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: row }) });
      return;
    }

    if (method === 'DELETE' && id && segments.length === 4) {
      const idx = webhooks.findIndex((w) => w.id === id);
      if (idx >= 0) webhooks.splice(idx, 1);
      stats.deleted = id;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) });
      return;
    }

    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
}

function freshStats(): WebhookMockStats {
  return {
    listRequests: 0, deliveriesRequests: 0, created: null, createSecretRevealed: false,
    lastPut: null, deleted: null, pinged: [], rotated: [],
  };
}

test.describe('Webhooks admin page', () => {
  let consoleErrors: string[];
  let webhooks: WebhookRow[];
  let deliveries: DeliveryRow[];
  let stats: WebhookMockStats;

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await mockCommonApis(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  async function gotoWebhooks(
    page: Page,
    me: Record<string, unknown> = FULL_PERMS_ME,
  ): Promise<void> {
    webhooks = MOCK_WEBHOOKS();
    deliveries = MOCK_DELIVERIES();
    stats = freshStats();
    await mockWebhookApis(page, webhooks, deliveries, stats);
    await seedSessionWithMe(page, me);
    await page.goto('/webhooks');
    await expect(page.getByTestId('webhooks-page')).toBeVisible();
    await expect(page.locator('td', { hasText: 'https://hooks.acme.test/a' }).first()).toBeVisible();
  }

  function rowFor(page: Page, url: string) {
    return page.locator('tr', { has: page.locator('td', { hasText: url }) });
  }

  test('menu entry visible with webhooks:read; list renders counts + active switch', async ({ page }) => {
    await gotoWebhooks(page);
    // Sidebar menu entry (i18n zh label)
    await expect(page.locator('.ant-menu').getByText('事件钩子', { exact: true })).toBeVisible();
    // pending/dead aggregates from the list projection
    await expect(rowFor(page, 'https://hooks.acme.test/a').getByText('3', { exact: true })).toBeVisible();
    await expect(rowFor(page, 'https://hooks.acme.test/b').getByText('2', { exact: true })).toBeVisible();
    // '*' subscription tag renders
    await expect(rowFor(page, 'https://hooks.acme.test/a').getByText('*', { exact: true })).toBeVisible();
    await expect(rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-active-switch')).toBeChecked();
    await expect(rowFor(page, 'https://hooks.acme.test/b').getByTestId('webhooks-active-switch')).not.toBeChecked();
    // list payload must not carry secret material anywhere in the DOM
    await expect(page.locator('body')).not.toContainText(CREATED_SECRET);
  });

  test('create: modal → POST 201 → reveal-once secret modal; secret never in list', async ({ page }) => {
    await gotoWebhooks(page);
    await page.getByTestId('webhooks-create').click();
    await page.getByTestId('webhooks-url-input').fill('https://hooks.acme.test/new');
    await page.getByTestId('webhooks-description-input').fill('created by e2e');
    const events = page.getByTestId('webhooks-events-select').getByRole('combobox');
    await events.click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content', { hasText: /^user\.created$/ }).click();
    await events.fill('role.updated');
    await events.press('Enter');
    await events.press('Escape'); // close dropdown — open options overlay intercepts the footer click

    await page.getByTestId('webhooks-form-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    await expect.poll(() => stats.created, { timeout: 5000 }).toEqual({
      url: 'https://hooks.acme.test/new',
      description: 'created by e2e',
      subscribedEvents: ['user.created', 'role.updated'],
    });
    // Reveal-once modal shows the secret exactly here…
    const reveal = page.getByTestId('webhooks-secret-reveal');
    await expect(reveal.locator('.ant-modal-content')).toBeVisible();
    await expect(reveal.locator('.ant-alert')).toContainText('请立即复制此密钥');
    await expect(page.getByTestId('webhooks-secret-value')).toHaveValue(CREATED_SECRET);
    // …and never again after dismissal (list re-rendered without secret).
    await reveal.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(reveal.locator('.ant-modal-content')).toBeHidden();
    await expect(rowFor(page, 'https://hooks.acme.test/new')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(CREATED_SECRET);
  });

  test('active switch: PUT wire body {active:false}', async ({ page }) => {
    await gotoWebhooks(page);
    await rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-active-switch').click();
    await expect.poll(() => stats.lastPut, { timeout: 5000 }).not.toBeNull();
    expect(stats.lastPut?.id).toBe('hook-a');
    expect(stats.lastPut?.body.active).toBe(false);
    await expect(rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-active-switch')).not.toBeChecked();
  });

  test('test ping: POST /:id/ping 202 → queued message', async ({ page }) => {
    await gotoWebhooks(page);
    await rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-ping').click();
    await expect.poll(() => stats.pinged, { timeout: 5000 }).toEqual(['hook-a']);
    await expect(page.locator('.ant-message')).toContainText('测试投递已入队');
  });

  test('deliveries drawer: ledger rows render + refresh re-fetches', async ({ page }) => {
    await gotoWebhooks(page);
    await rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-deliveries-open').click();
    const drawer = page.getByTestId('webhooks-deliveries');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('已送达', { exact: true })).toBeVisible();
    await expect(drawer.getByText('待投递', { exact: true }).last()).toBeVisible();
    await expect(drawer.getByText('死信', { exact: true })).toBeVisible();
    // attempts column renders for the pending row
    await expect(drawer.getByText('2', { exact: true })).toBeVisible();

    const before = stats.deliveriesRequests;
    await page.getByTestId('webhooks-deliveries-refresh').click();
    await expect.poll(() => stats.deliveriesRequests, { timeout: 5000 }).toBeGreaterThan(before);
  });

  test('rotate secret: POST rotate → reveal-once modal with new secret', async ({ page }) => {
    await gotoWebhooks(page);
    await rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-rotate').click();
    await expect.poll(() => stats.rotated, { timeout: 5000 }).toEqual(['hook-a']);
    const reveal = page.getByTestId('webhooks-secret-reveal');
    await expect(reveal.locator('.ant-modal-content')).toBeVisible();
    await expect(page.getByTestId('webhooks-secret-value')).toHaveValue(ROTATED_SECRET);
    await reveal.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(page.locator('body')).not.toContainText(ROTATED_SECRET);
  });

  test('delete: popconfirm → DELETE wire → row disappears', async ({ page }) => {
    await gotoWebhooks(page);
    await rowFor(page, 'https://hooks.acme.test/b').getByTestId('webhooks-delete').click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();
    await expect.poll(() => stats.deleted, { timeout: 5000 }).toBe('hook-b');
    await expect(rowFor(page, 'https://hooks.acme.test/b')).toHaveCount(0);
  });

  test('read-only user: create/edit/ping/rotate/delete hidden; switch disabled; deliveries available', async ({ page }) => {
    await gotoWebhooks(page, READONLY_ME);
    await expect(page.getByTestId('webhooks-create')).toHaveCount(0);
    await expect(page.getByTestId('webhooks-edit')).toHaveCount(0);
    await expect(page.getByTestId('webhooks-ping')).toHaveCount(0);
    await expect(page.getByTestId('webhooks-rotate')).toHaveCount(0);
    await expect(page.getByTestId('webhooks-delete')).toHaveCount(0);
    await expect(rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-active-switch')).toBeDisabled();
    // Deliveries is a read action — stays available for webhooks:read
    await expect(rowFor(page, 'https://hooks.acme.test/a').getByTestId('webhooks-deliveries-open')).toBeVisible();
  });
});
