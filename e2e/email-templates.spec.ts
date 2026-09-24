import { test, expect, type Page } from '@playwright/test';

// Mock-first Email Templates tab suite (Q4c-T5). Shapes copied verbatim from
// the Q4c contract (spec §7): GET /v1/email-templates returns the fixed four
// ids with jsonb-object arms; PUT returns the merged view; POST /:id/preview
// renders the STORED template; POST /:id/test → 202 or 502 SMTP_UNAVAILABLE.

interface TemplateRow {
  id: 'verify' | 'reset' | 'magic' | 'invite';
  subject: { en?: string; zh?: string };
  html: { en?: string; zh?: string };
  overridden: boolean;
}

interface TemplateMockStats {
  listRequests: number;
  lastPut: { id: string; body: Record<string, unknown> } | null;
  lastPreview: { id: string; body: Record<string, unknown> } | null;
  lastTest: { id: string; body: Record<string, unknown> } | null;
}

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

const FULL_PERMS_ME = {
  id: '1',
  email: 'admin@accessbase.local',
  name: 'Administrator',
  roles: [{ id: 'r-1', name: 'admin' }],
  permissions: ['options:read', 'options:write', 'users:read', 'audit:read', 'stats:read'],
  mfaEnabled: false,
};

// options:read only — tab visible, edit controls hidden.
const READONLY_ME = {
  id: '1',
  email: 'viewer@accessbase.local',
  name: 'Viewer',
  roles: [{ id: 'r-9', name: 'viewer' }],
  permissions: ['options:read'],
  mfaEnabled: false,
};

const MOCK_TEMPLATES = (): TemplateRow[] => [
  {
    id: 'verify',
    subject: { en: 'Verify your email', zh: '验证邮箱' },
    html: { en: '<p>Click {{link}}</p>', zh: '<p>点击 {{link}}</p>' },
    overridden: true,
  },
  {
    id: 'reset',
    subject: { en: 'Reset password' },
    html: { en: '<p>{{link}}</p>' },
    overridden: false,
  },
  {
    id: 'magic',
    subject: { en: 'Sign-in link' },
    html: { en: '<p>{{link}}</p>' },
    overridden: false,
  },
  {
    id: 'invite',
    subject: { en: 'You are invited', zh: '收到邀请' },
    html: { en: '<p>{{invitee}} from {{inviter}}, {{hours}}h</p>', zh: '<p>{{invitee}}</p>' },
    overridden: false,
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
  // Settings page mount fetches (roster copied from options.spec.ts)
  await page.route('**/api/v1/auth/sessions**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/v1/auth/webauthn/credentials', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/v1/options', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [{ key: 'site.name', value: 'Acme', updatedAt: new Date().toISOString() }] }),
    });
  });
}

/** Backs /v1/email-templates off one mutable in-browser "DB". */
async function mockTemplateApis(page: Page, templates: TemplateRow[], stats: TemplateMockStats): Promise<void> {
  await page.route('**/api/v1/email-templates**', async (route) => {
    const request = route.request();
    const method = request.method();
    const segments = new URL(request.url()).pathname.split('/').filter(Boolean); // api,v1,email-templates,<id>,<action>
    const id = segments[3] as TemplateRow['id'] | undefined;
    const action = segments[4];
    const row = templates.find((t) => t.id === id);

    if (method === 'GET' && segments.length === 3) {
      stats.listRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: templates }) });
      return;
    }

    if (method === 'PUT' && row && segments.length === 4) {
      const body = JSON.parse(request.postData() ?? '{}') as { subject?: TemplateRow['subject']; html?: TemplateRow['html'] };
      // server merge semantics: arms replace what is sent, absent arms kept
      row.subject = { ...row.subject, ...(body.subject ?? {}) };
      row.html = { ...row.html, ...(body.html ?? {}) };
      row.overridden = true;
      stats.lastPut = { id: row.id, body };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: row }) });
      return;
    }

    if (method === 'POST' && row && action === 'preview') {
      const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      stats.lastPreview = { id: row.id, body };
      const locale = typeof body['locale'] === 'string' ? body['locale'] : 'en';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { subject: `PREVIEW SUBJECT ${locale}`, html: `<p>preview html ${locale}</p>` } }),
      });
      return;
    }

    if (method === 'POST' && row && action === 'test') {
      const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      stats.lastTest = { id: row.id, body };
      // SMTP_UNAVAILABLE 502 arm (no mailer configured in mock world)
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'SMTP_UNAVAILABLE', message: 'SMTP is not configured' } }),
      });
      return;
    }

    await route.fulfill({ status: 405, contentType: 'application/json', body: '' });
  });
}

function freshStats(): TemplateMockStats {
  return { listRequests: 0, lastPut: null, lastPreview: null, lastTest: null };
}

test.describe('Email Templates tab', () => {
  let consoleErrors: string[];
  let templates: TemplateRow[];
  let stats: TemplateMockStats;

  test.beforeEach(async ({ page }) => {
    consoleErrors = trackConsoleErrors(page);
    await mockCommonApis(page);
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'console errors should be empty').toEqual([]);
  });

  async function gotoTemplatesTab(page: Page, me: Record<string, unknown> = FULL_PERMS_ME): Promise<void> {
    templates = MOCK_TEMPLATES();
    stats = freshStats();
    await mockTemplateApis(page, templates, stats);
    await seedSessionWithMe(page, me);
    await page.goto('/settings');
    // PIT-080 sanity: the tab's endpoint is only fetched once the tab is active
    expect(stats.listRequests).toBe(0);
    await page.getByRole('tab', { name: '邮件模板' }).click();
    await expect(page.getByTestId('email-templates-card')).toBeVisible();
    await expect.poll(() => stats.listRequests).toBeGreaterThan(0);
  }

  function rowFor(page: Page, label: string) {
    return page.locator('tr', { has: page.locator('td', { hasText: label }) });
  }

  test('tab lists the four templates with overridden tags', async ({ page }) => {
    await gotoTemplatesTab(page);
    await expect(rowFor(page, '邮箱验证').getByText('已自定义')).toBeVisible();
    await expect(rowFor(page, '密码重置').getByText('默认')).toBeVisible();
    await expect(rowFor(page, '魔法链接登录')).toBeVisible();
    await expect(rowFor(page, '邀请注册')).toBeVisible();
  });

  test('edit: PUT wire body carries subject/html localized arms', async ({ page }) => {
    await gotoTemplatesTab(page);
    await rowFor(page, '邮箱验证').getByTestId('email-templates-edit').click();
    const drawer = page.getByTestId('email-templates-drawer');
    await expect(drawer).toBeVisible();
    // initialValues prefill from the stored arms
    await expect(page.getByTestId('email-templates-subject-en')).toHaveValue('Verify your email');
    await page.getByTestId('email-templates-subject-en').fill('New verify subject');
    await page.getByTestId('email-templates-subject-zh').fill('新验证主题');
    await page.getByTestId('email-templates-save').click();

    await expect.poll(() => stats.lastPut, { timeout: 5000 }).not.toBeNull();
    expect(stats.lastPut?.id).toBe('verify');
    expect(stats.lastPut?.body).toEqual({
      subject: { en: 'New verify subject', zh: '新验证主题' },
      html: { en: '<p>Click {{link}}</p>', zh: '<p>点击 {{link}}</p>' },
    });
    await expect(page.locator('.ant-message')).toContainText('模板已保存');
    // merged view refreshes the row → new subject persists in the store
    expect(templates.find((t) => t.id === 'verify')?.subject.en).toBe('New verify subject');
  });

  test('preview: locale switch + sample vars wire, panel renders result', async ({ page }) => {
    await gotoTemplatesTab(page);
    await rowFor(page, '邀请注册').getByTestId('email-templates-edit').click();
    const drawer = page.getByTestId('email-templates-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByText('zh', { exact: true }).click();
    await page.getByTestId('email-templates-preview-run').click();

    await expect.poll(() => stats.lastPreview, { timeout: 5000 }).not.toBeNull();
    expect(stats.lastPreview?.id).toBe('invite');
    const body = stats.lastPreview?.body as { locale?: string; vars?: Record<string, unknown> };
    expect(body.locale).toBe('zh');
    expect(body.vars).toEqual({
      link: 'https://example.invalid/x',
      name: 'Ada',
      invitee: 'bob@example.com',
      inviter: 'Ada',
      hours: 24,
    });
    await expect(page.getByTestId('email-templates-preview-subject')).toHaveText('PREVIEW SUBJECT zh');
    await expect(page.getByTestId('email-templates-preview-frame')).toBeAttached();
  });

  test('test send: 502 SMTP_UNAVAILABLE surfaces as warning Alert', async ({ page }) => {
    await gotoTemplatesTab(page);
    await rowFor(page, '密码重置').getByTestId('email-templates-edit').click();
    await page.getByTestId('email-templates-test-to').fill('qa@acme.test');
    await page.getByTestId('email-templates-test-send').click();

    await expect.poll(() => stats.lastTest, { timeout: 5000 }).not.toBeNull();
    expect(stats.lastTest?.id).toBe('reset');
    expect(stats.lastTest?.body).toEqual({ to: 'qa@acme.test' });
    await expect(page.getByTestId('email-templates-smtp-alert')).toBeVisible();
    await expect(page.getByTestId('email-templates-smtp-alert')).toContainText('SMTP 不可用');
  });

  test('options:read only — tab renders but edit controls hidden', async ({ page }) => {
    await gotoTemplatesTab(page, READONLY_ME);
    await expect(page.getByTestId('email-templates-table')).toBeVisible();
    await expect(page.getByTestId('email-templates-edit')).toHaveCount(0);
  });
});
