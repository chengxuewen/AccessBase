/**
 * SL-2 wiring: env/options → resolved idle seconds → rotateRefreshToken.
 * The wiring mirrors mfa-policy's config-plane posture: a failing options
 * read degrades to the env tier or the 86400 default — never blocks refresh.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type * as Identity from '@accessbase/identity';

describe('session-idle wiring (SL-2)', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.resetModules();
  });

  it('resolveIdleSeconds: env numeric wins, including "0" (explicit off)', async () => {
    process.env['SESSION_IDLE_TIMEOUT_SECONDS'] = '0';
    vi.resetModules();
    const { resolveIdleSeconds } = await import('../utils/session-idle-wiring.js');
    expect(await resolveIdleSeconds()).toBe(0);

    process.env['SESSION_IDLE_TIMEOUT_SECONDS'] = '3600';
    vi.resetModules();
    const { resolveIdleSeconds: r2 } = await import('../utils/session-idle-wiring.js');
    expect(await r2()).toBe(3600);
  });

  it('resolveIdleSeconds: garbage env falls to options tier (3-tier)', async () => {
    process.env['SESSION_IDLE_TIMEOUT_SECONDS'] = 'abc';
    vi.resetModules();
    const { setOptionsManager } = await import('../routes/options.js');
    const { resolveIdleSeconds } = await import('../utils/session-idle-wiring.js');
    setOptionsManager({
      get: async (key: string, envValue: unknown, defaultValue: unknown) =>
        envValue !== undefined ? envValue : (key === 'session.idle_timeout_seconds' ? 7200 : defaultValue),
    } as never);
    expect(await resolveIdleSeconds()).toBe(7200);
  });

  it('resolveIdleSeconds: options failure → env tier, else default 86400 (fail-open G4)', async () => {
    delete process.env['SESSION_IDLE_TIMEOUT_SECONDS'];
    vi.resetModules();
    const { setOptionsManager } = await import('../routes/options.js');
    const { resolveIdleSeconds } = await import('../utils/session-idle-wiring.js');
    setOptionsManager({
      get: async () => {
        throw new Error('db down');
      },
    } as never);
    expect(await resolveIdleSeconds()).toBe(86400);
  });

  it('resolveIdleSeconds: env wins even when options read fails (tier order)', async () => {
    process.env['SESSION_IDLE_TIMEOUT_SECONDS'] = '60';
    vi.resetModules();
    const { setOptionsManager } = await import('../routes/options.js');
    const { resolveIdleSeconds } = await import('../utils/session-idle-wiring.js');
    setOptionsManager({
      get: async () => {
        throw new Error('db down');
      },
    } as never);
    expect(await resolveIdleSeconds()).toBe(60);
  });

  it('refresh handler threads the resolved cutoff into rotateRefreshToken', async () => {
    process.env['SESSION_IDLE_TIMEOUT_SECONDS'] = '12345';
    process.env['NODE_ENV'] = 'test';
    process.env['JWT_SECRET'] = 'test-secret';
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['REDIS_URL'] = 'redis://localhost:6379';

    vi.mock('@fastify/cors', () => ({ default: async () => {} }));
    vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
    vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
    vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
    vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

    const rotateMock = vi.fn().mockResolvedValue({
      refreshToken: 'new-r',
      userId: '550e8400-e29b-41d4-a716-446655440000',
    });
    const sessionManagerMock = {
      rotateRefreshToken: rotateMock,
      findSessionByToken: vi.fn().mockResolvedValue(null),
    };
    vi.doMock('@accessbase/identity', async (importOriginal) => {
      const actual = (await importOriginal()) as typeof Identity;
      return {
        ...actual,
        SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
        // setup-guard's queryAdminExists resolves the admin via UserManager —
        // without this stub it dials the (unavailable) test PG and 503s.
        UserManager: vi.fn().mockImplementation(() => ({
          findByEmail: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@test.local' }),
          // post-rotate owner resolution (G fix L1)
          findByIdAny: vi.fn().mockResolvedValue({
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'admin@test.local',
            status: 'active',
          }),
        })),
      };
    });

    const { setOptionsManager } = await import('../routes/options.js');
    setOptionsManager({
      get: async (_k: string, envValue: unknown, defaultValue: unknown) =>
        envValue !== undefined ? envValue : defaultValue,
    } as never);

    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: 'tok' },
      });
      expect(res.statusCode).toBe(200);
      expect(rotateMock).toHaveBeenCalledTimes(1);
      const optsArg = rotateMock.mock.calls[0][2];
      expect(optsArg).toEqual({ idleCutoffSeconds: 12345 });
    } finally {
      await app.close();
      vi.doUnmock('@accessbase/identity');
    }
  });
});
