import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { IdentityService, OptionsManager } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// ldapts must never touch the network — provider is constructed by the route
// via dynamic import of @accessbase/identity, so mock the class there. A
// mutable handler lets each test drive authenticate()'s outcome.
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const testUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'ldap-user@test.local',
  name: 'Ldap User',
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
};

// Track whether claims objects get dereferenced for User-row fields the
// provider contract says they do not carry (R3 / T2-review carry).
let claimsIdDereferenced = false;
let claimsTenantIdDereferenced = false;

// Per-test knob: force findByEmail to return a suspended row for one email.
let suspendedEmail: string | null = null;

// Per-test knob: make the found row TOTP-enabled for one email (E step-up).
let totpEmail: string | null = null;

const authenticateMock = vi.fn();

const ldapProviderInstances: Array<{
  config: Record<string, unknown>;
  authenticate: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
    // Q2b routeTx seam: run the callback with a dummy handle (mocked
    // write methods ignore it; real tx semantics are locked by funnel-tx-integration.
    transaction: (fn: (d: unknown) => unknown) => fn({}),
      findByEmail: vi.fn(async (email: string) => {
        // Guard fast path: queryAdminExists looks up the admin email first.
        if (email === 'admin@accessbase.local') return { ...testUser, email };
        if (email === suspendedEmail) return { ...testUser, email, status: 'suspended' };
        if (email === totpEmail) return { ...testUser, email, totpEnabled: true };
        return email === testUser.email ? testUser : null;
      }),
      create: vi.fn(async (data: { email: string; name: string }) => ({
        ...testUser,
        email: data.email,
        name: data.name,
      })),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([]),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
    })),
    LdapProvider: vi.fn().mockImplementation((config: Record<string, unknown>) => {
      const inst = {
        config,
        authenticate: authenticateMock,
      };
      ldapProviderInstances.push(inst);
      return inst;
    }),
  };
});

// Options seam: LDAP keys read via getOptionsManager().get(key, env, default).
const optionsStore = new Map<string, unknown>([
  ['ldap_enabled', true],
  ['ldap_url', 'ldap://ldap.example.com:389'],
  ['ldap_base_dn', 'dc=example,dc=com'],
  ['ldap_bind_dn', 'cn=admin,dc=example,dc=com'],
  ['ldap_bind_password', 'bind-secret'],
  ['ldap_user_filter', '(uid={username})'],
]);

const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : (optionsStore.has(key) ? optionsStore.get(key) : defaultValue),
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');
const { resetManagers } = await import('../utils/managers.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeEach(async () => {
  // Q2a test seam: singleton managers — fresh construction per test (instance
  // probes below depend on per-test ctor results).
  await resetManagers();
});

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

const CLAIMS = {
  // Poisoned getters: any dereference of User-row-only fields records itself.
  get id() {
    claimsIdDereferenced = true;
    return 'should-not-be-read';
  },
  get tenantId() {
    claimsTenantIdDereferenced = true;
    return 'should-not-be-read';
  },
  dn: 'uid=alice,ou=people,dc=example,dc=com',
  email: 'ldap-user@test.local',
  name: 'Alice Anderson',
};

describe('POST /api/v1/auth/ldap/login', () => {
  it('happy path: 200 + token pair + reused user, LdapConfig assembled from options', async () => {
    ldapProviderInstances.length = 0;
    authenticateMock.mockResolvedValueOnce({ success: true, user: CLAIMS });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/ldap/login',
      payload: { username: 'alice', password: 'pw' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('test-refresh-token');
    expect(body.data.user.email).toBe('ldap-user@test.local');
    expect(body.data.user.roles).toEqual([]);

    // Options→LdapConfig mapping (R5/R6): fields must land on the right names
    const cfg = ldapProviderInstances[0]?.config as Record<string, unknown>;
    expect(cfg).toBeDefined();
    expect(cfg['enabled']).toBe(true);
    expect(cfg['url']).toBe('ldap://ldap.example.com:389');
    expect(cfg['searchBase']).toBe('dc=example,dc=com');
    expect(cfg['bindDN']).toBe('cn=admin,dc=example,dc=com');
    expect(cfg['bindPassword']).toBe('bind-secret');
    expect(cfg['searchFilter']).toBe('(uid={username})');

    // Reuse branch: findByEmail hit, create NOT called. Use the LAST instance
    // (setup-guard instantiates UserManager earlier on first request).
    const umInstances = vi.mocked(
      (await import('@accessbase/identity')).UserManager,
    ).mock.results;
    const umInstance = umInstances[umInstances.length - 1]?.value as {
      findByEmail: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    expect(umInstance.findByEmail).toHaveBeenCalledWith('ldap-user@test.local');
    expect(umInstance.create).not.toHaveBeenCalled();
  });

  it('provision branch: create called with DEFAULT_TENANT when findByEmail misses', async () => {
    authenticateMock.mockResolvedValueOnce({
      success: true,
      // Spread triggers getters; build plain object instead (CLAIMS itself is
      // passed raw in the dedicated structural test).
      user: {
        dn: 'uid=new,ou=people,dc=example,dc=com',
        email: 'new-user@test.local',
        name: 'New User',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/ldap/login',
      payload: { username: 'newbie', password: 'pw' },
    });

    expect(res.statusCode).toBe(200);
    const umInstances = vi.mocked(
      (await import('@accessbase/identity')).UserManager,
    ).mock.results;
    const umInstance = umInstances[umInstances.length - 1]?.value as {
      findByEmail: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    expect(umInstance.findByEmail).toHaveBeenCalledWith('new-user@test.local');
    expect(umInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new-user@test.local', name: 'New User' }),
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('claims are never dereferenced for id/tenantId (R3 contract, structural)', async () => {
    authenticateMock.mockResolvedValueOnce({ success: true, user: CLAIMS });
    claimsIdDereferenced = false;
    claimsTenantIdDereferenced = false;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/ldap/login',
      payload: { username: 'alice', password: 'pw' },
    });
    expect(claimsIdDereferenced).toBe(false);
    expect(claimsTenantIdDereferenced).toBe(false);
  });

  it('unconfigured: ldap_enabled false → 503 AUTH_063, provider never constructed', async () => {
    ldapProviderInstances.length = 0;
    optionsStore.set('ldap_enabled', false);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/ldap/login',
        payload: { username: 'alice', password: 'pw' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('AUTH_063');
      expect(ldapProviderInstances.length).toBe(0);
    } finally {
      optionsStore.set('ldap_enabled', true);
    }
  });

  it('missing ldap_url → 503 AUTH_063', async () => {
    const saved = optionsStore.get('ldap_url');
    optionsStore.delete('ldap_url');
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/ldap/login',
        payload: { username: 'alice', password: 'pw' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('AUTH_063');
    } finally {
      optionsStore.set('ldap_url', saved);
    }
  });

  it('AUTH_064 → 401 with generic message (no LDAP detail leak)', async () => {
    authenticateMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'AUTH_064', message: 'LDAP credentials rejected' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/ldap/login',
      payload: { username: 'alice', password: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('AUTH_064');
    expect(body.error.message).toBe('Invalid credentials');
    expect(body.error.message).not.toContain('LDAP');
  });


  it('AUTH_065 real → 500', async () => {
    authenticateMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'AUTH_065', message: 'sync failed' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/ldap/login',
      payload: { username: 'alice', password: 'pw' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('AUTH_065');
  });

  it('missing claims email → 500 AUTH_065 (R3: provision requires email)', async () => {
    authenticateMock.mockResolvedValueOnce({
      success: true,
      user: { dn: 'uid=x,ou=people,dc=example,dc=com', email: '', name: 'X' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/ldap/login',
      payload: { username: 'alice', password: 'pw' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('AUTH_065');
  });

  it('unexpected provider error code → fail-closed 401 (generic reject)', async () => {
    authenticateMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'AUTH_999', message: 'boom' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/ldap/login',
      payload: { username: 'alice', password: 'pw' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Invalid credentials');
  });

  it('suspended existing user → 403 AUTH_004, no token issuance', async () => {
    // SessionManager instances are shared across tests (created at app
    // registration) — clear issuance spies so earlier 200s don't pollute.
    const smMock = vi.mocked((await import('@accessbase/identity')).SessionManager);
    for (const r of smMock.mock.results) {
      (r.value as { issueRefreshToken: ReturnType<typeof vi.fn> })
        .issueRefreshToken.mockClear();
    }

    suspendedEmail = 'ldap-user@test.local';
    authenticateMock.mockResolvedValueOnce({ success: true, user: CLAIMS });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/ldap/login',
        payload: { username: 'alice', password: 'pw' },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('AUTH_004');
      expect(body.error.message).toBe('Account suspended');

      // Gate must fire before issuance: zero refresh tokens across ALL
      // SessionManager instances (access token only exists inside the pair).
      const issued = smMock.mock.results.reduce(
        (n, r) =>
          n +
          (r.value as { issueRefreshToken: ReturnType<typeof vi.fn> })
            .issueRefreshToken.mock.calls.length,
        0,
      );
      expect(issued).toBe(0);
    } finally {
      suspendedEmail = null;
    }
  });

  it('TOTP-enabled existing user → 200 MFA step-up ({mfaRequired, flowToken}), no token pair (E)', async () => {
    const smMock = vi.mocked((await import('@accessbase/identity')).SessionManager);
    for (const r of smMock.mock.results) {
      (r.value as { issueRefreshToken: ReturnType<typeof vi.fn> })
        .issueRefreshToken.mockClear();
    }

    totpEmail = 'ldap-user@test.local';
    authenticateMock.mockResolvedValueOnce({ success: true, user: CLAIMS });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/ldap/login',
        payload: { username: 'alice', password: 'pw' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.mfaRequired).toBe(true);
      expect(typeof body.data.flowToken).toBe('string');
      expect(body.data).not.toHaveProperty('accessToken');
      expect(body.data).not.toHaveProperty('refreshToken');

      const issued = smMock.mock.results.reduce(
        (n, r) =>
          n +
          (r.value as { issueRefreshToken: ReturnType<typeof vi.fn> })
            .issueRefreshToken.mock.calls.length,
        0,
      );
      expect(issued).toBe(0);
    } finally {
      totpEmail = null;
    }
  });
});
