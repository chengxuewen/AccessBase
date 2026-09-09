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
import type { RoleManager } from '../managers/RoleManager.js';
import type { Permission, Role } from '../types.js';

/**
 * Chainable drizzle-style mock (same shape as SessionManager.test.ts):
 * every builder node passes through to the same chain, awaiting the chain
 * resolves the programmed result.
 */
function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
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

const permission = (id: string, resource: string, action: string): Permission => ({
  id,
  resource,
  action,
  createdAt: new Date(0),
});

const role = (id: string): Role => ({
  id,
  name: `role-${id}`,
  tenantId: 't1',
  permissions: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('PermissionManager', () => {
  let db: ReturnType<typeof makeMockDb>;
  let roleManager: {
    getUserRoles: ReturnType<typeof vi.fn>;
    resolveInheritedPermissions: ReturnType<typeof vi.fn>;
  };
  let manager: PermissionManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeMockDb();
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(db as never);
    roleManager = {
      getUserRoles: vi.fn(),
      resolveInheritedPermissions: vi.fn(),
    };
    manager = new PermissionManager(undefined, roleManager as unknown as RoleManager);
  });

  describe('getUserEffectivePermissions', () => {
    it('merges inherited permissions across roles, deduplicated by id', async () => {
      const p1 = permission('p1', 'users', 'read');
      const p2 = permission('p2', 'users', 'write');
      const p3 = permission('p3', 'roles', 'read');
      roleManager.getUserRoles.mockResolvedValue([role('r1'), role('r2')]);
      roleManager.resolveInheritedPermissions.mockImplementation(async (roleId: string) =>
        roleId === 'r1' ? [p1, p2] : [p2, p3],
      );

      const result = await manager.getUserEffectivePermissions('u1', 't1');

      expect(roleManager.getUserRoles).toHaveBeenCalledWith('u1', 't1');
      expect(result.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
      expect(result).toHaveLength(3);
    });

    it('returns empty list when user has no roles', async () => {
      roleManager.getUserRoles.mockResolvedValue([]);

      expect(await manager.getUserEffectivePermissions('u1', 't1')).toEqual([]);
      expect(roleManager.resolveInheritedPermissions).not.toHaveBeenCalled();
    });
  });

  describe('hasPermission', () => {
    beforeEach(() => {
      roleManager.getUserRoles.mockResolvedValue([role('r1')]);
      roleManager.resolveInheritedPermissions.mockResolvedValue([permission('p1', 'users', 'read')]);
    });

    it('returns true when resource:action is granted', async () => {
      expect(await manager.hasPermission('u1', 'users:read', 't1')).toBe(true);
    });

    it('returns false when action is not granted', async () => {
      expect(await manager.hasPermission('u1', 'users:delete', 't1')).toBe(false);
    });
  });

  describe('hasPermissions', () => {
    beforeEach(() => {
      roleManager.getUserRoles.mockResolvedValue([role('r1')]);
      roleManager.resolveInheritedPermissions.mockResolvedValue([permission('p1', 'users', 'read')]);
    });

    it('returns true when any requested permission is granted', async () => {
      expect(await manager.hasPermissions('u1', ['roles:delete', 'users:read'], 't1')).toBe(true);
    });

    it('returns false when none of the requested permissions is granted', async () => {
      expect(await manager.hasPermissions('u1', ['roles:delete', 'users:write'], 't1')).toBe(false);
    });

    it('returns false for an empty request list', async () => {
      expect(await manager.hasPermissions('u1', [], 't1')).toBe(false);
    });
  });

  describe('update', () => {
    it('applies the patch and returns the updated permission', async () => {
      const row = {
        id: 'p1',
        name: 'Read users',
        resource: 'users',
        action: 'read',
        description: 'updated',
        createdAt: new Date(0),
      };
      const chain = makeChain([row]);
      db.update.mockReturnValue(chain);

      const result = await manager.update('p1', { description: 'updated' });

      expect(chain.set).toHaveBeenCalledWith({ description: 'updated' });
      expect(result).toEqual({
        id: 'p1',
        resource: 'users',
        action: 'read',
        description: 'updated',
        createdAt: new Date(0),
      });
    });

    it('throws when permission does not exist', async () => {
      db.update.mockReturnValue(makeChain([]));

      await expect(manager.update('missing', { name: 'x' })).rejects.toThrow('Permission not found');
    });
  });

  describe('delete', () => {
    it('throws when the permission is referenced by roles', async () => {
      db.select.mockReturnValue(makeChain([{ count: 1 }]));

      await expect(manager.delete('p1')).rejects.toThrow('Permission is in use');
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('deletes when no role references it', async () => {
      db.select.mockReturnValue(makeChain([{ count: 0 }]));
      db.delete.mockReturnValue(makeChain(undefined));

      await expect(manager.delete('p1')).resolves.toBeUndefined();
      expect(db.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('setRolePermissions', () => {
    it('replaces role_permissions with the given set', async () => {
      const insertChain = makeChain(undefined);
      db.delete.mockReturnValue(makeChain(undefined));
      db.insert.mockReturnValue(insertChain);

      await manager.setRolePermissions('r1', ['p1', 'p2']);

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(insertChain.values).toHaveBeenCalledWith([
        { roleId: 'r1', permissionId: 'p1' },
        { roleId: 'r1', permissionId: 'p2' },
      ]);
    });

    it('clears existing grants without inserting when list is empty', async () => {
      db.delete.mockReturnValue(makeChain(undefined));

      await manager.setRolePermissions('r1', []);

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });
});
