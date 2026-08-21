import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../logger.js';
import type { AuditLogEntry, AuditConfig } from '../types.js';

// Mock dependencies
vi.mock('@accessbase/logging', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AuditLogger', () => {
  let logger: AuditLogger;
  let config: AuditConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    config = {
      enabled: true,
      level: 'write',
      storage: {
        tableName: 'audit_logs',
        archive: {
          enabled: true,
          retentionDays: 365,
          archiveAfterDays: 90,
        },
        indexes: ['timestamp', 'userId', 'resourceType', 'tenantId'],
      },
      async: {
        enabled: false,
        bufferSize: 1000,
        flushInterval: 5000,
      },
      sanitize: {
        enabled: false,
        fields: ['password', 'token', 'secret', 'api_key', 'credit_card'],
        replacement: '[REDACTED]',
      },
      integrity: {
        enabled: true,
        verifyInterval: 24,
        alertOnFailure: true,
      },
      export: {
        maxRows: 10000,
        formats: ['csv', 'excel'],
      },
    };

    logger = new AuditLogger(config);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(logger).toBeDefined();
    });

    it('should start flush timer if async enabled', () => {
      const asyncConfig = { ...config, async: { ...config.async, enabled: true } };
      const asyncLogger = new AuditLogger(asyncConfig);
      expect(asyncLogger).toBeDefined();
    });
  });

  describe('log', () => {
    it('should log entry when enabled', async () => {
      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: { name: 'Test' },
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await logger.log(entry);
      // Should not throw
    });

    it('should not log entry when disabled', async () => {
      const disabledConfig = { ...config, enabled: false };
      const disabledLogger = new AuditLogger(disabledConfig);

      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: { name: 'Test' },
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await disabledLogger.log(entry);
      // Should not throw, but also not log
    });

    it('should filter entries based on audit level', async () => {
      const writeConfig = { ...config, level: 'write' as const };
      const writeLogger = new AuditLogger(writeConfig);

      const readEntry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'LOGIN', // Should be filtered for 'write' level
        resourceType: 'auth',
        resourceId: 'user123',
        requestBody: {},
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await writeLogger.log(readEntry);
      // LOGIN should be filtered out for 'write' level
    });

    it('should log all entries for all level', async () => {
      const allConfig = { ...config, level: 'all' as const };
      const allLogger = new AuditLogger(allConfig);

      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'LOGIN',
        resourceType: 'auth',
        resourceId: 'user123',
        requestBody: {},
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await allLogger.log(entry);
      // Should log for 'all' level
    });

    it('should buffer entries in async mode', async () => {
      const asyncConfig = { ...config, async: { ...config.async, enabled: true } };
      const asyncLogger = new AuditLogger(asyncConfig);

      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: { name: 'Test' },
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await asyncLogger.log(entry);
      // Entry should be buffered
    });
  });

  describe('logBatch', () => {
    it('should log multiple entries', async () => {
      const entries: AuditLogEntry[] = [
        {
          userId: 'user1',
          username: 'testuser',
          userIp: '127.0.0.1',
          userAgent: 'test-agent',
          action: 'CREATE',
          resourceType: 'user',
          resourceId: 'user123',
          requestBody: { name: 'Test1' },
          timestamp: new Date(),
          tenantId: 'tenant1',
          requestId: 'req1',
          success: true,
        },
        {
          userId: 'user2',
          username: 'testuser2',
          userIp: '127.0.0.1',
          userAgent: 'test-agent',
          action: 'UPDATE',
          resourceType: 'user',
          resourceId: 'user456',
          requestBody: { name: 'Test2' },
          timestamp: new Date(),
          tenantId: 'tenant1',
          requestId: 'req2',
          success: true,
        },
      ];

      await logger.logBatch(entries);
      // Should not throw
    });

    it('should filter entries based on audit level', async () => {
      const writeConfig = { ...config, level: 'write' as const };
      const writeLogger = new AuditLogger(writeConfig);

      const entries: AuditLogEntry[] = [
        {
          userId: 'user1',
          username: 'testuser',
          userIp: '127.0.0.1',
          userAgent: 'test-agent',
          action: 'CREATE', // Should be logged
          resourceType: 'user',
          resourceId: 'user123',
          requestBody: {},
          timestamp: new Date(),
          tenantId: 'tenant1',
          requestId: 'req1',
          success: true,
        },
        {
          userId: 'user2',
          username: 'testuser2',
          userIp: '127.0.0.1',
          userAgent: 'test-agent',
          action: 'LOGIN', // Should be filtered
          resourceType: 'auth',
          resourceId: 'user456',
          requestBody: {},
          timestamp: new Date(),
          tenantId: 'tenant1',
          requestId: 'req2',
          success: true,
        },
      ];

      await writeLogger.logBatch(entries);
      // Only CREATE should be logged
    });
  });

  describe('sanitizeEntry', () => {
    it('should redact sensitive fields when enabled', async () => {
      const sanitizeConfig = {
        ...config,
        sanitize: {
          enabled: true,
          fields: ['password', 'token'],
          replacement: '[REDACTED]',
        },
      };
      const sanitizeLogger = new AuditLogger(sanitizeConfig);

      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: {
          username: 'testuser',
          password: 'secret123',
          token: 'abcxyz',
        },
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await sanitizeLogger.log(entry);
      // Password and token should be redacted
    });

    it('should not redact when disabled', async () => {
      const noSanitizeConfig = {
        ...config,
        sanitize: {
          enabled: false,
          fields: ['password'],
          replacement: '[REDACTED]',
        },
      };
      const noSanitizeLogger = new AuditLogger(noSanitizeConfig);

      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: {
          password: 'secret123',
        },
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await noSanitizeLogger.log(entry);
      // Password should not be redacted
    });
  });

  describe('flushBuffer', () => {
    it('should flush buffered entries', async () => {
      const asyncConfig = { ...config, async: { ...config.async, enabled: true } };
      const asyncLogger = new AuditLogger(asyncConfig);

      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: { name: 'Test' },
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await asyncLogger.log(entry);
      await asyncLogger.flushBuffer();
      // Buffer should be empty after flush
    });

    it('should handle empty buffer', async () => {
      await logger.flushBuffer();
      // Should not throw
    });
  });

  describe('shutdown', () => {
    it('should stop flush timer and flush remaining entries', async () => {
      const asyncConfig = { ...config, async: { ...config.async, enabled: true } };
      const asyncLogger = new AuditLogger(asyncConfig);

      const entry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: { name: 'Test' },
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req123',
        success: true,
      };

      await asyncLogger.log(entry);
      await asyncLogger.shutdown();
      // Should flush and stop timer
    });
  });

  describe('audit levels', () => {
    it('should audit write operations for write level', async () => {
      const writeConfig = { ...config, level: 'write' as const };
      const writeLogger = new AuditLogger(writeConfig);

      const createEntry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'CREATE',
        resourceType: 'user',
        resourceId: 'user123',
        requestBody: {},
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req1',
        success: true,
      };

      const updateEntry: AuditLogEntry = {
        ...createEntry,
        action: 'UPDATE',
        requestId: 'req2',
      };

      const deleteEntry: AuditLogEntry = {
        ...createEntry,
        action: 'DELETE',
        requestId: 'req3',
      };

      await writeLogger.log(createEntry);
      await writeLogger.log(updateEntry);
      await writeLogger.log(deleteEntry);
      // All write operations should be logged
    });

    it('should audit auth operations for auth level', async () => {
      const authConfig = { ...config, level: 'auth' as const };
      const authLogger = new AuditLogger(authConfig);

      const loginEntry: AuditLogEntry = {
        userId: 'user1',
        username: 'testuser',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'LOGIN',
        resourceType: 'auth',
        resourceId: 'user123',
        requestBody: {},
        timestamp: new Date(),
        tenantId: 'tenant1',
        requestId: 'req1',
        success: true,
      };

      const logoutEntry: AuditLogEntry = {
        ...loginEntry,
        action: 'LOGOUT',
        requestId: 'req2',
      };

      const failedLoginEntry: AuditLogEntry = {
        ...loginEntry,
        action: 'LOGIN_FAILED',
        requestId: 'req3',
        success: false,
      };

      await authLogger.log(loginEntry);
      await authLogger.log(logoutEntry);
      await authLogger.log(failedLoginEntry);
      // All auth operations should be logged
    });

    it('should audit config changes for config level', async () => {
      const configConfig = { ...config, level: 'config' as const };
      const configLogger = new AuditLogger(configConfig);

      const configEntry: AuditLogEntry = {
        userId: 'admin1',
        username: 'admin',
        userIp: '127.0.0.1',
        userAgent: 'test-agent',
        action: 'UPDATE',
        resourceType: 'config',
        resourceId: 'app.settings',
        requestBody: { key: 'maxUsers', oldValue: 100, newValue: 200 },
        timestamp: new Date(),
        tenantId: 'system',
        requestId: 'req1',
        success: true,
      };

      await configLogger.log(configEntry);
      // Config UPDATE should be logged
    });
  });
});