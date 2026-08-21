/**
 * Migration phase
 */
export type MigrationPhase = 'preload' | 'postsync' | 'postload';

/**
 * Migration file interface
 */
export interface MigrationFile {
  version: string;
  name: string;
  phase: MigrationPhase;
  up(db: Database): Promise<void>;
  down(db: Database): Promise<void>;
}

/**
 * Database interface for migrations
 */
export interface Database {
  execute(sql: string): Promise<void>;
  query<T>(sql: string): Promise<T[]>;
}

/**
 * Migration status
 */
export interface MigrationStatus {
  version: string;
  name: string;
  phase: MigrationPhase;
  status: 'pending' | 'running' | 'completed' | 'failed';
  executedAt?: Date;
  duration?: number;
  error?: string;
}

/**
 * Migration manager interface
 */
export interface MigrationManager {
  up(): Promise<void>;
  down(): Promise<void>;
  downTo(version: string): Promise<void>;
  status(): Promise<MigrationStatus[]>;
  generate(name: string, phase?: MigrationPhase): Promise<string>;
  validate(): Promise<ValidationResult>;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  file: string;
  message: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  file: string;
  message: string;
}

/**
 * Migration error
 */
export interface MigrationError {
  code: string;
  message: string;
  details?: {
    version?: string;
    phase?: MigrationPhase;
    sql?: string;
    stack?: string;
  };
}

/**
 * Migration configuration
 */
export interface MigrationConfig {
  database: {
    url: string;
    ssl?: boolean;
    maxConnections?: number;
  };
  migrations: {
    directory: string;
    tableName: string;
    lockTimeout: number;
  };
  backup: {
    enabled: boolean;
    directory: string;
    retentionDays: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
}

/**
 * Migration lifecycle hooks
 */
export interface MigrationLifecycle {
  onBeforeMigrate?: (version: string) => Promise<void>;
  onAfterMigrate?: (version: string, duration: number) => Promise<void>;
  onMigrateError?: (version: string, error: Error) => Promise<void>;
  onBeforeRollback?: (version: string) => Promise<void>;
  onAfterRollback?: (version: string) => Promise<void>;
  onBeforeBackup?: () => Promise<void>;
  onAfterBackup?: (backupPath: string) => Promise<void>;
}
