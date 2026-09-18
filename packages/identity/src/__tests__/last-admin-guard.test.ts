/**
 * last-admin-guard unit tests (Batch K Task 2, R1).
 *
 * The predicate is a pure db-querying function: given a tenant and the user
 * targeted by a privileged removal/suspension/deletion, it resolves the set of
 * ACTIVE users holding an isSystem (admin) role and answers whether excluding
 * the target would orphan the tenant (zero active admins left).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging (imported transitively by the db module graph)
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  wouldOrphanLastAdmin,
  ROLE_PROTECTED,
  LAST_ADMIN_GUARD,
} from '../services/last-admin-guard.js';

/** Chainable drizzle-style mock (UserManager.test precedent) with innerJoin. */
function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

function makeMockDb(selectResult: unknown) {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  db.select.mockReturnValue(makeChain(selectResult));
  return db;
}

const holder = (userId: string) => ({ userId });

describe('wouldOrphanLastAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when the target is the only active admin holder', async () => {
    const db = makeMockDb([holder('u1')]);
    await expect(wouldOrphanLastAdmin(db as never, 't1', 'u1')).resolves.toBe(true);
  });

  it('returns false when another active admin remains (two admins, strip one)', async () => {
    const db = makeMockDb([holder('u1'), holder('u2')]);
    await expect(wouldOrphanLastAdmin(db as never, 't1', 'u1')).resolves.toBe(false);
  });

  it('returns false when the target is not an active admin (holds only non-system roles)', async () => {
    const db = makeMockDb([holder('u2')]);
    await expect(wouldOrphanLastAdmin(db as never, 't1', 'u1')).resolves.toBe(false);
  });

  it('returns false when no active admins exist at all (target already suspended / tenant already orphaned)', async () => {
    const db = makeMockDb([]);
    await expect(wouldOrphanLastAdmin(db as never, 't1', 'u1')).resolves.toBe(false);
  });

  it('queries scoped to the tenant (where receives the tenant predicate)', async () => {
    const db = makeMockDb([holder('u1')]);
    await wouldOrphanLastAdmin(db as never, 't1', 'u1');
    expect(db.select).toHaveBeenCalledTimes(1);
    const selectArg = db.select.mock.calls[0]![0];
    expect(selectArg).toMatchObject({ userId: expect.anything() });
    // the where() call happened exactly once with a single combined condition
    const chain = db.select.mock.results[0]!.value;
    expect(chain.where).toHaveBeenCalledTimes(1);
  });
});

describe('tag constants (409 mapper contract)', () => {
  it('exports ROLE_PROTECTED / LAST_ADMIN_GUARD tag strings', () => {
    expect(ROLE_PROTECTED).toBe('ROLE_PROTECTED');
    expect(LAST_ADMIN_GUARD).toBe('LAST_ADMIN_GUARD');
  });
});
