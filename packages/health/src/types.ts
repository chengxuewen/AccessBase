/**
 * Health status
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

/**
 * Health check result
 */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  timestamp: Date;
  responseTime: number;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * System info
 */
export interface SystemInfo {
  nodeVersion: string;
  os: string;
  arch: string;
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercentage: number;
  };
  cpu: {
    cores: number;
    model: string;
    usage: number;
  };
}

/**
 * Health report
 */
export interface HealthReport {
  status: HealthStatus;
  timestamp: Date;
  version: string;
  uptime: number;
  checks: HealthCheckResult[];
  system: SystemInfo;
}

/**
 * Health checker interface
 */
export interface HealthChecker {
  name: string;
  type: 'liveness' | 'readiness' | 'startup';
  check(): Promise<HealthCheckResult>;
  enabled: boolean;
  timeout: number;
}

/**
 * Health check service interface
 */
export interface HealthCheckService {
  register(checker: HealthChecker): void;
  unregister(name: string): void;
  checkAll(): Promise<HealthReport>;
  check(name: string): Promise<HealthCheckResult>;
  getSystemInfo(): SystemInfo;
  getVersion(): string;
  getUptime(): number;
}

/**
 * Health check plugin options
 */
export interface HealthCheckOptions {
  /** Base path for health endpoints (default: /health) */
  path?: string;
  /** Enable detailed report on /health */
  detailed?: boolean;
  /** Custom checkers to register */
  checkers?: HealthChecker[];
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** App version */
  version?: string;
}

/**
 * Health check lifecycle hooks
 */
export interface HealthCheckLifecycle {
  onBeforeCheck?: (name: string) => Promise<void>;
  onAfterCheck?: (result: HealthCheckResult) => Promise<void>;
  onCheckError?: (name: string, error: Error) => Promise<void>;
  onStatusChange?: (name: string, oldStatus: HealthStatus, newStatus: HealthStatus) => Promise<void>;
}
