/**
 * Q4a helpdesk lanes — includes the Momus B1 WIRE assertion: the login 200
 * response schema must carry passwordChangeRequired through fast-json (page
 * mocks in e2e cannot catch that class; batch-B/G seam family).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const flowStore = new Map<string, { purpose: string; payload: unknown }>();
const flowTokenMock = {
  issue: vi.fn(async (purpose: string, payload: unknown) => {
    const t = `tok-${purpose}-${flowStore.size}`;
    flowStore.set(t, { purpose, payload });
    return t;
  }),
  consume: vi.fn(async (token: string, purpose: string) => {
    const e = flowStore.get(token);
    flowStore.delete(token);
    return e && e.purpose === purpose ? e.payload : null;
  }),
};

const state = {
  mustChange: true,
  hasPassword: false,
  adminReset: vi.fn().mockResolvedValue(undefined),
  revokeAll: vi.fn().mockResolvedValue(undefined),
  find: vi.fn(),
  mailSend: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      verifyPassword: vi.fn(async () => ({
        id: '550e8400-e29b-41d4-a716-446655440001',
        email: 'armed@test.local',
        name: 'Armed',
        status: 'active',
        tenantId: '00000000-0000-0000-0000-000000000001',
        totpEnabled: false,
        mustChangePassword: state.mustChange,
      })),
      findById: vi.fn(async (id: string) =>
        id === '550e8400-e29b-41d4-a716-446655440001'
          ? { id: '550e8400-e29b-41d4-a716-446655440001', email: 'armed@test.local', name: 'A', status: 'active', mustChangePassword: state.mustChange, tenantId: '00000000-0000-0000-0000-000000000001' }
          : null,
      ),
      // setup-guard fast path (users.test precedent)
      findByEmail: vi.fn(async (email: string) => (email === 'admin@accessbase.local' ? { id: '550e8400-e29b-41d4-a716-446655440001', email } : null)),
      hasPassword: vi.fn(async () => state.hasPassword),
      adminResetPassword: state.adminReset,
      resetPassword: vi.fn().mockResolvedValue(undefined),
      markEmailVerified: vi.fn().mockResolvedValue(undefined),
      transaction: (fn: (d: unknown) => unknown) => fn({}), // Q2b routeTx seam
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn(async () => []),
      findAll: vi.fn(async () => ({ data: [], total: 0 })),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn(async () => ({ refreshToken: 'rt' })),
      revokeAllUserSessions: state.revokeAll,
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn(async () => true),
      getUserEffectivePermissions: vi.fn(async () => []),
      // DG-6d seam: reset/invite lanes resolve tenant-wide by default.
      getUserDataScope: vi.fn(async () => 'all'),
    })),
    FlowTokenService: vi.fn().mockImplementation(() => flowTokenMock),
    OptionsManager: vi.fn().mockImplementation(() => ({
      get: vi.fn(async (_k: string, env: unknown, def: unknown) => (env !== undefined ? env : def)),
    })),
    Mailer: { fromConfig: vi.fn(() => ({ send: state.mailSend })) },
    getRedisClient: vi.fn(() => {
      throw new Error('no redis in unit lane');
    }),
  };
});

vi.mock('@accessbase/identity/db', () => ({
  users: { _: 'users' },
  userRoles: { _: 'ur' },
  roles: { _: 'r' },
  createDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ tenantId: '00000000-0000-0000-0000-000000000001' }] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  }),
}));

const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (_k: string, env: unknown, def: unknown) => (env !== undefined ? env : def),
} as never);
const { buildApp } = await import('../app.js');
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  flowStore.clear();
  flowTokenMock.issue.mockClear();
  state.adminReset.mockClear();
  state.revokeAll.mockClear();
  state.mailSend.mockClear();
  state.mustChange = true;
  state.hasPassword = false;
});

async function bearer(): Promise<Record<string, string>> {
  return { authorization: `Bearer ${app.jwt.sign({ sub: 'admin-1', email: 'admin@accessbase.local', status: 'active' })}` };
}

describe('Q4a login force-change arm', () => {
  it('WIRED (B1): 200 body carries passwordChangeRequired + flowToken, no pair', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'armed@test.local', password: 'Anything-1!' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data.passwordChangeRequired).toBe(true); // survives fast-json ONLY if schema-declared
    expect(typeof body.data.flowToken).toBe('string');
    expect(body.data.accessToken).toBeUndefined();
    expect(flowTokenMock.issue).toHaveBeenCalledWith('password_reset', { userId: '550e8400-e29b-41d4-a716-446655440001' }, 1800);
  });
  it('unarmed user proceeds past the arm', async () => {
    state.mustChange = false;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'armed@test.local', password: 'Anything-1!' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Record<string, unknown> }).data.passwordChangeRequired).toBeUndefined();
  });
});

describe('Q4a admin reset + invite', () => {
  it('admin reset: 200, manager funnel + session wipe invoked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440001/reset-password',
      headers: await bearer(),
      payload: { newPassword: 'TempPass-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(state.adminReset).toHaveBeenCalledTimes(1);
    expect(state.revokeAll).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001');
  });
  it('admin reset: cross-tenant id → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/660e8400-e29b-41d4-a716-446655440002/reset-password',
      headers: await bearer(),
      payload: { newPassword: 'TempPass-123' },
    });
    expect(res.statusCode).toBe(404);
  });
  it('invite: passwordless user → 202 + mail carries 72h password_reset token', async () => {
    process.env['SMTP_HOST'] = 'mail.test.local';
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440001/invite', headers: await bearer(), payload: {} });
    delete process.env['SMTP_HOST'];
    expect(res.statusCode).toBe(202);
    expect(state.mailSend).toHaveBeenCalledTimes(1);
    expect(String(state.mailSend.mock.calls[0]?.[2])).toContain('/reset-password?token=tok-password_reset-0');
    expect(flowTokenMock.issue).toHaveBeenCalledWith('password_reset', { userId: '550e8400-e29b-41d4-a716-446655440001' }, 72 * 3600);
  });
  it('invite: user WITH a password (not armed) → 409 pointing to reset', async () => {
    state.hasPassword = true;
    state.mustChange = false; // findById stays armed via shared state? see fixture below
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440001/invite', headers: await bearer(), payload: {} });
    expect(res.statusCode).toBe(409);
  });
});
