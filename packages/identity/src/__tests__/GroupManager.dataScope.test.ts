/**
 * DG-6d GroupManager leg (spec 2026-10-08-data-scope rev.3 §3.2): the `kind`
 * column ('group' | 'department', ruling A5 editable) plus the department
 * resolution read the server scope-util depends on. getDepartmentIdsForUser
 * pins kind='department' AND tenant predicates on BOTH tables — addMember
 * already guarantees consistency, the SQL says so anyway (defense-in-depth).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

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

const T = 'tenant-1';
const G = 'group-1';
const groupRow = {
  id: G,
  tenantId: T,
  name: 'Eng',
  description: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** Chain that records where()/set()/values() arguments for shape assertions. */
function captureChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = vi.fn(() => chain);
  chain.from = self;
  chain.innerJoin = self;
  chain.orderBy = self;
  chain.limit = self;
  chain.onConflictDoNothing = self;
  chain.where = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.returning = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.then = vi.fn((resolve?: ((v: unknown) => unknown) | null) =>
    Promise.resolve(result).then(resolve),
  );
  return chain;
}

function makeDb(selectQueue: unknown[]) {
  const db = {
    select: vi.fn(),
    insert: vi.fn().mockReturnValue(captureChain(undefined)),
    update: vi.fn().mockReturnValue(captureChain(undefined)),
    delete: vi.fn().mockReturnValue(captureChain(undefined)),
  };
  for (const r of selectQueue) db.select.mockReturnValueOnce(captureChain(r));
  db.select.mockReturnValue(captureChain([]));
  return db;
}

const whereSql = (chain: Record<string, ReturnType<typeof vi.fn>>): string => {
  const whereArg = chain.where.mock.calls[0]?.[0];
  return new PgDialect().sqlToQuery(whereArg as never).sql;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('kind column (A5)', () => {
  it('create persists the declared kind and defaults it to group', async () => {
    const deptChain = captureChain([{ ...groupRow, kind: 'department' }]);
    const db = makeDb([[]]); // duplicate-name check: free
    db.insert.mockImplementation(() => deptChain);

    const g = await new GroupManager(db as never).create({ name: 'Platform', kind: 'department' }, T);

    expect(deptChain.values.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ name: 'Platform', kind: 'department', tenantId: T }),
    );
    expect(g.kind).toBe('department');

    const plainChain = captureChain([groupRow]);
    const db2 = makeDb([[]]);
    db2.insert.mockImplementation(() => plainChain);
    await new GroupManager(db2 as never).create({ name: 'Eng' }, T);

    expect(plainChain.values.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ kind: 'group' }));
  });

  it('create clamps an out-of-enum kind before any write (GROUP_KIND_INVALID)', async () => {
    const db = makeDb([]);
    await expect(new GroupManager(db as never).create({ name: 'X', kind: 'division' }, T)).rejects.toThrow(
      'GROUP_KIND_INVALID',
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('update persists a kind change (A5: kind is editable)', async () => {
    const setChain = captureChain([{ ...groupRow, kind: 'department' }]);
    const db = makeDb([[groupRow]]); // findById
    db.update.mockImplementation(() => setChain);

    const g = await new GroupManager(db as never).update(G, { kind: 'department' }, T);

    expect(setChain.set.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ kind: 'department' }));
    expect(g.kind).toBe('department');
  });

  it('update clamps an out-of-enum kind before any write', async () => {
    const db = makeDb([[groupRow]]);
    await expect(new GroupManager(db as never).update(G, { kind: 'sect' }, T)).rejects.toThrow(
      'GROUP_KIND_INVALID',
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('findById projects kind; rows predating the column read as group', async () => {
    const db = makeDb([[{ ...groupRow, kind: 'department' }]]);
    await expect(new GroupManager(db as never).findById(G, T)).resolves.toMatchObject({
      kind: 'department',
    });

    const legacy = makeDb([[groupRow]]);
    await expect(new GroupManager(legacy as never).findById(G, T)).resolves.toMatchObject({
      kind: 'group',
    });
  });

  it('list projects kind for every row', async () => {
    const db = makeDb([[{ ...groupRow, kind: 'department' }]]);
    const listed = await new GroupManager(db as never).list(T);
    expect(listed[0]).toMatchObject({ kind: 'department' });
  });
});

describe('getDepartmentIdsForUser', () => {
  it('returns the caller department ids and pins kind + BOTH-table tenants in one SQL', async () => {
    const chain = captureChain([{ groupId: 'd1' }, { groupId: 'd2' }]);
    const db = { select: vi.fn(() => chain), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };

    const ids = await new GroupManager(db as never).getDepartmentIdsForUser('u1', T);

    expect(ids).toEqual(['d1', 'd2']);
    const sql = whereSql(chain);
    expect(sql).toContain('"groups"."kind"');
    expect(sql).toContain('"group_users"."tenant_id"');
    expect(sql).toContain('"groups"."tenant_id"');
    expect(sql).toContain('"group_users"."user_id"');
  });
});
