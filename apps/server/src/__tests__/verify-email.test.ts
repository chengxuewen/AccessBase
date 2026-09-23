import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { OptionsManager } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// Mailer mock: host-gated fromConfig (magic-login precedent)
const mailerSend = vi.fn().mockResolvedValue(undefined);
const mailerFromConfig = vi.fn((cfg: { host?: string } | null | undefined) =>
  cfg && cfg.host ? { send: mailerSend } : null,
);

const vUser = {
  id: '550e8400-e29b-41d4-a716-446655440040',
  email: 'verify-user@test.local',
  name: 'Verify User',
  tenantId: '00000000-0000-0000-0000-000000000001',
  status: 'active',
  emailVerified: false,
};

const markEmailVerified = vi.fn().mockResolvedValue(undefined);

// Shared flow store (issue/consume across the plugin's FlowTokenService mock)
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
      flowStore.delete(token);
      return null;
    }
    flowStore.delete(token);
    return entry.payload;
  }),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn(async (email: string) => {
        if (email === 'admin@accessbase.local') return { ...vUser, email };
        return null;
      }),
      findById: vi.fn(async (id: string) => (id === vUser.id ? vUser : null)),
      findByIdAny: vi.fn(async (id: string) => (id === vUser.id ? vUser : null)),
      create: vi.fn(async () => ({ id: vUser.id, email: 'new@test.local', name: 'New' })),
      changeStatus: vi.fn(async () => undefined),
      markEmailVerified,
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([]),
      getEffectivePermissions: vi.fn().mockResolvedValue([]),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
    })),
    FlowTokenService: vi.fn().mockImplementation(() => flowTokenMock),
    Mailer: { fromConfig: mailerFromConfig },
    OptionsManager: vi.fn().mockImplementation(() => ({
      get: vi.fn(async (_key: string, envValue: unknown, defaultValue: unknown) =>
        envValue !== undefined ? envValue : defaultValue,
      ),
    })),
  };
});

vi.mock('@accessbase/identity/db', () => ({
  users: { _: 'users-marker' },
  userRoles: { _: 'user_roles-marker' },
  roles: { _: 'roles-marker' },
  createDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => [] }),
          }),
        }),
        where: () => ({ limit: async () => [] }),
      }),
    }),
  }),
}));

const [{ _resetHostFallbackWarnForTest }] = await Promise.all([import('../routes/auth.js')]);
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (_key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : defaultValue,
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mailerSend.mockClear();
  mailerFromConfig.mockClear();
  markEmailVerified.mockClear();
  flowTokenMock.issue.mockClear();
  flowTokenMock.consume.mockClear();
  flowStore.clear();
  _resetHostFallbackWarnForTest();
  process.env['SMTP_HOST'] = 'mail.test.local';
  process.env['SMTP_FROM'] = 'no-reply@test.local';
});

function authHeader(): Record<string, string> {
  return {
    authorization: `Bearer ${app.jwt.sign({ sub: vUser.id, email: vUser.email })}`,
  };
}

describe('POST /api/v1/auth/verify-email/request (authenticated self-service, Q1-b2)', () => {
  it('no token → 401 (per-route app.authenticate — publicity is preHandler absence)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/request' });
    expect(res.statusCode).toBe(401);
  });

  it('authenticated + SMTP configured → 202 + email_verify issue + mail with /verify-email link', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email/request',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.message).toContain('Verification email sent');
    expect(flowTokenMock.issue).toHaveBeenCalledWith(
      'email_verify',
      { userId: vUser.id },
      86400,
    );
    expect(mailerSend).toHaveBeenCalledTimes(1);
    const html = String(mailerSend.mock.calls[0]?.[2]);
    expect(html).toContain('/verify-email?token=');
    // Link must carry the REAL token (never the full token in logs — W1-6 class)
    const issuedToken = [...flowStore.keys()][0];
    expect(html).toContain(issuedToken ?? 'NO-TOKEN');
  });

  it('SMTP unconfigured → 503 AUTH_EMAIL_002 (audience needs feedback; not enumeration-shaped)', async () => {
    delete process.env['SMTP_HOST'];
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email/request',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('AUTH_EMAIL_002');
  });
});

describe('POST /api/v1/auth/verify-email (public consume, Q1-b2)', () => {
  it('valid email_verify token → 200 + markEmailVerified(userId)', async () => {
    const token = await flowTokenMock.issue('email_verify', { userId: vUser.id }, 60);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.verified).toBe(true);
    expect(markEmailVerified).toHaveBeenCalledWith(vUser.id);
  });

  it('burn-first: second consume of same token → 400 AUTH_EMAIL_001', async () => {
    const token = await flowTokenMock.issue('email_verify', { userId: vUser.id }, 60);
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe('AUTH_EMAIL_001');
  });

  it('wrong-purpose token is rejected (purpose isolation)', async () => {
    const token = await flowTokenMock.issue('password_reset', { userId: vUser.id }, 60);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_EMAIL_001');
  });
});

describe('register fires best-effort verification email (Q1-b2)', () => {
  it('201 + mailer send with link (SMTP configured)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@test.local', name: 'New', password: 'Abcdef12!' },
    });
    expect(res.statusCode).toBe(201);
    // Best-effort is fire-and-forget: poll the spy (never assert sync ==1)
    await vi.waitFor(() => expect(mailerSend).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(String(mailerSend.mock.calls[0]?.[2])).toContain('/verify-email?token=');
  });
});
