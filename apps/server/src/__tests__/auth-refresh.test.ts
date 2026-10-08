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

// LC composer mocks (logout-coherence §3.4): the /auth/logout composer imports
// these two builders; the suite drives every resolution arm through them.
const { samlLogoutUrlMock, rpEndSessionUrlMock } = vi.hoisted(() => ({
  samlLogoutUrlMock: vi.fn<() => Promise<string | null>>(),
  rpEndSessionUrlMock: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('../utils/saml-logout.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveSamlLogoutUrl: samlLogoutUrlMock };
});
vi.mock('../utils/rp-end-session.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveRpEndSessionUrl: rpEndSessionUrlMock };
});

// Session manager mock — route-level behavior for /refresh and /logout
const sessionManagerMock = {
  rotateRefreshToken: vi.fn(),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      verifyPassword: vi.fn().mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'admin@test.local',
      }),
      findById: vi.fn().mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'admin@test.local',
        name: 'admin',
        status: 'active',
      }),
      // Refresh path resolves the session owner tenant-blind (G fix H1/L1)
      findByIdAny: vi.fn().mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'admin@test.local',
        name: 'admin',
        status: 'active',
      }),
    })),
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

describe('POST /api/v1/auth/refresh (rotation)', () => {
  it('returns 200 with a new token pair for a valid session', async () => {
    sessionManagerMock.rotateRefreshToken.mockResolvedValueOnce({
      refreshToken: 'new-raw-refresh-token',
      userId: '550e8400-e29b-41d4-a716-446655440000',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'old-raw-refresh-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('new-raw-refresh-token');
    expect(body.data.expiresIn).toBe(900);
  });

  it('returns 401 for unknown token', async () => {
    sessionManagerMock.rotateRefreshToken.mockRejectedValueOnce(
      new Error('Session not found'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'nope' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_003');
  });

  it('returns 401 on reuse; user sessions revoked', async () => {
    sessionManagerMock.rotateRefreshToken.mockImplementationOnce(async () => {
      await sessionManagerMock.revokeAllUserSessions('u-1');
      throw new Error('Token reuse detected');
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'replayed-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().success).toBe(false);
    // Reuse detection revoked all sessions for the user
    expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith('u-1');
  });
});

describe('POST /api/v1/auth/logout (session revocation)', () => {
  beforeEach(() => {
    // Composer legs start every test at null (the fail-soft baseline) with
    // cleared call history — assertions below are per-test, not file-order.
    samlLogoutUrlMock.mockReset().mockResolvedValue(null);
    rpEndSessionUrlMock.mockReset().mockResolvedValue(null);
  });
  it('revokes the DB session when a refresh token is supplied', async () => {
    sessionManagerMock.findSessionByToken.mockResolvedValueOnce({
      id: 'sess-1',
      userId: 'u-1',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'u-1', email: 'admin@test.local' })}` },
      payload: { refreshToken: 'raw-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { idpLogoutUrl: null } });
    expect(sessionManagerMock.revokeSession).toHaveBeenCalledWith('sess-1');
  });

  it('succeeds without revocation when no refresh token supplied', async () => {
    sessionManagerMock.revokeSession.mockClear();
const res = await app.inject({
method: 'POST',
url: '/api/v1/auth/logout',
headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'u-1', email: 'admin@test.local' })}` },
});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { idpLogoutUrl: null } });
    expect(sessionManagerMock.revokeSession).not.toHaveBeenCalled();
  });

  // LC §3.4: response carries the composed idpLogoutUrl; resolution order
  // saml-first then RP; each leg fail-soft — logout never depends on the IdP.
  it('idpLogoutUrl comes from the SAML builder when it resolves a URL (RP leg not consulted)', async () => {
    samlLogoutUrlMock.mockResolvedValueOnce('https://idp.example/slo?SAMLRequest=abc');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'u-1', email: 'admin@test.local' })}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ idpLogoutUrl: 'https://idp.example/slo?SAMLRequest=abc' });
    expect(samlLogoutUrlMock).toHaveBeenCalledWith('u-1');
    expect(rpEndSessionUrlMock).not.toHaveBeenCalled();
  });

  it('falls through to the RP end-session URL when SAML resolves null', async () => {
    samlLogoutUrlMock.mockResolvedValueOnce(null);
    rpEndSessionUrlMock.mockResolvedValueOnce('https://rp.example/end-session?id_token_hint=xyz');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'u-1', email: 'admin@test.local' })}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ idpLogoutUrl: 'https://rp.example/end-session?id_token_hint=xyz' });
    expect(rpEndSessionUrlMock).toHaveBeenCalledWith('u-1');
  });

  it('both builders throwing degrades to null with the 200 envelope (revocation still ran)', async () => {
    sessionManagerMock.findSessionByToken.mockResolvedValueOnce({ id: 'sess-2', userId: 'u-1' });
    samlLogoutUrlMock.mockRejectedValueOnce(new Error('saml options unreadable'));
    rpEndSessionUrlMock.mockRejectedValueOnce(new Error('db down'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'u-1', email: 'admin@test.local' })}` },
      payload: { refreshToken: 'raw-token-2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { idpLogoutUrl: null } });
    expect(sessionManagerMock.revokeSession).toHaveBeenCalledWith('sess-2');
  });
});
