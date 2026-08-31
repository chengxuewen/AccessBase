import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock plugins that require fastify@5 but fastify@4 is installed (same as routes.test.ts)
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// PermissionManager.findAll hits PG — stub it with in-memory data
vi.mock('@accessbase/identity', async (importOriginal) => {
  const original = await importOriginal<typeof import('@accessbase/identity')>();
  const permissionFixture = {
    id: '660e8400-e29b-41d4-a716-446655440001',
    name: 'users:read',
    resource: 'users',
    action: 'read',
    description: 'Read users',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  class PermissionManager {
    async findAll() {
      return {
        data: [permissionFixture],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };
    }
  }
  return { ...original, PermissionManager };
});

const { buildApp } = await import('../app.js');
const { setSetupComplete } = await import('../middleware/setup-guard.js');

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
  // Bypass setup guard — tests exercise the auth layer, not setup state
  setSetupComplete(true);
});

// Sign a valid JWT using the app's own secret so jwtVerify passes
async function authedInject(options: { method: 'GET'; url: string }) {
  const token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000' });
  return app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });
}

describe('GET /api/v1/permissions', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/permissions' });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_001');
  });

  it('returns paginated permission list when authenticated', async () => {
    const res = await authedInject({ method: 'GET', url: '/api/v1/permissions' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ resource: 'users', action: 'read' });
    expect(body.total).toBe(1);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/permissions',
      headers: { authorization: 'Bearer not-a-jwt' },
    });

    expect(res.statusCode).toBe(401);
  });
});
