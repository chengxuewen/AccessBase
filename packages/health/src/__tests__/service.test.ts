import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthCheckServiceImpl } from '../service.js';
import type { HealthChecker, HealthCheckResult } from '../types.js';

// Mock dependencies
vi.mock('@accessbase/logging', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('node:os', () => ({
  default: {
    totalmem: vi.fn(() => 1024 * 1024 * 1024), // 1GB
    freemem: vi.fn(() => 512 * 1024 * 1024), // 512MB
    cpus: vi.fn(() => [
      {
        model: 'Test CPU',
        times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 50 },
      },
    ]),
    platform: vi.fn(() => 'linux'),
    arch: vi.fn(() => 'x64'),
  },
}));

describe('HealthCheckServiceImpl', () => {
  let service: HealthCheckServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HealthCheckServiceImpl('1.0.0');
  });

  describe('constructor', () => {
    it('should initialize with provided version', () => {
      expect(service.getVersion()).toBe('1.0.0');
    });

    it('should use default version if not provided', () => {
      const defaultService = new HealthCheckServiceImpl();
      expect(defaultService.getVersion()).toBe('0.0.0');
    });
  });

  describe('register/unregister', () => {
    it('should register a health checker', async () => {
      const checker: HealthChecker = {
        name: 'test',
        type: 'liveness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockResolvedValue({
          name: 'test',
          status: 'healthy',
          timestamp: new Date(),
          responseTime: 5,
        }),
      };

      service.register(checker);
      const result = await service.check('test');
      expect(result).toBeDefined();
      expect(result.name).toBe('test');
    });

    it('should unregister a health checker', async () => {
      const checker: HealthChecker = {
        name: 'test',
        type: 'liveness',
        enabled: true,
        timeout: 1000,
        check: vi.fn(),
      };

      service.register(checker);
      service.unregister('test');

      const result = await service.check('test');
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Checker not found: test');
    });
  });

  describe('check', () => {
    it('should return unhealthy status for unknown checker', async () => {
      const result = await service.check('unknown');
      expect(result).toEqual({
        name: 'unknown',
        status: 'unhealthy',
        timestamp: expect.any(Date),
        responseTime: 0,
        error: 'Checker not found: unknown',
      });
    });

    it('should run registered checker and return result', async () => {
      const expectedResult: HealthCheckResult = {
        name: 'test',
        status: 'healthy',
        timestamp: new Date(),
        responseTime: 10,
        details: { connection: true },
      };

      const checker: HealthChecker = {
        name: 'test',
        type: 'liveness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockResolvedValue(expectedResult),
      };

      service.register(checker);
      const result = await service.check('test');

      expect(result).toEqual(expectedResult);
      expect(checker.check).toHaveBeenCalled();
    });

    it('should handle checker timeout', async () => {
      const checker: HealthChecker = {
        name: 'slow',
        type: 'liveness',
        enabled: true,
        timeout: 100, // 100ms timeout
        check: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200))),
      };

      service.register(checker);
      const result = await service.check('slow');

      expect(result.status).toBe('unhealthy');
      expect(result.error).toContain('timed out');
    });

    it('should handle checker throwing error', async () => {
      const checker: HealthChecker = {
        name: 'error',
        type: 'liveness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      service.register(checker);
      const result = await service.check('error');

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('checkAll', () => {
    it('should run all enabled checkers', async () => {
      const healthyChecker: HealthChecker = {
        name: 'healthy',
        type: 'liveness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockResolvedValue({
          name: 'healthy',
          status: 'healthy',
          timestamp: new Date(),
          responseTime: 5,
        }),
      };

      const degradedChecker: HealthChecker = {
        name: 'degraded',
        type: 'readiness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockResolvedValue({
          name: 'degraded',
          status: 'degraded',
          timestamp: new Date(),
          responseTime: 10,
        }),
      };

      const disabledChecker: HealthChecker = {
        name: 'disabled',
        type: 'liveness',
        enabled: false,
        timeout: 1000,
        check: vi.fn(),
      };

      service.register(healthyChecker);
      service.register(degradedChecker);
      service.register(disabledChecker);

      const report = await service.checkAll();

      expect(report.status).toBe('degraded');
      expect(report.checks).toHaveLength(2);
      expect(report.version).toBe('1.0.0');
      expect(report.system).toBeDefined();
      expect(report.system.nodeVersion).toBe(process.version);
      expect(report.system.os).toBe('linux');
      expect(report.system.arch).toBe('x64');
      expect(report.system.memory.total).toBe(1024 * 1024 * 1024);
      expect(report.system.cpu.cores).toBe(1);
      expect(report.system.cpu.model).toBe('Test CPU');
    });

    it('should return unhealthy if any checker is unhealthy', async () => {
      const healthyChecker: HealthChecker = {
        name: 'healthy',
        type: 'liveness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockResolvedValue({
          name: 'healthy',
          status: 'healthy',
          timestamp: new Date(),
          responseTime: 5,
        }),
      };

      const unhealthyChecker: HealthChecker = {
        name: 'unhealthy',
        type: 'readiness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockResolvedValue({
          name: 'unhealthy',
          status: 'unhealthy',
          timestamp: new Date(),
          responseTime: 10,
          error: 'Database down',
        }),
      };

      service.register(healthyChecker);
      service.register(unhealthyChecker);

      const report = await service.checkAll();

      expect(report.status).toBe('unhealthy');
      expect(report.checks).toHaveLength(2);
    });

    it('should return healthy if all checkers are healthy', async () => {
      const checker: HealthChecker = {
        name: 'test',
        type: 'liveness',
        enabled: true,
        timeout: 1000,
        check: vi.fn().mockResolvedValue({
          name: 'test',
          status: 'healthy',
          timestamp: new Date(),
          responseTime: 5,
        }),
      };

      service.register(checker);

      const report = await service.checkAll();

      expect(report.status).toBe('healthy');
      expect(report.checks).toHaveLength(1);
    });

    it('should return healthy if no checkers registered', async () => {
      const report = await service.checkAll();

      expect(report.status).toBe('healthy');
      expect(report.checks).toHaveLength(0);
    });
  });

  describe('getSystemInfo', () => {
    it('should return system information', () => {
      const systemInfo = service.getSystemInfo();

      expect(systemInfo).toEqual({
        nodeVersion: process.version,
        os: 'linux',
        arch: 'x64',
        memory: {
          total: 1024 * 1024 * 1024,
          free: 512 * 1024 * 1024,
          used: 512 * 1024 * 1024,
          usedPercentage: 50,
        },
        cpu: {
          cores: 1,
          model: 'Test CPU',
          usage: expect.any(Number),
        },
      });
    });
  });

  describe('getUptime', () => {
    it('should return uptime in seconds', () => {
      const uptime = service.getUptime();
      expect(uptime).toBeGreaterThanOrEqual(0);
      expect(typeof uptime).toBe('number');
    });
  });
});
