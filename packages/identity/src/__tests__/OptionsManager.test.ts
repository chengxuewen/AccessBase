import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { OptionsManager } from '../managers/OptionsManager.js';
import type { DrizzleDB } from '../db/index.js';

/**
 * Chainable drizzle-style mock (same shape as PermissionManager.test.ts):
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
  chain.onConflictDoUpdate = vi.fn(() => chain);
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

const optionRow = (key: string, value: unknown, updatedAt = new Date(0)) => ({
  key,
  value,
  updatedAt,
});

describe('OptionsManager', () => {
  let db: ReturnType<typeof makeMockDb>;
  let manager: OptionsManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeMockDb();
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(db as never);
    manager = new OptionsManager();
  });

  describe('get', () => {
    it('prefers env value when defined, over the option row', async () => {
      db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));

      const result = await manager.get('theme', 'light', 'default-theme');

      expect(result).toBe('light');
    });

    it('uses the option row when env is undefined', async () => {
      db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));

      const result = await manager.get('theme', undefined, 'default-theme');

      expect(result).toBe('dark');
    });

    it('falls back to the default when env and option row are both absent', async () => {
      db.select.mockReturnValue(makeChain([]));

      const result = await manager.get('theme', undefined, 'default-theme');

      expect(result).toBe('default-theme');
    });
  });

  describe('set', () => {
    it('upserts and the next get reflects the new value (cache invalidation)', async () => {
      db.select.mockReturnValue(makeChain([]));
      const insertChain = makeChain(undefined);
      db.insert.mockReturnValue(insertChain);

      expect(await manager.get('theme', undefined, 'default-theme')).toBe('default-theme');

      await manager.set('theme', 'dark');

      expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith({
        target: expect.anything(),
        set: { value: 'dark', updatedAt: expect.any(Date) },
      });

      db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));
      expect(await manager.get('theme', undefined, 'default-theme')).toBe('dark');
    });
  });

  describe('delete', () => {
    it('removes the row and get falls back to the default', async () => {
      db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));
      const deleteChain = makeChain(undefined);
      db.delete.mockReturnValue(deleteChain);

      expect(await manager.get('theme', undefined, 'default-theme')).toBe('dark');

      await manager.delete('theme');

      expect(db.delete).toHaveBeenCalledTimes(1);

      db.select.mockReturnValue(makeChain([]));
      expect(await manager.get('theme', undefined, 'default-theme')).toBe('default-theme');
    });
  });

  describe('listAll', () => {
    it('returns rows with updatedAt', async () => {
      const updatedAt = new Date(123456789);
      db.select.mockReturnValue(makeChain([optionRow('theme', 'dark', updatedAt)]));

      const rows = await manager.listAll();

      expect(rows).toEqual([{ key: 'theme', value: 'dark', updatedAt }]);
    });
  });

  describe('constructor', () => {
    it('accepts both a string url and a DrizzleDB instance (overload branches)', async () => {
      const { createDb } = await import('../db/index.js');

      const mgrString = new OptionsManager('postgres://example/db');
      expect(createDb).toHaveBeenCalledWith('postgres://example/db');

      createDb.mockClear();
      const mgrDb = new OptionsManager(db as unknown as DrizzleDB);
      expect(createDb).not.toHaveBeenCalled();

      db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));
      expect(await mgrDb.get('theme', undefined, 'x')).toBe('dark');
      expect(mgrString).toBeInstanceOf(OptionsManager);
    });
  });
});

describe('OptionsManager publish hook (R-A cross-node coherence)', () => {
  let db: ReturnType<typeof makeMockDb>;
  let manager: OptionsManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeMockDb();
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(db as never);
    manager = new OptionsManager();
  });

  afterEach(async () => {
    const { setOptionsPublishHook } = await import('../managers/OptionsManager.js');
    setOptionsPublishHook(undefined);
  });

  it('set fires the publish hook (announce to other nodes)', async () => {
    const { setOptionsPublishHook } = await import('../managers/OptionsManager.js');
    const publish = vi.fn();
    setOptionsPublishHook(publish);
    db.insert.mockReturnValue(makeChain(undefined));

    await manager.set('theme', 'dark');

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('setIfAbsent fires the publish hook', async () => {
    const { setOptionsPublishHook } = await import('../managers/OptionsManager.js');
    const publish = vi.fn();
    setOptionsPublishHook(publish);
    db.insert.mockReturnValue(makeChain(undefined));

    await manager.setIfAbsent('site.name', 'x');

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('delete fires the publish hook', async () => {
    const { setOptionsPublishHook } = await import('../managers/OptionsManager.js');
    const publish = vi.fn();
    setOptionsPublishHook(publish);
    db.delete.mockReturnValue(makeChain(undefined));

    await manager.delete('theme');

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('invalidate({fromRemote:true}) drops the local cache without republishing', async () => {
    const { setOptionsPublishHook } = await import('../managers/OptionsManager.js');
    const publish = vi.fn();
    setOptionsPublishHook(publish);
    db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));
    await manager.get('theme', undefined, 'default-theme'); // warm cache
    expect(publish).not.toHaveBeenCalled();

    manager.invalidate({ fromRemote: true });

    expect(publish).not.toHaveBeenCalled(); // remote announcements never loop
    // cache truly dropped: next get re-selects
    db.select.mockClear();
    db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));
    await manager.get('theme', undefined, 'default-theme');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('cross-instance: A writes, remote invalidation makes B re-read the shared DB', async () => {
    const { setOptionsPublishHook, OptionsManager: Mgr } = await import(
      '../managers/OptionsManager.js',
    );
    // Node B: separate manager instance on the SAME shared DB
    const nodeB = new Mgr();
    db.select.mockReturnValue(makeChain([]));
    expect(await manager.get('theme', undefined, 'default-theme')).toBe('default-theme');
    expect(await nodeB.get('theme', undefined, 'default-theme')).toBe('default-theme');

    // A's write lands in the shared PG; wire the bus: hook => B drops its cache
    db.select.mockReturnValue(makeChain([optionRow('theme', 'dark')]));
    setOptionsPublishHook(() => nodeB.invalidate({ fromRemote: true }));
    db.insert.mockReturnValue(makeChain(undefined));
    await manager.set('theme', 'dark');

    expect(await nodeB.get('theme', undefined, 'default-theme')).toBe('dark');
  });

  it('no hook registered => writes stay silent no-op (single-node mode)', async () => {
    db.insert.mockReturnValue(makeChain(undefined));
    await expect(manager.set('theme', 'dark')).resolves.toBeUndefined();
  });
});