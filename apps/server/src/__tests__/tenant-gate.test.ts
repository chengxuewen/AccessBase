import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { IdentityService, OptionsManager } from '@accessbase/identity';

// Tenant suspension gate (Batch G Task 3 / R1 + R8):
// - the gate lives INSIDE the issueTokenPair helpers + the refresh door, so a
//   suspended NON-default tenant blocks login/refresh/oauth-exchange with
//   403 {code:'AUTH_TENANT_001'} while default-tenant users are unaffected
//   (default tenant can never suspend — TenantManager TENANT_PROTECTED guard).
// Strategy per R8: a second tenant row (suspended) is constructed in the
// TenantManager mock; no real DB.

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

// arctic network calls must never run — same stub shape as oauth.test.ts
vi.mock('arctic', () => {
  class FakeProvider {
    constructor(
      public clientId: string,
      public clientSecret: string,
      public redirectURI: string | null,
    ) {}
    createAuthorizationURL(state: string): URL {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', this.clientId);
      url.searchParams.set('state', state);
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
  return {
    GitHub,
    Google,
    OAuth2Client: class {},
    CodeChallengeMethod: { S256: 0, Plain: 1 },
    generateState: () => 'test-state-123',
    generateCodeVerifier: () => 'test-verifier-456',
  };
});

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SUSPENDED_TENANT_ID = '00000000-0000-0000-0000-000000000042';

const defaultTenantUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'admin@test.local',
  name: 'Admin',
  status: 'active' as const,
  totpEnabled: false,
  tenantId: DEFAULT_TENANT_ID,
};

const suspendedTenantUser = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  email: 'suspended-tenant-user@test.local',
  name: 'Suspended Tenant User',
  status: 'active' as const,
  totpEnabled: false,
  tenantId: SUSPENDED_TENANT_ID,
};

// Mutable knobs: which user login resolves for which email, and tenant rows.
let userByEmail: Record<string, typeof defaultTenantUser | typeof suspendedTenantUser> = {};
let tenantRows: Array<{ id: string; status: string }> = [
  { id: DEFAULT_TENANT_ID, status: 'active' },
  { id: SUSPENDED_TENANT_ID, status: 'suspended' },
];

const tenantFindById = vi.fn(async (id: string) =>
  tenantRows.find((t) => t.id === id) ?? null,
);

const sessionManagerMock = {
  issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
  rotateRefreshToken: vi.fn(),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  getUserSessions: vi.fn().mockResolvedValue([]),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      verifyPassword: vi.fn(async (email: string) => {
        const u = userByEmail[email];
        if (!u) {
          throw new Error('Invalid credentials');
        }
        return u;
      }),
      findByEmail: vi.fn(async (email: string) => {
        // Setup-guard fast path: the admin-email lookup must hit (initialized
        // system) — route-level lookups go through the userByEmail knobs.
        if (email === 'admin@accessbase.local') return { ...defaultTenantUser, email };
        return userByEmail[email] ?? null;
      }),
      // Mock models the REAL scoping: findById is tenant-scoped in UserManager,
      // so a (id, tenantId) two-key lookup — a non-default-tenant user passed
      // with DEFAULT_TENANT returns null, exactly as production behaves.
      findById: vi.fn(async (id: string, tenantId: string) =>
        [defaultTenantUser, suspendedTenantUser].find(
          (u) => u.id === id && u.tenantId === tenantId,
        ) ?? null,
      ),
      findByIdAny: vi.fn(async (id: string) =>
        [defaultTenantUser, suspendedTenantUser].find((u) => u.id === id) ?? null,
      ),
      create: vi.fn(async (data: { email: string; name: string }) => ({
        ...defaultTenantUser,
        email: data.email,
        name: data.name,
      })),
      changePassword: vi.fn(async () => {}),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([]),
    })),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
    TenantManager: vi.fn().mockImplementation(() => ({
      findById: tenantFindById,
    })),
  };
});

// oauth_accounts / users table access (oauth.ts) + setup-guard queryAdminExists
// seam (users fast-path row; join path returns empty) — magic-login precedent.
const linkedAccounts: Array<Record<string, unknown>> = [];
vi.mock('@accessbase/identity/db', () => ({
  oauthAccounts: { _: 'oauth_accounts-marker' },
  users: { _: 'users-marker' },
  userRoles: { _: 'user_roles-marker' },
  roles: { _: 'roles-marker' },
  createDb: () => ({
    select: (projection?: Record<string, unknown>) => {
      // queryAdminExists fast path: an admin row must come back so the
      // setup guard reports initialized (otherwise every route 503s).
      const adminRow = { id: defaultTenantUser.id, email: 'admin@accessbase.local', status: 'active' };
      const rows = projection
        ? [Object.fromEntries(Object.keys(projection).map((k) => [k, adminRow[k as keyof typeof adminRow]]))]
        : [adminRow];
      const thenable = <T extends unknown[]>(arr: T): T & { limit: () => Promise<T> } => {
        (arr as T & { limit: () => Promise<T> }).limit = async () => arr;
        return arr as T & { limit: () => Promise<T> };
      };
      return {
        from: () => ({
          // queryAdminExists join path (fast path missed) — always empty.
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => thenable([] as Array<Record<string, unknown>>),
            }),
          }),
          // oauth.ts findOrCreateOAuthUser: the single linkedAccounts row (with
          // full user fields) drives BOTH lookups — account match and the
          // users-table row (id lookup by the link's userId). Projection maps
          // the requested columns; the gate therefore sees the row's REAL tenantId.
          where: () =>
            thenable(
              linkedAccounts.map((r) =>
                projection
                  ? Object.fromEntries(
                      Object.keys(projection)
                        .map((k) => [k, r[k]])
                        .filter(([, v]) => v !== undefined),
                    )
                  : r,
              ),
            ),
        }),
      };
    },
  }),
}));

// GitHub provider creds must exist BEFORE any module that snapshots config.ts
// (H2 fix: routes/options.js imports config — env set after this import left
// the provider unconfigured, authorize 503'd, and the callback died at
// unsupported_provider without ever reaching the gate).
process.env['GITHUB_CLIENT_ID'] = 'test-gh-id';
process.env['GITHUB_CLIENT_SECRET'] = 'test-gh-secret';

// Options seam (SAML/options probes read via getOptionsManager)
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

beforeEach(() => {
  userByEmail = {};
  linkedAccounts.length = 0;
  tenantFindById.mockClear();
  // Reset queued Once behaviors — a gate/door rejection that throws BEFORE
  // rotation leaves stale .mockResolvedValueOnce entries that would otherwise
  // leak into the next test's rotate call.
  sessionManagerMock.rotateRefreshToken.mockReset();
  sessionManagerMock.findSessionByToken.mockReset();
  sessionManagerMock.findSessionByToken.mockResolvedValue(null);
  sessionManagerMock.issueRefreshToken.mockClear();
});

const TENANT_403 = {
  success: false,
  error: { code: 'AUTH_TENANT_001', message: 'Access denied' },
};

async function githubCallbackFor(
  userId: string,
  profileEmail: string,
  tenantId: string,
): Promise<Awaited<ReturnType<typeof app.inject>> | undefined> {
  // Single linked row drives both lookups (account match + users-table row by
  // the link's userId) — oauth.test.ts useTotpUser precedent. Full user fields
  // so the gate sees the row's real tenantId.
  linkedAccounts.length = 0;
  linkedAccounts.push({
    id: userId,
    email: profileEmail,
    userId,
    provider: 'github',
    providerAccountId: '4242',
    status: 'active',
    totpEnabled: false,
    tenantId,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({
            id: 4242,
            login: 'ghuser',
            name: 'GH User',
            email: profileEmail,
          }),
        };
      }
      throw new Error('unexpected fetch ' + u);
    }),
  );
  const auth = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/authorize' });
  const state = auth.cookies.find((c) => c.name === 'oauth_state')?.value ?? '';
  const reply = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/oauth/github/callback?code=real_code&state=${state}`,
    cookies: { oauth_state: state },
  });
  vi.unstubAllGlobals();
  return reply;
}

describe('tenant suspension gate (AUTH_TENANT_001)', () => {
  it('login happy path (default tenant) is unaffected and resolves DEFAULT_TENANT via findById', async () => {
    userByEmail[defaultTenantUser.email] = defaultTenantUser;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: defaultTenantUser.email, password: 'Secret1!' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('test-refresh-token');
    // Gate resolved the DEFAULT tenant, not a suspended one
    expect(tenantFindById).toHaveBeenCalledWith(DEFAULT_TENANT_ID);
    expect(sessionManagerMock.issueRefreshToken).toHaveBeenCalled();
  });

  it('login for a suspended-tenant user → 403 {code AUTH_TENANT_001}, no tokens', async () => {
    userByEmail[suspendedTenantUser.email] = suspendedTenantUser;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: suspendedTenantUser.email, password: 'Secret1!' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject(TENANT_403);
    expect(tenantFindById).toHaveBeenCalledWith(SUSPENDED_TENANT_ID);
    // Gate fires BEFORE issuance — zero refresh tokens minted
    expect(sessionManagerMock.issueRefreshToken).not.toHaveBeenCalled();
  });

  it('refresh for a suspended-tenant session user → 403 AUTH_TENANT_001 (fail-closed door)', async () => {
    sessionManagerMock.findSessionByToken.mockResolvedValueOnce({
      id: 'sess-1',
      userId: suspendedTenantUser.id,
    });
    sessionManagerMock.rotateRefreshToken.mockResolvedValueOnce({
      refreshToken: 'should-never-be-issued',
      userId: suspendedTenantUser.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'presented-token' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject(TENANT_403);
    // Door fires BEFORE rotation — the presented token is not consumed
    expect(sessionManagerMock.rotateRefreshToken).not.toHaveBeenCalled();
  });
  
  // H1 regression: the gate's user resolution must be tenant-unfiltered.
  // findById is tenant-scoped — with the old DEFAULT_TENANT call a
  // non-default-tenant user resolves to null, the gate is SKIPPED, and
  // assertTenantActive falls back to the DEFAULT (active) tenant so rotation
  // proceeds. This test is RED against that code shape.
  it('refresh for a suspended NON-default-tenant user → 403 before rotation (findByIdAny door)', async () => {
    sessionManagerMock.findSessionByToken.mockResolvedValueOnce({
      id: 'sess-3',
      userId: suspendedTenantUser.id,
    });
    sessionManagerMock.rotateRefreshToken.mockResolvedValueOnce({
      refreshToken: 'must-not-be-issued',
      userId: suspendedTenantUser.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'non-default-suspended' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject(TENANT_403);
    // Suspended tenant was actually consulted (door saw the real tenant)
    expect(tenantFindById).toHaveBeenCalledWith(SUSPENDED_TENANT_ID);
    expect(sessionManagerMock.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('refresh with active tenant still rotates (door does not over-block)', async () => {
    sessionManagerMock.findSessionByToken.mockResolvedValueOnce({
      id: 'sess-2',
      userId: defaultTenantUser.id,
    });
    sessionManagerMock.rotateRefreshToken.mockResolvedValueOnce({
      refreshToken: 'new-raw-refresh-token',
      userId: defaultTenantUser.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'valid-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.refreshToken).toBe('new-raw-refresh-token');
    expect(tenantFindById).toHaveBeenCalledWith(DEFAULT_TENANT_ID);
  });

  it('oauth callback: suspended-tenant user → 302 /login?oauthError=AUTH_TENANT_001, gate fired, no tokens', async () => {
    // H2 fix (option a): GITHUB env now precedes the config snapshot, so the
    // provider resolves and the callback truly reaches issueTokenPair's gate.
    // M2 contract: the browser navigation channel carries the code on the
    // redirect (/login?oauthError=...) — never a raw JSON body.
    const reply = await githubCallbackFor(
      suspendedTenantUser.id,
      suspendedTenantUser.email,
      SUSPENDED_TENANT_ID,
    );
    expect(reply?.statusCode).toBe(302);
    expect(reply?.headers.location).toBe(
      '/login?oauthError=' + encodeURIComponent('AUTH_TENANT_001'),
    );
    // Gate consulted the user's REAL tenant (suspended row)
    expect(tenantFindById).toHaveBeenCalledWith(SUSPENDED_TENANT_ID);
    // Gate fired before issuance — zero refresh tokens minted across the flow
    expect(sessionManagerMock.issueRefreshToken).not.toHaveBeenCalled();
  });

  // FIX 1 regression: change-password re-issuance must propagate tenantId
  // to issueTokenPair so the gate checks the user's real tenant, not DEFAULT.
  it('change-password for suspended-tenant user → 403 AUTH_TENANT_001', async () => {
    const token = app.jwt.sign(
      { sub: suspendedTenantUser.id, email: suspendedTenantUser.email, status: 'active', tenantId: SUSPENDED_TENANT_ID },
      { expiresIn: '15m' },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { oldPassword: 'OldPass1!', newPassword: 'Brand#New!Pass789' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject(TENANT_403);
    // Gate consulted the user's REAL tenant (suspended row)
    expect(tenantFindById).toHaveBeenCalledWith(SUSPENDED_TENANT_ID);
  });
});
