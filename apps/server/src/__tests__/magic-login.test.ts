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

// Mailer mock (R8: fromConfig keyed off host): shared send spy, host-gated null.
const mailerSend = vi.fn().mockResolvedValue(undefined);
const mailerFromConfig = vi.fn(
  (cfg: { host?: string } | null | undefined) =>
    cfg && cfg.host ? { send: mailerSend } : null,
);

const MAGIC_EMAIL = 'magic-user@test.local';

const magicUser = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  email: MAGIC_EMAIL,
  name: 'Magic User',
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
  totpEnabled: false,
};

// Per-test knobs
let userByEmail: Record<string, typeof magicUser | null> = { [MAGIC_EMAIL]: magicUser };
let userById: Record<string, (typeof magicUser & { status?: string; totpEnabled?: boolean }) | null> = {
  [magicUser.id]: magicUser,
};

// Real-ish FlowTokenService: in-memory store so request+consume share state
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
        // system) — route-level lookups go through the userByEmail knobs.
        if (email === 'admin@accessbase.local') return { ...magicUser, email };
        return userByEmail[email] ?? null;
      }),
      findById: vi.fn(async (id: string) => userById[id] ?? null),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([{ id: 'role-1', name: 'admin' }]),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
    })),
    Mailer: { fromConfig: mailerFromConfig },
    FlowTokenService: vi.fn().mockImplementation(() => flowTokenMock),
    // OptionsManager mock: env-first contract (envValue !== undefined wins)
    OptionsManager: vi.fn().mockImplementation(() => ({
      get: vi.fn(async (_key: string, envValue: unknown, defaultValue: unknown) =>
        envValue !== undefined ? envValue : defaultValue,
      ),
    })),
  };
});

// No site.url in options and no SITE_URL env → R3 falls back to request origin.
// (The env-first get() makes '' — the route's env default — the fallback chain
// itself; leaving optionsStore empty exercises the request-origin arm.)
// Setup-guard DB seam: queryAdminExists reads the users table via
vi.mock('@accessbase/identity/db', () => ({
  users: { _: 'users-marker' },
  userRoles: { _: 'user_roles-marker' },
  roles: { _: 'roles-marker' },
  createDb: () => ({
    select: (projection?: Record<string, unknown>) => {
      // queryAdminExists fast path: users lookup by admin email → admin row.
      // (The guard hits this first; returning the row short-circuits the join.)
      const adminRow = { id: magicUser.id, email: 'admin@accessbase.local', status: 'active' };
      const rows = projection
        ? [
            Object.fromEntries(
              Object.keys(projection).map((k) => [k, adminRow[k as keyof typeof adminRow]]),
            ),
          ]
        : [adminRow];
      return {
        from: () => ({
          // The join path only runs when the fast path misses; the thenable
          // array below satisfies both await shapes (with/without .limit()).
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
// scope, so a top-of-file static import would evaluate the real module graph
// against uninitialized mock fns. config is safe to import statically (no mock
// seam), but importing it here keeps a single post-mock import block.
const [{ _resetHostFallbackWarnForTest }, { config }] = await Promise.all([
  import('../routes/auth.js'),
  import('../config.js'),
]);

const { getOptionsManager, setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (_key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : defaultValue,
} as unknown as OptionsManager);

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
  mailerSend.mockClear();
  mailerFromConfig.mockClear();
  flowTokenMock.issue.mockClear();
  flowTokenMock.consume.mockClear();
  flowStore.clear();
  userByEmail = { [MAGIC_EMAIL]: magicUser };
  userById = { [magicUser.id]: magicUser };
});

const REQUEST_URL = '/api/v1/auth/magic/request';
const CONSUME_URL = '/api/v1/auth/magic/consume';

async function requestMagic(email: string) {
  return app.inject({
    method: 'POST',
    url: REQUEST_URL,
    payload: { email },
    headers: { host: 'localhost:3000' },
  });
}

/** Drive request→capture the issued token→consume it. */
async function issueAndConsume(email: string) {
  const req = await requestMagic(email);
  expect(req.statusCode).toBe(202);
  // Grab the token issued inside the request route via the flow store
  const token = [...flowStore.keys()][0];
  expect(token).toBeDefined();
  return app.inject({ method: 'POST', url: CONSUME_URL, payload: { token } });
}

describe('POST /api/v1/auth/magic/request', () => {
  it('happy path: 202 fixed body + issue(magic_login,{userId,email},900) + link contains token + origin from request', async () => {
    // smtp config via env (OptionsManager env-first → envValue wins)
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const res = await requestMagic(MAGIC_EMAIL);

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({
        success: true,
        data: { message: 'If an account exists, a sign-in link has been sent.' },
      });

      expect(flowTokenMock.issue).toHaveBeenCalledTimes(1);
      expect(flowTokenMock.issue).toHaveBeenCalledWith(
        'magic_login',
        { userId: magicUser.id, email: MAGIC_EMAIL },
        900,
      );

      expect(mailerSend).toHaveBeenCalledTimes(1);
      const [to, subject, html] = mailerSend.mock.calls[0] as [string, string, string];
      expect(to).toBe(MAGIC_EMAIL);
      expect(subject).toBe('Your sign-in link');
      const issuedToken = [...flowStore.keys()][0];
      expect(html).toContain(`${issuedToken}`);
      expect(html).toContain('/login/magic?token=');
      // R3 fallback: no site.url/SITE_URL → request origin (inject defaults)
      expect(html).toContain('http://localhost:3000/login/magic?token=');
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });

  it('unknown email: 202 body IDENTICAL to happy + no send + no issue', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const unknown = await requestMagic('nobody@test.local');
      const happy = {
        success: true,
        data: { message: 'If an account exists, a sign-in link has been sent.' },
      };
      expect(unknown.statusCode).toBe(202);
      expect(unknown.json()).toEqual(happy);

      expect(mailerSend).not.toHaveBeenCalled();
      expect(flowTokenMock.issue).not.toHaveBeenCalled();
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });

  it.each(['suspended', 'pending'] as const)(
    '%s user: 202 identical + no send',
    async (status) => {
      process.env['SMTP_HOST'] = 'smtp.test.local';
      try {
        userByEmail = { [MAGIC_EMAIL]: { ...magicUser, status } };
        const res = await requestMagic(MAGIC_EMAIL);
        expect(res.statusCode).toBe(202);
        expect(res.json()).toEqual({
          success: true,
          data: { message: 'If an account exists, a sign-in link has been sent.' },
        });
        expect(mailerSend).not.toHaveBeenCalled();
        expect(flowTokenMock.issue).not.toHaveBeenCalled();
      } finally {
        delete process.env['SMTP_HOST'];
      }
    },
  );

  it('invalid email format → 400', async () => {
    const res = await requestMagic('not-an-email');
    expect(res.statusCode).toBe(400);
  });

  it('Mailer null (no smtp_host): 202 + warn logged + no throw', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await requestMagic(MAGIC_EMAIL);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      success: true,
      data: { message: 'If an account exists, a sign-in link has been sent.' },
    });
    expect(warnSpy).toHaveBeenCalled();
    // Issue still happened (token exists) but no email went out
    expect(flowTokenMock.issue).toHaveBeenCalledTimes(1);
    expect(mailerSend).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('site.url option set → link origin comes from options, not request', async () => {
    // siteStore-backed OptionsManager replaced at runtime
    const omPrev = getOptionsManager();
    setOptionsManager({
      get: async (key: string, envValue: unknown, defaultValue: unknown) => {
        if (key === 'site.url') return envValue !== undefined ? envValue : 'https://idp.example.com';
        return envValue !== undefined ? envValue : defaultValue;
      },
    } as unknown as OptionsManager);
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      await requestMagic(MAGIC_EMAIL);
      const html = String(mailerSend.mock.calls[0]?.[2] ?? '');
      expect(html).toContain('https://idp.example.com/login/magic?token=');
    } finally {
      delete process.env['SMTP_HOST'];
      setOptionsManager(omPrev);
    }
  });

  it('SITE_URL env set → link origin comes from env', async () => {
    // Base env-first mock already resolves site.url → SITE_URL env value.
    process.env['SMTP_HOST'] = 'smtp.test.local';
    process.env['SITE_URL'] = 'https://env.example.com';
    try {
      await requestMagic(MAGIC_EMAIL);
      const html = String(mailerSend.mock.calls[0]?.[2] ?? '');
      expect(html).toContain('https://env.example.com/login/magic?token=');
    } finally {
      delete process.env['SMTP_HOST'];
      delete process.env['SITE_URL'];
    }
  });
});

describe('magic-link Host trust gating (H′3)', () => {
  beforeEach(() => {
    _resetHostFallbackWarnForTest();
  });

  it('poisoned Host + no site.url/SITE_URL: link uses request Host + warn logged', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const res = await app.inject({
        method: 'POST',
        url: REQUEST_URL,
        payload: { email: MAGIC_EMAIL },
        headers: { host: 'evil.example.com' },
      });
      expect(res.statusCode).toBe(202);
      const html = String(mailerSend.mock.calls[0]?.[2] ?? '');
      expect(html).toContain('http://evil.example.com/login/magic?token=');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('magic-link origin falling back to request Host'),
      );
    } finally {
      delete process.env['SMTP_HOST'];
      warnSpy.mockRestore();
    }
  });

  it('TRUST_PROXY=true + x-forwarded-host: link uses forwarded host, not Host, no warn', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    config.trustProxy = true;
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const res = await app.inject({
        method: 'POST',
        url: REQUEST_URL,
        payload: { email: MAGIC_EMAIL },
        headers: { host: 'evil.example.com', 'x-forwarded-host': 'fwd.example.com' },
      });
      expect(res.statusCode).toBe(202);
      const html = String(mailerSend.mock.calls[0]?.[2] ?? '');
      expect(html).toContain('http://fwd.example.com/login/magic?token=');
      expect(html).not.toContain('evil.example.com');
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('magic-link origin falling back to request Host'),
      );
    } finally {
      delete process.env['SMTP_HOST'];
      config.trustProxy = false;
      warnSpy.mockRestore();
    }
  });

  it('TRUST_PROXY=true + NO x-forwarded-host: falls back to Host header + warn', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    config.trustProxy = true;
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const res = await app.inject({
        method: 'POST',
        url: REQUEST_URL,
        payload: { email: MAGIC_EMAIL },
        headers: { host: 'evil.example.com' },
      });
      expect(res.statusCode).toBe(202);
      const html = String(mailerSend.mock.calls[0]?.[2] ?? '');
      expect(html).toContain('http://evil.example.com/login/magic?token=');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('magic-link origin falling back to request Host'),
      );
    } finally {
      delete process.env['SMTP_HOST'];
      config.trustProxy = false;
      warnSpy.mockRestore();
    }
  });
});

describe('magic-link SMTP async send (H′4)', () => {
  it('never-resolving send: response still 202 (send not awaited)', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    mailerSend.mockImplementation(() => new Promise<void>(() => {}));
    try {
      const res = await app.inject({
        method: 'POST',
        url: REQUEST_URL,
        payload: { email: MAGIC_EMAIL },
        headers: { host: 'localhost:3000' },
      });
      expect(res.statusCode).toBe(202);
      expect(mailerSend).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env['SMTP_HOST'];
      mailerSend.mockResolvedValue(undefined);
    }
  });
});

describe('POST /api/v1/auth/magic/consume', () => {
  it('happy non-totp: 200 token pair envelope + user.roles', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const res = await issueAndConsume(MAGIC_EMAIL);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(typeof body.data.accessToken).toBe('string');
      expect(body.data.refreshToken).toBe('test-refresh-token');
      expect(body.data.expiresIn).toBe(900);
      expect(body.data.user.email).toBe(MAGIC_EMAIL);
      expect(body.data.user.roles).toEqual([{ id: 'role-1', name: 'admin' }]);
      // No MFA arm on the token-pair branch
      expect(body.data).not.toHaveProperty('mfaRequired');
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });

  it('totp user: {mfaRequired, flowToken} + issue(mfa_verify,{userId},300)', async () => {
    userById = { [magicUser.id]: { ...magicUser, totpEnabled: true } };
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const res = await issueAndConsume(MAGIC_EMAIL);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.mfaRequired).toBe(true);
      expect(typeof body.data.flowToken).toBe('string');
      expect(body.data).not.toHaveProperty('accessToken');
      expect(flowTokenMock.issue).toHaveBeenLastCalledWith(
        'mfa_verify',
        { userId: magicUser.id },
        300,
      );
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });

  it('invalid token → 401 AUTH_MAGIC_001 generic', async () => {
    const res = await app.inject({
      method: 'POST',
      url: CONSUME_URL,
      payload: { token: 'garbage' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toEqual({
      code: 'AUTH_MAGIC_001',
      message: 'Invalid or expired sign-in link',
    });
  });

  it('deleted user between request and consume → 401 AUTH_MAGIC_001', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const req = await requestMagic(MAGIC_EMAIL);
      expect(req.statusCode).toBe(202);
      userById = {}; // user removed after link was sent
      const token = [...flowStore.keys()][0];
      const res = await app.inject({
        method: 'POST',
        url: CONSUME_URL,
        payload: { token },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('AUTH_MAGIC_001');
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });

  it('email-changed user (payload.email ≠ user.email) → 401 AUTH_MAGIC_001', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const req = await requestMagic(MAGIC_EMAIL);
      expect(req.statusCode).toBe(202);
      userById = { [magicUser.id]: { ...magicUser, email: 'renamed@test.local' } };
      const token = [...flowStore.keys()][0];
      const res = await app.inject({
        method: 'POST',
        url: CONSUME_URL,
        payload: { token },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('AUTH_MAGIC_001');
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });

  it('suspended at consume time → 403 AUTH_004', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const req = await requestMagic(MAGIC_EMAIL);
      expect(req.statusCode).toBe(202);
      userById = { [magicUser.id]: { ...magicUser, status: 'suspended' } };
      const token = [...flowStore.keys()][0];
      const res = await app.inject({
        method: 'POST',
        url: CONSUME_URL,
        payload: { token },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('AUTH_004');
      expect(res.json().error.message).toBe('Account suspended');
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });

  it('single-use: second consume of the same token → 401', async () => {
    process.env['SMTP_HOST'] = 'smtp.test.local';
    try {
      const req = await requestMagic(MAGIC_EMAIL);
      expect(req.statusCode).toBe(202);
      const token = [...flowStore.keys()][0];
      expect(token).toBeDefined();
      const first = await app.inject({ method: 'POST', url: CONSUME_URL, payload: { token } });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({ method: 'POST', url: CONSUME_URL, payload: { token } });
      expect(second.statusCode).toBe(401);
      expect(second.json().error.code).toBe('AUTH_MAGIC_001');
    } finally {
      delete process.env['SMTP_HOST'];
    }
  });
});
