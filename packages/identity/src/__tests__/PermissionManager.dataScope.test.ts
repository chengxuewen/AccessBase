/**
 * DG-6d data-scope — PermissionManager leg (spec 2026-10-08-data-scope rev.3 §3.2).
 *
 * The flagship [B3] net lives here: a REAL RoleManager (same fake db) writes the
 * binding scopes through update(), the fake persists them into a junction array,
 * and getUserDataScope must read 'dept' back THROUGH the role projection.
 * An insert-values spy alone cannot catch a projection that drops the junction
 * column — this can: strip the projection line and the read falls back to 'all'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { PermissionManager } from '../managers/PermissionManager.js';
import { RoleManager } from '../managers/RoleManager.js';
import { DEFAULT_TENANT_ID } from '../managers/TenantManager.js';
import { resetPermissionCache } from '../managers/permission-cache.js';
import { createDb } from '../db/index.js';
import type { Permission, Role } from '../types.js';

const passthroughChain = (result: unknown) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = vi.fn(() => chain);
  chain.from = self;
  chain.where = self;
  chain.set = self;
  chain.returning = self;
  chain.values = self;
  chain.limit = self;
  chain.offset = self;
  chain.orderBy = self;
  chain.innerJoin = self;
  chain.onConflictDoNothing = self;
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
};

const roleRow = (id: string) => ({
  id,
  name: `role-${id}`,
  description: null,
  tenantId: DEFAULT_TENANT_ID,
  parentId: null,
  isSystem: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const scopedPermission = (
  id: string,
  resource: string,
  action: string,
  dataScope?: Permission['dataScope'],
): Permission => ({
  id,
  resource,
  action,
  createdAt: new Date(0),
  ...(dataScope === undefined ? {} : { dataScope }),
});

describe('widest-wins dedup (effective-permission site)', () => {
  let roleManager: {
    getUserRoles: ReturnType<typeof vi.fn>;
    getEffectiveRoles: ReturnType<typeof vi.fn>;
    resolveInheritedPermissions: ReturnType<typeof vi.fn>;
  };
  let manager: PermissionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPermissionCache();
    roleManager = {
      getUserRoles: vi.fn(),
      getEffectiveRoles: vi.fn((u: string, t: string) => roleManager.getUserRoles(u, t)),
      resolveInheritedPermissions: vi.fn(),
    };
    manager = new PermissionManager(undefined, roleManager as unknown as RoleManager);
  });

  const role = (id: string): Role =>
    ({
      id,
      name: `role-${id}`,
      tenantId: 't1',
      permissions: [],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }) as Role;

  it('dept + self for the same code collapses to dept (order A first)', async () => {
    roleManager.getUserRoles.mockResolvedValue([role('r1'), role('r2')]);
    roleManager.resolveInheritedPermissions.mockImplementation(async (roleId: string) =>
      roleId === 'r1' ? [scopedPermission('p1', 'users', 'read', 'dept')] : [scopedPermission('p1', 'users', 'read', 'self')],
    );

    const result = await manager.getUserEffectivePermissions('u1', 't1');

    expect(result).toHaveLength(1);
    expect(result[0]?.dataScope).toBe('dept');
  });

  it('the reverse binding order yields the same lattice value', async () => {
    roleManager.getUserRoles.mockResolvedValue([role('r1'), role('r2')]);
    roleManager.resolveInheritedPermissions.mockImplementation(async (roleId: string) =>
      roleId === 'r1' ? [scopedPermission('p1', 'users', 'read', 'self')] : [scopedPermission('p1', 'users', 'read', 'dept')],
    );

    const result = await manager.getUserEffectivePermissions('u1', 't1');

    expect(result[0]?.dataScope).toBe('dept');
  });

  it('all anywhere wins, membership unchanged (distinct codes preserved)', async () => {
    roleManager.getUserRoles.mockResolvedValue([role('r1'), role('r2')]);
    roleManager.resolveInheritedPermissions.mockImplementation(async (roleId: string) =>
      roleId === 'r1'
        ? [scopedPermission('p1', 'users', 'read', 'all'), scopedPermission('p2', 'users', 'write', 'self')]
        : [scopedPermission('p1', 'users', 'read', 'self')],
    );

    const result = await manager.getUserEffectivePermissions('u1', 't1');

    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.find((p) => p.id === 'p1')?.dataScope).toBe('all');
    expect(result.find((p) => p.id === 'p2')?.dataScope).toBe('self');
  });
});

describe('getUserDataScope', () => {
  let roleManager: {
    getUserRoles: ReturnType<typeof vi.fn>;
    getEffectiveRoles: ReturnType<typeof vi.fn>;
    resolveInheritedPermissions: ReturnType<typeof vi.fn>;
  };
  let manager: PermissionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPermissionCache();
    roleManager = {
      getUserRoles: vi.fn(),
      getEffectiveRoles: vi.fn((u: string, t: string) => roleManager.getUserRoles(u, t)),
      resolveInheritedPermissions: vi.fn(),
    };
    manager = new PermissionManager(undefined, roleManager as unknown as RoleManager);
  });

  const role = (id: string): Role =>
    ({
      id,
      name: `role-${id}`,
      tenantId: 't1',
      permissions: [],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }) as Role;

  beforeEach(() => {
    roleManager.getUserRoles.mockResolvedValue([role('r1')]);
  });

  it('returns the binding scope for a granted code', async () => {
    roleManager.resolveInheritedPermissions.mockResolvedValue([
      scopedPermission('p1', 'users', 'read', 'dept'),
    ]);
    expect(await manager.getUserDataScope('u1', 'users:read', 't1')).toBe('dept');
  });

  it('null when the code is absent (caller is not eligible for the surface at all)', async () => {
    roleManager.resolveInheritedPermissions.mockResolvedValue([
      scopedPermission('p1', 'users', 'read', 'dept'),
    ]);
    expect(await manager.getUserDataScope('u1', 'users:delete', 't1')).toBeNull();
  });

  it('an unscoped (catalog-shaped) permission reads back as the all default', async () => {
    roleManager.resolveInheritedPermissions.mockResolvedValue([
      scopedPermission('p1', 'users', 'read'),
    ]);
    expect(await manager.getUserDataScope('u1', 'users:read', 't1')).toBe('all');
  });

  it('reuses the effective-permission cache (one role round trip for two reads)', async () => {
    roleManager.resolveInheritedPermissions.mockResolvedValue([
      scopedPermission('p1', 'users', 'read', 'self'),
    ]);
    await manager.getUserDataScope('u1', 'users:read', 't1');
    await manager.getUserDataScope('u1', 'users:write', 't1');
    expect(roleManager.getUserRoles.mock.calls).toHaveLength(1);
  });
});

describe('[B3] round trip — declared scope reads back THROUGH the projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPermissionCache();
  });

  it('update({permissionScopes:{p1:dept}}) → getUserDataScope = dept, via a real RoleManager', async () => {
    const db: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(createDb).mockReturnValue(db as unknown as ReturnType<typeof createDb>);

    // Stateful junction: the funnel's INSERT lands here, the projection reads it
    // back lazily (at await time) — nothing is pre-programmed about the read.
    const junction: Array<{ roleId: string; permissionId: string; dataScope: string }> = [];
    db.delete.mockReturnValue(passthroughChain(undefined));
    db.update.mockReturnValue(passthroughChain([roleRow('r1')])); // roles write + auth bump
    db.insert.mockImplementation(() => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.values = vi.fn((rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : [rows]) as Array<Record<string, unknown>>;
        for (const row of list) {
          if ('permissionId' in row && 'dataScope' in row) {
            junction.push(row as unknown as { roleId: string; permissionId: string; dataScope: string });
          }
        }
        return chain;
      });
      chain.returning = vi.fn(() => passthroughChain([roleRow('r1')]));
      chain.then = vi.fn((resolve?: ((v: unknown) => unknown) | null) =>
        Promise.resolve(undefined).then(resolve),
      );
      return chain;
    });
    const junctionRead = () =>
      passthroughChain(
        junction.map((j) => ({
          permissions: {
            id: j.permissionId,
            name: 'users:read',
            resource: 'users',
            action: 'read',
            description: null,
            createdAt: new Date(0),
          },
          role_permissions: j,
        })),
      );

    const roleManager = new RoleManager();
    const manager = new PermissionManager(undefined, roleManager);

    // write leg
    db.select
      .mockReturnValueOnce(passthroughChain([roleRow('r1')])) // existence
      .mockReturnValueOnce(junctionRead()); // update()'s trailing getRolePermissions
    await roleManager.update(
      'r1',
      { permissionIds: ['p1'], permissionScopes: { p1: 'dept' } },
      DEFAULT_TENANT_ID,
    );
    expect(junction).toEqual([{ roleId: 'r1', permissionId: 'p1', dataScope: 'dept' }]);

    // read leg: getEffectiveRoles(direct join → projection) + resolveInherited(→ projection)
    db.select
      .mockReturnValueOnce(passthroughChain([{ roles: roleRow('r1'), user_roles: { userId: 'u1' } }]))
      .mockReturnValueOnce(junctionRead())
      .mockReturnValueOnce(passthroughChain([])) // group leg: none
      .mockReturnValueOnce(junctionRead())
      .mockReturnValueOnce(passthroughChain([roleRow('r1')])); // inheritance walk (no parent)

    expect(await manager.getUserDataScope('u1', 'users:read', DEFAULT_TENANT_ID)).toBe('dept');
  });
});
