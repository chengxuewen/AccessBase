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

// --- Auth endpoints (stub/mocked — all return 501 NOT_IMPLEMENTED) ---

describe('POST /api/v1/auth/login', () => {
  it('returns 501 NOT_IMPLEMENTED (identity not wired)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@test.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(501);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('rejects missing password with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@test.com' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects empty body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/register', () => {
  it('returns 501 NOT_IMPLEMENTED (identity not wired)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@test.com', name: 'Test User', password: 'password123' },
    });

    expect(res.statusCode).toBe(501);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('rejects missing name with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@test.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects short password with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@test.com', name: 'Test', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('rejects unauthenticated request with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_001');
  });

  it('returns 501 for authenticated request (identity not wired)', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(501);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('returns 501 NOT_IMPLEMENTED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'some-refresh-token' },
    });

    expect(res.statusCode).toBe(501);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

// --- Protected routes require auth ---

describe('protected routes authentication', () => {
  const protectedRoutes = [
    { method: 'GET' as const, url: '/api/v1/users' },
    { method: 'GET' as const, url: '/api/v1/users/me' },
    { method: 'GET' as const, url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440000' },
    { method: 'GET' as const, url: '/api/v1/roles' },
    { method: 'GET' as const, url: '/api/v1/roles/550e8400-e29b-41d4-a716-446655440000' },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.url} rejects unauthenticated with 401`, async () => {
      const res = await app.inject(route);
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_001');
    });
  }
});
