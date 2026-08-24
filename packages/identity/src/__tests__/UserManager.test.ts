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
