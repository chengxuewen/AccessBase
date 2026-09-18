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
