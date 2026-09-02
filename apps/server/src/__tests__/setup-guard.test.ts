/**
 * Setup Guard — DB-derived state tests (D113)
 *
 * Setup state is derived from the users table:
 *   1. fast path: configured/default admin email exists (UserManager.findByEmail)
 *   2. fallback (carried ruling): ANY user holds the 'admin' role
 *      (users ⋈ user_roles ⋈ roles) — closes the custom-email blind spot
 *      for wizard-created admins.
 *
 * Tests control state via `setAdminRoleRows` (drizzle db mock) and
 * `mockFindByEmail`:
 *   - either path hits → initialized (setup writes → 410)
 *   - both miss       → not initialized (non-setup → 403 SETUP_REQUIRED)
 *   - db rejects      → guard fails closed (503 SETUP_STATE_UNAVAILABLE),
 *                       status endpoint fails open (200, adminExists:false)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// Drizzle db + table mocks: the existence check joins users ⋈ user_roles ⋈ roles
// (roles.name = 'admin'). Tests control state via `adminRoleRows`.
const adminRoleRows: unknown[][] = [];
const dbMock = { select: vi.fn() };

vi.mock('@accessbase/identity/db', () => ({
  createDb: vi.fn(() => dbMock),
  users: { __table: 'users' },
  userRoles: { __table: 'userRoles' },
  roles: { __table: 'roles' },
}));

// UserManager mock: the guard's findByEmail fast path (and other routes) route
// through this seam; default in beforeEach is null so state is drizzle-driven.
const mockFindByEmail = vi.fn();

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: mockFindByEmail,
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

// Per-test state control: empty = not initialized, one row = an admin-role user exists.
function setAdminRoleRows(count: number) {
  adminRoleRows.length = 0;
  for (let i = 0; i < count; i++) adminRoleRows.push([{ id: `u${i}` }]);
}

beforeEach(() => {
  mockFindByEmail.mockReset();
  dbMock.select.mockReset();
  dbMock.select.mockImplementation(() => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(adminRoleRows),
          }),
        }),
      }),
    }),
  }));
  setAdminRoleRows(0);
});

describe('setupGuard: un-initialized state (no admin-role user)', () => {
  beforeEach(() => {
    mockFindByEmail.mockResolvedValue(null);
  });
  it('blocks /api/v1/users with 403 SETUP_REQUIRED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SETUP_REQUIRED');
  });

  it('returns 200 status with adminExists:false when not initialized', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      isInitialized: false,
      adminExists: false,
      configComplete: false,
    });
  });

  it('allows /health/live', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });

  it('allows /api/v1/setup/checks (whitelisted)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/checks' });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /api/v1/setup/admin to proceed (not 403/410)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: { email: 'new-admin@test.local', name: 'Admin', password: 'P@ssw0rd1' },
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(410);
  });

  it('does not let "/" prefix-match every URL (regression: startsWith bug)', async () => {
    // Before the fix, '/' in ALLOWED_PATHS made every URL bypass the guard.
    const res = await app.inject({ method: 'GET', url: '/api/v1/roles' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SETUP_REQUIRED');
  });

  it('uses adminEmail fallback when config.adminEmail is empty (fast path)', async () => {
    mockFindByEmail.mockResolvedValue(null);
    await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(mockFindByEmail).toHaveBeenCalledWith('admin@accessbase.local');
  });
});

describe('setupGuard: initialized state (admin-role user exists)', () => {
  beforeEach(() => {
    // findByEmail misses (e.g. wizard admin used a custom email);
    // the admin-role join is what reports initialized.
    mockFindByEmail.mockResolvedValue(null);
    setAdminRoleRows(1);
  });

  it('allows /api/v1/users through the guard (401 from auth, not 403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    // Auth middleware runs after guard: 401 expected without token, NOT 403.
    expect(res.statusCode).toBe(401);
  });

  it('status endpoint reports initialized', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      isInitialized: true,
      adminExists: true,
      configComplete: true,
    });
  });

  it('blocks POST /setup/admin with 410 SETUP_ALREADY_COMPLETE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: { email: 'x@y.z', password: 'P@ssw0rd!' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('SETUP_ALREADY_COMPLETE');
  });

  it('lets POST /setup/config through the guard mid-wizard (admin exists)', async () => {
    // admin 创建后 isInitialized 即为 true，config 是向导内合法写，handler 自身有 410 二道防线
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/config',
      payload: { siteName: 'AccessBase' },
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(410);
  });
});

describe('setupGuard: DB failure three-state behavior', () => {
  const dbRejectChain = () =>
    dbMock.select.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.reject(new Error('db down')),
            }),
          }),
        }),
      }),
    }));

  it('status endpoint fails open: 200 with adminExists:false', async () => {
    dbRejectChain();
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      isInitialized: false,
      adminExists: false,
      configComplete: false,
    });
  });

  it('guard fails closed: /api/v1/users → 503 SETUP_STATE_UNAVAILABLE', async () => {
    dbRejectChain();
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SETUP_STATE_UNAVAILABLE');
  });

  it('REGRESSION (custom-email blind spot): wizard admin with custom email counts as initialized', async () => {
    // Before the carried ruling, queryAdminExists only checked findByEmail(config.adminEmail ||
    // fallback). A wizard-created admin with a CUSTOM email left the guard thinking the system
    // was uninitialized → global 403. Now: email miss + ANY admin-role user ⇒ initialized.
    mockFindByEmail.mockResolvedValue(null);
    setAdminRoleRows(1);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    // 401 (auth) proves the guard let the request through; 403 would be the blind spot.
    expect(res.statusCode).toBe(401);
  });

  it('exposes adminRoleRows-based state: empty rows ⇒ wizard can proceed to POST /setup/admin', async () => {
    mockFindByEmail.mockResolvedValue(null);
    setAdminRoleRows(0);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: { email: `admin-${Date.now()}@test.local`, name: 'Admin', password: 'P@ssw0rd1' },
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(410);
  });
});
