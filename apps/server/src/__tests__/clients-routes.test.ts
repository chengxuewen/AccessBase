import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock plugins that require fastify@5 but fastify@4 is installed
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// In-memory client store consumed by the mocked OidcClientManager
interface MockClient {
  id: string;
  clientId: string;
  name: string;
  secretEncrypted: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  grantTypes: string[];
  scope: string;
  tokenAuthMethod: string;
  createdAt: Date;
  updatedAt: Date;
}

const store = new Map<string, MockClient>();
let counter = 0;

// Mutable permission verdict for requirePermission
const allow = { value: true };
const hasPermission = vi.fn(async () => allow.value);

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({ hasPermission })),
    OidcClientManager: vi.fn().mockImplementation(() => ({
      create: vi.fn(async (input: { name: string; redirectUris: string[]; grantTypes: string[]; scope: string; tokenAuthMethod?: string }) => {
        const id = `id-${++counter}`;
        const clientId = `ab_test${counter}`;
        const plaintextSecret = `secret-${counter}-${Date.now()}`;
        const row: MockClient = {
          id,
          clientId,
          name: input.name,
          secretEncrypted: `encrypted-${plaintextSecret}`,
          redirectUris: input.redirectUris,
          postLogoutRedirectUris: [],
          grantTypes: input.grantTypes,
          scope: input.scope,
          tokenAuthMethod: input.tokenAuthMethod ?? 'client_secret_basic',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(clientId, row);
        return { client: row, plaintextSecret };
      }),
      list: vi.fn(async () =>
        [...store.values()].map(({ secretEncrypted: _s, ...rest }) => rest),
      ),
      get: vi.fn(async (clientId: string) => store.get(clientId)),
      rotateSecret: vi.fn(async (clientId: string) => {
        const existing = store.get(clientId);
        if (!existing) return undefined;
        const newSecret = `rotated-${Date.now()}`;
        store.set(clientId, { ...existing, secretEncrypted: `encrypted-${newSecret}`, updatedAt: new Date() });
        return newSecret;
      }),
      remove: vi.fn(async (clientId: string) => {
        store.delete(clientId);
      }),
    })),
  };
});

const { buildApp } = await import('../app.js');

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
  counter = 0;
  allow.value = true;
  hasPermission.mockClear();
});

describe('POST /api/v1/clients', () => {
  it('creates a client and returns clientSecret plaintext once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'Test App',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code'],
        scope: 'openid profile',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.clientSecret).toBeDefined();
    expect(typeof body.data.clientSecret).toBe('string');
    expect(body.data.clientId).toBeDefined();
    expect(body.data.name).toBe('Test App');
  });

  it('403 without clients:write', async () => {
    allow.value = false;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'Test App',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code'],
        scope: 'openid',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    expect(res.json().error.code).toBe('PERM_001');
  });

  it('400 with empty redirectUris', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'Bad App',
        redirectUris: [],
        grantTypes: ['authorization_code'],
        scope: 'openid',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it('400 with invalid redirect_uri (javascript: scheme)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'XSS App',
        redirectUris: ['javascript:alert(1)'],
        grantTypes: ['authorization_code'],
        scope: 'openid',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });
});

describe('GET /api/v1/clients', () => {
  it('lists clients without secret material', async () => {
    // Create a client first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'Listed App',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code'],
        scope: 'openid',
      },
    });
    const createdSecret = createRes.json().data.clientSecret;

    const res = await app.inject({ method: 'GET', url: '/api/v1/clients', headers: AUTH() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe('Listed App');
    // The plaintext secret MUST NOT appear anywhere in the list response
    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain(createdSecret);
  });

  it('403 without clients:read', async () => {
    allow.value = false;

    const res = await app.inject({ method: 'GET', url: '/api/v1/clients', headers: AUTH() });

    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    expect(res.json().error.code).toBe('PERM_001');
  });
});

describe('POST /api/v1/clients/:clientId/rotate-secret', () => {
  it('returns a new secret different from the original', async () => {
    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'Rotate App',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['client_credentials'],
        scope: 'openid',
      },
    });
    const clientId = createRes.json().data.clientId;
    const oldSecret = createRes.json().data.clientSecret;

    // Rotate
    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientId}/rotate-secret`,
      headers: AUTH(),
    });

    expect(rotateRes.statusCode).toBe(200);
    const body = rotateRes.json();
    expect(body.success).toBe(true);
    expect(body.data.clientId).toBe(clientId);
    expect(body.data.clientSecret).toBeDefined();
    expect(body.data.clientSecret).not.toBe(oldSecret);
  });
});

describe('DELETE /api/v1/clients/:clientId', () => {
  it('returns 204 and client no longer appears in list', async () => {
    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'Delete Me',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code'],
        scope: 'openid',
      },
    });
    const clientId = createRes.json().data.clientId;

    // Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/clients/${clientId}`,
      headers: AUTH(),
    });

    expect(deleteRes.statusCode).toBe(204);
    expect(deleteRes.body).toBe('');

    // Verify gone from list
    const listRes = await app.inject({ method: 'GET', url: '/api/v1/clients', headers: AUTH() });
    const body = listRes.json();
    expect(body.data.length).toBe(0);
  });
});
