import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

// Session manager mock — route-level behavior for /sessions/revoke-others
const sessionManagerMock = {
  rotateRefreshToken: vi.fn(),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  revokeOtherSessions: vi.fn(),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findById: vi.fn().mockResolvedValue(null),
      findByEmail: vi.fn().mockResolvedValue(null),
      verifyPassword: vi.fn().mockRejectedValue(new Error('nope')),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
  };
});

const { buildApp } = await import('../app.js');
const { setSetupComplete } = await import('../middleware/setup-guard.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

function authedInject(options: { method: 'POST'; url: string; payload?: unknown }) {
  const token = app.jwt.sign({ sub: 'u-1', email: 'admin@test.local' });
  return app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  setSetupComplete(true);
  app = await buildApp();
});

afterAll(async () => {
  setSetupComplete(false);
  await app.close();
});

describe('POST /api/v1/auth/sessions/revoke-others', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-others',
      payload: { refreshToken: 'raw-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().success).toBe(false);
  });

  it('revokes all other sessions but keeps the current one', async () => {
    sessionManagerMock.findSessionByToken.mockResolvedValueOnce({
      id: 'sess-current',
      userId: 'u-1',
    });
    sessionManagerMock.revokeOtherSessions.mockResolvedValueOnce(undefined);

    const res = await authedInject({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-others',
      payload: { refreshToken: 'raw-current-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(sessionManagerMock.revokeOtherSessions).toHaveBeenCalledWith('u-1', 'sess-current');
  });

  it('still succeeds when the refresh token is unknown (nothing to keep)', async () => {
    sessionManagerMock.findSessionByToken.mockResolvedValueOnce(null);

    const res = await authedInject({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-others',
      payload: { refreshToken: 'stale-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    // No current session resolvable → revoke everything for the user
    expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith('u-1');
  });
});
