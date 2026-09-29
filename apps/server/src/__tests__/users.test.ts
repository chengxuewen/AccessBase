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

// Mock @accessbase/identity to avoid needing a real DB
const mockUser = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  email: 'test@example.com',
  name: 'Test User',
  isActive: true,
  tenantId: '00000000-0000-0000-0000-000000000001',
  tokenVersion: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockUser2 = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  email: 'admin@example.com',
  name: 'Admin User',
  isActive: true,
  tenantId: '00000000-0000-0000-0000-000000000001',
  tokenVersion: 0,
  createdAt: new Date('2026-01-02'),
  updatedAt: new Date('2026-01-02'),
};

const mockFindAll = vi.fn().mockResolvedValue({
  data: [mockUser, mockUser2],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
});

const mockFindById = vi.fn().mockImplementation((id: string) => {
  if (id === mockUser.id) return Promise.resolve(mockUser);
  if (id === '00000000-0000-0000-0000-000000000000') return Promise.resolve(null);
  return Promise.resolve(null);
});

const mockFindByEmail = vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' });

const mockCreate = vi.fn().mockImplementation((data: { email: string; name: string }) => {
  if (data.email === 'existing@example.com') {
    return Promise.reject(new Error('unique constraint violation'));
  }
  return Promise.resolve({
    ...mockUser,
    id: '550e8400-e29b-41d4-a716-446655440099',
    email: data.email,
    name: data.name,
  });
});

const mockUpdate = vi.fn().mockImplementation((id: string, data: { name?: string }) => {
  if (id === '00000000-0000-0000-0000-000000000000') {
    return Promise.reject(new Error('User not found'));
  }
  return Promise.resolve({ ...mockUser, ...data });
});

const mockChangeStatus = vi.fn().mockImplementation((id: string, status: string) => {
  if (id === '00000000-0000-0000-0000-000000000000') {
    return Promise.reject(new Error('User not found'));
  }
  return Promise.resolve({
    ...mockUser,
    isActive: status === 'active',
  });
});

const mockDelete = vi.fn().mockImplementation((id: string) => {
  if (id === '00000000-0000-0000-0000-000000000000') {
    return Promise.reject(new Error('User not found'));
  }
  return Promise.resolve();
});

const mockSetUserRoles = vi.fn().mockResolvedValue(undefined);
const mockGetUserRoles = vi.fn().mockResolvedValue([
  { id: '550e8400-e29b-41d4-a716-4466554400aa', name: 'admin' },
]);

// R-audit Task A5 seams: erase funnel + advisory-lock probe inside the tx seam.
// mockLockAcquired flips the SELECT pg_try_advisory_xact_lock(727242) result.
let mockLockAcquired = true;
const mockTxExecute = vi.fn().mockImplementation(() =>
  Promise.resolve({ rows: [{ locked: mockLockAcquired }] }),
);
const mockEraseAuditData = vi.fn().mockResolvedValue({
  receiptHash: 'genesis', rowsAffected: 0, legacySkipped: 0, eventsScrubbed: 0,
});
// Tenant validator (T2-2): known role ids resolve, anything else is foreign → null
const mockRoleFindById = vi.fn().mockImplementation((id: string) =>
  id === '550e8400-e29b-41d4-a716-4466554400aa' || id === '550e8400-e29b-41d4-a716-4466554400bb'
    ? Promise.resolve({ id, name: 'assigned-role' })
    : Promise.resolve(null),
);

// Spread actual so later-added identity exports (FlowTokenService, MfaManager,
// getRedisClient) keep resolving; the explicit mocks below override the managers.
vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  UserManager: vi.fn().mockImplementation(() => ({
    // Q2b routeTx seam — the tx handle exposes execute() like a real drizzle
    // handle; the erasure route probes the advisory lock through it.
    transaction: (fn: (d: { execute: typeof mockTxExecute }) => unknown) =>
      fn({ execute: mockTxExecute }),
    findAll: mockFindAll,
    findById: mockFindById,
    findByEmail: mockFindByEmail,
    create: mockCreate,
    update: mockUpdate,
    changeStatus: mockChangeStatus,
    delete: mockDelete,
    eraseAuditData: mockEraseAuditData,
  })),
  RoleManager: vi.fn().mockImplementation(() => ({
    findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    findById: mockRoleFindById,
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setUserRoles: mockSetUserRoles,
    getUserRoles: mockGetUserRoles,
  })),
  // requirePermission preHandler (Task 9) — default allow
  PermissionManager: vi.fn().mockImplementation(() => ({
    hasPermission: vi.fn().mockResolvedValue(true),
  })),
  // auth.ts (Phase 6a Task 4) imports SessionManager; mock it too
  // auth.ts (Phase 6a Task 4) imports SessionManager; mock it too
  SessionManager: vi.fn().mockImplementation(() => ({
    rotateRefreshToken: vi.fn(),
    findSessionByToken: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn(),
    revokeAllUserSessions: vi.fn(),
  })),
}));

// A5: the request body schema on DELETE forces express-style content-type
// handling through the setup-guard DB probe; keep redis absent (getRedis
// returns null → FlowTokenService degrades) without dialing a real client.
vi.mock('../utils/redis.js', () => ({ getRedis: vi.fn().mockResolvedValue(null) }));
// A5: the DELETE body schema trips the setup-guard DB probe path under vitest
// (no real PG) — stub the guard hook to a pass-through (isSystemInitialized in
// setup.js is never reached; route imports untouched).
vi.mock('../middleware/setup-guard.js', () => ({ setupGuard: vi.fn().mockResolvedValue(undefined) }));

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: mockUser.id, email: mockUser.email });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // A5 erasure seams: lock always re-acquired per test; call histories clean.
  mockLockAcquired = true;
  mockTxExecute.mockClear();
  mockEraseAuditData.mockClear();
  mockDelete.mockClear();
});

const authHeaders = () => ({ Authorization: `Bearer ${token}` });

describe('GET /api/v1/users', () => {
  it('returns paginated user list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toHaveProperty('isActive');
  });
});

describe('GET /api/v1/users/me', () => {
  it('returns current user profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('email');
    expect(body.data).toHaveProperty('name');
    expect(body.data).toHaveProperty('isActive');
    expect(body.data).not.toHaveProperty('roles');
  });
});

describe('GET /api/v1/users/:id', () => {
  it('returns user by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
expect(body.data.id).toBe(mockUser.id);
    expect(body.data.email).toBe(mockUser.email);
    // T2-2 contract: detail exposes roles so UserEdit can prefill roleIds
    expect(body.data.roles).toEqual([{ id: '550e8400-e29b-41d4-a716-4466554400aa', name: 'admin' }]);
    expect(body.data.roleIds).toEqual(['550e8400-e29b-41d4-a716-4466554400aa']);
    expect(mockGetUserRoles).toHaveBeenCalledWith(mockUser.id, '00000000-0000-0000-0000-000000000001');
  });

  it('returns 404 for nonexistent user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/users', () => {
  it('creates a new user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(),
      payload: { email: 'new@example.com', name: 'New User', password: 'password123' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('id');
    expect(body.data.email).toBe('new@example.com');
  });

  it('assigns roles when roleIds are provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(),
      payload: {
        email: 'roled@example.com',
        name: 'Rolled User',
        roleIds: ['550e8400-e29b-41d4-a716-4466554400aa'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockSetUserRoles).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440099',
      ['550e8400-e29b-41d4-a716-4466554400aa'],
      '00000000-0000-0000-0000-000000000001',
      expect.anything(), // Q2b tx handle (routeTx)
    );
  });

  it('rejects foreign roleIds without creating the user (tenant isolation)', async () => {
    const callsBefore = mockCreate.mock.calls.length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(),
      payload: {
        email: 'foreign@example.com',
        name: 'Foreign User',
        roleIds: ['550e8400-e29b-41d4-a716-4466554400ff'],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_001');
    expect(mockCreate.mock.calls.length).toBe(callsBefore);
    expect(mockSetUserRoles).not.toHaveBeenCalledWith(
      expect.any(String),
      ['550e8400-e29b-41d4-a716-4466554400ff'],
      expect.any(String),
    );
  });

  it('honours isActive:false on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(),
      payload: { email: 'off@example.com', name: 'Off User', isActive: false },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'off@example.com', isActive: false }),
      '00000000-0000-0000-0000-000000000001',
      expect.anything(), // Q2b tx handle
    );
  });

  it('returns 409 on duplicate email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(),
      payload: { email: 'existing@example.com', name: 'Dup User' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });
});

describe('PUT /api/v1/users/:id', () => {
  it('updates user', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { name: 'Updated Name' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Updated Name');
  });

  it('replaces role set when roleIds provided', async () => {
    mockSetUserRoles.mockClear();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { roleIds: ['550e8400-e29b-41d4-a716-4466554400bb'] },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSetUserRoles).toHaveBeenCalledWith(
      mockUser.id,
      ['550e8400-e29b-41d4-a716-4466554400bb'],
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('leaves roles untouched when roleIds omitted', async () => {
    mockSetUserRoles.mockClear();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { name: 'Name Only' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSetUserRoles).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/users/:id/status', () => {
  it('changes user status', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${mockUser.id}/status`,
      headers: authHeaders(),
      payload: { status: 'suspended' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('isActive');
  });

  it('returns 404 for nonexistent user', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000/status',
      headers: authHeaders(),
      payload: { status: 'suspended' },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
  });
});

describe('DELETE /api/v1/users/:id', () => {
  it('deletes user', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
  });
});

describe('GET /api/v1/users (search)', () => {
  it('passes search params to UserManager', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?search=test&page=2&pageSize=10',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'test', page: 2, pageSize: 10 }),
      expect.any(String),
    );
  });
});

// K-T2: manager guard tags (LAST_ADMIN_GUARD:) must map to a 409 envelope via
// the shared conflict mapper — never a 500, on every mutating user route.
describe('last-admin guard mapping (K-T2)', () => {
  const guardErr = () =>
    new Error('LAST_ADMIN_GUARD: cannot remove the last active administrator of the tenant');

  it('PUT roleIds demotion maps LAST_ADMIN_GUARD to 409 {code: LAST_ADMIN_GUARD}', async () => {
    mockSetUserRoles.mockRejectedValueOnce(guardErr());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { roleIds: [] },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('LAST_ADMIN_GUARD');
    expect(body.error.message).toBeTruthy();
  });

  it('DELETE maps LAST_ADMIN_GUARD to 409', async () => {
    mockDelete.mockRejectedValueOnce(
      new Error('LAST_ADMIN_GUARD: cannot delete the last active administrator of the tenant'),
    );
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LAST_ADMIN_GUARD');
  });

  it('PATCH status suspend maps LAST_ADMIN_GUARD to 409', async () => {
    mockChangeStatus.mockRejectedValueOnce(
      new Error('LAST_ADMIN_GUARD: cannot suspend the last active administrator of the tenant'),
    );
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${mockUser.id}/status`,
      headers: authHeaders(),
      payload: { status: 'suspended' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LAST_ADMIN_GUARD');
  });
});

describe('DELETE /users/:id sanctioned erasure (R-audit Task A5)', () => {
  it('eraseAudit flag: routeTx FIRST statement is the advisory try-lock; erase runs with captured email BEFORE delete, all on one tx', async () => {
    mockEraseAuditData.mockResolvedValueOnce({ receiptHash: 'r', rowsAffected: 2, legacySkipped: 0, eventsScrubbed: 1 });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { eraseAudit: true, legalBasis: 'GDPR Art.17' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockEraseAuditData).toHaveBeenCalledTimes(1);
    // (email, requestedBy, legalBasis, tenantId-ish opts, tx handle) — email captured inside the tx
    const eraseArgs = mockEraseAuditData.mock.calls[0] as unknown[];
    expect(eraseArgs[0]).toBe(mockUser.id);
    const opts = eraseArgs[1] as Record<string, unknown>;
    expect(opts.legalBasis).toBe('GDPR Art.17');
    expect(opts.requestedBy).toBe(mockUser.id); // token sub (self-delete in mock lane)
    // ORDERING: erase ran BEFORE delete (email capture while user row exists)
    const delOrder = mockDelete.mock.invocationCallOrder[0];
    const eraseOrder = mockEraseAuditData.mock.invocationCallOrder[0];
    expect(eraseOrder).toBeLessThan(delOrder);
    // lock executed as tx first statement (drizzle sql template → render via PgDialect)
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const rendered = new PgDialect().sqlToQuery(mockTxExecute.mock.calls[0][0] as never);
    expect(rendered.sql).toContain('pg_try_advisory_xact_lock(727242)');
  });

  it('advisory lock false → 409 ERASE_LOCK_BUSY, erase/delete never called', async () => {
    mockLockAcquired = false;
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { eraseAudit: true, legalBasis: 'GDPR Art.17' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ERASE_LOCK_BUSY');
    expect(mockEraseAuditData).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('eraseAudit without legalBasis → 400 VALIDATION_001 (schema-declared required-when-flag)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { eraseAudit: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_001');
    expect(mockEraseAuditData).not.toHaveBeenCalled();
  });

  it('no flag → today behavior byte-identical: direct userManager.delete, no routeTx/lock/erase', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(mockUser.id, expect.any(String));
    expect(mockEraseAuditData).not.toHaveBeenCalled();
    expect(mockTxExecute).not.toHaveBeenCalled();
  });
});
