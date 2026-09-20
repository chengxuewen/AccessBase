/**
 * Batch L-prime T1 tests (server side): partition invariant vs the 21-code
 * seed table, strict bindPermissions kernel (X4), and the best-effort wrapper
 * contract the wizard/init/self-heal depend on.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  BUILTIN_PERMISSIONS,
  bindPermissions,
  seedBuiltinPermissions,
} from '../routes/permissions-seed.js';
import {
  TENANT_BINDABLE_PERMISSIONS,
  PLATFORM_ONLY_PERMISSIONS,
} from '@accessbase/identity';
import { logger } from '@accessbase/logging';

function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.returning = vi.fn(() => chain);
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
  };
}

const NAMES_21 = BUILTIN_PERMISSIONS.map((p) => p.name);

describe('partition invariant (X2 gate: every new code MUST be placed)', () => {
  it('disjoint + union == BUILTIN names (21)', () => {
    expect(
      TENANT_BINDABLE_PERMISSIONS.filter((n) => PLATFORM_ONLY_PERMISSIONS.includes(n)),
    ).toEqual([]);
    const union = [...TENANT_BINDABLE_PERMISSIONS, ...PLATFORM_ONLY_PERMISSIONS].sort();
    expect(union).toEqual([...NAMES_21].sort());
    expect(NAMES_21).toHaveLength(21);
  });
});

describe('X4 strict bindPermissions kernel', () => {
  it('throws when a requested builtin name is absent after insert', async () => {
    const db = makeMockDb();
    db.insert.mockReturnValue(makeChain(undefined));
    // only 8 of the 9 requested names come back
    db.select.mockReturnValueOnce(
      makeChain(TENANT_BINDABLE_PERMISSIONS.slice(0, 8).map((n, i) => ({ id: `p${i}`, name: n }))),
    );

    await expect(
      bindPermissions(db as never, 'role-1', TENANT_BINDABLE_PERMISSIONS),
    ).rejects.toThrow(/missing builtin rows after insert/);
  });

  it('throws when final binding count diverges from the requested set', async () => {
    const db = makeMockDb();
    db.insert.mockReturnValue(makeChain(undefined));
    db.select
      .mockReturnValueOnce(
        makeChain(TENANT_BINDABLE_PERMISSIONS.map((n, i) => ({ id: `p${i}`, name: n }))),
      )
      .mockReturnValueOnce(makeChain([{ count: 7 }])); // assert: expected 9

    await expect(
      bindPermissions(db as never, 'role-1', TENANT_BINDABLE_PERMISSIONS),
    ).rejects.toThrow(/holds 7 bindings, expected 9/);
  });

  it('resolves when insert/read/count all line up', async () => {
    const db = makeMockDb();
    db.insert.mockReturnValue(makeChain(undefined));
    db.select
      .mockReturnValueOnce(
        makeChain(TENANT_BINDABLE_PERMISSIONS.map((n, i) => ({ id: `p${i}`, name: n }))),
      )
      .mockReturnValueOnce(makeChain([{ count: TENANT_BINDABLE_PERMISSIONS.length }]));

    await expect(
      bindPermissions(db as never, 'role-1', TENANT_BINDABLE_PERMISSIONS),
    ).resolves.toBeUndefined();
  });
});

describe('best-effort wrapper contract (wizard/init/self-heal must not see throws)', () => {
  it('swallows strict-kernel failures and logs them', async () => {
    const db = makeMockDb();
    db.insert.mockReturnValue(makeChain(undefined));
    db.select.mockReturnValueOnce(makeChain([])); // every name "missing" -> strict throws

    await expect(seedBuiltinPermissions(db as never, 'role-1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to seed builtin permissions — admin creation continues',
    );
  });
});
