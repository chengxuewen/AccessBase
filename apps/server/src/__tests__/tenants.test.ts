import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';

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

const mockTenant = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const mockFindAll = vi.fn().mockResolvedValue({
  data: [mockTenant],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
});

const mockFindById = vi.fn().mockImplementation((id: string) =>
  id === mockTenant.id ? Promise.resolve(mockTenant) : Promise.resolve(null),
);

const mockCreate = vi.fn().mockImplementation((data: { name: string; slug: string }) => {
  if (data.slug === 'taken') {
    return Promise.reject(new Error(`TENANT_PROTECTED: slug '${data.slug}' already exists`));
  }
  return Promise.resolve({ ...mockTenant, id: '550e8400-e29b-41d4-a716-446655440011', ...data });
});

const mockUpdate = vi.fn().mockImplementation((id: string, data: { name?: string }) => {
  if (id === DEFAULT_TENANT_ID) {
    return Promise.reject(new Error('TENANT_PROTECTED: the default tenant cannot be modified'));
  }
  if (id === '00000000-0000-0000-0000-000000000099') {
    return Promise.reject(new Error('Tenant not found'));
  }
  return Promise.resolve({ ...mockTenant, ...data });
});

const mockDelete = vi.fn().mockImplementation((id: string) => {
  if (id === DEFAULT_TENANT_ID) {
    return Promise.reject(new Error('TENANT_PROTECTED: the default tenant cannot be modified'));
  }
  return Promise.resolve({ ...mockTenant, status: 'suspended' });
});

// Spread actual so unrelated server routes keep resolving; explicit mocks
// override the managers these tests exercise.
vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  TenantManager: vi.fn().mockImplementation(() => ({
    findAll: mockFindAll,
    findById: mockFindById,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
  })),
  UserManager: vi.fn().mockImplementation(() => ({
    findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
  })),
  RoleManager: vi.fn().mockImplementation(() => ({
    findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    findById: vi.fn().mockResolvedValue({ id: 'r1', name: 'admin' }),
  })),
  // requirePermission preHandler — default allow
  PermissionManager: vi.fn().mockImplementation(() => ({
    hasPermission: vi.fn().mockResolvedValue(true),
  })),
  SessionManager: vi.fn().mockImplementation(() => ({
    revokeAllUserSessions: vi.fn(),
  })),
}));

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: mockTenant.id, email: 'admin@accessbase.local' });
});

afterAll(async () => {
  await app.close();
});

const authHeaders = () => ({ Authorization: `Bearer ${token}` });

describe('GET /api/v1/tenants', () => {
  it('returns paginated tenant list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(1);
    expect(body.data[0]).toHaveProperty('slug');
  });

  it('denied tenants:read is enforced via the shared route guard (static)', async () => {
    const { getRequiredPermission } = await import('@accessbase/identity');
    // tenants routes must resolve codes through the same requirePermission gate;
    // live 403 behavior is covered by route-guard.test.ts tenants entries.
    expect(getRequiredPermission('GET', '/api/v1/tenants')).toBe('tenants:read');
    expect(getRequiredPermission('POST', '/api/v1/tenants')).toBe('tenants:write');
    expect(getRequiredPermission('PUT', '/api/v1/tenants/x')).toBe('tenants:write');
    expect(getRequiredPermission('DELETE', '/api/v1/tenants/x')).toBe('tenants:delete');
  });
});

describe('GET /api/v1/tenants/:id', () => {
  it('returns tenant by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${mockTenant.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(mockTenant.id);
    expect(body.data.slug).toBe('acme');
  });

  it('returns 404 for nonexistent tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/00000000-0000-0000-0000-000000000099',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/tenants', () => {
  it('creates a tenant (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: authHeaders(),
      payload: { name: 'Globex', slug: 'globex' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe('globex');
  });

  it('returns 409 TENANT_PROTECTED on duplicate slug', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: authHeaders(),
      payload: { name: 'Dup', slug: 'taken' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TENANT_PROTECTED');
  });
});

describe('PUT /api/v1/tenants/:id', () => {
  it('updates tenant', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/tenants/${mockTenant.id}`,
      headers: authHeaders(),
      payload: { name: 'Acme Renamed' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Acme Renamed');
  });

  it('returns 409 TENANT_PROTECTED for default tenant', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/tenants/${DEFAULT_TENANT_ID}`,
      headers: authHeaders(),
      payload: { name: 'Nope' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TENANT_PROTECTED');
  });

  it('returns 404 for nonexistent tenant', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/tenants/00000000-0000-0000-0000-000000000099',
      headers: authHeaders(),
      payload: { name: 'Nope' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/v1/tenants/:id', () => {
  it('soft-deletes tenant', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${mockTenant.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(mockTenant.id);
  });

  it('returns 409 TENANT_PROTECTED for default tenant', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${DEFAULT_TENANT_ID}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TENANT_PROTECTED');
  });
});

describe('seed / routePermissions static assertions', () => {
  it('permissions-seed.ts declares exactly 21 resource entries (incl. tenants)', () => {
    const src = readFileSync(resolveSeedPath(), 'utf8');
    expect((src.match(/resource: '/g) ?? []).length).toBe(21);
    expect(src).toContain("resource: 'tenants'");
  });

  it('partition lists cover tenants codes (bindPermissions name readback supersedes RESOURCES filter)', () => {
    const src = readFileSync(
      new URL('../../../../packages/identity/src/services/permission-partition.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).toContain("'tenants:read'");
    expect(src).toContain("'tenants:write'");
    expect(src).toContain("'tenants:delete'");
  });
});

function resolveSeedPath(): string {
  // relative to apps/server — keeps the assertion stable regardless of cwd
  return new URL('../routes/permissions-seed.ts', import.meta.url).pathname;
}
