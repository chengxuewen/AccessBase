import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { OptionsManager } from '@accessbase/identity';

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

const mockFindAll = vi.fn().mockResolvedValue({
  data: [mockUser],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
});

// create() echoes the input and defaults isActive true (matches UserManager contract)
const mockCreate = vi.fn().mockImplementation((data: { email: string; name: string; isActive?: boolean }) =>
  Promise.resolve({
    ...mockUser,
    id: `550e8400-e29b-41d4-a716-4466554400${String(mockCreate.mock.calls.length + 2).padStart(2, '0')}`,
    email: data.email,
    name: data.name,
    isActive: data.isActive ?? true,
  }),
);

// setupGuard's queryAdminExists fast path needs findByEmail to resolve an
// admin (else it dials real PG); import's duplicate check needs it to be
// email-aware: only the configured admin email exists, everything else null.
const mockFindByEmail = vi.fn().mockImplementation((email: string) =>
  email === 'admin@accessbase.local' || email === 'dup@example.com'
    ? Promise.resolve({ id: 'u-exists', email })
    : Promise.resolve(null),
);

// revokeAllUserSessions spy — force-logout assertions read calls off this
const mockRevokeAll = vi.fn().mockResolvedValue(undefined);

vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  UserManager: vi.fn().mockImplementation(() => ({
    findAll: mockFindAll,
    findByEmail: mockFindByEmail,
    create: mockCreate,
  })),
  // requirePermission resolves PermissionManager off app.identity — mock allow
  PermissionManager: vi.fn().mockImplementation(() => ({
    hasPermission: vi.fn().mockResolvedValue(true),
  })),
  RoleManager: vi.fn().mockImplementation(() => ({})),
  SessionManager: vi.fn().mockImplementation(() => ({
    revokeAllUserSessions: mockRevokeAll,
  })),
}));

// Options seam for readPasswordPolicy('register') — env-first passthrough with
// an empty store reproduces the default register policy (8/upper/lower/digit).
const optionsStore = new Map<string, unknown>();
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : (optionsStore.has(key) ? optionsStore.get(key) : defaultValue),
} as unknown as OptionsManager);

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

const authHeaders = () => ({ Authorization: `Bearer ${token}` });
const goodRow = { email: 'new.user@example.com', name: 'New User', password: 'GoodPass1' };

describe('POST /api/v1/users/import', () => {
  it('dry-run (no commit) returns report shape {valid, errors} without creating', async () => {
    mockCreate.mockClear();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: authHeaders(),
      payload: {
        rows: [
          goodRow,
          { email: 'bad-email', name: 'Bad Email', password: 'GoodPass1' },
          { email: 'weak@x.com', name: 'Weak Pw', password: 'short' },
        ],
      },
    } as never);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.valid).toBe(1);
    expect(body.data.errors).toHaveLength(2);
    // error entries carry row index + field + message
    for (const e of body.data.errors) {
      expect(e).toHaveProperty('row');
      expect(e).toHaveProperty('field');
      expect(e).toHaveProperty('message');
      expect(typeof e.row).toBe('number');
    }
    // dry-run must not touch UserManager.create
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('row error isolation on commit: bad rows do not block good rows', async () => {
    mockCreate.mockClear();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: authHeaders(),
      payload: {
        commit: true,
        rows: [
          goodRow,
          { email: 'weak@x.com', name: 'Weak Pw', password: 'short' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.created).toBe(1);
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]).toMatchObject({ row: 1, field: 'password' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      { email: goodRow.email, name: goodRow.name, password: goodRow.password, isActive: true },
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('commit lands users ACTIVE (R6): create receives isActive true', async () => {
    mockCreate.mockClear();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: authHeaders(),
      payload: { commit: true, rows: [goodRow] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(1);
    expect(body.data.errors).toHaveLength(0);
    // isActive must be explicitly true (R6 lead ruling — never pending)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('duplicate email (pre-existing) errors only that row', async () => {
    mockCreate.mockClear();
    // Email-aware mock: this address resolves as an existing user
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: authHeaders(),
      payload: {
        commit: true,
        rows: [
          { email: 'dup@example.com', name: 'Dup', password: 'GoodPass1' },
          goodRow,
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.created).toBe(1);
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]).toMatchObject({ row: 0 });
    expect(body.data.errors[0].message).toContain('already exists');
  });

  it('validates email format per row in dry-run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: authHeaders(),
      payload: { rows: [{ email: 'not-an-email', name: 'X', password: 'GoodPass1' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.errors[0]).toMatchObject({ row: 0, field: 'email' });
  });

  it('401 without token (route sits behind authenticate)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/import', payload: { rows: [] } });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/users/:id/force-logout', () => {
  it('revokes all sessions and returns revoked:true (R13 — no cache invalidation)', async () => {
    mockRevokeAll.mockClear();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440002/force-logout',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { revoked: true } });
    expect(mockRevokeAll).toHaveBeenCalledTimes(1);
    expect(mockRevokeAll).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440002');
  });

  it('is idempotent: repeated calls still 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440002/force-logout',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.revoked).toBe(true);
  });

  it('rides users:write permission gate via prefix trimming (addendum #3)', async () => {
    // No new authorize.ts key: POST:/api/v1/users → users:write covers both
    // /import and /:id/force-logout through longest-prefix segment trimming.
    const { getRequiredPermission } = await import('@accessbase/identity');
    expect(getRequiredPermission('POST', '/api/v1/users/import')).toBe('users:write');
    expect(getRequiredPermission('POST', '/api/v1/users/550e8400-e29b-41d4-a716-446655440002/force-logout')).toBe('users:write');
  });
});
