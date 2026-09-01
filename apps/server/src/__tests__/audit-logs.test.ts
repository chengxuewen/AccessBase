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

// Drizzle mock: select() is used twice per request (count query, data query).
// The where() node is awaitable (count path) and chainable (data path).
const dbMock = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  select: vi.fn(),
};

vi.mock('@accessbase/identity/db', () => ({
  createDb: vi.fn(() => dbMock),
  auditLogs: {},
}));

// identity is imported by app.ts (auth/users/roles routes); spread actual, mock managers
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      findById: vi.fn().mockResolvedValue(null),
      verifyPassword: vi.fn().mockRejectedValue(new Error('nope')),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  };
});

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

// Per-test query results consumed by the drizzle chain mock
let rows: Record<string, unknown>[] = [];
let total = 0;

function authedInject(options: { method: 'GET'; url: string }) {
  const token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000' });
  return app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  dbMock.select.mockImplementation(() => {
    // where() result: awaitable for count, chainable for data
    const whereNode = Object.assign(Promise.resolve([{ total }]), {
      orderBy: () => ({
        limit: () => ({ offset: () => Promise.resolve(rows) }),
      }),
    });
    return { from: () => ({ where: () => whereNode }) };
  });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/audit-logs', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs' });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_001');
  });

  it('returns seeded rows in flat envelope with mapped shape and total', async () => {
    rows = [
      {
        id: 'a-1',
        action: 'POST /api/v1/users',
        userId: 'u-1',
        resourceType: 'user',
        resourceId: 'u-9',
        ip: '10.0.0.1',
        responseStatus: 201,
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
      {
        id: 'a-2',
        action: 'DELETE /api/v1/roles/1',
        userId: 'u-2',
        resourceType: 'role',
        resourceId: 'r-1',
        ip: '10.0.0.2',
        responseStatus: 200,
        createdAt: new Date('2026-08-31T00:01:00Z'),
      },
    ];
    total = 2;

    const res = await authedInject({ method: 'GET', url: '/api/v1/audit-logs?page=1&pageSize=10' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      id: 'a-1',
      action: 'POST /api/v1/users',
      actor: 'u-1',
      resource: 'user u-9',
      ipAddress: '10.0.0.1',
      status: 201,
    });
    expect(typeof body.data[0].createdAt).toBe('string');
  });

  it('filters by action query param and returns only matching rows', async () => {
    rows = [
      {
        id: 'a-3',
        action: 'POST /api/v1/users',
        userId: 'u-1',
        resourceType: 'user',
        resourceId: 'u-9',
        ip: '10.0.0.1',
        responseStatus: 201,
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    ];
    total = 1;

    const res = await authedInject({ method: 'GET', url: '/api/v1/audit-logs?action=users' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].action).toContain('users');
  });
});
