import type {
  HealthCheckService,
  HealthChecker,
  HealthReport,
  HealthCheckResult,
  SystemInfo,
  HealthStatus,
} from './types.js';
import { createLogger } from '@accessbase/logging';
import os from 'node:os';

const startTime = Date.now();

/**
 * Health check service implementation
 */
export class HealthCheckServiceImpl implements HealthCheckService {
  private readonly checkers = new Map<string, HealthChecker>();
  private readonly logger = createLogger({ level: 'info' });
  private readonly version: string;

  constructor(version: string = '0.0.0') {
    this.version = version;
  }

  register(checker: HealthChecker): void {
    this.checkers.set(checker.name, checker);
    this.logger.debug(`Registered health checker: ${checker.name}`);
  }

  unregister(name: string): void {
    this.checkers.delete(name);
    this.logger.debug(`Unregistered health checker: ${name}`);
  }

  async checkAll(): Promise<HealthReport> {
    const enabledCheckers = [...this.checkers.values()].filter((c) => c.enabled);
    const results = await Promise.all(enabledCheckers.map((c) => this.runChecker(c)));

    const overallStatus = this.calculateOverallStatus(results);

    return {
      status: overallStatus,
      timestamp: new Date(),
      version: this.version,
      uptime: this.getUptime(),
      checks: results,
      system: this.getSystemInfo(),
    };
  }

  async check(name: string): Promise<HealthCheckResult> {
    const checker = this.checkers.get(name);
    if (!checker) {
      return {
        name,
        status: 'unhealthy',
        timestamp: new Date(),
        responseTime: 0,
        error: `Checker not found: ${name}`,
      };
    }
    return this.runChecker(checker);
  }

  getSystemInfo(): SystemInfo {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();

    return {
      nodeVersion: process.version,
      os: os.platform(),
      arch: os.arch(),
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usedPercentage: Math.round((usedMem / totalMem) * 100),
      },
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model ?? 'unknown',
        usage: this.getCpuUsage(),
      },
    };
  }

  getVersion(): string {
    return this.version;
  }

  getUptime(): number {
    return Math.floor((Date.now() - startTime) / 1000);
  }

  private async runChecker(checker: HealthChecker): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const result = await Promise.race([checker.check(), this.timeout(checker.timeout)]);
      return result;
    } catch (error) {
      return {
        name: checker.name,
        status: 'unhealthy',
        timestamp: new Date(),
        responseTime: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Health check timed out after ${ms}ms`)), ms);
    });
  }

  private calculateOverallStatus(results: HealthCheckResult[]): HealthStatus {
    const statuses = results.map((r) => r.status);
    if (statuses.includes('unhealthy')) return 'unhealthy';
    if (statuses.includes('degraded')) return 'degraded';
    return 'healthy';
  }

  private getCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    return Math.round(((totalTick - totalIdle) / totalTick) * 100);
  }
}
