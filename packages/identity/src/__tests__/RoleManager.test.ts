import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { RoleManager } from '../managers/RoleManager.js';
import { logger } from '@accessbase/logging';

const mockLogger = vi.mocked(logger);

describe('RoleManager', () => {
  let roleManager: RoleManager;

  beforeEach(() => {
    vi.clearAllMocks();
    roleManager = new RoleManager();
  });

  describe('constructor', () => {
    it('should create RoleManager instance', () => {
      expect(roleManager).toBeDefined();
      expect(roleManager).toBeInstanceOf(RoleManager);
    });
  });

  describe('API surface', () => {
    it('should export RoleManager class', () => {
      expect(typeof RoleManager).toBe('function');
    });

    it('should have create method', () => {
      expect(typeof roleManager.create).toBe('function');
    });

    it('should have findById method', () => {
      expect(typeof roleManager.findById).toBe('function');
    });

    it('should have findAll method', () => {
      expect(typeof roleManager.findAll).toBe('function');
    });

    it('should have update method', () => {
      expect(typeof roleManager.update).toBe('function');
    });

    it('should have delete method', () => {
      expect(typeof roleManager.delete).toBe('function');
    });

    it('should have setParent method', () => {
      expect(typeof roleManager.setParent).toBe('function');
    });

    it('should have resolveInheritedPermissions method', () => {
      expect(typeof roleManager.resolveInheritedPermissions).toBe('function');
    });

    it('should have assignToUser method', () => {
      expect(typeof roleManager.assignToUser).toBe('function');
    });

    it('should have revokeFromUser method', () => {
      expect(typeof roleManager.revokeFromUser).toBe('function');
    });

    it('should have getUserRoles method', () => {
      expect(typeof roleManager.getUserRoles).toBe('function');
    });
  });
});
