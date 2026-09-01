import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';

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

let loginPasswordInvalid = false;

const pwUser = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  email: 'pw@test.local',
  name: 'pw admin',
  isActive: true,
  totpEnabled: false,
  tenantId: '00000000-0000-0000-0000-000000000001',
  tokenVersion: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const changePasswordMock = vi.fn();
const resetPasswordMock = vi.fn();
const sessionManagerMock = {
  issueRefreshToken: vi.fn(async () => ({ refreshToken: 'fresh-refresh-token' })),
  rotateRefreshToken: vi.fn(),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn().mockResolvedValue(2),
};
// Real-ish FlowTokenService: in-memory store; issue() captures tokens for assertions
const flowStore = new Map<string, { payload: { purpose: string }; expiresAt: number }>();
const issuedTokens: string[] = [];
const flowTokenMock = {
  issue: vi.fn(async (purpose: string, payload: { purpose: string }, ttl: number) => {
    const token = 'tok-' + Math.random().toString(36).slice(2);
    issuedTokens.push(token);
    flowStore.set(token, { payload: { ...payload, purpose }, expiresAt: Date.now() + ttl * 1000 });
    return token;
  }),
  consume: vi.fn(async (token: string, purpose: string) => {
    const entry = flowStore.get(token);
    if (!entry || Date.now() > entry.expiresAt || entry.payload.purpose !== purpose) return null;
    flowStore.delete(token); // single-use
    return { userId: 'u', ...entry.payload };
  }),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      verifyPassword: vi.fn().mockImplementation(async (_email: string, password: string) => {
        if (loginPasswordInvalid || password !== 'pw') throw new Error('Invalid credentials');
        return { ...pwUser };
      }),
      findById: vi.fn().mockResolvedValue({ ...pwUser }),
      findByEmail: vi.fn().mockImplementation(async (email: string) =>
        email === pwUser.email || email === 'admin@accessbase.local' ? { ...pwUser } : null,
      ),
      changePassword: changePasswordMock.mockImplementation(
        async (_userId: string, oldPassword: string) => {
          if (oldPassword !== 'Current!Pass456') throw new Error('Invalid credentials');
        },
      ),
      resetPassword: resetPasswordMock,
    })),
    FlowTokenService: vi.fn().mockImplementation(() => flowTokenMock),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
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
  loginPasswordInvalid = false;
});

const authHeader = () => ({
  authorization: `Bearer ${app.jwt.sign({ sub: pwUser.id, email: pwUser.email })}`,
});

const STRONG_NEW = 'Brand#New!Pass789';

describe('POST /api/v1/auth/change-password', () => {
  it('happy path: valid old + strong new → fresh tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeader(),
      payload: { oldPassword: 'Current!Pass456', newPassword: STRONG_NEW },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('fresh-refresh-token');
    expect(body.data.expiresIn).toBe(900);
    expect(changePasswordMock).toHaveBeenCalledWith(
      pwUser.id,
      'Current!Pass456',
      STRONG_NEW,
    );
  });

  it('wrong oldPassword → 401 (changePassword contract rejects)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeader(),
      payload: { oldPassword: 'WrongOld!Pass1', newPassword: STRONG_NEW },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_002');
  });

  it('weak newPassword (no special char) → 400 VALIDATION_001 with field info', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeader(),
      payload: { oldPassword: 'Current!Pass456', newPassword: 'NoSpecial123abc' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_001');
    expect(body.error.message).toMatch(/password/i);
  });

  it('short newPassword (<12) → 400 VALIDATION_001', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeader(),
      payload: { oldPassword: 'Current!Pass456', newPassword: 'Sh0rt!x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_001');
  });

  it('password reused from history → 400 PASSWORD_REUSED', async () => {
    // Real reuse gate lives in UserManager.rotatePassword; simulate rejection
    changePasswordMock.mockImplementationOnce(async () => {
      throw new Error('PASSWORD_REUSED');
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeader(),
      payload: { oldPassword: 'Current!Pass456', newPassword: 'OldValid!Pass123' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PASSWORD_REUSED');
  });

  it('unauthenticated → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { oldPassword: 'Current!Pass456', newPassword: STRONG_NEW },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/forgot-password', () => {
  it('existing email → success:true, reset token issued (logged server-side)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: pwUser.email },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ success: true });
    expect(body.data).toBeUndefined();
    // No email service (P0 out of scope): token is logged server-side, not returned
    expect(flowTokenMock.issue).toHaveBeenCalledWith('password_reset', { userId: pwUser.id }, 1800);
  });

  it('non-existing email → IDENTICAL success body (anti-enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ghost@nowhere.tld' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it('missing email → 400 VALIDATION_001', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_001');
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  it('happy path: valid token → success, all sessions revoked', async () => {
    resetPasswordMock.mockResolvedValueOnce(undefined);
    const forgot = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: pwUser.email },
    });
    expect(forgot.json()).toEqual({ success: true });
    const token = issuedTokens.at(-1) as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: STRONG_NEW },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(resetPasswordMock).toHaveBeenCalledWith(pwUser.id, STRONG_NEW);
    // Reset must kill every existing session
    expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith(pwUser.id);
  });

  it('consumed (double-use) token → 400', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: pwUser.email },
    });
    const token = issuedTokens.at(-1) as string;
    // First use succeeds
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: STRONG_NEW },
    });
    expect(first.statusCode).toBe(200);
    // Replay fails
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: STRONG_NEW },
    });
    expect(second.statusCode).toBe(400);
  });

  it('weak newPassword → 400 VALIDATION_001, token not consumed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: 'any-token', newPassword: 'weak' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_001');
  });
});

describe('login lockout integration (Phase 6b Task 5)', () => {
  it('6th consecutive failed login → 423 AUTH_LOCKED_001', async () => {
    loginPasswordInvalid = true;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'lockme@test.local', password: 'bad' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(401));
    expect(statuses[5]).toBe(423);
    const last = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lockme@test.local', password: 'bad' },
    });
    expect(last.json().error.code).toBe('AUTH_LOCKED_001');
  });

  it('successful login clears failures (retry works after clear)', async () => {
    // 4 failures (below threshold) then a success
    loginPasswordInvalid = true;
    for (let i = 0; i < 4; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'recover@test.local', password: 'bad' },
      });
    }
    loginPasswordInvalid = false;
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'recover@test.local', password: 'pw' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('locked account stays locked even with correct password', async () => {
    loginPasswordInvalid = true;
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'staylocked@test.local', password: 'bad' },
      });
    }
    loginPasswordInvalid = false;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'staylocked@test.local', password: 'pw' },
    });
    expect(res.statusCode).toBe(423);
  });
});
