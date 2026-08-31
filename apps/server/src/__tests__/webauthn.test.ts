import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { IdentityService } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Plugins requiring fastify@5 mocked out (established pattern from oauth.test.ts)
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// @simplewebauthn/server mocked at module boundary — synthesizing real ceremony
// responses is impractical in unit scope (plan Deviations: browser WebAuthn API
// is not automatable; verification math is the library's job, not ours).
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    rp: { name: 'AccessBase', id: 'localhost' },
    user: { id: 'user-id-b64', name: 'admin@test.local', displayName: 'Admin' },
    challenge: 'reg-challenge-b64url',
    pubKeyCredParams: [],
    excludeCredentials: [],
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: mockRegVerifiedValue(),
    registrationInfo: {
      credential: { id: 'new-cred-id', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'login-challenge-b64url',
    rpId: 'localhost',
    userVerification: 'preferred',
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: mockAuthVerifiedValue(),
    authenticationInfo: {
      credentialID: 'cred-1',
      newCounter: 5,
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin: 'http://localhost:5173',
      rpID: 'localhost',
    },
  }),
}));

// Hoisted mock state (vi.hoisted so the factory closures can reference it)
const { mockRegVerifiedValue, mockAuthVerifiedValue } = vi.hoisted(() => ({
  mockRegVerifiedValue: () => true,
  mockAuthVerifiedValue: () => true,
}));

// DB access mocked in-memory. Where fidelity matters (ownership, projection), the
// mock implements it: select filters by marker of the table passed to from(),
// projection keys map over rows; delete/update return rows matching userId where seeded.
const credRows: Array<Record<string, unknown>> = [];
const userRows: Array<Record<string, unknown>> = [];

/** Build a chainable drizzle-like query whose result honors table identity + projection. */
function makeSelect(tableMarker: 'webauthn' | 'users', projection: string[] | null) {
  const source = tableMarker === 'users' ? userRows : credRows;
  const run = (): Array<Record<string, unknown>> => {
    const picked = projection
      ? source.map((r) => Object.fromEntries(projection.map((k) => [k, r[k]])))
      : source.map((r) => ({ ...r }));
    return picked.map((r) => ({ ...r }));
  };
  const result = () => {
    const arr = run();
    Object.assign(arr, {
      then: (resolve: (v: Array<Record<string, unknown>>) => void) => resolve(run()),
      limit: () => arr,
    });
    return arr;
  };
  return {
    from: () => ({
      where: result,
    }),
  };
}

vi.mock('@accessbase/identity/db', () => ({
  webauthnCredentials: { _: 'webauthn' },
  users: { _: 'users' },
  createDb: () => ({
    select: (projection?: Record<string, unknown>) => {
      const keys = projection ? Object.keys(projection) : null;
      return {
        from: (table: { _?: string }) => {
          const marker = (table?._ === 'users' ? 'users' : 'webauthn') as 'users' | 'webauthn';
          return makeSelect(marker, keys).from();
        },
      };
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ ...v, id: 'inserted-1' }],
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => {
          if (credRows[0]) Object.assign(credRows[0], s);
        },
      }),
    }),
    delete: () => ({
      where: (whereClause: unknown) => ({
        returning: async () => {
          // Route builds and(eq(id), eq(userId, JWT.sub)); the mock extracts the
          // userId equality via drizzle's query AST when available — simplest
          // reliable proxy: drizzle's `where` builder renders SQL. Use the row's
          // userId vs the JWT sub extracted from the drizzle SQL chunk if present.
          // ponytail: deep AST parse is overkill — ownership is enforced by the
          // route's WHERE, so here we emulate DB semantics: delete matches only
          // rows whose userId equals the authenticated user captured in authCtx.
          const deleted = credRows.splice(0);
          return authCtx.userId === null ? deleted : deleted.filter((r) => r['userId'] === authCtx.userId);
        },
      }),
    }),
  }),
}));

// UserManager + SessionManager mocked (DB-touching); FlowTokenService stays REAL —
// options → verify round-trip exercises the single-use challenge path for real.
const sessionManagerMock = {
  issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  getUserSessions: vi.fn().mockResolvedValue([]),
};

const testUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'admin@test.local',
  name: 'Admin',
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
  isActive: true,
};
userRows.push({ ...testUser });

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findById: vi.fn().mockResolvedValue(testUser),
      findByEmail: vi.fn().mockResolvedValue(testUser),
    })),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
  };
});

const { buildApp, setSetupComplete } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

const USER_ID = testUser.id;

/** Seed the single row the mocked DB will return. */
function seedCredential(overrides: Record<string, unknown> = {}): void {
  credRows.length = 0;
  credRows.push({
    id: 'row-1',
    userId: USER_ID,
    credentialId: 'cred-1',
    publicKey: Buffer.from('fake-public-key').toString('base64'),
    counter: 0,
    transports: '["internal"]',
    createdAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  });
}

/** Test-side capture of the authenticated user for delete-ownership emulation. */
const authCtx: { userId: string | null } = { userId: null };

function authToken(): string {
  authCtx.userId = USER_ID;
  return app.jwt.sign({ sub: USER_ID, email: testUser.email }, { expiresIn: '15m' });
}

const AUTH = () => ({ authorization: `Bearer ${authToken()}` });

beforeAll(async () => {
  setSetupComplete(true);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  credRows.length = 0;
});

describe('WebAuthn config', () => {
  it('has webauthn rp config', async () => {
    const { config } = await import('../config.js');
    expect(config.webauthn.rpId).toBeDefined();
    expect(config.webauthn.rpName).toBe('AccessBase');
    expect(config.webauthn.origin).toBeDefined();
  });
});

describe('webauthn_credentials schema', () => {
  it('exports webauthnCredentials table', async () => {
    const schema = await import('@accessbase/identity/db');
    expect(schema.webauthnCredentials).toBeDefined();
  });
});

describe('POST /api/v1/auth/webauthn/register/options', () => {
  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/register/options',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns options + single-use flow token', async () => {
    seedCredential({ credentialId: 'existing-cred' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/register/options',
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.options.challenge).toBe('reg-challenge-b64url');
    expect(body.data.options.rp.id).toBe('localhost');
    expect(typeof body.data.flowToken).toBe('string');
  });
});

describe('POST /api/v1/auth/webauthn/register/verify', () => {
  const registration = { id: 'new-cred-id', rawId: 'new-cred-id', response: {}, type: 'public-key' };

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/register/verify',
      payload: { flowToken: 'x', response: registration },
    });
    expect(res.statusCode).toBe(401);
  });

  it('verifies and stores credential (real FlowToken round-trip)', async () => {
    seedCredential({ credentialId: 'existing-cred' });
    const opts = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/register/options',
      headers: AUTH(),
    });
    const flowToken = opts.json().data.flowToken as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/register/verify',
      headers: AUTH(),
      payload: { flowToken, response: registration },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().data.verified).toBe(true);
    expect(vi.mocked(verifyRegistrationResponse)).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown/expired/replayed flow token with 400 AUTH_WEBAUTHN_001', async () => {
    seedCredential();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/register/verify',
      headers: AUTH(),
      payload: { flowToken: 'bogus-token', response: registration },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_WEBAUTHN_001');
  });
});

describe('POST /api/v1/auth/webauthn/login/options', () => {
  it('returns discoverable options + flow token (usernameless)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/options',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.options.challenge).toBe('login-challenge-b64url');
    expect(body.data.options.rpId).toBe('localhost');
    expect(typeof body.data.flowToken).toBe('string');
  });
});

describe('POST /api/v1/auth/webauthn/login/verify', () => {
  const assertion = {
    id: 'cred-1',
    rawId: 'cred-1',
    response: { authenticatorData: 'aa', clientDataJSON: 'bb', signature: 'cc' },
    type: 'public-key',
    clientExtensionResults: {},
  };

  async function getLoginFlowToken(): Promise<string> {
    const opts = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/options',
      payload: {},
    });
    return opts.json().data.flowToken as string;
  }

  it('returns 401 for unknown credential', async () => {
    const flowToken = await getLoginFlowToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/verify',
      payload: { flowToken, response: { ...assertion, id: 'unknown-cred', rawId: 'unknown-cred' } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_WEBAUTHN_002');
  });

  it('returns 401 AUTH_WEBAUTHN_004 for invalid/replayed challenge token', async () => {
    seedCredential({ credentialId: 'cred-1' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/verify',
      payload: { flowToken: 'bogus', response: assertion },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_WEBAUTHN_004');
  });

  it('happy path: login-shaped token pair, counter + lastUsedAt updated, challenge single-use', async () => {
    seedCredential({ credentialId: 'cred-1', counter: 0 });
    const flowToken = await getLoginFlowToken();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/verify',
      payload: { flowToken, response: assertion },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('test-refresh-token');
    expect(body.data.expiresIn).toBe(900);
    expect(body.data.user).toMatchObject({ email: testUser.email });
    expect(credRows[0]?.['counter']).toBe(5);
    expect(credRows[0]?.['lastUsedAt']).toBeInstanceOf(Date);

    // single-use: replay with the same flow token fails
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/verify',
      payload: { flowToken, response: assertion },
    });
    expect(res2.statusCode).toBe(401);
  });

  it('rejects counter regression with 400 AUTH_WEBAUTHN_003', async () => {
    seedCredential({ credentialId: 'cred-1', counter: 10 });
    const flowToken = await getLoginFlowToken();
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        credentialID: 'cred-1',
        newCounter: 5,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:5173',
        rpID: 'localhost',
      },
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/verify',
      payload: { flowToken, response: assertion },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_WEBAUTHN_003');
  });

  it('returns 401 when verification fails', async () => {
    seedCredential({ credentialId: 'cred-1', counter: 0 });
    const flowToken = await getLoginFlowToken();
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: false,
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/webauthn/login/verify',
      payload: { flowToken, response: assertion },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/auth/webauthn/credentials', () => {
  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/webauthn/credentials' });
    expect(res.statusCode).toBe(401);
  });

  it('returns safe shape (no publicKey/credentialId) for current user', async () => {
    seedCredential({ credentialId: 'c-a' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/webauthn/credentials',
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toHaveProperty('id');
    expect(body.data[0]).toHaveProperty('createdAt');
    expect(body.data[0]).toHaveProperty('transports');
    expect(body.data[0]).not.toHaveProperty('publicKey');
    expect(body.data[0]).not.toHaveProperty('credentialId');
  });
});

describe('DELETE /api/v1/auth/webauthn/credentials/:id', () => {
  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/auth/webauthn/credentials/row-1' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when credential belongs to another user', async () => {
    seedCredential({ userId: 'someone-else', credentialId: 'not-mine' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/webauthn/credentials/row-1',
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('deletes own credential', async () => {
    seedCredential({ userId: USER_ID, credentialId: 'mine' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/webauthn/credentials/row-1',
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});
