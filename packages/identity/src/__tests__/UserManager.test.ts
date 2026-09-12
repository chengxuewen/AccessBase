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
});
