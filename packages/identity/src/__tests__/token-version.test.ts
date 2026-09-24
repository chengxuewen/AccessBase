import { describe, it, expect, vi } from 'vitest';
import { bumpAuthState } from '../services/token-version.js';
import { PgDialect } from 'drizzle-orm/pg-core';

function captureDb() {
  let whereArg: unknown = null;
  let setArg: unknown = null;
  const chain: Record<string, unknown> = {};
  const db = {
    update: vi.fn(() => chain),
  };
  chain.set = vi.fn((s: unknown) => {
    setArg = s;
    return chain;
  });
  chain.where = vi.fn((w: unknown) => {
    whereArg = w;
    return chain;
  });
  chain.returning = vi.fn(() => Promise.resolve([{ id: 'u1' }]));
  return {
    db: db as never,
    sql: () => new PgDialect().sqlToQuery(whereArg as never).sql,
    set: () => setArg as Record<string, unknown>,
  };
}

describe('bumpAuthState (Q3A)', () => {
  it('roleIds target composes a member-subquery predicate', async () => {
    const c = captureDb();
    await bumpAuthState(c.db, { tenantId: 't1', roleIds: ['r1'] }, async () => undefined);
    expect((c.set() as { tokenVersion?: unknown }).tokenVersion).toBeTruthy(); // SET token_version = expr
    expect(c.sql()).toMatch(/user_roles/);
    expect(c.sql()).toMatch(/"users"."tenant_id"/);
  });
  it('userIds target hits the id list', async () => {
    const c = captureDb();
    await bumpAuthState(c.db, { tenantId: 't1', userIds: ['u1'] }, async (ids) => {
      expect(ids).toEqual(['u1']);
    });
    expect(c.sql()).toMatch(/"users"\."id"/);
  });
  it('empty non-tenant-wide target is a no-op', async () => {
    const db = { update: vi.fn() };
    await bumpAuthState(db as never, { tenantId: 't1' });
    expect(db.update).not.toHaveBeenCalled();
  });
  it('broken db lane fails soft (never blocks the legitimate write)', async () => {
    const db = { update: vi.fn(() => { throw new Error('chain ended'); }) };
    await expect(
      bumpAuthState(db as never, { tenantId: 't1', allTenantUsers: true }),
    ).resolves.toBeUndefined();
  });
});
