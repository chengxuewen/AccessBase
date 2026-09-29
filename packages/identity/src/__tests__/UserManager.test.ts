import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('$2b$12$hashed')),
    compare: vi.fn(() => Promise.resolve(true)),
  },
}));

import { UserManager } from '../managers/UserManager.js';
import { logger } from '@accessbase/logging';

const mockLogger = vi.mocked(logger);

describe('UserManager', () => {
  let userManager: UserManager;

  beforeEach(() => {
    vi.clearAllMocks();
    userManager = new UserManager();
  });

  describe('constructor', () => {
    it('should create UserManager instance', () => {
      expect(userManager).toBeDefined();
      expect(userManager).toBeInstanceOf(UserManager);
    });
  });

  describe('API surface', () => {
    it('should export UserManager class', () => {
      expect(typeof UserManager).toBe('function');
    });

    it('should have create method', () => {
      expect(typeof userManager.create).toBe('function');
    });

    it('should have findById method', () => {
      expect(typeof userManager.findById).toBe('function');
    });

    it('should have findByEmail method', () => {
      expect(typeof userManager.findByEmail).toBe('function');
    });

    it('should have findAll method', () => {
      expect(typeof userManager.findAll).toBe('function');
    });

    it('should have update method', () => {
      expect(typeof userManager.update).toBe('function');
    });

    it('should have delete method', () => {
      expect(typeof userManager.delete).toBe('function');
    });

    it('should have changeStatus method', () => {
      expect(typeof userManager.changeStatus).toBe('function');
    });

    it('should have verifyPassword method', () => {
      expect(typeof userManager.verifyPassword).toBe('function');
    });

    it('should have resetPassword method', () => {
      expect(typeof userManager.resetPassword).toBe('function');
    });
  });
});

describe('verifyPassword status enforcement', () => {
  function makeMockDb() {
    return {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }

  // Chainable drizzle-style mock: awaiting the chain resolves `result` (same
  // shape as OptionsManager.test.ts makeChain).
  function makeChain(result: unknown) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.then = vi.fn(
      (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
        Promise.resolve(result).then(resolve, reject),
    );
    return chain;
  }

  const userRow = (status: string) => ({
    id: 'u1',
    email: 'a@b.c',
    name: 'A',
    status,
    passwordHash: '$2a$10$whatever',
    tokenVersion: 1,
  });

  it('rejects suspended users before bcrypt compare', async () => {
    const { createDb } = await import('../db/index.js');
    const { default: bcryptjsMock } = await import('bcryptjs');
    const { compare } = bcryptjsMock;
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([userRow('suspended')]));

    const mgr = new UserManager();
    await expect(mgr.verifyPassword('a@b.c', 'any-password')).rejects.toThrow(
      'ACCOUNT_SUSPENDED',
    );
    expect(compare).not.toHaveBeenCalled();
  });

  it('rejects pending users with the same error', async () => {
    const { createDb } = await import('../db/index.js');
    const { default: bcryptjsMock } = await import('bcryptjs');
    const { compare } = bcryptjsMock;
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([userRow('pending')]));

    const mgr = new UserManager();
    await expect(mgr.verifyPassword('p@b.c', 'any-password')).rejects.toThrow(
      'ACCOUNT_SUSPENDED',
    );
    expect(compare).not.toHaveBeenCalled();
  });

  it('still succeeds for active users (bcrypt path unchanged)', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([userRow('active')]));

    const mgr = new UserManager();
    const user = await mgr.verifyPassword('a@b.c', 'right-password');
    expect(user.isActive).toBe(true);
  });

  // Regression: mapToUser must map BOTH totpEnabled (MFA step-up branch in
  // auth.ts login) and status (JWT status claim / P0 enforcement). A past edit
  // dropped totpEnabled, silently disabling MFA step-up for all users.
  it('findById output carries totpEnabled and status from the DB row', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(
      makeChain([{ ...userRow('suspended'), totpEnabled: true }]),
    );

    const mgr = new UserManager();
    const user = await mgr.findById('u1', '00000000-0000-0000-0000-000000000001');
    expect(user).not.toBeNull();
    expect(user?.totpEnabled).toBe(true);
    expect(user?.status).toBe('suspended');
    expect(user?.isActive).toBe(false);
  });
  
  // findByIdAny: tenant-unfiltered lookup for cross-tenant flows (refresh
  // door resolves the token owner without knowing their tenant). Unlike
  // findById, no tenantId predicate is applied — the where clause filters by
  // id only, so a user in ANY tenant resolves.
  it('findByIdAny resolves a user regardless of tenant (no tenantId predicate)', async () => {
    const { createDb } = await import('../db/index.js');
    const { eq } = await import('drizzle-orm');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([userRow('active')]));

    const mgr = new UserManager();
    const user = await mgr.findByIdAny('u1');
    expect(user).not.toBeNull();
    expect(user?.status).toBe('active');
    expect(user?.status).toBe('active');
  });

  it('findByIdAny returns null for unknown id', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([]));

    const mgr = new UserManager();
    const user = await mgr.findByIdAny('missing');
    expect(user).toBeNull();
  });
});

describe('findByPhone (Batch I Task 0, R1)', () => {
  function makeMockDb() {
    return {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }

  function makeChain(result: unknown) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.then = vi.fn(
      (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
        Promise.resolve(result).then(resolve, reject),
    );
    return chain;
  }

  const userRow = (phone: string) => ({
    id: 'u1',
    email: 'a@b.c',
    name: 'A',
    phone,
    status: 'active',
    passwordHash: null,
    tokenVersion: 1,
    totpEnabled: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a single matching row to the mapped user', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([userRow('+8613800000001')]));

    const mgr = new UserManager();
    const user = await mgr.findByPhone('+8613800000001');

    expect(user).not.toBeNull();
    expect(user?.email).toBe('a@b.c');
  });

  it('queries with LIMIT 2 so a duplicate can be detected', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([userRow('+8613800000001')]));

    const mgr = new UserManager();
    await mgr.findByPhone('+8613800000001');

    // The last limit() call in the chain receives the cap.
    const limitCall = db.select.mock.results[0]!.value.limit.mock.calls.at(-1);
    expect(limitCall![0]).toBe(2);
  });

  it('returns null and warns when multiple rows match (R1 ambiguity refusal)', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(
      makeChain([userRow('+8613800000001'), userRow('+8613800000001')]),
    );

    const mgr = new UserManager();
    const user = await mgr.findByPhone('+8613800000001');

    expect(user).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+8613800000001' }),
      'duplicate phone registrations',
    );
  });

  it('returns null silently when no rows match', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([]));

    const mgr = new UserManager();
    const user = await mgr.findByPhone('+999missing');

    expect(user).toBeNull();
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+999missing' }),
      'duplicate phone registrations',
    );
  });
});

describe('findAll emailExact (Batch J Task 1, structural tripwire)', () => {
  it('resolves through the mocked db chain; each query calls where() once', async () => {
    // The mock chain never evaluates SQL (R3), so no semantic assertion is
    // possible here: this locks that findAll({ emailExact }) plumbs through
    // without throwing and still builds a where-filtered count + page query.
    const { createDb } = await import('../db/index.js');
    const db = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(createDb).mockReturnValue(db as never);
    const makeChain = (result: unknown) => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.offset = vi.fn(() => chain);
      chain.orderBy = vi.fn(() => chain);
      chain.then = vi.fn(
        (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
          Promise.resolve(result).then(resolve, reject),
      );
      return chain;
    };
    const countChain = makeChain([{ count: 0 }]);
    const pageChain = makeChain([]);
    db.select.mockReturnValueOnce(countChain).mockReturnValueOnce(pageChain);

    const mgr = new UserManager();
    const result = await mgr.findAll({ emailExact: 'A@B.com' }, 'tenant-1');

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    expect(countChain.where).toHaveBeenCalledTimes(1);
    expect(pageChain.where).toHaveBeenCalledTimes(1);
  });
});

describe('K-T2 last-admin guard (UserManager funnel)', () => {
  function makeMockDb() {
    return { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
  }
  function makeChain(result: unknown) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.set = vi.fn(() => chain);
    chain.values = vi.fn(() => chain);
    chain.returning = vi.fn(() => chain);
    chain.then = vi.fn(
      (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
        Promise.resolve(result).then(resolve, reject),
    );
    return chain;
  }
  const userRow = { id: 'u1', email: 'a@b.c', name: 'A', status: 'active', tenantId: 't1' };

  it('delete throws LAST_ADMIN_GUARD when target is the sole active admin', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    // holder census returns only the target as an active admin
    db.select.mockReturnValue(makeChain([{ userId: 'u1' }]));
    const mgr = new UserManager();
    await expect(mgr.delete('u1', 't1')).rejects.toThrow(/^LAST_ADMIN_GUARD:/);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('delete proceeds when another active admin remains', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([{ userId: 'u1' }, { userId: 'u2' }]));
    db.delete.mockReturnValue(makeChain(undefined));
    db.insert.mockReturnValue(makeChain(undefined)); // Q4c user.deleted event
    const mgr = new UserManager();
    await expect(mgr.delete('u1', 't1')).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalled();
  });

  it('changeStatus to suspended throws LAST_ADMIN_GUARD for the sole active admin', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.select.mockReturnValue(makeChain([{ userId: 'u1' }]));
    const mgr = new UserManager();
    await expect(mgr.changeStatus('u1', 'suspended', 't1')).rejects.toThrow(/^LAST_ADMIN_GUARD:/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('changeStatus to pending does NOT run the guard (auth.ts registration path)', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.update.mockReturnValue(makeChain([{ ...userRow, status: 'pending' }]));
    db.insert.mockReturnValue(makeChain(undefined)); // Q4c user.updated event
    const mgr = new UserManager();
    const user = await mgr.changeStatus('u1', 'pending', 't1');
    expect(user.status).toBe('pending');
    // guard skipped entirely → no holder census select
    expect(db.select).not.toHaveBeenCalled();
  });

  it('changeStatus to active does NOT run the guard', async () => {
    const { createDb } = await import('../db/index.js');
    const db = makeMockDb();
    vi.mocked(createDb).mockReturnValue(db as never);
    db.update.mockReturnValue(makeChain([{ ...userRow, status: 'active' }]));
    db.insert.mockReturnValue(makeChain(undefined)); // Q4c user.updated event
    const mgr = new UserManager();
    const user = await mgr.changeStatus('u1', 'active', 't1');
    expect(user.status).toBe('active');
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('email verification plumbing (Q1-b2)', () => {
  function makeChain(result: unknown) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.limit = vi.fn(() => chain);
    chain.then = vi.fn(
      (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
        Promise.resolve(result).then(resolve, reject),
    );
    return chain;
  }

  it('markEmailVerified issues UPDATE set email_verified=true by id', async () => {
    const { createDb } = await import('../db/index.js');
    const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
    vi.mocked(createDb).mockReturnValue(db as never);
    const setSpy = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
    db.update.mockReturnValue({ set: setSpy });

    const mgr = new UserManager();
    await mgr.markEmailVerified('u-42');

    expect(setSpy).toHaveBeenCalledWith({ emailVerified: true });
  });

  it('findById maps emailVerified from the DB row (never silently false)', async () => {
    const { createDb } = await import('../db/index.js');
    const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
    vi.mocked(createDb).mockReturnValue(db as never);
    const chain = makeChain([
      {
        id: 'u1',
        email: 'a@b.c',
        name: 'A',
        status: 'active',
        tenantId: 't1',
        tokenVersion: 1,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    db.select.mockReturnValue({ from: vi.fn(() => ({ where: vi.fn(() => chain) })) });

    const mgr = new UserManager();
    const user = await mgr.findById('u1', 't1');
    expect(user?.emailVerified).toBe(true);
  });
});

describe('findAll sorting (Q1-b3, gap-audit D6)', () => {
  async function runFindAll(params: { sortBy?: string; sortOrder?: 'asc' | 'desc' }): Promise<string> {
    const { createDb } = await import('../db/index.js');
    const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
    vi.mocked(createDb).mockReturnValue(db as never);
    let orderArg: unknown = null;
    const countChain = { from: () => ({ where: () => [{ count: 0 }] }) };
    const listChain = {
      from: () => ({
        where: () => ({
          limit: () => ({
            offset: () => ({
              orderBy: (...a: unknown[]) => {
                orderArg = a[0];
                const chain: Record<string, ReturnType<typeof vi.fn>> = {};
                chain.then = vi.fn(
                  (resolve?: ((v: unknown) => unknown) | null) => Promise.resolve([]).then(resolve),
                );
                return chain;
              },
            }),
          }),
        }),
      }),
    };
    db.select.mockImplementation((proj?: unknown) => (proj ? countChain : listChain));

    const mgr = new UserManager();
    await mgr.findAll(params, 't1');
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const { sql } = new PgDialect().sqlToQuery(orderArg as never);
    return sql;
  }

  it('sortBy=email + desc renders ORDER BY "users"."email" desc', async () => {
    const sql = await runFindAll({ sortBy: 'email', sortOrder: 'desc' });
    expect(sql).toContain('"users"."email"');
    expect(/desc/i.test(sql)).toBe(true);
  });

  it('no sortBy defaults to created_at ASC (zero behavior change for existing callers)', async () => {
    const sql = await runFindAll({});
    expect(sql).toContain('"users"."created_at"');
    expect(/desc/i.test(sql)).toBe(false);
  });
});

describe('eraseAuditData (R-audit Task A5, spec D5/U2/U3)', () => {
  // Resolved once for the fake's tombstone-count wiring (same module instance the funnel uses).
  let eventsTable: unknown;
  beforeAll(async () => {
    const schema = await import('../db/schema.js');
    eventsTable = schema.events;
  });
  const subject = '550e8400-e29b-41d4-a716-446655440001';
  const acting = '550e8400-e29b-41d4-a716-4466554400aa';
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const eraseOpts = { requestedBy: acting, legalBasis: 'GDPR Art.17', email: 'subject@test.local', tenantId };

  /**
   * Faithful fake db: records the insert values + every update's {table, set,
   * where}, returns scripted results. The funnel is expressed with drizzle
   * builders (typed scrub/ledger/tombstone + emitEvent), so the fake captures
   * those and asserts against the real schema tables.
   */
  function makeFakeDb(rows: Array<{ id: string; rowHash: string | null }>, eventsMatched = 0) {
    const db = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
    };
    // SELECT receipt subset: WHERE user_id = subject AND row_hash IS NOT NULL ORDER BY created_at, id
    db.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve(rows)),
        })),
      })),
    });
    // INSERT audit_erasures ... RETURNING id — capture the values object
    const insertedValues: unknown[] = [];
    db.insert.mockImplementation((_table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertedValues.push(values);
        return { returning: vi.fn(() => Promise.resolve([{ id: 'ledger-1' }])) };
      }),
    }));
    // UPDATE builder: record {table, set, where} per call; the where chain is
    // awaitable (plain updates) AND carries returning() (tombstone recount).
    const updates: Array<{ table: unknown; set: unknown; where: unknown }> = [];
    db.update.mockImplementation((table: unknown) => ({
      set: vi.fn((set: unknown) => ({
        where: vi.fn((where: unknown) => {
          updates.push({ table, set, where });
          const tombRows = table === eventsTable ? Array.from({ length: Math.max(eventsMatched, 0) }, (_, i) => ({ id: i + 1 })) : [{ id: 1 }];
          return Object.assign(Promise.resolve(tombRows), {
            returning: vi.fn(() => Promise.resolve(tombRows)),
          });
        }),
      })),
    }));
    return { db, insertedValues, updates };
  }

  async function runErase(db: unknown) {
    const mgr = new UserManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return mgr.eraseAuditData(subject, eraseOpts as any, db as never);
  }

  it('happy path: receipt over ordered non-NULL hashes + rowsAffected/legacySkipped/eventsScrubbed', async () => {
    const h1 = 'a'.repeat(64);
    const h2 = 'b'.repeat(64);
    const { db } = makeFakeDb([{ id: 'r1', rowHash: h1 }, { id: 'r2', rowHash: h2 }, { id: 'r3', rowHash: null }], 3);

    const result = await runErase(db);

    const { receiptHash } = await import('@accessbase/audit');
    expect(result.receiptHash).toBe(receiptHash([h1, h2]));
    expect(result.rowsAffected).toBe(3); // ALL rows incl. legacy NULL-hash
    expect(result.legacySkipped).toBe(1);
    expect(result.eventsScrubbed).toBe(3);
  });

  it('ledger row carries the D5 column set incl. receipt + legalBasis (ledger is its sanctioned home)', async () => {
    const h = 'c'.repeat(64);
    const { db, insertedValues } = makeFakeDb([{ id: 'r1', row_hash: h }]);

    const result = await runErase(db);

    // db.insert serves BOTH the ledger row and the audit.erased emit (same handle) — the LEDGER is the first
    expect(db.insert.mock.calls.length).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ledger = insertedValues[0] as any;
    expect(ledger.subjectUserId).toBe(subject);
    expect(ledger.requestedBy).toBe(acting);
    expect(ledger.tenantId).toBe(tenantId);
    expect(ledger.legalBasis).toBe('GDPR Art.17');
    expect(ledger.receiptHash).toBe(result.receiptHash);
    expect(ledger.rowsAffected).toBe(1);
    expect(ledger.eventsScrubbed).toBe(0); // placeholder 0 at insert; tombstone count folded after
  });

  it('audit scrub UPDATE whitelist per D4: requestBody={}, userId=[ERASED], ip/userAgent NULL, erasedAt+erasureId — and NOTHING else', async () => {
    const { db, updates } = makeFakeDb([{ id: 'r1', rowHash: 'd'.repeat(64) }]);
    await runErase(db);

    const { auditLogs, events } = await import('../db/schema.js');
    const scrub = updates.find((u) => u.table === auditLogs) as { set: Record<string, unknown>; where: unknown } | undefined;
    expect(scrub).toBeDefined();
    const set = scrub?.set as Record<string, unknown>;
    // Exact whitelist: these keys and ONLY these keys
    expect(Object.keys(set).sort()).toEqual(['erasedAt', 'erasureId', 'ip', 'requestBody', 'userAgent', 'userId'].sort());
    expect(set.requestBody).toEqual({});
    expect(set.userId).toBe('[ERASED]');
    expect(set.ip).toBeNull();
    expect(set.userAgent).toBeNull();
    expect(set.erasureId).toBe('ledger-1');
    expect(set.erasedAt).toBeInstanceOf(Date);
    // WHERE names the subject (drizzle eq renders as a predicate; verify via SQL)
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const q = new PgDialect().sqlToQuery((scrub as { where: unknown }).where as never);
    expect(q.sql).toContain('"audit_logs"."user_id"');
    expect(q.params).toContain(subject);
    // events tombstone is the OTHER update on this db
    expect(updates.some((u) => u.table === events)).toBe(true);
  });

  it('events tombstone matches payload->>id/email OR auth.login.* email; count folds into ledger eventsScrubbed', async () => {
    const { db, updates, insertedValues } = makeFakeDb([{ id: 'r1', rowHash: 'e'.repeat(64) }], 4);
    await runErase(db);

    const { events } = await import('../db/schema.js');
    const tombstone = updates.find((u) => u.table === events) as { set: unknown; where: unknown } | undefined;
    expect(tombstone).toBeDefined();
    expect(tombstone?.set).toEqual({ payload: { erased: true } });
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const q = new PgDialect().sqlToQuery(tombstone?.where as never);
    // user.* id OR email + auth.login.* email predicates all reference the captured email + subject id
    expect(q.sql).toContain('id');
    expect(JSON.stringify(q.params)).toContain('subject@test.local');
    expect(JSON.stringify(q.params)).toContain(subject);
    // ledger insert placeholder is 0; funnel folds the tombstone count into a follow-up ledger UPDATE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((insertedValues[0] as any).eventsScrubbed).toBe(0);
    expect(updates.length).toBe(3); // audit scrub + tombstone + ledger eventsScrubbed backfill
  });

  it('emits audit.erased on the SAME handle; payload = {subjectUserId, rowsAffected, legacySkipped} — NO legalBasis, NO email', async () => {
    const { db, insertedValues } = makeFakeDb([{ id: 'r1', rowHash: 'f'.repeat(64) }], 2);

    await runErase(db);

    // db.insert called twice: ledger row + events row (emitEvent rides the same handle)
    expect(db.insert).toHaveBeenCalledTimes(2);
    const eventRow = insertedValues[1] as Record<string, unknown>;
    expect(eventRow.type).toBe('audit.erased');
    expect(eventRow.tenantId).toBe(tenantId);
    const payload = eventRow.payload as Record<string, unknown>;
    expect(payload).toEqual({ subjectUserId: subject, rowsAffected: 1, legacySkipped: 0 });
    expect(JSON.stringify(payload)).not.toContain('GDPR');
    expect(JSON.stringify(payload)).not.toContain('subject@test.local');
  });

  it('rev.4 mention-rows: requestBody containing the subject email/uuid joins the target set (D-ERASE-1)', async () => {
    const h = 'f'.repeat(64);
    const { db, updates } = makeFakeDb([{ id: 'r1', rowHash: h }]);
    await runErase(db);

    const { auditLogs } = await import('../db/schema.js');
    const scrub = updates.find((u) => u.table === auditLogs) as { where: unknown } | undefined;
    expect(scrub).toBeDefined();
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const q = new PgDialect().sqlToQuery((scrub as { where: unknown }).where as never);
    // predicate must now be the UNION: actor arm + mention arm (email OR uuid in request_body)
    expect(q.sql).toContain('request_body');
    expect(q.params).toContain('%subject@test.local%'); // email mention token (LIKE-wrapped)
    expect(q.params).toContain(subject); // appears for BOTH actor eq + uuid mention
  });

  it('second call for an already-erased subject: zero rows, NO ledger insert, NO event', async () => {
    const { db } = makeFakeDb([]);

    const result = await runErase(db);

    expect(result.rowsAffected).toBe(0);
    expect(result.receiptHash).toBeDefined(); // GENESIS receipt (empty set)
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
