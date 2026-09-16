import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IdentityService, OptionsManager } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
// MFA_ENCRYPTION_KEY: needed because the /auth/mfa/verify completion test calls
// auth.ts's requireMfaKey() — the MfaManager class itself is mocked below.
process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);

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
  // Generic OIDC RP stub (options-driven providers): numeric CodeChallengeMethod
  // mirrors arctic's runtime enum (R16); methods live on the prototype so tests
  // can vi.spyOn them.
  class OAuth2Client {
    constructor(
      public clientId: string,
      public clientPassword: string | null,
      public redirectURI: string | null,
    ) {}
    createAuthorizationURLWithPKCE(
      authorizationEndpoint: string,
      state: string,
      codeChallengeMethod: number,
      codeVerifier: string,
      scopes: string[],
    ): URL {
      const url = new URL(authorizationEndpoint);
      url.searchParams.set('client_id', this.clientId);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', `s256-${codeVerifier}`);
      url.searchParams.set('code_challenge_method', codeChallengeMethod === 0 ? 'S256' : 'plain');
      for (const s of scopes) url.searchParams.append('scope', s);
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
        accessToken: () => 'generic-access-token',
        refreshToken: () => 'generic-refresh-token',
        idToken: () => 'generic-id-token',
        hasRefreshToken: () => true,
        accessTokenExpiresAt: () => new Date(Date.now() + 3600_000),
      };
    }
  }
  return {
    GitHub,
    Google,
    OAuth2Client,
    CodeChallengeMethod: { S256: 0, Plain: 1 },
    generateState: () => 'test-state-123',
    generateCodeVerifier: () => 'test-verifier-456',
  };
});

// Mock plugins that require fastify@5 but fastify@4 is installed
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// UserManager + SessionManager mocked (DB-touching); see the FlowTokenService
// seam below for the shared issue/consume stub.
const testUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'oauth@test.local',
  name: 'OAuth User',
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
};

const sessionManagerMock = {
  issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
};
const mfaManagerMock = {
  verify: vi.fn(async (_userId: string, code: string) => ({ success: code === '123456' })),
  verifyRecoveryCode: vi.fn(async () => ({ success: false })),
};

const sharedFlowStore = new Map<string, { purpose: string; payload: unknown }>();
function resetSharedFlowStore(): void {
  sharedFlowStore.clear();
}
const sharedFlowTokens = {
  issue: vi.fn(async (purpose: string, payload: unknown) => {
    const token = crypto.randomUUID().replaceAll('-', '');
    sharedFlowStore.set(token, { purpose, payload });
    return token;
  }),
  consume: vi.fn(async <T,>(token: string, purpose: string): Promise<T | null> => {
    const rec = sharedFlowStore.get(token);
    if (rec) sharedFlowStore.delete(token); // burn-first: mirrors FlowTokenService consume
    if (!rec || rec.purpose !== purpose) return null;
    return rec.payload as T;
  }),
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
    FlowTokenService: vi.fn().mockImplementation(() => sharedFlowTokens),
    // mfa/verify completion test stubs the TOTP check (real class would hit PG)
    MfaManager: vi.fn().mockImplementation(() => mfaManagerMock),
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
      return { values: () => ({ returning: async () => [{ id: testUser.id, email: testUser.email, status: 'active' }] }) };
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

// Options seam: generic OIDC providers read config via getOptionsManager().
// A plain object with a get() honoring env-first matches the real contract;
// the identity mock above keeps @accessbase/identity itself off PG.
const optionsStore = new Map<string, unknown>();
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : (optionsStore.has(key) ? optionsStore.get(key) : defaultValue),
} as unknown as OptionsManager);

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
  it('returns 404 AUTH_OAUTH_001 for unknown provider (R17: not in registry)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/unknown-provider/authorize',
    });
    expect(res.statusCode).toBe(404);
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

describe('generic OIDC providers (options-driven)', () => {
  const dynamicConfig = {
    'my-oidc': {
      authUrl: 'https://idp.example.com/authorize',
      tokenUrl: 'https://idp.example.com/token',
      userinfoUrl: 'https://idp.example.com/userinfo',
      clientId: 'xxx',
      scope: 'openid profile email',
    },
  };

  function setDynamicOptions(): void {
    optionsStore.set('oauth_providers', JSON.stringify(dynamicConfig));
    optionsStore.set('oauth_my-oidc_client_secret', 'yyy');
  }

  it('authorize redirects for an options-configured provider with PKCE', async () => {
    setDynamicOptions();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/my-oidc/authorize' });
      expect(res.statusCode).toBe(302);
      const location = res.headers['location'] as string;
      expect(location).toContain('idp.example.com/authorize');
      expect(location).toContain('client_id=xxx');
      expect(location).toContain('code_challenge_method=S256');
      expect(location).toContain('code_challenge=');
      expect(res.cookies.find((c) => c.name === 'oauth_state')).toBeDefined();
      expect(res.cookies.find((c) => c.name === 'oauth_verifier')).toBeDefined();
    } finally {
      optionsStore.clear();
    }
  });

  it('skips malformed options JSON with warn (built-ins unaffected)', async () => {
    optionsStore.set('oauth_providers', 'not-json');
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/my-oidc/authorize' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('AUTH_OAUTH_001');
      const gh = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
      expect(gh.statusCode).toBe(302);
      expect(gh.headers['location']).toContain('github.com');
    } finally {
      optionsStore.clear();
    }
  });

  it('accepts the jsonb object shape for oauth_providers (Settings→Options flow)', async () => {
    // The options value column is jsonb: PUT /v1/options with an already-parsed
    // object stores the object itself, so OptionsManager.get() returns it
    // without a JSON text round-trip — the natural admin flow end-to-end.
    optionsStore.set('oauth_providers', dynamicConfig);
    optionsStore.set('oauth_my-oidc_client_secret', 'yyy');
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/my-oidc/authorize' });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location'] as string).toContain('idp.example.com/authorize');
    } finally {
      optionsStore.clear();
    }
  });

  it('skips entries with non-string scope or non-https endpoints (warn)', async () => {
    optionsStore.set('oauth_providers', {
      ...dynamicConfig,
      'num-scope': { ...dynamicConfig['my-oidc'], scope: 42 },
      'insecure-idp': { ...dynamicConfig['my-oidc'], authUrl: 'http://idp.example.com/authorize' },
    });
    // secrets present for all three — the skip must come from the field checks
    optionsStore.set('oauth_my-oidc_client_secret', 'yyy');
    optionsStore.set('oauth_num-scope_client_secret', 'yyy');
    optionsStore.set('oauth_insecure-idp_client_secret', 'yyy');
    try {
      const good = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/my-oidc/authorize' });
      expect(good.statusCode).toBe(302);
      const numScope = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/num-scope/authorize' });
      expect(numScope.statusCode).toBe(404);
      const insecure = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/insecure-idp/authorize' });
      expect(insecure.statusCode).toBe(404);
    } finally {
      optionsStore.clear();
    }
  });

  it('invalid provider names are rejected (404)', async () => {
    for (const name of ['UPPER', 'has_underscore']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/auth/oauth/${name}/authorize` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('AUTH_OAUTH_001');
    }
  });

  it('built-in takes precedence over same-name dynamic provider', async () => {
    optionsStore.set(
      'oauth_providers',
      JSON.stringify({
        github: {
          authUrl: 'https://evil.example.com/authorize',
          tokenUrl: 'https://evil.example.com/token',
          userinfoUrl: 'https://evil.example.com/userinfo',
          clientId: 'dynamic-id',
        },
      }),
    );
    optionsStore.set('oauth_github_client_secret', 'dyn-secret');
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
      expect(res.statusCode).toBe(302);
      const location = res.headers['location'] as string;
      expect(location).toContain('github.com');
      expect(location).not.toContain('evil.example.com');
    } finally {
      optionsStore.clear();
    }
  });

  it('callback happy path: PKCE token exchange + userinfo + provisioning', async () => {
    setDynamicOptions();
    const { OAuth2Client } = await import('arctic');
    const validateSpy = vi.spyOn(OAuth2Client.prototype, 'validateAuthorizationCode');
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).includes('idp.example.com/userinfo')) {
        return { ok: true, json: async () => ({ sub: 'sub-123', email: 'gen@t.local', name: 'Gen User' }) };
      }
      throw new Error('unexpected fetch ' + String(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const auth = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/my-oidc/authorize' });
      const state = auth.cookies.find((c) => c.name === 'oauth_state')?.value ?? '';
      const verifier = auth.cookies.find((c) => c.name === 'oauth_verifier')?.value ?? '';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/oauth/my-oidc/callback?code=gen_code&state=${state}`,
        cookies: { oauth_state: state, oauth_verifier: verifier },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toContain('/login?oauthCode=');
      expect(validateSpy).toHaveBeenCalledWith('https://idp.example.com/token', 'gen_code', 'test-verifier-456');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://idp.example.com/userinfo',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer generic-access-token' }) }),
      );
    } finally {
      vi.unstubAllGlobals();
      validateSpy.mockRestore();
      optionsStore.clear();
    }
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

  it('returns 403 AUTH_004 when the linked user is suspended (no token issued)', async () => {
    setProviderEnv(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string | URL) => {
        const u = String(url);
        // /user/emails must be matched BEFORE the broader /user prefix check
        if (u.endsWith('/user/emails')) {
          return { ok: true, json: async () => [{ email: 'gh@users.noreply.github.com', primary: true, verified: true }] };
        }
        if (u.includes('api.github.com/user')) {
          return { ok: true, json: async () => ({ id: 4242, login: 'ghuser', name: 'GH User', email: null }) };
        }
        throw new Error('unexpected fetch ' + u);
      }),
    );

    // linkedAccounts doubles as the mocked users-table store: an existing link
    // whose user row is suspended exercises the login gate, not provisioning.
    linkedAccounts.push({
      id: testUser.id,
      email: testUser.email,
      userId: testUser.id,
      provider: 'github',
      providerAccountId: '4242',
      status: 'suspended',
    });
    sessionManagerMock.issueRefreshToken.mockClear();
    try {
      const auth = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
      const state = auth.cookies.find((c) => c.name === 'oauth_state')?.value ?? '';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/oauth/github/callback?code=real_code&state=${state}`,
        cookies: { oauth_state: state },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_004' } });
      // Gate fired before issuance: no redirect with an exchange code, no session
      expect(res.headers['location']).toBeUndefined();
      expect(sessionManagerMock.issueRefreshToken).not.toHaveBeenCalled();
    } finally {
      linkedAccounts.length = 0;
      vi.unstubAllGlobals();
    }
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

// Task 2 (Batch E): MFA step-up on the OAuth login path. Callback issues ONLY
// an oauth_exchange code whose payload carries { userId, mfaPending: true } for
// TOTP-enabled users; the exchange endpoint consumes it AT EXCHANGE TIME and
// returns { mfaRequired, flowToken } (mfa_verify, 300s) instead of a token pair.
// /auth/mfa/verify is untouched (R5) — it already issues the session uniformly.
describe('OAuth MFA step-up (totpEnabled user)', () => {
  beforeEach(() => {
    resetSharedFlowStore();
    setProviderEnv(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/user/emails')) {
          return { ok: true, json: async () => [{ email: testUser.email, primary: true, verified: true }] };
        }
        if (u.includes('api.github.com/user')) {
          return { ok: true, json: async () => ({ id: 4242, login: 'ghuser', name: 'GH User', email: null }) };
        }
        throw new Error('unexpected fetch ' + u);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runCallback(): Promise<string> {
    const auth = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
    const state = auth.cookies.find((c) => c.name === 'oauth_state')?.value ?? '';
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?code=c&state=${state}`,
      cookies: { oauth_state: state },
    });
    expect(cb.statusCode).toBe(302);
    return (cb.headers['location'] as string).split('oauthCode=')[1]?.split('&')[0] ?? '';
  }

  function useTotpUser(): void {
    // linkedAccounts row drives the mocked users-table projection (id/email/status)
    linkedAccounts.length = 0;
    linkedAccounts.push({
      id: testUser.id,
      email: testUser.email,
      userId: testUser.id,
      provider: 'github',
      providerAccountId: '4242',
      status: 'active',
      totpEnabled: true,
    });
  }

  it('callback issues oauth_exchange code with mfaPending payload (no token pair pre-issued)', async () => {
    useTotpUser();
    sessionManagerMock.issueRefreshToken.mockClear();
    const oauthCode = await runCallback();
    expect(oauthCode).toBeTruthy();
    // R6: NO refresh session on the redirect chain — issuance stays centralized
    expect(sessionManagerMock.issueRefreshToken).not.toHaveBeenCalled();
    // payload rides the exchange code: { userId, mfaPending: true }
    const record = [...sharedFlowStore.values()].find((r) => r.purpose === 'oauth_exchange');
    expect(record).toBeDefined();
    expect(record?.payload).toMatchObject({ userId: testUser.id, mfaPending: true });
    expect(record?.payload).not.toHaveProperty('accessToken');
  });

  it('exchange for mfaPending user returns { mfaRequired, flowToken } instead of tokens', async () => {
    useTotpUser();
    const oauthCode = await runCallback();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/oauth/exchange', payload: { code: oauthCode } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.mfaRequired).toBe(true);
    expect(typeof body.data.flowToken).toBe('string');
    expect(body.data.accessToken).toBeUndefined();
    expect(body.data.refreshToken).toBeUndefined();
    // exchange-time issuance (R6): the mfa_verify token is minted HERE
    const mfaRecord = [...sharedFlowStore.values()].find((r) => r.purpose === 'mfa_verify');
    expect(mfaRecord?.payload).toMatchObject({ userId: testUser.id });
  });

  it('issued mfa_verify flowToken completes via the untouched /auth/mfa/verify (R5)', async () => {
    useTotpUser();
    const oauthCode = await runCallback();
    const ex = await app.inject({ method: 'POST', url: '/api/v1/auth/oauth/exchange', payload: { code: oauthCode } });
    const { flowToken } = ex.json().data;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/verify', payload: { flowToken, code: '123456' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.accessToken).toBeTruthy();
    expect(res.json().data.refreshToken).toBe('test-refresh-token');
    expect(mfaManagerMock.verify).toHaveBeenCalledWith(testUser.id, '123456');
  });
});

// Behavior lock: non-TOTP users keep the full token-pair flow unchanged.
describe('OAuth non-TOTP regression', () => {
  beforeEach(() => {
    resetSharedFlowStore();
    setProviderEnv(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('api.github.com/user')) {
          return { ok: true, json: async () => ({ id: 777, login: 'ex', name: 'Ex User', email: 'ex@t.local' }) };
        }
        throw new Error('unexpected fetch ' + u);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('callback → exchange still yields the login-shaped token pair (no mfaRequired)', async () => {
    // provisioned user path: linkedAccounts empty → insert branch returns active user without totpEnabled
    linkedAccounts.length = 0;
    const auth = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
    const state = auth.cookies.find((c) => c.name === 'oauth_state')?.value ?? '';
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?code=c&state=${state}`,
      cookies: { oauth_state: state },
    });
    expect(cb.statusCode).toBe(302);
    const oauthCode = (cb.headers['location'] as string).split('oauthCode=')[1]?.split('&')[0] ?? '';
    expect(oauthCode).toBeTruthy();

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/oauth/exchange', payload: { code: oauthCode } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBe('test-refresh-token');
    expect(body.data.mfaRequired).toBeUndefined();
    expect(body.data.user).toMatchObject({ email: testUser.email });
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

describe('GET /api/v1/auth/oauth/providers', () => {
  it('returns only env-configured built-ins when no dynamic options (public, names only)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/providers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.providers).toEqual(['github', 'google']);
  });

  it('merges dynamic providers (deduped) with env-configured built-ins', async () => {
    optionsStore.set(
      'oauth_providers',
      JSON.stringify({
        'my-oidc': {
          authUrl: 'https://idp.example.com/authorize',
          tokenUrl: 'https://idp.example.com/token',
          userinfoUrl: 'https://idp.example.com/userinfo',
          clientId: 'xxx',
        },
        github: {
          authUrl: 'https://x.example.com/authorize',
          tokenUrl: 'https://x.example.com/token',
          userinfoUrl: 'https://x.example.com/userinfo',
          clientId: 'dup',
        },
      }),
    );
    optionsStore.set('oauth_my-oidc_client_secret', 'yyy');
    optionsStore.set('oauth_github_client_secret', 'zzz');
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/providers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      // built-ins first, dynamic appended, same-name dynamic deduped
      expect(body.data.providers).toEqual(['github', 'google', 'my-oidc']);
    } finally {
      optionsStore.clear();
    }
  });
});
