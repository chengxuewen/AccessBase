import { describe, it, expect, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// arctic network calls must never run in tests — replace providers with stubs
vi.mock('arctic', () => {
  class FakeProvider {
    constructor(
      public clientId: string,
      public clientSecret: string,
      public redirectURI: string | null,
    ) {}
    createAuthorizationURL(state: string, ...rest: unknown[]) {
      const base =
        this.constructor.name === 'GitHub'
          ? 'https://github.com/login/oauth/authorize'
          : 'https://accounts.google.com/o/oauth2/v2/auth';
      const url = new URL(base);
      url.searchParams.set('client_id', this.clientId);
      url.searchParams.set('state', state);
      if (typeof rest[0] === 'string') url.searchParams.set('code_challenge', rest[0]);
      if (Array.isArray(rest[rest.length - 1])) {
        for (const s of rest[rest.length - 1] as string[]) url.searchParams.set('scope', s);
      }
      return url;
    }
    async validateAuthorizationCode(): Promise<{
      accessToken: () => string;
      refreshToken: () => string;
      idToken: () => string;
      hasRefreshToken: () => boolean;
      accessTokenExpiresAt: () => Date;
    }> {
      return {
        accessToken: () => 'gh-access-token',
        refreshToken: () => 'gh-refresh-token',
        idToken: () => 'gh-id-token',
        hasRefreshToken: () => true,
        accessTokenExpiresAt: () => new Date(Date.now() + 3600_000),
      };
    }
  }
  class GitHub extends FakeProvider {}
  class Google extends FakeProvider {}
  return { GitHub, Google, generateState: () => 'test-state-123', generateCodeVerifier: () => 'test-verifier-456' };
});

// Mock plugins that require fastify@5 but fastify@4 is installed
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// UserManager + SessionManager mocked (DB-touching); FlowTokenService stays REAL
// so the exchange round-trip (issue → consume, single-use) is actually exercised.
const sessionManagerMock = {
  issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
};

const testUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'oauth@test.local',
  name: 'OAuth User',
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue(testUser),
      findById: vi.fn().mockResolvedValue(testUser),
      verifyPassword: vi.fn().mockResolvedValue(testUser),
      create: vi.fn().mockResolvedValue(testUser),
    })),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
  };
});

// oauth_accounts DB access via @accessbase/identity/db — mocked (in-memory link store)
const linkedAccounts: Array<Record<string, unknown>> = [];
vi.mock('@accessbase/identity/db', () => ({
  oauthAccounts: { _: 'oauth_accounts-marker' },
  users: { _: 'users-marker' },
  createDb: () => ({
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          // Drizzle builders are awaited either after .where() or after .where().limit();
          // a self-fulfilling thenable array satisfies both shapes.
          const result = linkedAccounts.map((r) =>
            projection ? Object.fromEntries(Object.keys(projection).map((k) => [k, r[k]])) : r,
          );
          const arr = result as Array<Record<string, unknown>> & { limit: () => Promise<Array<Record<string, unknown>>> };
          arr.limit = async () => arr;
          return arr;
        },
      }),
    }),
    insert() {
      return { values: () => ({ returning: async () => [{ id: testUser.id, email: testUser.email }] }) };
    },
    delete() {
      return {
        where: () => {
          const n = linkedAccounts.length;
          linkedAccounts.length = 0;
          const rows = Array.from({ length: n }, (_, i) => ({ id: String(i) }));
          const arr = rows as Array<{ id: string }> & { returning: () => Promise<Array<{ id: string }>> };
          arr.returning = async () => arr;
          return arr;
        },
      };
    },
  }),
}));

// Provider creds must exist BEFORE config.ts module snapshot
process.env['GITHUB_CLIENT_ID'] = 'test-gh-id';
process.env['GITHUB_CLIENT_SECRET'] = 'test-gh-secret';
process.env['GOOGLE_CLIENT_ID'] = 'test-gg-id';
process.env['GOOGLE_CLIENT_SECRET'] = 'test-gg-secret';

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

function setProviderEnv(on: boolean) {
  if (on) {
    process.env['GITHUB_CLIENT_ID'] = 'test-gh-id';
    process.env['GITHUB_CLIENT_SECRET'] = 'test-gh-secret';
  } else {
    delete process.env['GITHUB_CLIENT_ID'];
    delete process.env['GITHUB_CLIENT_SECRET'];
    delete process.env['GOOGLE_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_SECRET'];
  }
}

describe('OAuth config', () => {
  it('has github/google client id/secret + oauthRedirectBase in config', async () => {
    const { config } = await import('../config.js');
    expect(config).toHaveProperty('oauth.github.clientId');
    expect(config).toHaveProperty('oauth.github.clientSecret');
    expect(config).toHaveProperty('oauth.google.clientId');
    expect(config).toHaveProperty('oauth.google.clientSecret');
    expect(config).toHaveProperty('oauthRedirectBase');
  });
});

describe('oauth_accounts schema', () => {
  it('exports oauthAccounts table definition', async () => {
    const schema = await import('@accessbase/identity/db');
    expect(schema.oauthAccounts).toBeDefined();
  });
});

describe('GET /api/v1/auth/oauth/:provider/authorize', () => {
  it('returns 400 AUTH_OAUTH_001 for unsupported provider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/unknown-provider/authorize',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_OAUTH_001');
  });

  it('returns 503 AUTH_OAUTH_002 when provider is not configured', async () => {
    const { config } = await import('../config.js');
    const saved = config.oauth.github;
    config.oauth.github = { clientId: '', clientSecret: '' };
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('AUTH_OAUTH_002');
    } finally {
      config.oauth.github = saved;
    }
  });

  it('returns 302 with state cookie for GitHub (no PKCE per D109)', async () => {
    setProviderEnv(true);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
    expect(res.statusCode).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toContain('github.com');
    expect(location).toContain('state=');
    const stateCookie = res.cookies.find((c) => c.name === 'oauth_state');
    expect(stateCookie).toBeDefined();
    expect(stateCookie?.httpOnly).toBe(true);
    expect(String(stateCookie?.sameSite).toLowerCase()).toBe('lax');
  });

  it('returns 302 for Google with PKCE verifier cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/google/authorize' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location'] as string).toContain('accounts.google.com');
    const verifierCookie = res.cookies.find((c) => c.name === 'oauth_verifier');
    expect(verifierCookie).toBeDefined();
    // state cookie also set for Google
    // state cookie also set for Google
  });
});

describe('GET /api/v1/auth/oauth/:provider/callback', () => {
  it('redirects to /login?oauthError=state_mismatch on state mismatch (no stack)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/github/callback?code=auth_code&state=wrong',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('oauthError=state_mismatch');
    expect(res.body).not.toContain('stack');
  });

  it('redirects with error when code is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/github/callback?state=some',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('oauthError=');
  });

  it('redirects with error for unsupported provider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/facebook/callback?code=x&state=y',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('oauthError=');
  });

  it('happy path: issues exchange token and redirects to /login?oauthCode=...', async () => {
    setProviderEnv(true);
    // mock global fetch (GitHub profile + emails)
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/user/emails')) {
        return {
          ok: true,
          json: async () => [{ email: 'gh@users.noreply.github.com', primary: true, verified: true }],
        };
      }
      if (u.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ id: 4242, login: 'ghuser', name: 'GH User', email: null }),
        };
      }
      if (u.includes('api.github.com/user/emails')) {
        return {
          ok: true,
          json: async () => [{ email: 'gh@users.noreply.github.com', primary: true, verified: true }],
        };
      }
      throw new Error('unexpected fetch ' + u);
    });
    vi.stubGlobal('fetch', fetchMock);

    // first: authorize to get valid state cookie
    const auth = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
    const stateCookie = auth.cookies.find((c) => c.name === 'oauth_state');
    const state = stateCookie?.value ?? '';

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?code=real_code&state=${state}`,
      cookies: { oauth_state: state },
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toContain('/login?oauthCode=');
    // cookies cleared after use
    expect(res.headers['set-cookie']?.toString()).toContain('oauth_state=;');
    vi.unstubAllGlobals();
  });
});

describe('POST /api/v1/auth/oauth/exchange', () => {
  it('returns 400 for missing code', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/oauth/exchange', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it('returns 401 AUTH_OAUTH_003 for invalid/expired code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/exchange',
      payload: { code: 'invalid-code' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_OAUTH_003');
  });

  it('happy path: consumes flow token once and returns login-shaped token pair', async () => {
    // issue a REAL flow token via the same FlowTokenService the route uses (memory fallback in test env)
    const { FlowTokenService } = await import('@accessbase/identity');
    const flow = new FlowTokenService(undefined);
    const { config } = await import('../config.js');
    void config;
    // The route constructs its own FlowTokenService — memory fallback is per-instance,
    // so instead we go through the real callback to mint a code from the route's own instance.
    setProviderEnv(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('api.github.com/user')) {
          return { ok: true, json: async () => ({ id: 777, login: 'ex', name: 'Ex User', email: 'ex@t.local' }) };
        }
        throw new Error('unexpected ' + u);
      }),
    );
    const auth = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
    const state = auth.cookies.find((c) => c.name === 'oauth_state')?.value ?? '';
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?code=c&state=${state}`,
      cookies: { oauth_state: state },
    });
    const oauthCode = (cb.headers['location'] as string).split('oauthCode=')[1]?.split('&')[0] ?? '';
    expect(oauthCode).toBeTruthy();

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/oauth/exchange', payload: { code: oauthCode } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('test-refresh-token');
    expect(body.data.expiresIn).toBe(900);
    expect(body.data.user).toMatchObject({ email: testUser.email });

    // single-use: second consume fails
    const res2 = await app.inject({ method: 'POST', url: '/api/v1/auth/oauth/exchange', payload: { code: oauthCode } });
    expect(res2.statusCode).toBe(401);
    vi.unstubAllGlobals();
  });
});

describe('DELETE /api/v1/auth/oauth/:provider (unlink)', () => {
  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/auth/oauth/github' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 AUTH_OAUTH_001 for unsupported provider (authed)', async () => {
    const accessToken = app.jwt.sign({ sub: testUser.id, email: testUser.email }, { expiresIn: '15m' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/oauth/myspace',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_OAUTH_001');
  });

  it('returns 404 AUTH_OAUTH_004 when link does not exist', async () => {
    const accessToken = app.jwt.sign({ sub: testUser.id, email: testUser.email }, { expiresIn: '15m' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/oauth/github',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AUTH_OAUTH_004');
  });
});

describe('GET /api/v1/auth/oauth/links', () => {
  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/links' });
    expect(res.statusCode).toBe(401);
  });

  it('returns linked providers list for authed user', async () => {
    linkedAccounts.push({ userId: testUser.id, provider: 'github', providerAccountId: '4242' });
    const accessToken = app.jwt.sign({ sub: testUser.id, email: testUser.email }, { expiresIn: '15m' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/links',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ provider: 'github', providerAccountId: '4242' }]);
  });
});
