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

// Shared spies for assertions
const revokeAllUserSessions = vi.fn().mockResolvedValue(undefined);
const rotateRefreshToken = vi.fn();
const findSessionByToken = vi.fn().mockResolvedValue(null);
const recordFailure = vi.fn().mockResolvedValue(1);
const mockVerifyPassword = vi.fn();
const mockFindById = vi.fn();
const mockChangeStatus = vi.fn().mockImplementation((id: string, status: string) =>
  Promise.resolve({
    id,
    email: 'victim@test.local',
    name: 'victim',
    isActive: status === 'active',
    totpEnabled: false,
    tenantId: '00000000-0000-0000-0000-000000000001',
    tokenVersion: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  }),
);

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      verifyPassword: mockVerifyPassword,
      findById: mockFindById,
      changeStatus: mockChangeStatus,
      // Non-null admin short-circuits setup-guard's queryAdminExists (skips its raw-PG fallback)
      findByEmail: vi.fn().mockResolvedValue({ id: ADMIN_ID, email: 'admin@accessbase.local' }),
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      getUserRoles: vi.fn().mockResolvedValue([]),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn().mockResolvedValue(true),
    })),
    // SessionManager is mocked here (unlike plan text which kept it real): the
    // spy target is the SAME fn the route calls — with a real manager the route
    // would create its own instance and our spy would never fire.
    SessionManager: vi.fn().mockImplementation(() => ({
      rotateRefreshToken,
      findSessionByToken,
      revokeSession: vi.fn(),
      revokeAllUserSessions,
    })),
    LockoutService: vi.fn().mockImplementation(() => ({
      isLocked: vi.fn().mockResolvedValue(false),
      isIpBlacklisted: vi.fn().mockResolvedValue(false),
      recordFailure,
      clear: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

const VICTIM_ID = '550e8400-e29b-41d4-a716-446655440000';
const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440099';

let app: App;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('disabled user enforcement (P0)', () => {
  it('authenticate returns 403 AUTH_004 when token carries status!=active', async () => {
    const token = app.jwt.sign({ sub: VICTIM_ID, email: 'a@b.c', status: 'suspended' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_004' } });
  });

  it('still authenticates claim-less legacy tokens (backward compat)', async () => {
    const token = app.jwt.sign({ sub: ADMIN_ID, email: 'ad@x.io' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.json().error?.code).not.toBe('AUTH_004');
  });

  it('PATCH status=suspended calls revokeAllUserSessions', async () => {
    revokeAllUserSessions.mockClear();
    const token = app.jwt.sign({ sub: ADMIN_ID, email: 'ad@x.io', status: 'active' });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${VICTIM_ID}/status`,
      payload: { status: 'suspended' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revokeAllUserSessions).toHaveBeenCalledWith(VICTIM_ID);
  });

  it('login maps ACCOUNT_SUSPENDED to 403 AUTH_004 without lockout.recordFailure', async () => {
    mockVerifyPassword.mockRejectedValueOnce(new Error('ACCOUNT_SUSPENDED'));
    recordFailure.mockClear();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'suspended@test.local', password: 'whatever' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_004' } });
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('refresh mints access token carrying status claim from findById', async () => {
    mockFindById.mockResolvedValue({
      id: VICTIM_ID,
      email: 'victim@test.local',
      name: 'victim',
      status: 'active',
    });
    findSessionByToken.mockResolvedValue({ userId: VICTIM_ID, id: 'sess-1' });
    rotateRefreshToken.mockResolvedValueOnce({
      refreshToken: 'new-raw-refresh-token',
      userId: VICTIM_ID,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'old-raw-refresh-token' },
    });

    expect(res.statusCode).toBe(200);
    const accessToken = res.json().data.accessToken as string;
    const decoded = app.jwt.decode<{ status?: string }>(accessToken);
    expect(decoded?.status).toBe('active');
  });

  it('refresh rejects pre-existing suspended users (fail-closed)', async () => {
    mockFindById.mockResolvedValue({
      id: VICTIM_ID,
      email: 'victim@test.local',
      name: 'victim',
      status: 'suspended',
    });
    findSessionByToken.mockResolvedValue({ userId: VICTIM_ID, id: 'sess-1' });
    rotateRefreshToken.mockClear();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'old-raw-refresh-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_003' } });
    // Gate ran BEFORE rotate: no orphaned fresh session was ever created
    expect(rotateRefreshToken).not.toHaveBeenCalled();
  });
});
