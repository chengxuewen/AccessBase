/**
 * Q4c per-leg emit unit tests: every funnel in the spec §4 roster must call
 * emitEvent with the right type + op, on the caller handle when one is passed
 * (insert mechanics + real-PG atomicity are locked by funnel-tx-integration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const { createDbMock } = vi.hoisted(() => ({ createDbMock: vi.fn() }));
vi.mock('../db/index.js', () => ({
  createDb: createDbMock,
  closeDb: vi.fn(),
}));
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn(async () => {}),
}));
vi.mock('../services/last-admin-guard.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    wouldOrphanLastAdmin: vi.fn(async () => false),
    holdsSystemRoleViaGroup: vi.fn(async () => false),
    holdsIsSystemExceptViaGroup: vi.fn(async () => false),
    collectAdminHolders: vi.fn(async () => new Set<string>()),
  };
});
vi.mock('../services/token-version.js', () => ({
  bumpAuthState: vi.fn(async () => {}),
  delAuthState: vi.fn(async () => {}),
}));
vi.mock('../services/redis.js', () => ({
  getRedisClient: vi.fn(async () => ({ del: vi.fn(async () => 1) })),
}));
vi.mock('../managers/permission-cache.js', () => ({
  invalidatePermissionCache: vi.fn(),
  resetPermissionCache: vi.fn(),
}));

import { emitEvent } from '../services/events.js';
import { UserManager } from '../managers/UserManager.js';
import { RoleManager } from '../managers/RoleManager.js';
import { TenantManager } from '../managers/TenantManager.js';
import { ApiKeyManager } from '../managers/ApiKeyManager.js';
import { GroupManager } from '../managers/GroupManager.js';
import type { DbLike } from '../db/index.js';

const emitMock = vi.mocked(emitEvent);

function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'where', 'innerJoin', 'limit', 'set', 'values', 'returning', 'orderBy', 'offset', 'onConflictDoNothing']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

/** One row shape satisfying user/role/tenant/group mappers + perm joins. */
const ROW = {
  id: 'x1', tenantId: 't1', email: 'a@b.c', name: 'X', slug: 's', status: 'active',
  passwordHash: null, avatarUrl: null, tokenVersion: 0, isSystem: false, parentId: null,
  description: null, revokedAt: null, count: 0, userId: 'x1',
  permissions: { id: 'p1', resource: 'users', action: 'read', createdAt: new Date(0) },
  createdAt: new Date(0), updatedAt: new Date(0),
};

/**
 * Queue-driven select legs; once the explicit queue is exhausted every later
 * select returns [ROW] (existence/lookup hits by default).
 */
function makeDb(selectQueue: unknown[] = []) {
  const q = [...selectQueue];
  return {
    select: vi.fn().mockImplementation(() => makeChain(q.length > 0 ? q.shift() : [ROW])),
    insert: vi.fn().mockReturnValue(makeChain([ROW])),
    update: vi.fn().mockReturnValue(makeChain([ROW])),
    delete: vi.fn().mockReturnValue(makeChain(undefined)),
  };
}

function emitsOn(handle: unknown) {
  return emitMock.mock.calls.filter((c) => c[0] === handle).map((c) => c[1] as { type: string; payload: Record<string, unknown> });
}

beforeEach(() => {
  vi.clearAllMocks();
  ROW.status = 'active';
});

describe('UserManager emit legs', () => {
  it('create/update/delete/changeStatus emit the four user types', async () => {
    const db = makeDb();
    createDbMock.mockReturnValue(db);
    const um = new UserManager();
    await um.create({ email: 'a@b.c', name: 'X', password: 'Passw0rd-123' }, 't1');
    await um.update('x1', { name: 'Y' }, 't1');
    await um.delete('x1', 't1');
    await um.changeStatus('x1', 'suspended', 't1');
    await um.changeStatus('x1', 'active', 't1');
    expect(emitsOn(db).map((e) => e.type)).toEqual([
      'user.created', 'user.updated', 'user.deleted', 'user.suspended', 'user.updated',
    ]);
  });
});

describe('RoleManager emit legs', () => {
  it('seven funnels emit role.changed with the op discriminator', async () => {
    // leg 1 = create dup-check miss; later selects default [ROW] (isSystem false)
    const db = makeDb([[]]);
    createDbMock.mockReturnValue(db);
    const rm = new RoleManager();
    await rm.create({ name: 'r' }, 't1');
    await rm.update('x1', { name: 'r2' }, 't1');
    await rm.delete('x1', 't1');
    await rm.setParent('x1', null, 't1');
    await rm.assignToUser('u1', 'r1', 't1');
    await rm.revokeFromUser('u1', 'r1', 't1');
    await rm.setUserRoles('u1', ['r1'], 't1');
    const legs = emitsOn(db);
    expect(legs.map((l) => l.type)).toEqual(Array(7).fill('role.changed'));
    expect(legs.map((l) => l.payload.op)).toEqual([
      'created', 'updated', 'deleted', 'parent', 'assigned', 'unassigned', 'set',
    ]);
  });
});

describe('TenantManager emit legs', () => {
  it('created/updated/suspended/deleted follow status + deleteOp', async () => {
    const db = makeDb([[]]); // create dup-slug miss
    createDbMock.mockReturnValue(db);
    const tm = new TenantManager();
    await tm.create({ name: 'N', slug: 'n' });
    await tm.update('t2', { name: 'M' }); // ROW.status active → tenant.updated
    ROW.status = 'suspended';
    await tm.update('t2', { status: 'suspended' });
    ROW.status = 'active';
    await tm.delete('t2'); // deleteOp → tenant.deleted
    expect(emitsOn(db).map((e) => e.type)).toEqual([
      'tenant.created', 'tenant.updated', 'tenant.suspended', 'tenant.deleted',
    ]);
  });
});

describe('ApiKeyManager + GroupManager emit legs', () => {
  it('revoke emits apikey.revoked', async () => {
    const db = makeDb();
    const akm = new ApiKeyManager(db as unknown as DbLike);
    await akm.revoke('k1', 't1');
    expect(emitsOn(db)).toEqual([{ tenantId: 't1', type: 'apikey.revoked', payload: { id: 'k1' } }]);
  });

  it('group funnels emit group.changed with lifecycle/member/roles ops', async () => {
    // explicit early legs: create-dup miss; update dup miss; setRoles bad-role
    // miss. existence/memberIds/isSystem probes take the [ROW] default.
    const db = makeDb([[], [ROW], [], [ROW], [ROW], [ROW], [ROW], [], [ROW]]);
    const gm = new GroupManager(db as unknown as DbLike);
    await gm.create({ name: 'g' }, 't1');
    await gm.update('x1', { name: 'g2' }, 't1');
    await gm.addMember('x1', 'u1', 't1');
    await gm.removeMember('x1', 'u1', 't1');
    await gm.setGroupRoles('x1', ['r1'], 't1');
    await gm.delete('x1', 't1');
    const legs = emitsOn(db);
    expect(legs.map((l) => l.type)).toEqual(Array(6).fill('group.changed'));
    expect(legs.map((l) => l.payload.op)).toEqual([
      'lifecycle', 'lifecycle', 'member', 'member', 'roles', 'lifecycle',
    ]);
  });
});

describe('tx-handle threading', () => {
  it('emit runs on the tx handle passed to create, not the manager pool', async () => {
    const db = makeDb();
    const tx = makeDb();
    createDbMock.mockReturnValue(db);
    const um = new UserManager();
    await um.create({ email: 'a@b.c', name: 'X', password: 'Passw0rd-123' }, 't1', tx as unknown as DbLike);
    expect(emitsOn(tx).map((e) => e.type)).toEqual(['user.created']);
    expect(emitsOn(db)).toEqual([]);
  });
});
