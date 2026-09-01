/**
 * Setup Guard — DB-derived state tests (D113)
 *
 * Setup state is derived from the users table via UserManager.findByEmail
 * on every guarded request. No in-memory state; tests control state purely
 * by mocking findByEmail:
 *   - resolves non-null  → initialized (setup writes → 410)
 *   - resolves null      → not initialized (non-setup → 403 SETUP_REQUIRED)
 *   - rejects            → guard fails closed (503 SETUP_STATE_UNAVAILABLE),
 *                          status endpoint fails open (200, adminExists:false)
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

beforeEach(() => {
  mockFindByEmail.mockReset();
});

describe('setupGuard: un-initialized state (findByEmail → null)', () => {
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
});

describe('setupGuard: initialized state (findByEmail → admin user)', () => {
  const adminUser = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    email: 'admin@accessbase.local',
    name: 'Admin',
    isActive: true,
  };

  beforeEach(() => {
    mockFindByEmail.mockResolvedValue(adminUser);
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

  it('blocks setup write endpoints with 410 SETUP_ALREADY_COMPLETE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: { email: 'x@y.z', password: 'P@ssw0rd!' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('SETUP_ALREADY_COMPLETE');
  });
});

describe('setupGuard: DB failure three-state behavior', () => {
  it('status endpoint fails open: 200 with adminExists:false', async () => {
    mockFindByEmail.mockRejectedValue(new Error('db down'));
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      isInitialized: false,
      adminExists: false,
      configComplete: false,
    });
  });

  it('guard fails closed: /api/v1/users → 503 SETUP_STATE_UNAVAILABLE', async () => {
    mockFindByEmail.mockRejectedValue(new Error('db down'));
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SETUP_STATE_UNAVAILABLE');
  });

  it('uses adminEmail fallback when config.adminEmail is empty', async () => {
    mockFindByEmail.mockResolvedValue(null);
    await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(mockFindByEmail).toHaveBeenCalledWith('admin@accessbase.local');
  });
});
