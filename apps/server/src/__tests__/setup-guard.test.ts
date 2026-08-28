import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

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

const { buildApp, setSetupComplete } = await import('../app.js');

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
  setSetupComplete(false);
});

describe('setupGuard: un-initialized state', () => {
  it('blocks /api/v1/users with 403 SETUP_REQUIRED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SETUP_REQUIRED');
  });

  it('allows /api/v1/setup/status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(res.statusCode).toBe(200);
  });

  it('allows /health/live', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });

  it('does not let "/" prefix-match every URL (regression: startsWith bug)', async () => {
    // Before the fix, '/' in ALLOWED_PATHS made every URL bypass the guard.
    const res = await app.inject({ method: 'GET', url: '/api/v1/roles' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SETUP_REQUIRED');
  });
});

describe('setupGuard: initialized state', () => {
  it('allows /api/v1/users', async () => {
    setSetupComplete(true);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    // Auth middleware runs after guard: 401 expected without token, NOT 403.
    expect(res.statusCode).toBe(401);
  });

  it('blocks setup write endpoints with 410 SETUP_ALREADY_COMPLETE', async () => {
    setSetupComplete(true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: { email: 'x@y.z', password: 'P@ssw0rd!' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('SETUP_ALREADY_COMPLETE');
  });
});
