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
      create: vi.fn(async (input: { name: string; redirectUris: string[]; grantTypes: string[]; scope: string; tokenAuthMethod?: string; backchannelLogoutUri?: string | null }) => {
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

  it('Q3D: backchannelLogoutUri passes through when http(s); invalid schemes dropped', async () => {
    const im = (await import('@accessbase/identity')).OidcClientManager as unknown as {
      mock: { results: Array<{ value: { create: ReturnType<typeof vi.fn> } }> };
    };
    const inst = im.mock.results[im.mock.results.length - 1]?.value;
    inst.create.mockClear();
    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'BC App',
        redirectUris: ['https://rp.example/cb'],
        grantTypes: ['authorization_code'],
        scope: 'openid',
        backchannelLogoutUri: 'https://rp.example/bc-logout',
      },
    });
    expect(good.statusCode).toBe(201);
    expect(inst.create).toHaveBeenCalledWith(expect.objectContaining({ backchannelLogoutUri: 'https://rp.example/bc-logout' }));

    inst.create.mockClear();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: {
        name: 'BC Bad',
        redirectUris: ['https://rp.example/cb'],
        grantTypes: ['authorization_code'],
        scope: 'openid',
        backchannelLogoutUri: 'javascript://evil',
      },
    });
    expect(bad.statusCode).toBe(201);
    const passed = inst.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(passed.backchannelLogoutUri).toBeUndefined();
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

// --- logout-coherence T-PKJ: tokenAuthMethod whitelist + none/CC gate + jwks rules ---

describe('POST /api/v1/clients — private_key_jwt validation (T-PKJ)', () => {
  const base = {
    name: 'PKJ App',
    redirectUris: ['https://rp.example/cb'],
    grantTypes: ['authorization_code'],
    scope: 'openid',
  };
  const post = (extra: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { ...base, ...extra },
    });

  /** Read the input object the route handed to manager.create on its last call. */
  async function inspectCreateCall(res: { statusCode: number }) {
    const im = (await import('@accessbase/identity')).OidcClientManager as unknown as {
      mock: { results: Array<{ value: { create: ReturnType<typeof vi.fn> } }> };
    };
    const inst = im.mock.results[im.mock.results.length - 1]?.value;
    const lastCall = inst.create.mock.calls[inst.create.mock.calls.length - 1]?.[0];
    void res;
    return lastCall as Record<string, unknown>;
  }

  const RSA_PUB_JWK = { kty: 'RSA', n: 'abc123', e: 'AQAB' };

  it('CLIENT_008: unknown tokenAuthMethod rejected', async () => {
    const res = await post({ tokenAuthMethod: 'client_secret_mac' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_008');
  });

  it('whitelisted tokenAuthMethods all accepted', async () => {
    for (const method of ['client_secret_basic', 'client_secret_post', 'none']) {
      const res = await post({ tokenAuthMethod: method });
      expect(res.statusCode).toBe(201);
    }
    const pkj = await post({ tokenAuthMethod: 'private_key_jwt', jwks: { keys: [RSA_PUB_JWK] } });
    expect(pkj.statusCode).toBe(201);
  });

  it('omitted tokenAuthMethod keeps the client_secret_basic default', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(201);
    const arg = await inspectCreateCall(res);
    expect(arg.tokenAuthMethod).toBeUndefined();
    expect(res.json().data.tokenAuthMethod).toBe('client_secret_basic');
  });

  it('CLIENT_009: none + client_credentials rejected (provider does not gate it)', async () => {
    const res = await post({ grantTypes: ['client_credentials'], tokenAuthMethod: 'none' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_009');
  });

  it('CLIENT_009: none + device_code rejected', async () => {
    const res = await post({
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
      tokenAuthMethod: 'none',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_009');
  });

  it('none + authorization_code stays legal', async () => {
    const res = await post({ tokenAuthMethod: 'none' });
    expect(res.statusCode).toBe(201);
  });

  it('CLIENT_010: private_key_jwt without jwks', async () => {
    const res = await post({ tokenAuthMethod: 'private_key_jwt' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_010');
  });

  it('CLIENT_010: private_key_jwt with empty keys array', async () => {
    const res = await post({ tokenAuthMethod: 'private_key_jwt', jwks: { keys: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_010');
  });

  it('CLIENT_011: RSA key carrying private member d rejected', async () => {
    const res = await post({
      tokenAuthMethod: 'private_key_jwt',
      jwks: { keys: [{ ...RSA_PUB_JWK, d: 'private-exponent' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_011');
  });

  it('CLIENT_011: EC key carrying extra k member rejected', async () => {
    const res = await post({
      tokenAuthMethod: 'private_key_jwt',
      jwks: { keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'b', k: 'junk' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_011');
  });

  it('CLIENT_011: unknown kty rejected', async () => {
    const res = await post({
      tokenAuthMethod: 'private_key_jwt',
      jwks: { keys: [{ kty: 'oct', k: 'shared-secret' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_011');
  });

  it('CLIENT_011: RSA key missing required member e rejected', async () => {
    const res = await post({
      tokenAuthMethod: 'private_key_jwt',
      jwks: { keys: [{ kty: 'RSA', n: 'abc123' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_011');
  });

  it('CLIENT_011 also guards jwks supplied alongside secret auth methods', async () => {
    const res = await post({
      tokenAuthMethod: 'client_secret_basic',
      jwks: { keys: [{ kty: 'RSA', n: 'a', e: 'b', p: 'prime' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLIENT_011');
  });

  it('valid public jwks passes through to manager.create verbatim', async () => {
    const jwks = { keys: [RSA_PUB_JWK, { kty: 'OKP', crv: 'Ed25519', x: 'pubkey' }] };
    const res = await post({ tokenAuthMethod: 'private_key_jwt', jwks });
    expect(res.statusCode).toBe(201);
    const arg = await inspectCreateCall(res);
    expect(arg.jwks).toEqual(jwks);
  });
});
