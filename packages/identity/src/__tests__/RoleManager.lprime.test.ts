/**
 * Batch L-prime T1 tests — identity hardening:
 * binding funnel (X1), real cycle detection (X3), setParent moat (R6),
 * assignToUser replay-safety (G-1), user_create policy profile (G-3),
 * isDefault projection (G-5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { RoleManager } from '../managers/RoleManager.js';
import { TenantManager, DEFAULT_TENANT_ID } from '../managers/TenantManager.js';
import { readPasswordPolicy } from '../services/password-policy.js';
import {
  TENANT_BINDABLE_PERMISSIONS,
  PLATFORM_ONLY_PERMISSIONS,
} from '../services/permission-partition.js';
import { createDb } from '../db/index.js';

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
  chain.onConflictDoNothing = vi.fn(() => chain);
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

const TENANT = '11111111-1111-1111-1111-111111111111';

const roleRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'editor',
  description: null,
  tenantId: TENANT,
  parentId: null,
  isSystem: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

function freshManager() {
  const db = makeMockDb();
  vi.mocked(createDb).mockReturnValue(db as unknown as ReturnType<typeof createDb>);
  return { manager: new RoleManager(), db };
}

describe('X1 binding funnel — non-default tenants capped at TENANT_BINDABLE', () => {
  it('update(): platform code in permissionIds throws PERMISSION_NOT_BINDABLE before any rolePermissions write', async () => {
    const { manager, db } = freshManager();
    db.update.mockReturnValue(makeChain([roleRow()])); // field write precedes the binding funnel
    db.select
      .mockReturnValueOnce(makeChain([roleRow()])) // existence
      .mockReturnValueOnce(makeChain([{ id: 'p-plat', name: 'tenants:write' }])); // funnel

    await expect(
      manager.update('r1', { permissionIds: ['p-plat'] }, TENANT),
    ).rejects.toThrow(/^PERMISSION_NOT_BINDABLE: tenants:write/);
    // binding must NOT have been touched (delete is the first writer step)
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('update(): tenant-bindable name passes the funnel and proceeds to delete+insert', async () => {
    const { manager, db } = freshManager();
    db.select
      .mockReturnValueOnce(makeChain([roleRow()]))
      .mockReturnValueOnce(makeChain([{ id: 'p-ok', name: 'users:read' }]))
      .mockReturnValueOnce(makeChain([])); // getRolePermissions tail
    db.update.mockReturnValue(makeChain([roleRow()]));
    db.delete.mockReturnValue(makeChain(undefined));
    db.insert.mockReturnValue(makeChain(undefined));

    await expect(
      manager.update('r1', { permissionIds: ['p-ok'] }, TENANT),
    ).resolves.toBeDefined();
    expect(db.insert).toHaveBeenCalled();
  });

  it('default-tenant context runs NO funnel select (2 selects, not 3) — platform unchanged', async () => {
    const { manager, db } = freshManager();
    const admin = roleRow({ tenantId: DEFAULT_TENANT_ID, isSystem: false });
    db.select
      .mockReturnValueOnce(makeChain([admin])) // existence
      .mockReturnValueOnce(makeChain([])); // getRolePermissions tail — NO funnel call between
    db.update.mockReturnValue(makeChain([admin]));
    db.delete.mockReturnValue(makeChain(undefined));
    db.insert.mockReturnValue(makeChain(undefined));

    await manager.update('r1', { permissionIds: ['p-any'] }, DEFAULT_TENANT_ID);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('unknown permission ids pass through the funnel (FK error stays the enforcement)', async () => {
    const { manager, db } = freshManager();
    db.select
      .mockReturnValueOnce(makeChain([roleRow()]))
      .mockReturnValueOnce(makeChain([])) // funnel resolves nothing
      .mockReturnValueOnce(makeChain([]));
    db.update.mockReturnValue(makeChain([roleRow()]));
    db.delete.mockReturnValue(makeChain(undefined));
    db.insert.mockReturnValue(makeChain(undefined));

    await expect(
      manager.update('r1', { permissionIds: ['ghost'] }, TENANT),
    ).resolves.toBeDefined();
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('create(): funnel rejection surfaces after role insert, before rolePermissions insert', async () => {
    const { manager, db } = freshManager();
    db.select
      .mockReturnValueOnce(makeChain([])) // duplicate-name check
      .mockReturnValueOnce(makeChain([{ id: 'p2', name: 'options:write' }])); // funnel
    db.insert.mockReturnValue(makeChain([{ id: 'new-role' }]));

    await expect(
      manager.create(
        { name: 'x', permissionIds: ['p2'] },
        TENANT,
      ),
    ).rejects.toThrow(/^PERMISSION_NOT_BINDABLE: options:write/);
    // exactly ONE insert happened: the roles row; the binding insert never ran
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe('X3/R6 setParent — real cycle detection + system-role moat', () => {
  it('rejects isSystem roles with ROLE_PROTECTED before any update', async () => {
    const { manager, db } = freshManager();
    db.select.mockReturnValueOnce(makeChain([roleRow({ isSystem: true })]));
    db.update.mockReturnValue(makeChain([roleRow()]));

    await expect(manager.setParent('r1', 'p1', TENANT)).rejects.toThrow(/^ROLE_PROTECTED/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('self-parent (A to A) throws cycle (invisible to the old ancestors-only walk)', async () => {
    const { manager, db } = freshManager();
    const a = roleRow({ id: 'A', parentId: null });
    db.select
      .mockReturnValueOnce(makeChain([a])) // role lookup
      .mockReturnValueOnce(makeChain([a])); // parent lookup (same row: id=A)

    await expect(manager.setParent('A', 'A', TENANT)).rejects.toThrow(
      /Inheritance cycle detected/,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('mutual cycle (A already parented to B; setting B parent to A) throws', async () => {
    const { manager, db } = freshManager();
    const b = roleRow({ id: 'B', parentId: null });
    const a = roleRow({ id: 'A', parentId: 'B' });
    db.select
      .mockReturnValueOnce(makeChain([b])) // role lookup
      .mockReturnValueOnce(makeChain([a])) // parent exists
      .mockReturnValueOnce(makeChain([a])); // walk: A -> parentId B === roleId

    await expect(manager.setParent('B', 'A', TENANT)).rejects.toThrow(
      /Inheritance cycle detected/,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('legit parent chain (walk ends at null) proceeds to write', async () => {
    const { manager, db } = freshManager();
    const child = roleRow({ id: 'C', parentId: null });
    const parent = roleRow({ id: 'P', parentId: null });
    db.select
      .mockReturnValueOnce(makeChain([child]))
      .mockReturnValueOnce(makeChain([parent])) // parent exists
      .mockReturnValueOnce(makeChain([parent])) // walk: P.parent null -> false
      .mockReturnValueOnce(makeChain([])); // getRolePermissions tail
    db.update.mockReturnValue(makeChain([roleRow({ id: 'C', parentId: 'P' })]));

    await expect(manager.setParent('C', 'P', TENANT)).resolves.toMatchObject({ id: 'C' });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe('G-1 assignToUser replay safety', () => {
  it('uses onConflictDoNothing (composite PK replays must not duplicate-key)', async () => {
    const { manager, db } = freshManager();
    const chain = makeChain(undefined);
    db.insert.mockReturnValue(chain);

    await manager.assignToUser('u1', 'r1', TENANT);
    expect(chain.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

describe('partition lists (G-2 counts)', () => {
  it('9 bindable + 12 platform-only, disjoint', () => {
    expect(TENANT_BINDABLE_PERMISSIONS).toHaveLength(9);
    expect(PLATFORM_ONLY_PERMISSIONS).toHaveLength(12);
    expect(
      TENANT_BINDABLE_PERMISSIONS.filter((n) => PLATFORM_ONLY_PERMISSIONS.includes(n)),
    ).toEqual([]);
  });
});

describe('G-3 password policy user_create callsite', () => {
  it('defaults follow the register profile when nothing is configured', async () => {
    const getOption = <T,>(_key: string, _env: T | undefined, def: T) => Promise.resolve(def);
    const policy = await readPasswordPolicy(getOption, 'user_create');
    expect(policy).toEqual({
      minLength: 8,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: false,
    });
  });
});

describe('G-5 Tenant projection isDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('true for the default tenant row, false otherwise', async () => {
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as unknown as ReturnType<typeof createDb>);
    const tenantManager = new TenantManager();
    const row = (id: string) => ({
      id,
      name: 'n',
      slug: 's',
      status: 'active',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    db.select.mockReturnValueOnce(makeChain([row(DEFAULT_TENANT_ID)]));
    expect(await tenantManager.findById(DEFAULT_TENANT_ID)).toMatchObject({ isDefault: true });
    db.select.mockReturnValueOnce(makeChain([row(TENANT)]));
    expect(await tenantManager.findById(TENANT)).toMatchObject({ isDefault: false });
  });
});
