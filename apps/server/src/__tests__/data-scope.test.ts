/**
 * DG-6d data-scope resolution unit tests (data-scope batch T-SERVER, spec §3.3).
 *
 * Pure resolver lane: the UserScopeFilter arms the users routes predicate on.
 * Route lanes (users.test.ts) cover the wiring; real-PG arms are locked by
 * data-scope-integration.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

process.env.NODE_ENV = 'test';

// The util lazy-constructs ONE PermissionManager + ONE GroupManager per process
// (permission.ts singleton precedent). Factory-mock the classes so the singletons
// hold these shared vi.fn methods — no pool, no dial.
const mockGetUserDataScope = vi.fn();
const mockGetDeptIds = vi.fn();

vi.mock('@accessbase/identity', () => ({
  PermissionManager: vi.fn().mockImplementation(() => ({
    getUserDataScope: mockGetUserDataScope,
  })),
  GroupManager: vi.fn().mockImplementation(() => ({
    getDepartmentIdsForUser: mockGetDeptIds,
  })),
}));

const { resolveUserRowScope } = await import('../utils/data-scope.js');

const TENANT = '00000000-0000-0000-0000-000000000001';
const SUB = '550e8400-e29b-41d4-a716-446655440001';

function fakeRequest(user: Record<string, unknown>, tenantId?: string): FastifyRequest {
  return {
    user,
    tenantId,
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

beforeEach(() => {
  mockGetUserDataScope.mockReset();
  mockGetDeptIds.mockReset();
});

describe('resolveUserRowScope', () => {
  it('apikey caller short-circuits to tenant-wide BEFORE any permission read [R2]', async () => {
    const scope = await resolveUserRowScope(
      fakeRequest({ sub: 'key-id', type: 'apikey', scopes: ['*'] }, TENANT),
      'users:read',
    );
    expect(scope).toEqual({ kind: 'all' });
    expect(mockGetUserDataScope).not.toHaveBeenCalled();
  });

  it("JWT binding 'all' -> tenant-wide filter", async () => {
    mockGetUserDataScope.mockResolvedValue('all');
    const scope = await resolveUserRowScope(fakeRequest({ sub: SUB }, TENANT), 'users:write');
    expect(scope).toEqual({ kind: 'all' });
    expect(mockGetUserDataScope).toHaveBeenCalledWith(SUB, 'users:write', TENANT);
  });

  it("JWT binding 'self' -> self filter", async () => {
    mockGetUserDataScope.mockResolvedValue('self');
    const scope = await resolveUserRowScope(fakeRequest({ sub: SUB }, TENANT), 'users:delete');
    expect(scope).toEqual({ kind: 'self', userId: SUB });
  });

  it("JWT binding 'dept' -> dept filter carrying the caller's department ids", async () => {
    mockGetUserDataScope.mockResolvedValue('dept');
    mockGetDeptIds.mockResolvedValue(['g1', 'g2']);
    const scope = await resolveUserRowScope(fakeRequest({ sub: SUB }, TENANT), 'users:read');
    expect(scope).toEqual({ kind: 'dept', userId: SUB, groupIds: ['g1', 'g2'] });
    expect(mockGetDeptIds).toHaveBeenCalledWith(SUB, TENANT);
  });

  it('dept binding with EMPTY department roster converts to self here, never downstream [B4]', async () => {
    mockGetUserDataScope.mockResolvedValue('dept');
    mockGetDeptIds.mockResolvedValue([]);
    const scope = await resolveUserRowScope(fakeRequest({ sub: SUB }, TENANT), 'users:read');
    expect(scope).toEqual({ kind: 'self', userId: SUB });
  });

  it('null binding (code absent) fails SOFT to tenant-wide with exactly one warn', async () => {
    mockGetUserDataScope.mockResolvedValue(null);
    const request = fakeRequest({ sub: SUB }, TENANT);
    const scope = await resolveUserRowScope(request, 'users:read');
    expect(scope).toEqual({ kind: 'all' });
    expect(request.log.warn).toHaveBeenCalledTimes(1);
  });

  it('tenant-less request context falls back to DEFAULT_TENANT for the scope read', async () => {
    mockGetUserDataScope.mockResolvedValue('all');
    await resolveUserRowScope(fakeRequest({ sub: SUB }), 'users:write');
    expect(mockGetUserDataScope).toHaveBeenCalledWith(SUB, 'users:write', TENANT);
  });
});
