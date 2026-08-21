import type { HealthChecker, HealthCheckResult } from './types.js';
import { Pool } from 'pg';

/**
 * Database health checker
 */
export class DatabaseHealthChecker implements HealthChecker {
  readonly name = 'database';
  readonly type = 'readiness' as const;
  readonly enabled = true;
  readonly timeout = 5000;

  private readonly pool: Pool;

  constructor(connectionString: string, timeout?: number) {
    this.pool = new Pool({ connectionString, max: 2 });
    if (timeout !== undefined) {
      (this as { timeout: number }).timeout = timeout;
    }
  }

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        const poolInfo = {
          total: this.pool.totalCount,
          active: this.pool.totalCount - this.pool.idleCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount,
        };

        return {
          name: this.name,
          status: 'healthy',
          timestamp: new Date(),
          responseTime: Date.now() - start,
          details: { connection: true, query: true, pool: poolInfo },
        };
      } finally {
        client.release();
      }
    } catch (error) {
      return {
        name: this.name,
        status: 'unhealthy',
        timestamp: new Date(),
        responseTime: Date.now() - start,
        error: error instanceof Error ? error.message : 'Database connection failed',
      };
    }
  }
}

/**
 * Memory health checker
 */
export class MemoryHealthChecker implements HealthChecker {
  readonly name = 'memory';
  readonly type = 'liveness' as const;
  enabled = true;
  timeout = 1000;

  private readonly threshold: number;

  /**
   * @param threshold - Memory usage percentage threshold (0-100)
   */
  constructor(threshold = 90) {
    this.threshold = threshold;
  }

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    const total = process.memoryUsage();
    const heapUsedPercent = Math.round((total.heapUsed / total.heapTotal) * 100);

    const status = heapUsedPercent > this.threshold ? 'unhealthy' : 'healthy';

    return {
      name: this.name,
      status,
      timestamp: new Date(),
      responseTime: Date.now() - start,
      details: {
        rss: total.rss,
        heapTotal: total.heapTotal,
        heapUsed: total.heapUsed,
        heapUsedPercent,
        external: total.external,
      },
    };
  }
}
