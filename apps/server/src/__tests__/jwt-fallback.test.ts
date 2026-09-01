import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Set env before importing config-dependent modules — NO key path envs (HMAC fallback)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
delete process.env.JWT_PRIVATE_KEY_PATH;
delete process.env.JWT_PUBLIC_KEY_PATH;

// Mock plugins that require fastify@5 but fastify@4 is installed
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      verifyPassword: vi.fn().mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'admin@test.local',
      }),
      findById: vi.fn().mockResolvedValue({ id: 'u1', email: 'e', name: 'n', status: 'active' }),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
      rotateRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'new-refresh', userId: 'u1' }),
      revokeSession: vi.fn().mockResolvedValue(undefined),
      findSessionByToken: vi.fn().mockResolvedValue(null),
    })),
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

describe('JWT HMAC fallback (no key paths configured)', () => {
  it('issues a token signed with HS256 that the protected route accepts', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@test.local', password: 'x' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().data.accessToken;

    const decoded = app.jwt.decode(token, { complete: true });
    expect(decoded.header.alg).toBe('HS256');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a tampered token with 401', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@test.local', password: 'x' },
    });
    const token = login.json().data.accessToken;
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
    const tampered = parts.join('.');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
