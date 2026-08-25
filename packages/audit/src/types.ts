/**
 * Audit action types
 */
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED';

/**
 * Audit log entry (without hash fields)
 */
export interface AuditLogEntry {
  // Actor
  userId: string;
  username: string;
  userIp: string;
  userAgent: string;

  // Operation
  action: AuditAction;
  resourceType: string;
  resourceId: string;

  // Details
  requestBody: Record<string, unknown>;
  responseBody?: Record<string, unknown>;

  // Context
  timestamp: Date;
  tenantId: string;
  requestId: string;

  // Result
  success: boolean;
  errorMessage?: string;
}

/**
 * Full audit log with integrity fields
 */
export interface AuditLog extends AuditLogEntry {
  id: string;
  hash: string;
  previousHash: string;
}

/**
 * Audit log filter for queries
 */
export interface AuditLogFilter {
  userId?: string;
  username?: string;
  action?: AuditAction | AuditAction[];
  resourceType?: string;
  resourceId?: string;
  tenantId?: string;
  requestId?: string;
  success?: boolean;
  startTime?: Date;
  endTime?: Date;
  page?: number;
  pageSize?: number;
  sortBy?: 'timestamp' | 'action' | 'resourceType';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Audit log query result
 */
export interface AuditLogQueryResult {
  data: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Integrity verification result
 */
export interface IntegrityResult {
  valid: boolean;
  totalChecked: number;
  firstBrokenIndex?: number;
  brokenEntries?: AuditLog[];
}

/**
 * Audit configuration
 */
export interface AuditConfig {
  enabled: boolean;
  level: 'all' | 'write' | 'auth' | 'config';

  storage: {
    tableName: string;
    archive: {
      enabled: boolean;
      retentionDays: number;
      archiveAfterDays: number;
    };
    indexes: string[];
  };

  async: {
    enabled: boolean;
    bufferSize: number;
    flushInterval: number;
  };

  sanitize: {
    enabled: boolean;
    fields: string[];
    replacement: string;
  };

  integrity: {
    enabled: boolean;
    verifyInterval: number;
    alertOnFailure: boolean;
  };

  export: {
    maxRows: number;
    formats: ('csv' | 'excel')[];
  };
}

/**
 * Default audit configuration
 */
export const defaultAuditConfig: AuditConfig = {
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
    enabled: true,
    bufferSize: 1000,
    flushInterval: 5000,
  },
  sanitize: {
    enabled: true,
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
