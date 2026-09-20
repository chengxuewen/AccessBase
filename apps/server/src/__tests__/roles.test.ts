import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
  // L'-T5: ordered call log so route tests can assert setParent-before-update.
  const callLog: string[] = [];
  const instance = {
    callLog,
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
      .mockImplementation((id: string, data: { name?: string; description?: string }) => {
        callLog.push('update');
        return Promise.resolve(Role({ id, name: data.name ?? 'seed', description: data.description }));
      }),
    delete: vi.fn().mockResolvedValue(undefined),
    setParent: vi
      .fn()
      .mockImplementation((id: string, parentId: string | null) => {
        callLog.push(`setParent:${String(parentId)}`);
        return Promise.resolve(Role({ id, parentId: parentId ?? undefined }));
      }),
  };
  return {
    ...actual,
    // D113: the setup guard queries the users table via UserManager on every request —
    // mock admin as existing so guarded routes are reachable.
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    })),
    RoleManager: vi.fn().mockImplementation(() => instance),
    // requirePermission preHandler (Task 9) — default allow
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn().mockResolvedValue(true),
    })),
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

// G/R3 RED: a token's tenantId claim must reach the Manager via request context,
// not the hardcoded DEFAULT_TENANT constant.
describe('GET /api/v1/roles — tenantId injection', () => {
  it('passes the token tenantId claim to RoleManager.findAll', async () => {
    const tenantToken = app.jwt.sign({
      sub: '00000000-0000-0000-0000-0000000000ff',
      email: 'admin@test.com',
      tenantId: '99999999-9999-9999-9999-999999999999',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: AUTH(tenantToken),
    });

    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rm = (identity as any).RoleManager.mock.results[0].value as {
      findAll: ReturnType<typeof vi.fn>;
    };
    expect(rm.findAll).toHaveBeenLastCalledWith(
      expect.anything(),
      '99999999-9999-9999-9999-999999999999',
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


// K-T2: manager guard tags (ROLE_PROTECTED:) must map to a 409 envelope via the
// shared conflict mapper — never a 500.
describe('system role protection mapping (K-T2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roleManagerInstance = () => (identity as any).RoleManager.mock.results[0].value as {
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  it('PUT maps ROLE_PROTECTED manager error to 409 {code: ROLE_PROTECTED}', async () => {
    roleManagerInstance().update.mockRejectedValueOnce(
      new Error('ROLE_PROTECTED: cannot modify the built-in administrator role'),
    );
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
      headers: AUTH(token),
      payload: { name: 'hijack' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('ROLE_PROTECTED');
    expect(body.error.message).toBeTruthy();
  });

  it('DELETE maps ROLE_PROTECTED manager error to 409 {code: ROLE_PROTECTED}', async () => {
    roleManagerInstance().delete.mockRejectedValueOnce(
      new Error('ROLE_PROTECTED: cannot delete the built-in administrator role'),
    );
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
      headers: AUTH(token),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ROLE_PROTECTED');
  });
});

// L'-T5: PUT body parentId must route through RoleManager.setParent (cycle +
// same-tenant + isSystem guards live there) BEFORE any field write, so a rejected
// parent leaves name/description/permissions untouched.
describe('PUT /api/v1/roles/:id — parentId wiring (L\'-T5)', () => {
  const ROLE_ID = '11111111-1111-1111-1111-111111111111';
  const PARENT_ID = '22222222-2222-2222-2222-222222222222';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rm = () => (identity as any).RoleManager.mock.results[0].value as {
    setParent: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    callLog: string[];
  };
  beforeEach(() => {
    rm().callLog.length = 0;
    rm().setParent.mockClear();
    rm().update.mockClear();
  });

  it('calls setParent before update and forwards the tenant scope', async () => {
    rm().callLog.length = 0;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: AUTH(token),
      payload: { name: 'renamed', parentId: PARENT_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(rm().callLog).toEqual([`setParent:${PARENT_ID}`, 'update']);
    expect(rm().setParent).toHaveBeenCalledWith(ROLE_ID, PARENT_ID, '00000000-0000-0000-0000-000000000001');
  });

  it('explicit null clears the parent (setParent receives null)', async () => {
    rm().callLog.length = 0;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: AUTH(token),
      payload: { parentId: null },
    });

    expect(res.statusCode).toBe(200);
    expect(rm().setParent).toHaveBeenCalledWith(ROLE_ID, null, '00000000-0000-0000-0000-000000000001');
  });

  it('leaves the parent untouched when the key is absent', async () => {
    rm().callLog.length = 0;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: AUTH(token),
      payload: { name: 'renamed-only' },
    });

    expect(res.statusCode).toBe(200);
    expect(rm().setParent).not.toHaveBeenCalled();
    expect(rm().callLog).toEqual(['update']);
  });

  it('maps a ROLE_PROTECTED setParent refusal to the 409 envelope', async () => {
    rm().setParent.mockRejectedValueOnce(
      new Error('ROLE_PROTECTED: cannot modify the built-in administrator role'),
    );
    rm().callLog.length = 0;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: AUTH(token),
      payload: { parentId: PARENT_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ROLE_PROTECTED');
    // setParent threw before any field write — update() never reached.
    expect(rm().callLog).toEqual([]);
    expect(rm().setParent).toHaveBeenCalledTimes(1);
  });

  it('maps an unknown parent role to the NOT_FOUND 404 envelope', async () => {
    rm().setParent.mockRejectedValueOnce(new Error('Parent role not found'));
    rm().callLog.length = 0;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: AUTH(token),
      payload: { parentId: '33333333-3333-3333-3333-333333333333' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(rm().callLog).toEqual([]);
  });

  it('rejects a malformed parent id at the schema boundary', async () => {
    rm().callLog.length = 0;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: AUTH(token),
      payload: { parentId: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
  });
});
