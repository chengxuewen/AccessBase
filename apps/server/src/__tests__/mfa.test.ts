import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';
import { DEFAULT_TENANT } from '../utils/constants.js';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);

// Mock plugins that require fastify@5 but fastify@4 is installed
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// R1-T3: fake the identity/db connection so authDb() (the shared handle behind
// emitAuthEvent) writes into a captured insert log instead of dialing real PG.
interface CapturedInsert {
  values: Record<string, unknown>;
}
const eventInserts: CapturedInsert[] = [];
vi.mock('@accessbase/identity/db', async (importOriginal) => ({
  // real table defs; only the connection factory is faked (events.test.ts pattern)
  ...((await importOriginal()) as Record<string, unknown>),
  createDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        eventInserts.push({ values: vals });
        return Promise.resolve();
      }),
    })),
  })),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

// Deterministic TOTP: code '123456' valid, anything else invalid
const totpUser = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'admin@test.local' };

const mfaManagerMock = {
  setup: vi.fn(async () => ({
    secret: 'PLAINTEXTSECRET32BASE32CHARS',
    otpauthUrl: 'otpauth://totp/AccessBase:admin%40test.local?secret=X',
    qrDataUrl: 'data:image/png;base64,QR',
    recoveryCodes: Array.from({ length: 10 }, (_, i) => `deadbeef${String(i).padStart(2, '0')}`),
  })),
  enable: vi.fn(async () => {}),
  verify: vi.fn(async (_userId: string, code: string) => ({ success: code === '123456' })),
  verifyRecoveryCode: vi.fn(async (_userId: string, code: string) => ({ success: code === 'deadbeef00' })),
  disable: vi.fn(async () => {}),
};

// Login mock: totpEnabled flips per test
let loginTotpEnabled = false;
let loginPasswordInvalid = false;
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      verifyPassword: vi.fn().mockImplementation(async () => {
        if (loginPasswordInvalid) throw new Error('Invalid credentials');
        return { ...totpUser, totpEnabled: loginTotpEnabled };
      }),
      findById: vi.fn().mockResolvedValue({ ...totpUser, name: 'admin', status: 'active' }),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn(async () => ({ refreshToken: 'new-refresh-token' })),
      rotateRefreshToken: vi.fn(),
      findSessionByToken: vi.fn().mockResolvedValue(null),
      revokeSession: vi.fn(),
      revokeAllUserSessions: vi.fn(),
    })),
    // login success path now projects real roles (T2-4) — empty list keeps these tests behavior-identical
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([]),
    })),
    MfaManager: vi.fn().mockImplementation(() => mfaManagerMock),
  };
});

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

beforeEach(async () => {
  vi.clearAllMocks();
  loginTotpEnabled = false;
  loginPasswordInvalid = false;
  eventInserts.length = 0;
  // clear the memoized authDb() handle so the (cleared) createDb mock re-dials
  const { closeAuthDb } = await import('../utils/managers.js');
  await closeAuthDb();
  // re-arm createDb after clearAllMocks wiped its implementation
  const dbMod = (await import('@accessbase/identity/db')) as { createDb: ReturnType<typeof vi.fn> };
  dbMod.createDb.mockImplementation(() => ({
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        eventInserts.push({ values: vals });
        return Promise.resolve();
      }),
    })),
  }));
});

const authHeader = () => ({
  authorization: `Bearer ${app.jwt.sign({ sub: totpUser.id, email: totpUser.email })}`,
});

describe('login MFA branch', () => {
  it('totp_enabled user gets mfaRequired + flowToken, no tokens', async () => {
    loginTotpEnabled = true;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: totpUser.email, password: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.mfaRequired).toBe(true);
    expect(typeof body.data.flowToken).toBe('string');
    expect(body.data.flowToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.accessToken).toBeUndefined();
    expect(body.data.refreshToken).toBeUndefined();
  });

  it('non-MFA user still gets tokens (existing behavior)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: totpUser.email, password: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBe('new-refresh-token');
    expect(body.data.mfaRequired).toBeUndefined();
    // R1-T3 wire lock: exactly one auth.login.success events row, minimal payload shape
    const rows = eventInserts.filter((i) => i.values['type'] === 'auth.login.success');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values['payload']).toEqual({
      email: totpUser.email,
      method: 'password',
      userId: totpUser.id,
    });
  });
});

describe('R1-T3 auth events (logout + failure attribution)', () => {
  it('logout writes an auth.logout row from the token identity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: 'rt-1' },
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const row = eventInserts.find((i) => i.values['type'] === 'auth.logout');
    expect(row).toBeDefined();
    expect(row?.values['payload']).toEqual({ email: totpUser.email, method: 'password', userId: totpUser.id });
  });

  it('bad password writes auth.login.failure reason bad_credentials with the default-tenant fallback', async () => {
    loginPasswordInvalid = true;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'who@test.local', password: 'bad' },
    });
    expect(res.statusCode).toBe(401);
    const rows = eventInserts.filter((i) => i.values['type'] === 'auth.login.failure');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values['tenantId']).toBe(DEFAULT_TENANT);
    expect(rows[0]?.values['payload']).toEqual({ email: 'who@test.local', method: 'password', reason: 'bad_credentials' });
  });
});

describe('POST /api/v1/auth/mfa/verify', () => {
  const getFlowToken = async (): Promise<string> => {
    loginTotpEnabled = true;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: totpUser.email, password: 'pw' },
    });
    return res.json().data.flowToken as string;
  };

  it('valid flowToken + code → full token pair', async () => {
    const flowToken = await getFlowToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken, code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBe('new-refresh-token');
    expect(mfaManagerMock.verify).toHaveBeenCalledWith(totpUser.id, '123456');
    // R1-T3: the totp lane records ONE success event with method 'totp' (the
    // flow-token login itself issued no session, so no password-row exists)
    const rows = eventInserts.filter((i) => i.values['type'] === 'auth.login.success');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values['payload']).toMatchObject({ method: 'totp', email: totpUser.email });
  });

  it('accepts a recovery code as second factor', async () => {
    const flowToken = await getFlowToken();
    mfaManagerMock.verify.mockResolvedValueOnce({ success: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken, code: 'deadbeef00' },
    });
    expect(res.statusCode).toBe(200);
    expect(mfaManagerMock.verifyRecoveryCode).toHaveBeenCalled();
  });

  it('valid flowToken + wrong code → 401 AUTH_MFA_001', async () => {
    const flowToken = await getFlowToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken, code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_MFA_001');
  });

  it('invalid/expired flowToken → 401 even with valid code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken: 'bogus', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_MFA_001');
  });

  it('flowToken is single-use (replay → 401)', async () => {
    const flowToken = await getFlowToken();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken, code: '123456' },
    });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken, code: '123456' },
    });
    expect(replay.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/mfa/setup|enable|disable (auth required)', () => {
  it('setup without auth → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/setup' });
    expect(res.statusCode).toBe(401);
  });

  it('setup with auth returns url, qr and 10 codes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/setup',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.otpauthUrl).toMatch(/^otpauth:\/\//);
    expect(body.data.qrDataUrl).toMatch(/^data:image\/png/);
    expect(body.data.recoveryCodes).toHaveLength(10);
    expect(mfaManagerMock.setup).toHaveBeenCalledWith(totpUser.id, totpUser.email);
  });

  it('enable with auth + code calls enable', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/enable',
      headers: authHeader(),
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    expect(mfaManagerMock.enable).toHaveBeenCalledWith(totpUser.id, '123456');
  });

  it('enable with invalid code → 400', async () => {
    mfaManagerMock.enable.mockRejectedValueOnce(new Error('Invalid TOTP code'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/enable',
      headers: authHeader(),
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('disable without auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/disable',
      payload: { password: 'pw' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('disable with auth + correct password wipes MFA', async () => {
    const { UserManager } = await import('@accessbase/identity');
    const instance = (UserManager as unknown as ReturnType<typeof vi.fn>).mock.results;
    void instance;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/disable',
      headers: authHeader(),
      payload: { password: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    expect(mfaManagerMock.disable).toHaveBeenCalledWith(totpUser.id);
  });

  it('disable with wrong password → 401', async () => {
    loginPasswordInvalid = true;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/disable',
      headers: authHeader(),
      payload: { password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });
});
