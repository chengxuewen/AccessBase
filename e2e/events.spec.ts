import { test, expect, type Page } from '@playwright/test';

// Q4d events history read surface (mock-first). Response shape copied verbatim
// from apps/server/src/routes/events.ts view(): {id(number), tenantId, type,
// payload(object), createdAt(ISO), fanoutComplete(bool)} inside a paginated
// {success, data, total} envelope (PIT-033). Gated by the existing audit:read.

interface EventRow {
  id: number;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  fanoutComplete: boolean;
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';

const MOCK_EVENTS = (): EventRow[] => [
  { id: 3, tenantId: TENANT_A, type: 'user.created', payload: { id: 'u-1', email: 'a@acme.test', name: 'Alice' }, createdAt: '2026-09-18T10:00:00.000Z', fanoutComplete: true },
  { id: 2, tenantId: TENANT_A, type: 'role.changed', payload: { id: 'r-1', op: 'set', userId: 'u-2' }, createdAt: '2026-09-18T09:00:00.000Z', fanoutComplete: false },
  { id: 1, tenantId: TENANT_A, type: 'group.changed', payload: { id: 'g-1', op: 'member', userId: 'u-3' }, createdAt: '2026-09-18T08:00:00.000Z', fanoutComplete: false },
];

async function seedSession(page: Page, me: Record<string, unknown>): Promise<void> {
  const persisted = JSON.stringify({
    state: { token: 'test-token', refreshToken: 'test-refresh', user: me, isAuthenticated: true },
    version: 0,
  });
  await page.addInitScript((value) => {
    window.localStorage.setItem('lng', 'zh');
    window.localStorage.setItem('auth-storage', value);
  }, persisted);
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: me }) });
  });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const isNoise =
      text.includes('findDOMNode') || text.includes('chrome-extension') || text.includes('moz-extension') ||
      text.includes('ResizeObserver loop') || text.includes('Failed to load resource') ||
      text.includes('[antd: compatible]') || text.includes('[antd: message]');
    if (!isNoise) errors.push(text);
  });
  return errors;
}

const AUDIT_ME = {
  id: '1', email: 'auditor@accessbase.local', name: 'Auditor',
  roles: [{ id: 'r-audit', name: 'auditor' }],
  permissions: ['audit:read', 'stats:read'],
  mfaEnabled: false,
};
// No audit:read → the /events route + menu entry must not be reachable.
const NO_AUDIT_ME = {
  id: '2', email: 'plain@accessbase.local', name: 'Plain',
  roles: [{ id: 'r-viewer', name: 'viewer' }],
  permissions: ['users:read', 'stats:read'],
  mfaEnabled: false,
};

async function mockCommon(page: Page): Promise<void> {
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) });
  });
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] } }) });
  });
  // PIT-080 roster: /login-shell probes mocked everywhere.
  for (const p of ['saml', 'sms', 'captcha']) {
    await page.route(`**/api/v1/auth/${p}/status`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: false } }) });
    });
  }
}

let lastListUrl = '';

async function mockEvents(page: Page, events: EventRow[]): Promise<void> {
  await page.route('**/api/v1/events**', async (route) => {
    const url = new URL(route.request().url());
    lastListUrl = url.pathname + url.search;
    const idSeg = url.pathname.split('/').filter(Boolean).slice(-1)[0]; // 'events' or an id
    if (idSeg && /^\d+$/.test(idSeg)) {
      const row = events.find((e) => e.id === Number(idSeg));
      await route.fulfill({
        status: row ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(row ? { success: true, data: row } : { success: false, error: { code: 'EVENT_NOT_FOUND', message: 'Event not found' } }),
      });
      return;
    }
    // server-side type filter (ilike substring) — emulate so the filter test is meaningful
    const type = url.searchParams.get('type');
    const data = type ? events.filter((e) => e.type.includes(type)) : events;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data, total: data.length }) });
  });
}

test.describe('Events history read surface (Q4d)', () => {
  test('renders rows with type + fan-out tags and payload cell', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await seedSession(page, AUDIT_ME);
    await mockCommon(page);
    await mockEvents(page, MOCK_EVENTS());
    await page.goto('/events');
    await expect(page.getByText('user.created')).toBeVisible();
    await expect(page.getByText('role.changed')).toBeVisible();
    // fanout tags: one Complete, two Pending
    await expect(page.getByText('已完成')).toHaveCount(1);
    await expect(page.getByText('进行中')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('type filter sends type= param and narrows the table', async ({ page }) => {
    await seedSession(page, AUDIT_ME);
    await mockCommon(page);
    await mockEvents(page, MOCK_EVENTS());
    await page.goto('/events');
    await page.getByPlaceholder('按类型过滤').fill('group');
    await page.getByText('查询').click();
    await expect(async () => {
      expect(lastListUrl).toContain('type=group');
    }).toPass({ timeout: 5000 });
    await expect(page.getByText('group.changed')).toBeVisible();
    await expect(page.getByText('user.created')).toHaveCount(0);
  });

  test('detail view opens the payload modal via GET /events/:id', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await seedSession(page, AUDIT_ME);
    await mockCommon(page);
    await mockEvents(page, MOCK_EVENTS());
    await page.goto('/events');
    await page.getByTestId('events-detail-3').click();
    // PIT/M.E.: assert dialog CONTENT, not ant-modal-root (computed-hidden when open)
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('a@acme.test')).toBeVisible();
    await expect(dialog.getByText('已完成')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('audit:read is required — no code, no menu entry and direct nav blocked', async ({ page }) => {
    await seedSession(page, NO_AUDIT_ME);
    await mockCommon(page);
    await mockEvents(page, MOCK_EVENTS());
    await page.goto('/');
    await expect(page.getByText('事件流水')).toHaveCount(0);
    await page.goto('/events');
    // PrivateRoute redirect: the table never renders without the permission
    await expect(page.getByText('领域事件')).toHaveCount(0);
  });
});
