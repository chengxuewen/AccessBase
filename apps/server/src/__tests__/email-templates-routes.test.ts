/**
 * Q4c-T4 email-template routes: GET/PUT/preview/test wire behavior against a
 * buildApp instance with the plugin registered directly (app.ts wiring is
 * controller-side), plus the R8 dual-write validator closure on the generic
 * PUT /api/v1/options path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService, OptionsManager } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const mailerSend = vi.fn().mockResolvedValue(undefined);
const mailerFromConfig = vi.fn((cfg: { host?: string } | null | undefined) =>
  cfg && cfg.host ? { send: mailerSend } : null,
);

// env > stored row > default, mirroring the real OptionsManager.get priority
const rows = new Map<string, unknown>();

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn(async (email: string) =>
        email === 'admin@accessbase.local' ? { id: 'u1', email } : null,
      ),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn(async () => true),
    })),
    OptionsManager: vi.fn().mockImplementation(() => ({
      get: async (key: string, envValue: unknown, defaultValue: unknown) =>
        envValue !== undefined ? envValue : rows.has(key) ? rows.get(key) : defaultValue,
      set: async (key: string, value: unknown) => {
        rows.set(key, value);
      },
      delete: async (key: string) => {
        rows.delete(key);
      },
      listAll: async () =>
        [...rows.entries()].map(([key, value]) => ({ key, value, updatedAt: new Date() })),
    })),
    Mailer: { fromConfig: mailerFromConfig },
  };
});

const { buildApp } = await import('../app.js');
const { setOptionsManager } = await import('../routes/options.js');
const { emailTemplateRoutes } = await import('../routes/email-templates.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;
const AUTH = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp();
  // Test seam: in-memory options store for both route families.
  setOptionsManager({
    get: async (key: string, envValue: unknown, defaultValue: unknown) =>
      envValue !== undefined ? envValue : rows.has(key) ? rows.get(key) : defaultValue,
    set: async (key: string, value: unknown) => {
      rows.set(key, value);
    },
    delete: async (key: string) => {
      rows.delete(key);
    },
    listAll: async () =>
      [...rows.entries()].map(([key, value]) => ({ key, value, updatedAt: new Date() })),
  } as unknown as OptionsManager);
  // app.ts registration is controller-side; mount the plugin here instead.
  await app.register(emailTemplateRoutes, { prefix: '/api/v1' });
  token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', email: 'guard@test.local' });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  rows.clear();
  mailerSend.mockClear();
  delete process.env['SMTP_HOST'];
  delete process.env['SITE_URL'];
});

const BASE = '/api/v1/email-templates';

describe('GET /email-templates', () => {
  it('returns the 4 built-ins merged, overridden=false', async () => {
    const res = await app.inject({ method: 'GET', url: BASE, headers: AUTH() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string; subject: { en: string }; overridden: boolean }>;
    expect(data.map((d) => d.id)).toEqual(['verify', 'reset', 'magic', 'invite']);
    expect(data[0].subject.en).toBe('Verify your email');
    expect(data.every((d) => d.overridden === false)).toBe(true);
  });

  it('shows stored override merged over defaults per arm', async () => {
    rows.set('email_tmpl_reset', { subject: { en: 'Custom reset' } });
    const res = await app.inject({ method: 'GET', url: BASE, headers: AUTH() });
    const reset = res.json().data.find((d: { id: string }) => d.id === 'reset');
    expect(reset.overridden).toBe(true);
    expect(reset.subject.en).toBe('Custom reset');
    expect(reset.subject.zh.length).toBeGreaterThan(0); // default zh still present
  });

  it('401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: BASE });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /email-templates/:id', () => {
  it('stores a valid override; GET reflects it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${BASE}/verify`,
      headers: AUTH(),
      payload: { subject: { en: 'Confirm now' }, html: { en: '<p>{{link}}</p>' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe('verify');
    expect(rows.get('email_tmpl_verify')).toEqual({ subject: { en: 'Confirm now' }, html: { en: '<p>{{link}}</p>' } });
  });

  it('rejects unknown id with TEMPLATE_INVALID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${BASE}/bogus`,
      headers: AUTH(),
      payload: { subject: { en: 'x' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TEMPLATE_INVALID');
  });

  it('rejects script-bearing arms with TEMPLATE_INVALID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${BASE}/reset`,
      headers: AUTH(),
      payload: { html: { en: '<img src=x onerror=alert(1)>' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TEMPLATE_INVALID');
    expect(rows.has('email_tmpl_reset')).toBe(false);
  });

  it('null body clears the stored override', async () => {
    rows.set('email_tmpl_magic', { subject: { en: 'X' } });
    const res = await app.inject({
      method: 'PUT',
      url: `${BASE}/magic`,
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: 'null',
      payload: 'null',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.cleared).toBe(true);
    expect(rows.has('email_tmpl_magic')).toBe(false);
  });
});

describe('POST /email-templates/:id/preview', () => {
  it('renders sample vars without sending', async () => {
    const res = await app.inject({ method: 'POST', url: `${BASE}/invite/preview`, headers: AUTH(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.subject).toBe('Set your password');
    expect(res.json().data.html).toContain('alex@example.com');
    expect(mailerSend).not.toHaveBeenCalled();
  });

  it('body locale + stored + body draft overrides merge', async () => {
    rows.set('email_tmpl_reset', { subject: { zh: '存储的中文' } });
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reset/preview`,
      headers: AUTH(),
      payload: { locale: 'zh', overrides: { subject: { zh: '草稿中文' } } },
    });
    expect(res.json().data.subject).toBe('草稿中文'); // draft wins over stored
  });

  it('body vars replace samples; escaping applies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/magic/preview`,
      headers: AUTH(),
      payload: { vars: { link: 'https://x.test/p?a=1&b=2' } },
    });
    expect(res.json().data.html).toContain('href="https://x.test/p?a=1&amp;b=2"');
  });

  it('rejects invalid draft overrides and locale', async () => {
    const badOv = await app.inject({
      method: 'POST',
      url: `${BASE}/magic/preview`,
      headers: AUTH(),
      payload: { overrides: { subject: { en: '<script>x</script>' } } },
    });
    expect(badOv.statusCode).toBe(400);
    const badLocale = await app.inject({
      method: 'POST',
      url: `${BASE}/magic/preview`,
      headers: AUTH(),
      payload: { locale: 'fr' },
    });
    expect(badLocale.statusCode).toBe(400);
  });
});

describe('POST /email-templates/:id/test', () => {
  it('502 SMTP_UNAVAILABLE without mailer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reset/test`,
      headers: AUTH(),
      payload: { to: 'someone@test.local' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('SMTP_UNAVAILABLE');
    expect(mailerSend).not.toHaveBeenCalled();
  });

  it('202 sends stored template with a test link (fire-and-forget)', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    rows.set('email_tmpl_reset', { subject: { en: 'Stored reset' } });
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reset/test`,
      headers: AUTH(),
      payload: { to: 'someone@test.local' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toEqual({ sent: true });
    expect(mailerSend).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mailerSend.mock.calls[0] as [string, string, string];
    expect(to).toBe('someone@test.local');
    expect(subject).toBe('Stored reset');
    expect(html).toContain('email-template-test=reset');
  });

  it('uses site.url as the test-link origin', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    rows.set('site.url', 'https://idp.example.com');
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/magic/test`,
      headers: AUTH(),
      payload: { to: 'a@b.test' },
    });
    expect(res.statusCode).toBe(202);
    const html = String(mailerSend.mock.calls[0]?.[2] ?? '');
    expect(html).toContain('https://idp.example.com/login?email-template-test=magic');
  });

  it('unknown id → 400 before mailer resolution', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/bogus/test`,
      headers: AUTH(),
      payload: { to: 'a@b.test' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('R8 dual-write closure on generic PUT /api/v1/options', () => {
  it('accepts the five new keys with valid values', async () => {
    for (const [key, value] of [
      ['email_tmpl_verify', { subject: { en: 'ok' } }],
      ['email_tmpl_reset', { html: { zh: '<p>好</p>' } }],
      ['email_tmpl_magic', { subject: { en: 'a', zh: 'b' }, html: { en: 'c', zh: 'd' } }],
      ['email_tmpl_invite', { subject: { en: 'x' } }],
      ['email_locale_default', 'zh'],
    ] as const) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/options',
        headers: AUTH(),
        payload: { key, value },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('rejects invalid template values with OPT_001', async () => {
    const bad = [
      ['email_tmpl_verify', 'json-string'],
      ['email_tmpl_reset', { subject: { en: '<script>alert(1)</script>' } }],
      ['email_tmpl_magic', { subject: { en: 'a'.repeat(201) } }],
      ['email_locale_default', 'fr'],
    ] as const;
    for (const [key, value] of bad) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/options',
        headers: AUTH(),
        payload: { key, value },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('OPT_001');
      expect(rows.has(key)).toBe(false);
    }
  });
});
