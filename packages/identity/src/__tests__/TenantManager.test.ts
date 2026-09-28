import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock permission-cache so suspend-path invalidation is assertable (R2)
vi.mock('../managers/permission-cache.js', () => ({
  invalidatePermissionCache: vi.fn(),
}));

// Mock token-version so the suspend-cascade bump handle is assertable (R1-T2):
// the real bumpAuthState swallows mock-chain failures, so only a spy can prove
// which handle (caller tx vs internal pool) the UPDATE was routed to.
vi.mock('../services/token-version.js', () => ({
  bumpAuthState: vi.fn().mockResolvedValue(undefined),
  delAuthState: vi.fn().mockResolvedValue(undefined),
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { TenantManager } from '../managers/TenantManager.js';
import { invalidatePermissionCache } from '../managers/permission-cache.js';
import type { Tenant } from '../managers/TenantManager.js';

const mockInvalidate = vi.mocked(invalidatePermissionCache);

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Chainable drizzle-style mock (ported from RoleManager.test.ts):
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
  chain.offset = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
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

/** Second independent handle (tx-fake shape): same builder surface, separate spies. */
function makeTxHandle() {
  const tx = makeMockDb();
  // Real DbLike also exposes transaction(); include it so handle identity is unambiguous.
  return Object.assign(tx, { transaction: vi.fn() });
}

type DbTenantFixture = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

const dbTenant = (id: string, overrides: Partial<DbTenantFixture> = {}): DbTenantFixture => ({
  id,
  name: `tenant-${id}`,
  slug: `slug-${id}`,
  status: 'active',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

describe('TenantManager', () => {
  let db: ReturnType<typeof makeMockDb>;
  let manager: TenantManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeMockDb();
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(db as never);
    manager = new TenantManager();
  });

  describe('constructor', () => {
    it('should create TenantManager instance', () => {
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(TenantManager);
    });
  });

  describe('create', () => {
    it('returns the inserted row on happy path', async () => {
      const row = dbTenant('t-new', { name: 'Acme', slug: 'acme' });
      // 1st select -> duplicate check (empty), insert -> returning
      db.select.mockImplementation(() => makeChain([]));
      db.insert.mockImplementation(() => makeChain([row]));

      const result = await manager.create({ name: 'Acme', slug: 'acme' });

      expect(result).toMatchObject({ id: 't-new', name: 'Acme', slug: 'acme' });
      expect(db.insert).toHaveBeenCalledTimes(2); // tenant row + Q4c tenant.created event
    });

    it('rejects with TENANT_PROTECTED-tagged error on duplicate slug', async () => {
      db.select.mockImplementation(() => makeChain([dbTenant('t-existing')]));
      db.insert.mockImplementation(() => makeChain([]));

      await expect(manager.create({ name: 'X', slug: 'slug-t-existing' })).rejects.toThrow(
        /TENANT_PROTECTED|slug/i,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('throws when insert returns no row', async () => {
      db.select.mockImplementation(() => makeChain([]));
      db.insert.mockImplementation(() => makeChain([]));

      await expect(manager.create({ name: 'X', slug: 'x' })).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('returns PaginatedResult shape', async () => {
      // Route by call order: 1st select -> count, 2nd -> rows
      const selectResults: unknown[] = [[{ count: 2 }], [dbTenant('t1'), dbTenant('t2')]];
      db.select.mockImplementation(() => makeChain(selectResults.shift()));

      const result = await manager.findAll({ page: 1, pageSize: 20 });

      expect(result).toMatchObject({ total: 2, page: 1, pageSize: 20, totalPages: 1 });
      expect(result.data).toHaveLength(2);
      expect(db.select).toHaveBeenCalledTimes(2);
    });

    it('applies search filter condition when provided', async () => {
      const selectResults: unknown[] = [[{ count: 1 }], [dbTenant('t1')]];
      db.select.mockImplementation(() => makeChain(selectResults.shift()));

      const result = await manager.findAll({ page: 1, pageSize: 20, search: 'acme' });

      expect(result.data).toHaveLength(1);
      // count query + page query = 2 selects; search must not skip pagination
      expect(db.select).toHaveBeenCalledTimes(2);
    });
  });

  describe('findById', () => {
    it('returns tenant when found', async () => {
      db.select.mockImplementation(() => makeChain([dbTenant('t1')]));

      const result = await manager.findById('t1');

      expect(result).toMatchObject({ id: 't1' });
    });

    it('returns null when not found', async () => {
      db.select.mockImplementation(() => makeChain([]));

      const result = await manager.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('returns updated row on happy path', async () => {
      const updated = dbTenant('t1', { name: 'Renamed' });
      // 1st select -> existence check, update -> returning
      db.select.mockImplementation(() => makeChain([dbTenant('t1')]));
      db.update.mockImplementation(() => makeChain([updated]));
      db.insert.mockImplementation(() => makeChain([])); // Q4c tenant.updated event

      const result = await manager.update('t1', { name: 'Renamed' });

      expect(result).toMatchObject({ id: 't1', name: 'Renamed' });
      expect(mockInvalidate).not.toHaveBeenCalled(); // no suspend → no invalidation
    });

    it('throws TENANT_PROTECTED when target is the default tenant', async () => {
      await expect(manager.update(DEFAULT_TENANT_ID, { name: 'X' })).rejects.toThrow(
        /TENANT_PROTECTED/,
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    it('throws when tenant not found', async () => {
      db.select.mockImplementation(() => makeChain([]));

      await expect(manager.update('missing', { name: 'X' })).rejects.toThrow(/not found/i);
    });

    it('invalidates permission cache when status set to suspended (R2)', async () => {
      const updated = dbTenant('t1', { status: 'suspended' });
      db.select.mockImplementation(() => makeChain([dbTenant('t1')]));
      db.update.mockImplementation(() => makeChain([updated]));
      db.insert.mockImplementation(() => makeChain([])); // Q4c tenant.suspended event

      await manager.update('t1', { status: 'suspended' });

      expect(mockInvalidate).toHaveBeenCalledWith('t1');
    });

    it('routes the whole suspend cascade onto the caller tx handle (R1-T2)', async () => {
      const { bumpAuthState } = await import('../services/token-version.js');
      const mockBump = vi.mocked(bumpAuthState);
      const tx = makeTxHandle();
      const updated = dbTenant('t1', { status: 'suspended' });

      // Pool handle: only the (unused here) existence check could ever land here.
      db.select.mockImplementation(() => makeChain([dbTenant('t1')]));
      db.update.mockImplementation(() => makeChain([updated]));
      db.insert.mockImplementation(() => makeChain([]));
      // Tx handle: existence SELECT + tenant UPDATE + tenant user SELECT +
      // sessions/api_keys revoke UPDATEs + the tenant.suspended event INSERT.
      // (bumpAuthState is the mocked spy — its handle is asserted below.)
      tx.select
        .mockImplementationOnce(() => makeChain([dbTenant('t1')]))
        .mockImplementation(() => makeChain([{ id: 'u1' }]));
      tx.update.mockImplementation(() => makeChain([updated]));
      tx.insert.mockImplementation(() => makeChain([])); // Q4c tenant.suspended event

      await manager.update('t1', { status: 'suspended' }, tx as never);

      // bumpAuthState received the caller tx handle, not the internal pool.
      expect(mockBump).toHaveBeenCalledTimes(1);
      expect(mockBump.mock.calls[0]?.[0]).toBe(tx);
      // revokeTenantAccess SQL (tenant user SELECT + sessions/api_keys UPDATEs)
      // ran on the tx handle.
      expect(tx.update).toHaveBeenCalledTimes(3); // tenant row + sessions + api_keys
      expect(tx.select).toHaveBeenCalledTimes(2); // existence check + user lookup
      // Zero reads/writes against the raw pool handle — the whole cascade
      // (outbox event included) is tx-scoped.
      expect(db.update).not.toHaveBeenCalled();
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('does not invalidate for non-suspend status updates', async () => {
      const updated = dbTenant('t1', { status: 'active' });
      db.select.mockImplementation(() => makeChain([dbTenant('t1')]));
      db.update.mockImplementation(() => makeChain([updated]));
      db.insert.mockImplementation(() => makeChain([])); // Q4c tenant.updated event

      await manager.update('t1', { status: 'active' });

      expect(mockInvalidate).not.toHaveBeenCalled();
    });
  });

  describe('delete (soft suspend)', () => {
    it('throws TENANT_PROTECTED for the default tenant without touching DB', async () => {
      await expect(manager.delete(DEFAULT_TENANT_ID)).rejects.toThrow(/TENANT_PROTECTED/);
      expect(db.update).not.toHaveBeenCalled();
      expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('soft-suspends non-default tenant and invalidates permission cache', async () => {
      const suspended = dbTenant('t1', { status: 'suspended' });
      db.select.mockImplementation(() => makeChain([dbTenant('t1')]));
      db.update.mockImplementation(() => makeChain([suspended]));
      db.insert.mockImplementation(() => makeChain([])); // Q4c tenant.deleted event

      const result = await manager.delete('t1');

      expect(result).toMatchObject({ id: 't1', status: 'suspended' });
      // tenant row + sessions + api_keys revokes (W3-3 funnel) = 3 updates
      // (the Q3A bumpAuthState UPDATE is the module-level spy — its handle
      // routing is locked by the R1-T2 tx test above)
      expect(db.update).toHaveBeenCalledTimes(3);
      expect(db.delete).not.toHaveBeenCalled(); // soft — never a hard delete
      expect(mockInvalidate).toHaveBeenCalledWith('t1');
    });

    it('throws when tenant not found', async () => {
      db.select.mockImplementation(() => makeChain([]));

      await expect(manager.delete('missing')).rejects.toThrow(/not found/i);
    });
  });

  describe('Tenant type shape', () => {
    it('exposes Tenant with camelCase fields', () => {
      const t: Tenant = {
        id: 'x',
        name: 'n',
        slug: 's',
        status: 'active',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      expect(t.slug).toBe('s');
    });
  });
});
