import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';

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

// Mock RoleManager + UserManager (D113 guard) to avoid real DB
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  const Role = (overrides: Record<string, unknown> = {}) => ({
    id: '11111111-1111-1111-1111-111111111111',
    name: 'seed',
    description: undefined,
    tenantId: '00000000-0000-0000-0000-000000000001',
    permissions: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
  const instance = {
    findAll: vi.fn().mockResolvedValue({
      data: [Role({ name: 'admin' })],
      total: 1,
      page: 2,
      pageSize: 10,
      totalPages: 1,
    }),
    findById: vi.fn().mockImplementation((id: string) =>
      id === '11111111-1111-1111-1111-111111111111'
        ? Promise.resolve(Role())
        : Promise.resolve(null),
    ),
    create: vi.fn().mockImplementation((data: { name: string; description?: string }) =>
      Promise.resolve(Role({ name: data.name, description: data.description })),
    ),
    update: vi
      .fn()
      .mockImplementation((id: string, data: { name?: string; description?: string }) =>
        Promise.resolve(Role({ id, name: data.name ?? 'seed', description: data.description })),
      ),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    ...actual,
    // D113: the setup guard queries the users table via UserManager on every request —
    // mock admin as existing so guarded routes are reachable.
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    })),
    RoleManager: vi.fn().mockImplementation(() => instance),
  };
});

const { buildApp } = await import('../app.js');
const identity = await import('@accessbase/identity');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: '00000000-0000-0000-0000-0000000000ff', email: 'admin@test.com' });
});

afterAll(async () => {
  await app.close();
});

const AUTH = (t: string) => ({ authorization: `Bearer ${t}` });

describe('GET /api/v1/roles', () => {
  it('returns paginated roles via RoleManager', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/roles?page=2&pageSize=10',
      headers: AUTH(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rm = (identity as any).RoleManager.mock.results[0].value as {
      findAll: ReturnType<typeof vi.fn>;
    };
    expect(rm.findAll).toHaveBeenCalledWith(
      { page: 2, pageSize: 10, search: undefined },
      '00000000-0000-0000-0000-000000000001',
    );
  });
});

describe('GET /api/v1/roles/:id', () => {
  it('returns role by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
      headers: AUTH(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('seed');
  });

  it('returns 404 envelope for unknown ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/roles/22222222-2222-2222-2222-222222222222',
      headers: AUTH(token),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/roles', () => {
  it('creates a role with 201', async () => {
    const name = 'test-role-' + Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: AUTH(token),
      payload: { name, description: 'desc' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe(name);
  });
});

describe('PUT /api/v1/roles/:id', () => {
  it('updates a role', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
      headers: AUTH(token),
      payload: { name: 'updated-role' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('updated-role');
  });
});

describe('DELETE /api/v1/roles/:id', () => {
  it('deletes a role', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
      headers: AUTH(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
  });
});
