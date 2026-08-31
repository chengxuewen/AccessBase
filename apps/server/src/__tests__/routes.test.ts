import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock plugins that require fastify@5 but fastify@4 is installed.
vi.mock('@fastify/cors', () => ({
  default: async () => {},
}));
vi.mock('@fastify/swagger', () => ({
  default: async () => {},
}));
vi.mock('@fastify/swagger-ui', () => ({
  default: async () => {},
}));
vi.mock('@fastify/rate-limit', () => ({
  default: async () => {},
}));
vi.mock('@fastify/helmet', () => ({
  default: async () => {},
}));

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

// --- Health endpoints ---

describe('GET /health/live', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });
});

describe('GET /health/ready', () => {
  it('returns 503 when dependencies are not configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    // DB/Redis stubs report "not_configured" → degraded
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toBe('not_configured');
    expect(body.checks.redis).toBe('not_configured');
  });
});

describe('GET /health/startup', () => {
  it('returns 200 with uptime', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/startup' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });
});

// --- Setup endpoints (should work before setup is complete) ---
describe('GET /api/v1/setup/status', () => {
  it('returns setup status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('isInitialized');
    expect(body.data).toHaveProperty('adminExists');
    expect(body.data).toHaveProperty('configComplete');
  });
});

describe('GET /api/v1/setup/checks', () => {
  it('returns system checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/checks' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('checks');
    expect(Array.isArray(body.data.checks)).toBe(true);
  });
});

// --- Auth endpoints (blocked by setup guard when setup not complete) ---
describe('POST /api/v1/auth/login (setup guard)', () => {
  it('returns 403 SETUP_REQUIRED when setup is not complete', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@test.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SETUP_REQUIRED');
  });
});

describe('POST /api/v1/auth/register (setup guard)', () => {
  it('returns 403 SETUP_REQUIRED when setup is not complete', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@test.com', name: 'Test User', password: 'password123' },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SETUP_REQUIRED');
  });
});

describe('POST /api/v1/auth/logout (setup guard)', () => {
  it('returns 403 SETUP_REQUIRED when setup is not complete', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SETUP_REQUIRED');
  });
});

describe('POST /api/v1/auth/refresh (setup guard)', () => {
  it('returns 403 SETUP_REQUIRED when setup is not complete', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'some-refresh-token' },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SETUP_REQUIRED');
  });
});

// --- Protected routes (blocked by setup guard when setup not complete) ---
describe('protected routes authentication (setup guard)', () => {
  const protectedRoutes = [
    { method: 'GET' as const, url: '/api/v1/users' },
    { method: 'GET' as const, url: '/api/v1/users/me' },
    { method: 'GET' as const, url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440000' },
    { method: 'GET' as const, url: '/api/v1/roles' },
    { method: 'GET' as const, url: '/api/v1/roles/550e8400-e29b-41d4-a716-446655440000' },
    { method: 'GET' as const, url: '/api/v1/auth/oauth/github/authorize' },
    { method: 'GET' as const, url: '/api/v1/auth/oauth/links' },
    { method: 'DELETE' as const, url: '/api/v1/auth/oauth/github' },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.url} returns 403 SETUP_REQUIRED when setup is not complete`, async () => {
      const res = await app.inject(route);
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('SETUP_REQUIRED');
    });
  }
});
