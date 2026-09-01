/**
 * TRUE-BACKEND MFA E2E (Phase 6b Task 6 closeout).
 *
 * Unlike mfa.test.ts (identity mocked), this runs the full 2FA flow against the
 * REAL database: create user → setup/enable TOTP → login step-up (mfaRequired +
 * flowToken) → verify (TOTP / wrong / recovery / replay) → cleanup.
 *
 * Requires live native PG (accessbase:accessbase@localhost:5432/accessbase).
 * MFA_ENCRYPTION_KEY: dedicated test value (not the dev key).
 *
 * Note on Redis: auth routes pass `undefined` redis to FlowTokenService /
 * LockoutService when NODE_ENV=test, so those use their in-memory fallbacks.
 * Redis coverage lives in FlowTokenService/LockoutService unit tests; this file
 * is the DB-integrated API contract check.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://accessbase:accessbase@localhost:5432/accessbase';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);

// Mock plugins that require fastify@5 but fastify@4 is installed
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const { buildApp } = await import('../app.js');
const { UserManager } = await import('@accessbase/identity');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

const TENANT = '00000000-0000-0000-0000-000000000001';
const PASSWORD = 'CorrectHorse1!';
const EMAIL = `mfa-int-${Date.now()}@test.local`;

let app: App;
let userId = '';
const userManager = new (UserManager as unknown as {
  new (): import('@accessbase/identity').UserManager;
})();

beforeAll(async () => {
  app = await buildApp();
  const user = await userManager.create({ email: EMAIL, name: 'MFA Integration', password: PASSWORD }, TENANT);
  userId = user.id;
});

afterAll(async () => {
  // Recovery codes cascade-delete with the user row.
  if (userId) {
    try {
      await userManager.delete(userId, TENANT);
    } catch {
      // best-effort cleanup of test-local data
    }
  }
  await app.close();
});

const login = () =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: EMAIL, password: PASSWORD },
  });

const codeFromSecret = async (secret: string): Promise<string> => {
  const { generateSync } = await import('otplib');
  return generateSync({ secret });
};

describe('MFA true-backend E2E (real DB)', () => {
  it('full 2FA lifecycle: setup → enable → step-up → verify → recovery', { timeout: 60_000 }, async () => {
    // (a) user exists in real DB
    const found = await userManager.findById(userId, TENANT);
    expect(found?.email).toBe(EMAIL);

    // (b) enable MFA: login → setup → parse secret from otpauthUrl → live TOTP → enable
    const first = await login();
    expect(first.statusCode).toBe(200);
    const firstSession = first.json().data;
    expect(firstSession.accessToken).toBeTruthy();
    expect(firstSession.mfaRequired).toBeUndefined();

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/setup',
      headers: { authorization: `Bearer ${firstSession.accessToken as string}` },
    });
    expect(setup.statusCode).toBe(200);
    const { otpauthUrl, recoveryCodes } = setup.json().data;
    expect(otpauthUrl).toMatch(/^otpauth:\/\//);
    expect(recoveryCodes).toHaveLength(10);

    const secret = decodeURIComponent(otpauthUrl.split('secret=')[1]?.split('&')[0] ?? '');
    expect(secret).toBeTruthy();
    const code = await codeFromSecret(secret);

    const enable = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/enable',
      headers: { authorization: `Bearer ${firstSession.accessToken as string}` },
      payload: { code },
    });
    expect(enable.statusCode).toBe(200);

    // (c) login again → step-up branch: mfaRequired + flowToken, NO tokens
    const second = await login();
    expect(second.statusCode).toBe(200);
    const step = second.json().data;
    expect(step.mfaRequired).toBe(true);
    expect(step.flowToken).toMatch(/^[0-9a-f]{64}$/);
    expect(step.accessToken).toBeUndefined();
    expect(step.refreshToken).toBeUndefined();

    // (d) wrong TOTP → 401 AUTH_MFA_001
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken: step.flowToken, code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('AUTH_MFA_001');

    // (e) fresh login — the failed verify may have burned the old flowToken
    // (consume happens before code check), so get a new one like a real client
    const third = await login();
    const flowToken = third.json().data.flowToken as string;

    // (f) correct TOTP → token pair
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken, code: await codeFromSecret(secret) },
    });
    expect(ok.statusCode).toBe(200);
    const okBody = ok.json().data;
    expect(okBody.accessToken).toBeTruthy();
    expect(okBody.refreshToken).toBeTruthy();

    // (g) recovery code path — fresh login, use a recovery code instead of TOTP
    const fourth = await login();
    const ft4 = fourth.json().data.flowToken as string;
    const viaRecovery = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken: ft4, code: recoveryCodes[0] },
    });
    expect(viaRecovery.statusCode).toBe(200);
    expect(viaRecovery.json().data.accessToken).toBeTruthy();

    // (h) used recovery code cannot replay
    const fifth = await login();
    const ft5 = fifth.json().data.flowToken as string;
    const replayRecovery = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { flowToken: ft5, code: recoveryCodes[0] },
    });
    expect(replayRecovery.statusCode).toBe(401);
  });
});
