/**
 * Q4b GroupManager unit tests: error-tag matrix + the two-directional
 * last-admin census through the REAL guard legs (mock db select queue =
 * ordered SQL legs: findById → collectAdminHolders(direct, group) →
 * holdersExcludingGroup(direct, otherGroups) → holdsIsSystemExceptViaGroup
 * (direct, otherGroup) → memberIds), plus the R9 fan-out spies
 * (invalidatePermissionCache + bumpAuthState) and the setGroupRoles tx seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
  closeDb: vi.fn(),
}));
vi.mock('../services/token-version.js', () => ({
  bumpAuthState: vi.fn(async () => {}),
  delAuthState: vi.fn(async () => {}),
}));
vi.mock('../managers/permission-cache.js', () => ({
  invalidatePermissionCache: vi.fn(),
}));

import { GroupManager } from '../managers/GroupManager.js';
import { bumpAuthState } from '../services/token-version.js';
import { invalidatePermissionCache } from '../managers/permission-cache.js';

function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.returning = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

const T = 'tenant-1';
const G = 'group-1';

function makeDb(selectQueue: unknown[]) {
  const db = {
    select: vi.fn(),
    insert: vi.fn().mockReturnValue(makeChain(undefined)),
    update: vi.fn().mockReturnValue(makeChain(undefined)),
    delete: vi.fn().mockReturnValue(makeChain(undefined)),
  };
  for (const r of selectQueue) db.select.mockReturnValueOnce(makeChain(r));
  // Exhausted queue → empty rows (never undefined-chain).
  db.select.mockReturnValue(makeChain([]));
  return db;
}

const groupRow = { id: G, tenantId: T, name: 'Eng', description: null, createdAt: new Date(0), updatedAt: new Date(0) };
const holder = (userId: string) => ({ userId });
const userRef = (id: string) => ({ id });

let manager: GroupManager;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('create/update', () => {
  it('rejects duplicate tenant name with GROUP_NAME_EXISTS', async () => {
    manager = new GroupManager(makeDb([[{ id: 'other' }]]) as never);
    await expect(manager.create({ name: 'Eng' }, T)).rejects.toThrow('GROUP_NAME_EXISTS');
  });

  it('creates when the name is free', async () => {
    const db = makeDb([[], [groupRow]]);
    db.insert.mockReturnValue(makeChain([groupRow]));
    manager = new GroupManager(db as never);
    const g = await manager.create({ name: 'Eng' }, T);
    expect(g.name).toBe('Eng');
  });

  it('update throws GROUP_NOT_FOUND for unknown/foreign-tenant id', async () => {
    manager = new GroupManager(makeDb([[]]) as never);
    await expect(manager.update(G, { name: 'X' }, T)).rejects.toThrow('GROUP_NOT_FOUND');
  });
});

describe('delete — census direction: group is sole admin source', () => {
  it('refuses with LAST_ADMIN_GUARD when no holder survives without the group', async () => {
    const db = makeDb([
      [groupRow], // findById
      [], // collectAdminHolders: direct leg
      [holder('u1')], // collectAdminHolders: group leg (u1 is admin only via this group)
      [], // holdersExcludingGroup: direct
      [], // holdersExcludingGroup: other groups
    ]);
    manager = new GroupManager(db as never);
    await expect(manager.delete(G, T)).rejects.toThrow(/^LAST_ADMIN_GUARD:/);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('proceeds + fans out invalidation/bump to captured members (pre-cascade)', async () => {
    const db = makeDb([
      [groupRow], // findById
      [], // collectAdminHolders direct
      [holder('u1')], // collectAdminHolders group
      [], // holdersExcludingGroup direct
      [holder('u2')], // holdersExcludingGroup other-groups → u2 survives
      [holder('u1')], // memberIds captured BEFORE the cascade delete
    ]);
    manager = new GroupManager(db as never);
    await manager.delete(G, T);
    expect(db.delete).toHaveBeenCalled();
    expect(invalidatePermissionCache).toHaveBeenCalledWith(T, 'u1');
    // R9 + delete-cascade fix: bump must carry the PRE-cascade member list.
    expect(bumpAuthState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: T, userIds: ['u1'] }),
      expect.anything(),
    );
  });
});

describe('addMember / removeMember', () => {
  it('R5: rejects a user outside the group tenant before any insert', async () => {
    const db = makeDb([[groupRow], []]); // findById ok, user-tenant probe misses
    manager = new GroupManager(db as never);
    await expect(manager.addMember(G, 'uX', T)).rejects.toThrow('GROUP_MEMBER_TENANT_MISMATCH');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('adds and fans out cache+auth-state invalidation for the member', async () => {
    const db = makeDb([[groupRow], [userRef('u1')]]);
    manager = new GroupManager(db as never);
    await manager.addMember(G, 'u1', T);
    expect(db.insert).toHaveBeenCalled();
    expect(invalidatePermissionCache).toHaveBeenCalledWith(T, 'u1');
  });

  it('refuses removing the sole admin when no other path keeps them system', async () => {
    const db = makeDb([
      [groupRow], // findById
      [], // collectAdminHolders direct
      [holder('u1')], // collectAdminHolders group — u1 sole holder
      [], // holdsIsSystemExceptViaGroup: direct probe
      [], // holdsIsSystemExceptViaGroup: other-group probe
    ]);
    manager = new GroupManager(db as never);
    await expect(manager.removeMember(G, 'u1', T)).rejects.toThrow(/^LAST_ADMIN_GUARD:/);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('allows removing a sole group-admin who also holds the role directly (R3 skip)', async () => {
    const db = makeDb([
      [groupRow], // findById
      [], // collectAdminHolders direct
      [holder('u1')], // collectAdminHolders group
      [{ x: 'u1' }], // holdsIsSystemExceptViaGroup: DIRECT hit → keeps standing
    ]);
    manager = new GroupManager(db as never);
    await manager.removeMember(G, 'u1', T);
    expect(db.delete).toHaveBeenCalled();
  });

  it('skips the census entirely for non-holder members', async () => {
    const db = makeDb([
      [groupRow], // findById
      [], // collectAdminHolders direct
      [], // collectAdminHolders group → target not a holder
    ]);
    manager = new GroupManager(db as never);
    await manager.removeMember(G, 'u9', T);
    expect(db.delete).toHaveBeenCalled();
    expect(invalidatePermissionCache).toHaveBeenCalledWith(T, 'u9');
  });
});

describe('setGroupRoles', () => {
  it('rejects cross-tenant role ids before any write (GROUP_ROLE_TENANT_MISMATCH)', async () => {
    const db = makeDb([[groupRow], [{ id: 'r-bad' }]]);
    manager = new GroupManager(db as never);
    await expect(manager.setGroupRoles(G, ['r-bad'], T)).rejects.toThrow('GROUP_ROLE_TENANT_MISMATCH');
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('refuses unbinding the isSystem role when it would orphan the tenant (R2)', async () => {
    const db = makeDb([
      [groupRow], // findById
      [], // bad-role probe (all in tenant)
      [], // collectAdminHolders direct
      [holder('u1')], // collectAdminHolders group leg
      [holder('u1')], // memberIds
      [], // newIsSystemPresent probe (replacement set holds no isSystem role)
      [], // holdersExcludingGroup direct
      [], // holdersExcludingGroup other-groups
      [], // heldSelf re-check: u1 direct
      [], // heldSelf re-check: u1 other-group
    ]);
    manager = new GroupManager(db as never);
    await expect(manager.setGroupRoles(G, ['r-plain'], T)).rejects.toThrow(/^LAST_ADMIN_GUARD:/);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('writes through the tx handle (4th arg) and leaves this.db untouched for writes', async () => {
    const db = makeDb([
      [groupRow], // findById
      [], // bad-role probe
      [], // collectAdminHolders direct
      [holder('u1')], // collectAdminHolders group
      [holder('u1')], // memberIds (pre-write read for the keptSelf census)
      [{ id: 'r-admin' }], // newIsSystemPresent → system role still present, skip orphan math
      [holder('u1')], // invalidateMembers memberIds (post-write)
    ]);
    const tx = {
      delete: vi.fn().mockReturnValue(makeChain(undefined)),
      insert: vi.fn().mockReturnValue(makeChain(undefined)),
    };
    manager = new GroupManager(db as never);
    await manager.setGroupRoles(G, ['r-admin'], T, tx as never);
    expect(tx.delete).toHaveBeenCalled();
    // 1 role binding insert + 1 Q4c group.changed event insert, both on tx
    expect(tx.insert).toHaveBeenCalledTimes(2);
    // this.db must never write the bindings when a tx handle is provided.
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(invalidatePermissionCache).toHaveBeenCalledWith(T, 'u1');
  });
});

describe('grantsSystemRole (R4 lock probe)', () => {
  it('true when a joined isSystem binding exists', async () => {
    manager = new GroupManager(makeDb([[{ groupId: G }]]) as never);
    await expect(manager.grantsSystemRole(G)).resolves.toBe(true);
  });

  it('false when none', async () => {
    manager = new GroupManager(makeDb([[]]) as never);
    await expect(manager.grantsSystemRole(G)).resolves.toBe(false);
  });
});
