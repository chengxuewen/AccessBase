import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';

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

beforeEach(() => {
  vi.clearAllMocks();
  loginTotpEnabled = false;
  loginPasswordInvalid = false;
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
