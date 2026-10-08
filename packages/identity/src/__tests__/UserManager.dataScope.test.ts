/**
 * DG-6d UserManager leg (spec 2026-10-08-data-scope rev.3 §3.2): the row-visibility
 * predicate. findAll and isWithinScope share ONE predicate builder, so the list
 * surface and the per-row guard can never drift apart — the shape locks below are
 * the net. [B4/R5] a dept arm with EMPTY groupIds must degrade to the self arm
 * (never a dropped condition, never a degenerate `in ()`).
 *
 * Mock-lane honesty: a fake chain cannot render a drizzle subquery inline, so the
 * dept arm is pinned STRUCTURALLY — the subquery's projection column, FROM table
 * and WHERE fragment are asserted on the chain that built them, and the outer
 * predicate must bind its IN slot to that subquery object (a value array would
 * spread `in ($n, $n+1)` — the corrupt shape the spec forbids). The end-to-end
 * row set (dept list == members + self exactly) is the real-PG integration lane's
 * job, per spec §5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { UserManager } from '../managers/UserManager.js';
import { createDb } from '../db/index.js';
import { groupUsers } from '../db/schema.js';
import type { UserScopeFilter } from '../types.js';

const T = 'tenant-1';
const CALLER = 'user-caller';
const dialect = new PgDialect();

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function makeChain(next: () => unknown): Chain {
  const chain: Chain = {};
  const self = vi.fn(() => chain);
  chain.from = self;
  chain.innerJoin = self;
  chain.orderBy = self;
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(() => chain);
  // Rows are popped when a chain is AWAITED: the inArray subquery is built but
  // never executed against the mock, so it consumes nothing from the queue.
  chain.then = vi.fn((resolve?: ((v: unknown) => unknown) | null) =>
    Promise.resolve(next()).then(resolve),
  );
  return chain;
}

/**
 * Fake db recording every builder chain in creation order + a UserManager built
 * against it (the manager captures its db at construction, so it must be built
 * here). A dept arm builds its subquery FIRST, so chains[0] is the subquery and
 * the visible-row query is the last chain.
 */
function makeScoped(rowSets: unknown[][]) {
  const chains: Chain[] = [];
  let cursor = 0;
  const db = {
    select: vi.fn(),
    insert: vi.fn().mockReturnValue(makeChain(() => undefined)),
    update: vi.fn().mockReturnValue(makeChain(() => undefined)),
    delete: vi.fn().mockReturnValue(makeChain(() => undefined)),
  };
  db.select.mockImplementation(() => {
    // Awaited chains consume the next row-set in order; a built-but-never-run
    // subquery chain consumes none.
    const chain = makeChain(() => rowSets[cursor++] ?? []);
    chains.push(chain);
    return chain;
  });
  vi.mocked(createDb).mockReturnValue(db as unknown as ReturnType<typeof createDb>);
  return { db, chains, manager: new UserManager() };
}

/** Chain at an index (negative counts from the end) — loud when absent. */
function chainAt(chains: Chain[], index: number): Chain {
  const chain = chains.at(index);
  if (!chain) throw new Error(`expected a query chain at ${index}, built ${chains.length}`);
  return chain;
}

/** The predicate a chain was handed (first = subquery, last = outer query). */
function whereOf(chain: Chain, which: 'first' | 'last'): { sql: string; params: unknown[] } {
  const call = which === 'first' ? chain.where.mock.calls[0] : chain.where.mock.calls.at(-1);
  if (!call) throw new Error('the chain never received a where() predicate');
  return dialect.sqlToQuery(call[0] as SQL);
}

const runFindAll = async (
  scope: UserScopeFilter | undefined,
  extra: Partial<{ search: string; status: 'active' }> = {},
) => {
  const ctx = makeScoped([[{ count: 0 }], []]);
  await ctx.manager.findAll({ ...(scope ? { scope } : {}), ...extra }, T);
  return ctx;
};

const runCheck = (scope: UserScopeFilter, target: string, found: boolean) => {
  const ctx = makeScoped(found ? [[{ id: target }]] : []);
  return { ...ctx, call: () => ctx.manager.isWithinScope(target, scope) };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findAll scope arms', () => {
  it('all adds no visibility predicate (tenant predicate only)', async () => {
    const { chains } = await runFindAll({ kind: 'all' });
    expect(chains).toHaveLength(2); // count + page, no subquery
    const { sql } = whereOf(chainAt(chains, 1), 'last');
    expect(sql).toContain('"users"."tenant_id"');
    expect(sql).not.toContain('group_users');
    expect(sql).not.toMatch(/"users"\."id"\s*=\s*\$/);
  });

  it('self pins the caller id and never touches group_users', async () => {
    const { chains } = await runFindAll({ kind: 'self', userId: CALLER });
    expect(chains).toHaveLength(2);
    const { sql, params } = whereOf(chainAt(chains, 1), 'last');
    expect(sql).toMatch(/"users"\."id" = \$\d/);
    expect(params).toContain(CALLER);
    expect(sql).not.toContain('group_users');
  });

  it('dept = caller UNION members of the caller departments (subquery, not values)', async () => {
    const { db, chains } = await runFindAll({
      kind: 'dept',
      userId: CALLER,
      groupIds: ['d1', 'd2'],
    });

    // subquery shape: select group_users.user_id from group_users where group_id in (ids)
    const sub = chainAt(chains, 0);
    expect(db.select.mock.calls[0]?.[0]).toEqual({ userId: groupUsers.userId });
    expect(sub.from.mock.calls[0]?.[0]).toBe(groupUsers);
    const { sql: subSql, params: subParams } = whereOf(sub, 'first');
    expect(subSql).toContain('"group_users"."group_id" in (');
    expect(subParams).toEqual(['d1', 'd2']);

    // outer shape: self eq OR users.id IN <the subquery object itself>
    const page = whereOf(chainAt(chains, -1), 'last');
    expect(page.sql).toMatch(/"users"\."id" = \$\d/);
    expect(page.sql).toMatch(/"users"\."id" in \$\d/);
    expect(page.params).toContain(CALLER);
    // binding a value array instead of the subquery spreads placeholders — the
    // corrupt single-param shape the spec forbids (flows: IN (${ids}) spread)
    expect(page.sql).not.toMatch(/"users"\."id" in \(\$/);
    expect(page.params.at(-1)).toBe(sub);
  });

  it('[B4 belt] dept with NO departments degrades to the self arm (no degenerate in ())', async () => {
    const { chains } = await runFindAll({ kind: 'dept', userId: CALLER, groupIds: [] });
    expect(chains).toHaveLength(2); // the belt converts before any inArray is built
    const { sql, params } = whereOf(chainAt(chains, 1), 'last');
    expect(sql).not.toContain('group_users');
    expect(sql).toMatch(/"users"\."id" = \$\d/);
    expect(sql).not.toMatch(/in \(\s*\)/);
    expect(params).toContain(CALLER);
  });

  it('list meta is scoped by construction: count and page share one predicate', async () => {
    const { chains } = await runFindAll({ kind: 'dept', userId: CALLER, groupIds: ['d1'] });
    expect(chains).toHaveLength(3); // subquery + count + page
    expect(whereOf(chainAt(chains, 1), 'last').sql).toEqual(whereOf(chainAt(chains, 2), 'last').sql);
  });

  it('existing filters still compose with the scope predicate (search + status)', async () => {
    const { chains } = await runFindAll(
      { kind: 'self', userId: CALLER },
      { search: 'acme', status: 'active' },
    );
    const { sql } = whereOf(chainAt(chains, 1), 'last');
    expect(sql).toContain('ILIKE');
    expect(sql).toContain('"users"."status"');
    expect(sql).toContain('"users"."id"');
  });
});

describe('isWithinScope', () => {
  it('all is unconditional and issues no query', async () => {
    const { db, call } = runCheck({ kind: 'all' }, 'u2', false);
    expect(await call()).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('self: the caller is inside their own scope, nobody else', async () => {
    const me = runCheck({ kind: 'self', userId: CALLER }, CALLER, true);
    expect(await me.call()).toBe(true);
    const { sql, params } = whereOf(chainAt(me.chains, -1), 'last');
    expect(sql).toContain('"users"."id"');
    expect(params).toEqual([CALLER, CALLER]); // target pin + self pin
    expect(sql).not.toContain('group_users');

    const other = runCheck({ kind: 'self', userId: CALLER }, 'u2', false);
    expect(await other.call()).toBe(false);
  });

  it('dept: a department member resolves inside, an outsider does not', async () => {
    const member = runCheck({ kind: 'dept', userId: CALLER, groupIds: ['d1'] }, 'u2', true);
    expect(await member.call()).toBe(true);
    const sub = chainAt(member.chains, 0);
    const subSql = whereOf(sub, 'first');
    expect(subSql.sql).toContain('"group_users"."group_id" in (');
    expect(subSql.params).toEqual(['d1']);

    const outer = whereOf(chainAt(member.chains, -1), 'last');
    expect(outer.sql).toMatch(/"users"\."id" in \$\d/);
    expect(outer.sql).toMatch(/"users"\."id" = \$\d/);
    expect(outer.params).toContain(CALLER);
    expect(outer.params.at(-1)).toBe(sub);

    const outsider = runCheck({ kind: 'dept', userId: CALLER, groupIds: ['d1'] }, 'u9', false);
    expect(await outsider.call()).toBe(false);
  });

  it('[B4] dept with no departments only ever matches the caller', async () => {
    const selfOnly = runCheck({ kind: 'dept', userId: CALLER, groupIds: [] }, CALLER, true);
    expect(await selfOnly.call()).toBe(true);
    expect(selfOnly.chains).toHaveLength(1); // no subquery built
    expect(whereOf(chainAt(selfOnly.chains, -1), 'last').sql).not.toContain('group_users');

    const none = runCheck({ kind: 'dept', userId: CALLER, groupIds: [] }, 'u2', false);
    expect(await none.call()).toBe(false);
  });

  it('the guard runs the same predicate as the list (no drift possible)', async () => {
    const dept: UserScopeFilter = { kind: 'dept', userId: CALLER, groupIds: ['d1', 'd2'] };
    const list = await runFindAll(dept);
    const guard = runCheck(dept, 'u2', true);
    await guard.call();

    expect(whereOf(chainAt(guard.chains, 0), 'first').sql).toEqual(
      whereOf(chainAt(list.chains, 0), 'first').sql,
    );
    expect(whereOf(chainAt(guard.chains, -1), 'last').sql).toContain(' or ');
    expect(whereOf(chainAt(list.chains, -1), 'last').sql).toContain(' or ');
  });
});
