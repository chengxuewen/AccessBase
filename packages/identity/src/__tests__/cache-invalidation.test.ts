import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { PermissionManager } from '../managers/PermissionManager.js';
import { RoleManager } from '../managers/RoleManager.js';
import { UserManager } from '../managers/UserManager.js';
import { resetPermissionCache } from '../managers/permission-cache.js';
import type { Permission, Role, User } from '../types.js';

/**
 * Cache invalidation on permission-affecting write paths (B1 Task 2).
 *
 * Pattern: prime the cache for (u1,t1) [and (u2,t1) for user-level rows] via
 * getUserEffectivePermissions, invoke the write method against a mocked db,
 * then re-assert via getUserEffectivePermissions — a fresh getUserRoles call
 * proves the cached entry was dropped.
 */
function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.returning = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

function makeMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const permission = (id: string): Permission => ({
  id,
  resource: 'users',
  action: 'read',
  createdAt: new Date(0),
});

const dbRole = (id: string) => ({
  id,
  name: `role-${id}`,
  description: null,
  tenantId: 't1',
  parentId: null,
  isSystem: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const dbUser = {
  id: 'u1',
  email: 'u1@test.local',
  name: 'User One',
  status: 'active',
  totpEnabled: false,
  tenantId: 't1',
  tokenVersion: 0,
  passwordHash: 'x',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const u1Roles = (rm: { getUserRoles: ReturnType<typeof vi.fn> }): void => {
  rm.getUserRoles.mockResolvedValue([roleFor('r1')]);
};

// Minimal Role shape for the injected roleManager stub (permissions required)
const roleFor = (id: string): Role => ({
  id,
  name: `role-${id}`,
  tenantId: 't1',
  permissions: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('cache invalidation on write paths', () => {
  let db: ReturnType<typeof makeMockDb>;
  let rmStub: { getUserRoles: ReturnType<typeof vi.fn>; resolveInheritedPermissions: ReturnType<typeof vi.fn> };
  let pm: PermissionManager;
  let roleManager: RoleManager;
  let userManager: UserManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetPermissionCache();
    db = makeMockDb();
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(db as never);
    rmStub = {
      getUserRoles: vi.fn(),
      resolveInheritedPermissions: vi.fn().mockResolvedValue([permission('p1')]),
    };
    pm = new PermissionManager(undefined, rmStub as unknown as RoleManager);
    roleManager = new RoleManager();
    userManager = new UserManager();
  });

  const prime = async (): Promise<void> => {
    u1Roles(rmStub);
    await pm.getUserEffectivePermissions('u1', 't1');
  };

  const primeTwoUsers = async (): Promise<void> => {
    u1Roles(rmStub);
    await pm.getUserEffectivePermissions('u1', 't1');
    rmStub.getUserRoles.mockResolvedValue([roleFor('r1')]);
    await pm.getUserEffectivePermissions('u2', 't1');
  };

  const refetchCount = (userId: string): number =>
    rmStub.getUserRoles.mock.calls.filter((c) => c[0] === userId).length;

  // --- tenant-level rows: u1 must re-fetch, u2 stays cached when primed ---

  it('RoleManager.update clears tenant namespace', async () => {
    await prime();
    const row = dbRole('r1');
    // getRolePermissions inner-joins permissions → rows shaped { roles, permissions }
    const joinRow = { roles: row, permissions: permission('p1') };
    db.select.mockReturnValue(makeChain([joinRow]));
    db.update.mockReturnValue(makeChain([row]));

    await roleManager.update('r1', { name: 'renamed' }, 't1');

    await pm.getUserEffectivePermissions('u1', 't1');
    expect(refetchCount('u1')).toBe(2);
  });

  it('RoleManager.delete clears tenant namespace', async () => {
    await prime();
    db.select
      .mockReturnValueOnce(makeChain([dbRole('r1')])) // role lookup
      .mockReturnValueOnce(makeChain([{ count: 0 }])); // assigned-users guard
    db.delete.mockReturnValue(makeChain(undefined));

    await roleManager.delete('r1', 't1');

    await pm.getUserEffectivePermissions('u1', 't1');
    expect(refetchCount('u1')).toBe(2);
  });

  it('RoleManager.setParent clears tenant namespace', async () => {
    await prime();
    const row = dbRole('r1');
    db.select
      .mockReturnValueOnce(makeChain([row])) // role lookup
      .mockReturnValue(makeChain([{ roles: row, permissions: permission('p1') }])); // joins
    db.update.mockReturnValue(makeChain([row]));

    await roleManager.setParent('r1', null, 't1');

    await pm.getUserEffectivePermissions('u1', 't1');
    expect(refetchCount('u1')).toBe(2);
  });

  // --- user-level rows: only the affected user re-fetches ---

  it('RoleManager.assignToUser clears only that userId', async () => {
    await primeTwoUsers();
    db.insert.mockReturnValue(makeChain(undefined));

    await roleManager.assignToUser('u1', 'r1', 't1');

    await pm.getUserEffectivePermissions('u1', 't1');
    await pm.getUserEffectivePermissions('u2', 't1');
    expect(refetchCount('u1')).toBe(2);
    expect(refetchCount('u2')).toBe(1);
  });

  it('RoleManager.revokeFromUser clears only that userId', async () => {
    await primeTwoUsers();
    // K-T2: guard reads the revoked role — non-system → census skipped.
    db.select.mockReturnValueOnce(makeChain([{ isSystem: false }]));
    db.delete.mockReturnValue(makeChain(undefined));

    await roleManager.revokeFromUser('u1', 'r1', 't1');

    await pm.getUserEffectivePermissions('u1', 't1');
    await pm.getUserEffectivePermissions('u2', 't1');
    expect(refetchCount('u1')).toBe(2);
    expect(refetchCount('u2')).toBe(1);
  });

  it('RoleManager.setUserRoles clears only that userId', async () => {
    await primeTwoUsers();
    // K-T2: guard reads held roles — user holds none → census skipped.
    db.select.mockReturnValueOnce(makeChain([]));
    db.delete.mockReturnValue(makeChain(undefined));

    await roleManager.setUserRoles('u1', [], 't1');

    await pm.getUserEffectivePermissions('u1', 't1');
    await pm.getUserEffectivePermissions('u2', 't1');
    expect(refetchCount('u1')).toBe(2);
    expect(refetchCount('u2')).toBe(1);
  });

  // --- clear-all row: both users re-fetch ---

  it('PermissionManager.setRolePermissions clears the entire cache', async () => {
    await primeTwoUsers();
    db.delete.mockReturnValue(makeChain(undefined));

    await pm.setRolePermissions('r1', []);

    await pm.getUserEffectivePermissions('u1', 't1');
    await pm.getUserEffectivePermissions('u2', 't1');
    expect(refetchCount('u1')).toBe(2);
    expect(refetchCount('u2')).toBe(2);
  });

  // --- user-level row on UserManager ---

  it('UserManager.changeStatus clears only that userId', async () => {
    await primeTwoUsers();
    const updated = { ...dbUser, status: 'suspended' };
    db.update.mockReturnValue(makeChain([updated]));
    // K-T2: suspended transition consults the guard — no active admin holders
    // for this synthetic user → census false, update proceeds.
    db.select.mockReturnValueOnce(makeChain([]));

    const user: User = await userManager.changeStatus('u1', 'suspended', 't1');

    expect(user.status).toBe('suspended');
    await pm.getUserEffectivePermissions('u1', 't1');
    await pm.getUserEffectivePermissions('u2', 't1');
    expect(refetchCount('u1')).toBe(2);
    expect(refetchCount('u2')).toBe(1);
  });
});
