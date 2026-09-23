import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock plugins that require fastify@5 but fastify@4 is installed (same as routes.test.ts)
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// In-memory options store consumed by the mocked OptionsManager
const store = new Map<string, { value: unknown; updatedAt: Date }>();

// Mutable permission verdict for requirePermission (route-guard.test.ts pattern)
const allow = { value: true };
const hasPermission = vi.fn(async () => allow.value);

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    // D113: setup guard queries the users table — mock admin as existing
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({ hasPermission })),
    OptionsManager: vi.fn().mockImplementation(() => ({
      listAll: vi.fn(async () =>
        [...store.entries()].map(([key, e]) => ({ key, value: e.value, updatedAt: e.updatedAt })),
      ),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, { value, updatedAt: new Date() });
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    })),
  };
});

const { buildApp } = await import('../app.js');
const { setOptionsManager, resetOptionsManager } = await import('../routes/options.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', email: 'guard@test.local' });
});

afterAll(async () => {
  await app.close();
});

const AUTH = () => ({ authorization: `Bearer ${token}` });

beforeEach(() => {
  store.clear();
  allow.value = true;
  hasPermission.mockClear();
});

describe('GET /api/v1/options', () => {
  it('masks sensitive keys and leaves others untouched', async () => {
    store.set('jwt_secret', { value: 's3cr3t-value', updatedAt: new Date() });
    store.set('site_title', { value: 'AccessBase', updatedAt: new Date() });

    const res = await app.inject({ method: 'GET', url: '/api/v1/options', headers: AUTH() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const jwtSecret = body.data.find((e: { key: string }) => e.key === 'jwt_secret');
    const siteTitle = body.data.find((e: { key: string }) => e.key === 'site_title');
    expect(jwtSecret.value).toBe('******');
    expect(siteTitle.value).toBe('AccessBase');
  });

  it('masks keys matching each sensitive-pattern word (secret/password/token/key)', async () => {
    const rows = [
      { key: 'my_secret', value: 'a' },
      { key: 'db_password', value: 'b' },
      { key: 'api_token', value: 'c' },
      { key: 'license_key', value: 'd' },
      { key: 'plain_setting', value: 'e' },
    ];
    for (const r of rows) store.set(r.key, { value: r.value, updatedAt: new Date() });

    const res = await app.inject({ method: 'GET', url: '/api/v1/options', headers: AUTH() });

    const body = res.json();
    const byKey = Object.fromEntries(
      body.data.map((e: { key: string; value: unknown }) => [e.key, e.value]),
    );
    expect(byKey['my_secret']).toBe('******');
    expect(byKey['db_password']).toBe('******');
    expect(byKey['api_token']).toBe('******');
    expect(byKey['license_key']).toBe('******');
    expect(byKey['plain_setting']).toBe('e');
  });

  it('403 without options:read', async () => {
    allow.value = false;

    const res = await app.inject({ method: 'GET', url: '/api/v1/options', headers: AUTH() });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PERM_001');
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'options:read',
      '00000000-0000-0000-0000-000000000001',
    );
  });
});

describe('PUT /api/v1/options', () => {
  it('rejects invalid key format with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/options',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { key: '1-Bad Key!', value: 'x' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it('rejects masked placeholder value on a sensitive key with 400 (M5)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/options',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { key: 'jwt_secret', value: '******' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it('roundtrip: PUT then GET reflects stored value', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/options',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { key: 'site.name', value: 'Hello' },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: '/api/v1/options', headers: AUTH() });
    const body = get.json();
    const entry = body.data.find((e: { key: string }) => e.key === 'site.name');
    expect(entry.value).toBe('Hello');
  });

  it('accepts hyphenated provider secret keys (PROVIDER_NAME_PATTERN cross-contract)', async () => {
    // Dynamic provider secrets use oauth_<name>_client_secret keys and
    // PROVIDER_NAME_PATTERN allows hyphens — the key charset must allow them too.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/options',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { key: 'oauth_my-oidc_client_secret', value: '"yyy"' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.key).toBe('oauth_my-oidc_client_secret');
  });

  it('still rejects keys with a leading digit after hyphen widening', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/options',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { key: '1bad-key', value: 'x' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('OPT_001');
  });

  it('403 without options:write', async () => {
    allow.value = false;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/options',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { key: 'site_title', value: 'x' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERM_001');
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'options:write',
      '00000000-0000-0000-0000-000000000001',
    );
  });
});

describe('DELETE /api/v1/options/:key', () => {
  it('returns 204 and removes the key', async () => {
    store.set('site_title', { value: 'Hello', updatedAt: new Date() });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/options/site_title',
      headers: AUTH(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(store.has('site_title')).toBe(false);
  });

  it('403 without options:write', async () => {
    allow.value = false;

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/options/site_title',
      headers: AUTH(),
    });

    expect(res.statusCode).toBe(403);
  });
});

  // Batch P W3-2 (F13): allowlist + site.url origin rule.
  describe('option key allowlist and value validation (W3-2)', () => {
    it('rejects an unknown-but-format-legal key with a generic 400', async () => {
      allow.value = true;
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/options',
        headers: { authorization: `Bearer ${token}` },
        payload: { key: 'evil.anything', value: 'x' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: { message: string } }>().error.message).toBe('Unknown option key');
    });

    it('accepts the password-policy keys batch C reads at runtime', async () => {
      allow.value = true;
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/options',
        headers: { authorization: `Bearer ${token}` },
        payload: { key: 'password_min_length', value: 12 },
      });
      expect(res.statusCode).toBe(200);
    });

    it('site.url must be a bare http(s) origin', async () => {
      allow.value = true;
      const bad = [
        { v: 'not a url', why: 'absolute URL' },
        { v: 'ftp://host.example', why: 'http(s)' },
        { v: 'https://host.example/steal', why: 'without path' },
        { v: 'https://user:***@host.example', why: 'credentials' },
        { v: 'https://host.example?x=1', why: 'query' },
      ];
      for (const { v, why } of bad) {
        const res = await app.inject({
          method: 'PUT',
          url: '/api/v1/options',
          headers: { authorization: `Bearer ${token}` },
          payload: { key: 'site.url', value: v },
        });
        expect(res.statusCode, `value ${v} must be rejected (${why})`).toBe(400);
        expect(res.json<{ error: { message: string } }>().error.message).toContain(why);
      }
      const ok = await app.inject({
        method: 'PUT',
        url: '/api/v1/options',
        headers: { authorization: `Bearer ${token}` },
        payload: { key: 'site.url', value: 'https://app.example.com' },
      });
      expect(ok.statusCode).toBe(200);
    });
  });
