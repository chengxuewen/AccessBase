import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { IdentityService, OptionsManager } from '@accessbase/identity';
import { logger } from '@accessbase/logging';

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

// SmsProvider mock (R8 keyed off provider): shared send spy, provider-gated null.
const smsSend = vi.fn().mockResolvedValue(undefined);
const smsFromConfig = vi.fn(
  (cfg: { provider?: string } | null | undefined) =>
    cfg && cfg.provider ? { send: smsSend } : null,
);

const SMS_PHONE = '+15551234567';

const smsUser = {
  id: '550e8400-e29b-41d4-a716-446655440030',
  email: 'sms-user@test.local',
  name: 'SMS User',
  phone: SMS_PHONE,
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
  totpEnabled: false,
};

// Per-test knobs (PIT-055: two-key modeling — both phone and id lookups).
let userByPhone: Record<string, typeof smsUser | null> = { [SMS_PHONE]: smsUser };
let userById: Record<string, (typeof smsUser & { status?: string; totpEnabled?: boolean }) | null> = {
  [smsUser.id]: smsUser,
};

// Real-ish FlowTokenService: in-memory store so request+verify share state
// (both routes live in the same plugin instance — matches production shape).
const flowStore = new Map<string, { purpose: string; payload: unknown; expiresAt: number }>();
const flowTokenMock = {
  issue: vi.fn(async (purpose: string, payload: unknown, ttl: number) => {
    const token = 'tok-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    flowStore.set(token, { purpose, payload, expiresAt: Date.now() + ttl * 1000 });
    return token;
  }),
  consume: vi.fn(async (token: string, purpose: string) => {
    const entry = flowStore.get(token);
    if (!entry || Date.now() > entry.expiresAt || entry.purpose !== purpose) {
      flowStore.delete(token); // burn-on-read even on miss (mirrors real service)
      return null;
    }
    flowStore.delete(token); // single-use
    return entry.payload;
  }),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn(async (email: string) => {
        // Setup-guard fast path: the admin-email lookup must hit (initialized
        // system) — route-level lookups go through the userByPhone knobs.
        if (email === 'admin@accessbase.local') return { ...smsUser, email };
        return null;
      }),
      findByPhone: vi.fn(async (phone: string) => userByPhone[phone] ?? null),
      findById: vi.fn(async (id: string) => userById[id] ?? null),
      findByIdAny: vi.fn(async (id: string) => userById[id] ?? null),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([{ id: 'role-1', name: 'admin' }]),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
    })),
    SmsProviderImpl: { fromConfig: smsFromConfig },
    FlowTokenService: vi.fn().mockImplementation(() => flowTokenMock),
    // OptionsManager mock: env-first contract (envValue !== undefined wins)
    OptionsManager: vi.fn().mockImplementation(() => ({
      get: vi.fn(async (_key: string, envValue: unknown, defaultValue: unknown) =>
        envValue !== undefined ? envValue : defaultValue,
      ),
    })),
  };
});

// Setup-guard DB seam: queryAdminExists reads the users table via
vi.mock('@accessbase/identity/db', () => ({
  users: { _: 'users-marker' },
  userRoles: { _: 'user_roles-marker' },
  roles: { _: 'roles-marker' },
  createDb: () => ({
    select: (projection?: Record<string, unknown>) => {
      const adminRow = { id: smsUser.id, email: 'admin@accessbase.local', status: 'active' };
      const rows = projection
        ? [
            Object.fromEntries(
              Object.keys(projection).map((k) => [k, adminRow[k as keyof typeof adminRow]]),
            ),
          ]
        : [adminRow];
      return {
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => {
                const arr = [] as Array<Record<string, unknown>> & {
                  limit: () => Promise<Array<Record<string, unknown>>>;
                };
                arr.limit = async () => [];
                return arr;
              },
            }),
          }),
        }),
        where: () => {
          const arr = rows as Array<Record<string, unknown>> & {
            limit: () => Promise<Array<Record<string, unknown>>>;
          };
          arr.limit = async () => rows;
          return arr;
        },
      };
    },
  }),
}));
// Static imports of route/config modules must come AFTER vi.mock declarations
// (hoisting): auth.ts consumes the @accessbase/identity mock seam at module
// scope. config is safe but kept in the single post-mock import block.
const [{ _resetHostFallbackWarnForTest }] = await Promise.all([import('../routes/auth.js')]);

const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (_key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : defaultValue,
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');
const { resetManagers } = await import('../utils/managers.js');

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
  // Q2a test seam: the route managers are process singletons now — reset so
  // each test's ctor-mock + mock.results premises hold like the old
  // per-request construction.
  await resetManagers();
  smsSend.mockClear();
  smsFromConfig.mockClear();
  flowTokenMock.issue.mockClear();
  flowTokenMock.consume.mockClear();
  flowStore.clear();
  userByPhone = { [SMS_PHONE]: smsUser };
  userById = { [smsUser.id]: smsUser };
  // Default SMS provider config via env (OptionsManager env-first → env wins)
  process.env['SMS_PROVIDER'] = 'aliyun';
  process.env['ALIBABA_CLOUD_ACCESS_KEY_ID'] = 'test-ak';
  process.env['ALIBABA_CLOUD_ACCESS_KEY_SECRET'] = 'test-sk';
  process.env['SMS_SIGN_NAME'] = 'TestSign';
  process.env['SMS_TEMPLATE_CODE'] = 'SMS_123';
});

afterEach(() => {
  delete process.env['SMS_PROVIDER'];
  delete process.env['ALIBABA_CLOUD_ACCESS_KEY_ID'];
  delete process.env['ALIBABA_CLOUD_ACCESS_KEY_SECRET'];
  delete process.env['SMS_SIGN_NAME'];
  delete process.env['SMS_TEMPLATE_CODE'];
  delete process.env['TWILIO_ACCOUNT_SID'];
  delete process.env['TWILIO_AUTH_TOKEN'];
  delete process.env['TWILIO_FROM_NUMBER'];
});

const REQUEST_URL = '/api/v1/auth/sms-otp/request';
const VERIFY_URL = '/api/v1/auth/sms-otp/verify';

async function requestOtp(phone: string) {
  return app.inject({
    method: 'POST',
    url: REQUEST_URL,
    payload: { phone },
    headers: { host: 'localhost:3000' },
  });
}

/** Drive request→capture the issued token (from the RESPONSE — wire fidelity, Q1-b1)→verify. */
async function issueAndVerify(code: string) {
  const req = await requestOtp(SMS_PHONE);
  expect(req.statusCode).toBe(202);
  const token = req.json().data.token as string;
  expect(token).toBeDefined();
  return app.inject({ method: 'POST', url: VERIFY_URL, payload: { token, code } });
}

/** Extract the OTP from the issued sms_otp payload (send spy is fire-and-forget). */
function issuedPayload(): { userId: string; phone: string; code: string } {
  const entry = [...flowStore.values()][0];
  return entry?.payload as { userId: string; phone: string; code: string };
}

const TOKEN_PAIR_ENV = () => {
  process.env['SMS_PROVIDER'] = 'aliyun';
  process.env['ALIBABA_CLOUD_ACCESS_KEY_ID'] = 'test-ak';
  process.env['ALIBABA_CLOUD_ACCESS_KEY_SECRET'] = 'test-sk';
  process.env['SMS_SIGN_NAME'] = 'TestSign';
  process.env['SMS_TEMPLATE_CODE'] = 'SMS_123';
};

describe('POST /api/v1/auth/sms-otp/request', () => {
  it('happy path: 202 {message, token} + issue(sms_otp,{userId,phone,code},300) + send({to,code})', async () => {
    TOKEN_PAIR_ENV();
    const res = await requestOtp(SMS_PHONE);

    expect(res.statusCode).toBe(202);
    // Q1-b1: constant-shape response carries the flow token (wire chain fix)
    expect(res.json()).toEqual({
      success: true,
      data: {
        message: 'If an account exists, a verification code has been sent.',
        token: expect.any(String),
      },
    });

    // PIT-056 probe: issue payload carries userId/phone/code
    expect(flowTokenMock.issue).toHaveBeenCalledTimes(1);
    expect(flowTokenMock.issue).toHaveBeenCalledWith(
      'sms_otp',
      { userId: smsUser.id, phone: SMS_PHONE, code: expect.any(String) },
      300,
    );
    const payload = issuedPayload();
    expect(payload.userId).toBe(smsUser.id);
    expect(payload.phone).toBe(SMS_PHONE);
    expect(payload.code).toMatch(/^\d{6}$/);

    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(smsSend).toHaveBeenCalledWith({ to: SMS_PHONE, code: payload.code });
    expect(smsFromConfig).toHaveBeenCalledTimes(1);
  });

  it('unregistered phone: 202 IDENTICAL shape + DUMMY userId:null issue + no send (PIT-056 inverted by Q1-b1)', async () => {
    TOKEN_PAIR_ENV();
    const unknown = await requestOtp('+15550000000');
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json().data.message).toBe('If an account exists, a verification code has been sent.');
    expect(typeof unknown.json().data.token).toBe('string');

    expect(smsSend).not.toHaveBeenCalled();
    // Constant-shape immunity: a token IS issued (userId null) so all arms look alike.
    expect(flowTokenMock.issue).toHaveBeenCalledWith(
      'sms_otp',
      { userId: null, phone: '+15550000000', code: expect.any(String) },
      300,
    );
  });

  it.each(['suspended', 'pending'] as const)('%s user: 202 identical + no send + DUMMY issue', async (status) => {
    TOKEN_PAIR_ENV();
    userByPhone = { [SMS_PHONE]: { ...smsUser, status } };
    const res = await requestOtp(SMS_PHONE);
    expect(res.statusCode).toBe(202);
    expect(res.json().data.message).toBe('If an account exists, a verification code has been sent.');
    expect(typeof res.json().data.token).toBe('string');
    expect(smsSend).not.toHaveBeenCalled();
    expect(flowTokenMock.issue).toHaveBeenCalledWith(
      'sms_otp',
      { userId: null, phone: SMS_PHONE, code: expect.any(String) },
      300,
    );
  });

  it('invalid phone format (missing +) → 400', async () => {
    const res = await requestOtp('15551234567');
    expect(res.statusCode).toBe(400);
  });

  it('SmsProvider null (no config): 202 + warn logged + no send + DUMMY issue (Q1-b1 constant shape)', async () => {
    delete process.env['SMS_PROVIDER'];
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await requestOtp(SMS_PHONE);
    expect(res.statusCode).toBe(202);
    expect(res.json().data.message).toBe('If an account exists, a verification code has been sent.');
    expect(typeof res.json().data.token).toBe('string');
    expect(warnSpy).toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(flowTokenMock.issue).toHaveBeenCalledWith(
      'sms_otp',
      { userId: null, phone: SMS_PHONE, code: expect.any(String) },
      300,
    );
    warnSpy.mockRestore();
  });

  it('SmsProvider.send throws: 202 (fire-and-forget catch) + issue still called', async () => {
    TOKEN_PAIR_ENV();
    smsSend.mockRejectedValue(new Error('gateway down'));
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await requestOtp(SMS_PHONE);
    expect(res.statusCode).toBe(202);
    expect(flowTokenMock.issue).toHaveBeenCalledTimes(1);
    expect(smsSend).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    smsSend.mockResolvedValue(undefined);
  });

  it('multi-match phone (duplicate registrations): 202 + no send + DUMMY issue (R1)', async () => {
    TOKEN_PAIR_ENV();
    // R1: findByPhone returns null on multi-match (route treats as no-match → dummy).
    userByPhone = { [SMS_PHONE]: null };
    const res = await requestOtp(SMS_PHONE);
    expect(res.statusCode).toBe(202);
    expect(smsSend).not.toHaveBeenCalled();
    expect(flowTokenMock.issue).toHaveBeenCalledWith(
      'sms_otp',
      { userId: null, phone: SMS_PHONE, code: expect.any(String) },
      300,
    );
  });
  it('Q1-b1: dummy token (userId null) verifies to 401 WITHOUT user lookup (explicit guard)', async () => {
    delete process.env['SMS_PROVIDER']; // dummy arm
    const req = await requestOtp(SMS_PHONE);
    const token = req.json().data.token as string;
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: '123456' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_SMS_001');
    const um = (await import('@accessbase/identity')).UserManager as unknown as {
      mock: { results: Array<{ value: { findByIdAny?: { mock: { calls: unknown[][] } } } }> };
    };
    const calls = um.mock.results.flatMap((r) => r.value.findByIdAny?.mock.calls ?? []);
    expect(calls).toEqual([]);
  });
});

describe('POST /api/v1/auth/sms-otp/verify', () => {
  it('happy non-totp: 200 token pair envelope + user.roles', async () => {
    TOKEN_PAIR_ENV();
    const { token, payload } = await issueCapture();
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('test-refresh-token');
    expect(body.data.expiresIn).toBe(900);
    expect(body.data.user.email).toBe(smsUser.email);
    expect(body.data.user.roles).toEqual([{ id: 'role-1', name: 'admin' }]);
    // No MFA arm on the token-pair branch
    expect(body.data).not.toHaveProperty('mfaRequired');
  });

  it('PIT-056: verify looks the user up with findByIdAny(payload.userId)', async () => {
    TOKEN_PAIR_ENV();
    const { token, payload } = await issueCapture();
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(res.statusCode).toBe(200);
    // Spy-level probe: the route must resolve the user via findByIdAny.
    // Q2a: singleton managers make instance-count probes brittle — aggregate
    // calls ACROSS constructed instances instead (strictly stronger).
    const um = (await import('@accessbase/identity')).UserManager as unknown as {
      mock: { results: Array<{ value: { findByIdAny?: { mock: { calls: unknown[][] } } } }> };
    };
    const calls = um.mock.results.flatMap((r) => r.value.findByIdAny?.mock.calls ?? []);
    // ctor-mock accumulates across the file (no per-test mockClear on classes) —
    // assert THIS test's exact call is present, not exclusivity.
    expect(calls).toContainEqual([payload.userId]);
  });

  it('totp user: {mfaRequired, flowToken} + issue(mfa_verify,{userId},300) + NO accessToken/refreshToken (R8)', async () => {
    TOKEN_PAIR_ENV();
    userById = { [smsUser.id]: { ...smsUser, totpEnabled: true } };
    const { token, payload } = await issueCapture();
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.mfaRequired).toBe(true);
    expect(typeof body.data.flowToken).toBe('string');
    expect(body.data).not.toHaveProperty('accessToken');
    expect(body.data).not.toHaveProperty('refreshToken');
    expect(flowTokenMock.issue).toHaveBeenLastCalledWith('mfa_verify', { userId: smsUser.id }, 300);
  });

  it('wrong code → 401 AUTH_SMS_001 (token burned by consume)', async () => {
    TOKEN_PAIR_ENV();
    const { token, payload } = await issueCapture();
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toEqual({
      code: 'AUTH_SMS_001',
      message: 'Invalid or expired verification code',
    });
    // burn-first: same token+code cannot be retried
    const second = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(second.statusCode).toBe(401);
  });

  it('expired/invalid token → 401 AUTH_SMS_001', async () => {
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token: 'garbage', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_SMS_001');
  });

  it('suspended at verify time → 403 AUTH_004', async () => {
    TOKEN_PAIR_ENV();
    const { token, payload } = await issueCapture();
    userById = { [smsUser.id]: { ...smsUser, status: 'suspended' } };
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_004');
    expect(res.json().error.message).toBe('Account suspended');
  });

  it('phone changed after request (payload.phone ≠ user.phone) → 401 AUTH_SMS_001 (R3)', async () => {
    TOKEN_PAIR_ENV();
    const { token, payload } = await issueCapture();
    userById = { [smsUser.id]: { ...smsUser, phone: '+15559999999' } };
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_SMS_001');
  });

  it('deleted user between request and verify → 401 AUTH_SMS_001', async () => {
    TOKEN_PAIR_ENV();
    const { token, payload } = await issueCapture();
    userById = {};
    const res = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_SMS_001');
  });

  it('R2 zero-lockout probe: failure paths return only 401/403 domain codes, never 423', async () => {
    // R2 deliberately includes no lockout spy asserts: the route code has no
    // LockoutService reference at all (grep-level guarantee). This probe pins
    // the observable behavior: every failure stays in the 401/403 family —
    // a phone lockout regression would surface as 423 here.
    await app.inject({ method: 'POST', url: VERIFY_URL, payload: { token: 'bad', code: '111111' } });
    const { token, payload } = await issueCapture();
    const wrong = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    userById = { [smsUser.id]: { ...smsUser, phone: '+15559999999' } };
    const mismatch = await app.inject({
      method: 'POST',
      url: VERIFY_URL,
      payload: { token, code: payload.code },
    });
    expect(mismatch.statusCode).toBe(401);
  });
});

/** Issue an OTP and return {token, code} captured from the flow store. */
async function issueCapture() {
  const req = await requestOtp(SMS_PHONE);
  expect(req.statusCode).toBe(202);
  const token = req.json().data.token as string; // Q1-b1 wire fidelity
  expect(token).toBeDefined();
  const payload = flowStore.get(token)?.payload as { userId: string; phone: string; code: string };
  return { token, payload };
}

describe('GET /api/v1/auth/sms/status', () => {
  it('enabled: true when provider config present (saml/status gate pattern)', async () => {
    TOKEN_PAIR_ENV();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/sms/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { enabled: true } });
  });
  it('enabled: false when no provider configured', async () => {
    delete process.env['SMS_PROVIDER'];
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/sms/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { enabled: false } });
  });
});
