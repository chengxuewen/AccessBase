/**
 * DG-6d data-scope — RoleManager leg (spec 2026-10-08-data-scope rev.3 §3.2).
 *
 * Covers the four behaviours that make row-scoping real:
 *  1. [B3 PIN] the role permission projection surfaces the JUNCTION column
 *     (role_permissions.data_scope). A fixed field-map silently swallows it and
 *     the whole feature degrades to a no-op — the batch-E webauthn projection
 *     family. Every read here therefore goes through the projection, never
 *     through an insert-values spy.
 *  2. widest-wins dedup at the inheritance site (order-independent lattice).
 *  3. the binding funnel clamps out-of-enum scopes BEFORE any write.
 *  4. scope edits drop the effective-permission cache tenant-wide.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { RoleManager } from '../managers/RoleManager.js';
import { DEFAULT_TENANT_ID } from '../managers/TenantManager.js';
import {
  getCachedPermissions,
  resetPermissionCache,
  setCachedPermissions,
} from '../managers/permission-cache.js';
import { createDb } from '../db/index.js';
import type { DataScope, Permission } from '../types.js';

const DB = '11111111-1111-1111-1111-111111111111';

function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const passthrough = vi.fn(() => chain);
  chain.from = passthrough;
  chain.where = passthrough;
  chain.set = passthrough;
  chain.returning = passthrough;
  chain.values = passthrough;
  chain.limit = passthrough;
  chain.offset = passthrough;
  chain.orderBy = passthrough;
  chain.innerJoin = passthrough;
  chain.onConflictDoNothing = passthrough;
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

function makeMockDb() {
  return { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
}

const roleRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `role-${id}`,
  description: null,
  tenantId: DB,
  parentId: null,
  isSystem: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

/** permissions × role_permissions join row, as drizzle shapes it for select(). */
const joinRow = (roleId: string, permissionId: string, dataScope?: string) => ({
  permissions: {
    id: permissionId,
    name: `users-${permissionId}`,
    resource: 'users',
    action: 'read',
    description: null,
    createdAt: new Date(0),
  },
  role_permissions: { roleId, permissionId, ...(dataScope === undefined ? {} : { dataScope }) },
});

function freshManager() {
  const db = makeMockDb();
  vi.mocked(createDb).mockReturnValue(db as unknown as ReturnType<typeof createDb>);
  return { db, manager: new RoleManager() };
}

describe('[B3] junction dataScope surfaces through the permission projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPermissionCache();
  });

  it('resolveInheritedPermissions returns the binding scope, not an undefined field', async () => {
    const { db, manager } = freshManager();
    db.select
      .mockReturnValueOnce(makeChain([joinRow('r1', 'p1', 'dept')])) // getRolePermissions(r1)
      .mockReturnValueOnce(makeChain([roleRow('r1')])); // parent lookup (no parent)

    const [perm] = await manager.resolveInheritedPermissions('r1', DB);

    expect(perm?.id).toBe('p1');
    expect(perm?.dataScope).toBe('dept');
  });

  it('a junction row without the column reads back as the all default', async () => {
    const { db, manager } = freshManager();
    db.select
      .mockReturnValueOnce(makeChain([joinRow('r1', 'p1')]))
      .mockReturnValueOnce(makeChain([roleRow('r1')]));

    const [perm] = await manager.resolveInheritedPermissions('r1', DB);

    expect(perm?.dataScope).toBe('all');
  });
});

describe('widest-wins dedup (inheritance site)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPermissionCache();
  });

  const chainOf = (childScope: string, parentScope: string) => {
    const { db, manager } = freshManager();
    db.select
      .mockReturnValueOnce(makeChain([joinRow('r1', 'p1', childScope)])) // r1 perms
      .mockReturnValueOnce(makeChain([roleRow('r1', { parentId: 'r2' })])) // r1 → parent
      .mockReturnValueOnce(makeChain([joinRow('r2', 'p1', parentScope)])) // r2 perms
      .mockReturnValueOnce(makeChain([roleRow('r2')])); // r2 → no parent
    return manager.resolveInheritedPermissions('r1', DB);
  };

  it('narrower parent binding never overwrites a wider child binding', async () => {
    const result = await chainOf('dept', 'self');
    expect(result).toHaveLength(1);
    expect(result[0]?.dataScope).toBe('dept');
  });

  it('wider parent binding upgrades the narrower child binding', async () => {
    const result = await chainOf('self', 'dept');
    expect(result).toHaveLength(1);
    expect(result[0]?.dataScope).toBe('dept');
  });

  it('all anywhere wins over everything', async () => {
    const result = await chainOf('all', 'self');
    expect(result[0]?.dataScope).toBe('all');
  });

  it('membership semantics unchanged: distinct codes all survive dedup', async () => {
    const { db, manager } = freshManager();
    db.select
      .mockReturnValueOnce(makeChain([joinRow('r1', 'p1', 'self'), joinRow('r1', 'p2', 'all')]))
      .mockReturnValueOnce(makeChain([roleRow('r1')]));

    const result = await manager.resolveInheritedPermissions('r1', DB);
    expect(result.map((p: Permission) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('binding funnel — permissionScopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPermissionCache();
  });

  /** Captures every insert payload that looks like a role_permissions row. */
  function captureJunctionInserts(db: ReturnType<typeof makeMockDb>, returning: unknown[]) {
    const written: Array<Record<string, unknown>>[] = [];
    db.insert.mockImplementation(() => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.values = vi.fn((rows: unknown) => {
        const list = Array.isArray(rows) ? rows : [rows];
        if (list.length > 0 && typeof list[0] === 'object' && list[0] !== null && 'permissionId' in list[0]) {
          written.push(list as Array<Record<string, unknown>>);
        }
        return chain;
      });
      chain.returning = vi.fn(() => makeChain(returning));
      chain.then = vi.fn((resolve?: ((v: unknown) => unknown) | null) =>
        Promise.resolve(undefined).then(resolve),
      );
      return chain;
    });
    return written;
  }

  it('update() writes the declared scope per binding (absent entry = all)', async () => {
    const { db, manager } = freshManager();
    const written = captureJunctionInserts(db, [roleRow('r1')]);
    db.select
      .mockReturnValueOnce(makeChain([roleRow('r1')])) // existence
      .mockReturnValueOnce(makeChain([])); // getRolePermissions tail
    db.update.mockReturnValue(makeChain([roleRow('r1')]));
    db.delete.mockReturnValue(makeChain(undefined));

    await manager.update(
      'r1',
      { permissionIds: ['p1', 'p2'], permissionScopes: { p1: 'dept' } },
      DEFAULT_TENANT_ID,
    );

    expect(written[0]).toEqual([
      { roleId: 'r1', permissionId: 'p1', dataScope: 'dept' },
      { roleId: 'r1', permissionId: 'p2', dataScope: 'all' },
    ]);
  });

  it('create() forwards permissionScopes to the same funnel', async () => {
    const { db, manager } = freshManager();
    const written = captureJunctionInserts(db, [roleRow('new-role')]);
    db.select.mockReturnValueOnce(makeChain([])); // duplicate-name check
    db.delete.mockReturnValue(makeChain(undefined));

    await manager.create(
      { name: 'scoped', permissionIds: ['p1'], permissionScopes: { p1: 'self' } },
      DEFAULT_TENANT_ID,
    );

    expect(written[0]).toEqual([{ roleId: 'new-role', permissionId: 'p1', dataScope: 'self' }]);
  });

  it('clamps an out-of-enum scope with DATA_SCOPE_INVALID:<permId> BEFORE any junction write', async () => {
    const { db, manager } = freshManager();
    const written = captureJunctionInserts(db, [roleRow('r1')]);
    db.select.mockReturnValueOnce(makeChain([roleRow('r1')])); // existence
    db.update.mockReturnValue(makeChain([roleRow('r1')]));

    // Direct-identity callers bypass the route JSON-schema — the funnel is the belt.
    const rogue = { p1: 'everything' } as unknown as Record<string, DataScope>;
    await expect(
      manager.update('r1', { permissionIds: ['p1'], permissionScopes: rogue }, DEFAULT_TENANT_ID),
    ).rejects.toThrow(/^DATA_SCOPE_INVALID:p1$/);

    expect(written).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('a scope edit drops the tenant-wide effective-permission cache (B: propagation)', async () => {
    const { db, manager } = freshManager();
    captureJunctionInserts(db, [roleRow('r1')]);
    db.select
      .mockReturnValueOnce(makeChain([roleRow('r1')]))
      .mockReturnValueOnce(makeChain([]));
    db.update.mockReturnValue(makeChain([roleRow('r1')]));
    db.delete.mockReturnValue(makeChain(undefined));
    // Another tenant's entry must survive (tenant-scoped invalidation, not global).
    const other = '22222222-2222-2222-2222-222222222222';
    setCachedPermissions(other, 'u9', [], 60_000);
    setCachedPermissions(DEFAULT_TENANT_ID, 'u1', [], 60_000);
    expect(getCachedPermissions(DEFAULT_TENANT_ID, 'u1')).toBeDefined();

    await manager.update(
      'r1',
      { permissionIds: ['p1'], permissionScopes: { p1: 'dept' } },
      DEFAULT_TENANT_ID,
    );

    expect(getCachedPermissions(DEFAULT_TENANT_ID, 'u1')).toBeUndefined();
    expect(getCachedPermissions(other, 'u9')).toBeDefined();
  });
});
