import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { RoleManager } from '../managers/RoleManager.js';
import { logger } from '@accessbase/logging';
import type { Permission } from '../types.js';

const mockLogger = vi.mocked(logger);

/**
 * Chainable drizzle-style mock (ported from PermissionManager.test.ts):
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
  chain.offset = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
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

type DbRoleFixture = {
  id: string;
  name: string;
  description: string | null;
  tenantId: string;
  parentId: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const dbRole = (id: string): DbRoleFixture => ({
  id,
  name: `role-${id}`,
  description: null,
  tenantId: 't1',
  parentId: null,
  isSystem: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const permission = (id: string): Permission => ({
  id,
  resource: 'users',
  action: 'read',
  createdAt: new Date(0),
});

// Joined row shape as returned by permissions innerJoin rolePermissions
const permRow = (roleId: string, permissionId: string) => ({
  permissions: permission(permissionId),
  role_permissions: { roleId, permissionId },
});

describe('RoleManager', () => {
  let roleManager: RoleManager;

  beforeEach(() => {
    vi.clearAllMocks();
    roleManager = new RoleManager();
  });

  describe('constructor', () => {
    it('should create RoleManager instance', () => {
      expect(roleManager).toBeDefined();
      expect(roleManager).toBeInstanceOf(RoleManager);
    });
  });

  describe('API surface', () => {
    it('should export RoleManager class', () => {
      expect(typeof RoleManager).toBe('function');
    });

    it('should have create method', () => {
      expect(typeof roleManager.create).toBe('function');
    });

    it('should have findById method', () => {
      expect(typeof roleManager.findById).toBe('function');
    });

    it('should have findAll method', () => {
      expect(typeof roleManager.findAll).toBe('function');
    });

    it('should have update method', () => {
      expect(typeof roleManager.update).toBe('function');
    });

    it('should have delete method', () => {
      expect(typeof roleManager.delete).toBe('function');
    });

    it('should have setParent method', () => {
      expect(typeof roleManager.setParent).toBe('function');
    });

    it('should have resolveInheritedPermissions method', () => {
      expect(typeof roleManager.resolveInheritedPermissions).toBe('function');
    });

    it('should have assignToUser method', () => {
      expect(typeof roleManager.assignToUser).toBe('function');
    });

    it('should have revokeFromUser method', () => {
      expect(typeof roleManager.revokeFromUser).toBe('function');
    });

    it('should have getUserRoles method', () => {
      expect(typeof roleManager.getUserRoles).toBe('function');
    });
  });

});

describe('findAll permissions fetch', () => {
  let db: ReturnType<typeof makeMockDb>;
  let manager: RoleManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeMockDb();
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(db as never);
    manager = new RoleManager();
  });

  it('fetches role permissions in ONE query (no N+1)', async () => {
    // Route by call order: 1st select -> count, 2nd -> role rows, 3rd -> perms
    const selectResults: unknown[] = [
      [{ count: 3 }],
      [dbRole('r1'), dbRole('r2'), dbRole('r3')],
      [permRow('r1', 'p1'), permRow('r2', 'p2'), permRow('r3', 'p3')],
    ];
    db.select.mockImplementation(() => makeChain(selectResults.shift()));

    const result = await manager.findAll({ page: 1, pageSize: 20 }, 't1');

    // count + roles + ONE permissions query = 3 select calls (N+1 would be 5)
    expect(db.select).toHaveBeenCalledTimes(3);
    expect(selectResults).toHaveLength(0);
    expect(result.data.map((r) => r.permissions.map((p) => p.id))).toEqual([
      ['p1'],
      ['p2'],
      ['p3'],
    ]);
  });

  it('returns identical shape to previous behavior (regression lock)', async () => {
    const selectResults: unknown[] = [
      [{ count: 1 }],
      [dbRole('r1')],
      [permRow('r1', 'p1'), permRow('r1', 'p2')],
    ];
    db.select.mockImplementation(() => makeChain(selectResults.shift()));

    const result = await manager.findAll({ page: 1, pageSize: 20 }, 't1');

    expect(result).toEqual({
      data: [
        {
          id: 'r1',
          name: 'role-r1',
          description: undefined,
          tenantId: 't1',
          permissions: [permission('p1'), permission('p2')],
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });
});
