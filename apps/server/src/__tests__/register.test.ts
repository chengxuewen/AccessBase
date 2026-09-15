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

// Stable mock handles — tests drive them with mockResolvedValueOnce
const findByEmailMock = vi.fn()

// Email-aware: guard fast path needs findByEmail(adminEmail) non-null;
// register dup-check needs findByEmail(<new email>) null. Returns the admin
// only for the default admin address (disabled-user.test precedent).
findByEmailMock.mockImplementation((email: string) =>
  Promise.resolve(
    email === 'admin@accessbase.local' ? { id: 'u1', email } : null,
  ),
);
const createMock = vi.fn();
const changeStatusMock = vi.fn();

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    // findByEmail non-null (admin fast path) short-circuits setup-guard's
    // queryAdminExists → guard passes non-setup routes (users.test precedent)
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: findByEmailMock,
      create: createMock,
      changeStatus: changeStatusMock,
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      getUserRoles: vi.fn().mockResolvedValue([]),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn().mockResolvedValue(true),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      rotateRefreshToken: vi.fn(),
      findSessionByToken: vi.fn().mockResolvedValue(null),
      revokeSession: vi.fn(),
      revokeAllUserSessions: vi.fn(),
    })),
    // OptionsManager mock: C2 policy read must not dial the fake PG;
    // get honors the env-first contract (password.test precedent).
    OptionsManager: vi.fn().mockImplementation(() => ({
      get: vi.fn(async (_key: string, envValue: unknown, defaultValue: unknown) =>
        envValue !== undefined ? envValue : defaultValue,
      ),
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

describe('POST /api/v1/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-arm email-aware default (clearAllMocks wipes implementations)
    findByEmailMock.mockImplementation((email: string) =>
      Promise.resolve(
        email === 'admin@accessbase.local' ? { id: 'u1', email } : null,
      ),
    );
    changeStatusMock.mockResolvedValue({
      id: 'u9', email: 'new@x.io', name: 'New', isActive: false,
    });
  });

  it('creates pending user on valid payload', async () => {
    createMock.mockResolvedValueOnce({
      id: 'u9', email: 'new@x.io', name: 'New', isActive: true, tenantId: 't1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@x.io', name: 'New', password: 'Passw0rd!' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ success: true, data: { status: 'pending' } });
    // Two-param create + pending via changeStatus (addendum #1/#2)
    expect(createMock).toHaveBeenCalledWith(
      { email: 'new@x.io', name: 'New', password: 'Passw0rd!' },
      expect.any(String),
    );
    expect(changeStatusMock).toHaveBeenCalledWith('u9', 'pending', expect.any(String));
  });

  it('409 AUTH_REG_001 on duplicate email', async () => {
    // Re-arm implementation (not a Once: setup-guard already calls findByEmail
    // for its admin fast path, so a Once queue would be consumed by the guard,
    // not by the handler's dup-check): every non-admin address now exists.
    findByEmailMock.mockImplementation((email: string) =>
      Promise.resolve({ id: 'u1', email }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'dup@x.io', name: 'D', password: 'Passw0rd!' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUTH_REG_001');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('400 AUTH_REG_002 on weak password (no uppercase)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'w@x.io', name: 'W', password: 'weakpass1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_REG_002');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('400 AUTH_REG_002 on short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 's@x.io', name: 'S', password: 'Aa1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_REG_002');
  });
});
