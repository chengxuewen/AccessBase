/**
 * R1-T10 (DG-8a): auth.require_verified_email login gate — route matrix.
 * Locks: default-off zero-breakage; 403 AUTH_EMAIL_003 on BOTH terminal arms
 * (password final + /mfa/verify completion, re-review note 1 — a
 * password-arm-only gate leaks unverified+TOTP-bound users through step-up);
 * no success/failure telemetry on the blocked arm; anti-lockout ordering
 * (force-change / step-up arms stay reachable ahead of the gate).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService, OptionsManager } from '@accessbase/identity';
import { DEFAULT_TENANT } from '../utils/constants.js';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);
delete process.env['AUTH_REQUIRE_VERIFIED_EMAIL'];

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// Event-row capture (mfa.test.ts seam): the blocked arm must write NOTHING.
interface CapturedInsert {
  values: Record<string, unknown>;
}
const eventInserts: CapturedInsert[] = [];
vi.mock('@accessbase/identity/db', async (importOriginal) => ({
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

// Per-test knobs
const USER = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'gate@test.local',
  name: 'gate',
  tenantId: DEFAULT_TENANT,
};
let emailVerified = false;
let mustChange = false;
let totpEnabled = false;

const mfaManagerMock = {
  verify: vi.fn(async (_userId: string, code: string) => ({ success: code === '123456' })),
  verifyRecoveryCode: vi.fn(async () => ({ success: false })),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      verifyPassword: vi.fn(async () => ({
        ...USER,
        status: 'active',
        totpEnabled,
        emailVerified,
        mustChangePassword: mustChange,
      })),
      findById: vi.fn(async () => ({
        ...USER,
        status: 'active',
        totpEnabled,
        emailVerified,
      })),
      markEmailVerified: vi.fn(async () => {}),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([]),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn(async () => ({ refreshToken: 'new-refresh-token' })),
    })),
    MfaManager: vi.fn().mockImplementation(() => mfaManagerMock),
  };
});

// Options seam (captcha/mfa-test pattern): env > injected store > default.
const optionStore: Record<string, unknown> = {};
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (key: string, env: unknown, def: unknown) =>
    env !== undefined ? env : key in optionStore ? optionStore[key] : def,
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  emailVerified = false;
  mustChange = false;
  totpEnabled = false;
  eventInserts.length = 0;
  const { closeAuthDb } = await import('../utils/managers.js');
  await closeAuthDb();
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

const login = () =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: USER.email, password: 'pw' },
  });

describe('auth.require_verified_email — password terminal arm', () => {
  it('off (default): unverified user gets the session + ONE success row', async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.accessToken).toBeTruthy();
    expect(eventInserts.filter((i) => i.values['type'] === 'auth.login.success')).toHaveLength(1);
  });

  it('on + unverified → 403 AUTH_EMAIL_003, zero tokens, zero auth events', async () => {
    optionStore['auth.require_verified_email'] = 'true';
    try {
      const res = await login();
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        success: false,
        error: { code: 'AUTH_EMAIL_003', message: 'Email address not verified' },
      });
      expect((res.json() as { data?: unknown }).data).toBeUndefined();
      expect(eventInserts).toHaveLength(0); // neither success nor failure telemetry
    } finally {
      delete optionStore['auth.require_verified_email'];
    }
  });

  it('on + verified → session issued normally', async () => {
    optionStore['auth.require_verified_email'] = 'true';
    emailVerified = true;
    try {
      const res = await login();
      expect(res.statusCode).toBe(200);
      expect(res.json().data.accessToken).toBeTruthy();
    } finally {
      delete optionStore['auth.require_verified_email'];
    }
  });

  it('ANTI-LOCKOUT: on + unverified + mustChangePassword → force-change arm still 200', async () => {
    optionStore['auth.require_verified_email'] = 'true';
    mustChange = true;
    try {
      const res = await login();
      expect(res.statusCode).toBe(200);
      expect(res.json().data.passwordChangeRequired).toBe(true);
      expect(typeof res.json().data.flowToken).toBe('string');
    } finally {
      delete optionStore['auth.require_verified_email'];
    }
  });
});

describe('auth.require_verified_email — /mfa/verify terminal arm (re-review note 1)', () => {
  it('on + unverified + TOTP-bound: step-up arm reachable, completion 403 zero tokens', async () => {
    optionStore['auth.require_verified_email'] = 'true';
    totpEnabled = true;
    try {
      const step = await login();
      expect(step.statusCode).toBe(200);
      expect(step.json().data.mfaRequired).toBe(true);
      const flowToken = step.json().data.flowToken as string;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/verify',
        payload: { flowToken, code: '123456' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_EMAIL_003' } });
      expect((res.json() as { data?: unknown }).data).toBeUndefined();
      expect(eventInserts).toHaveLength(0);
    } finally {
      delete optionStore['auth.require_verified_email'];
    }
  });

  it('on + verified + TOTP-bound: /mfa/verify completes with a token pair', async () => {
    optionStore['auth.require_verified_email'] = 'true';
    totpEnabled = true;
    emailVerified = true;
    try {
      const step = await login();
      const flowToken = step.json().data.flowToken as string;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/verify',
        payload: { flowToken, code: '123456' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.accessToken).toBeTruthy();
    } finally {
      delete optionStore['auth.require_verified_email'];
    }
  });
});
