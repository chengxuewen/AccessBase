/**
 * Audit action types
 */
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED';

/**
 * Authorization provenance (4A T2, ruling D-2=A): WHY the action was
 * allowed/denied — the article's sixth audit field. IDENTIFIER-FREE by
 * contract: no subject/resource uuids here, because the RTBF erasure
 * mention-predicate scans only requestBody (panel run 1 S2-3 — a decision
 * carrying ids would survive erasure). The shape is part of the D1 row hash
 * via the null→undefined convention: legacy NULL-decision rows hash exactly
 * as before (canonicalJson drops undefined), present decisions are
 * tamper-evident.
 */
export interface AuditAuthzDecision {
  decision: 'allow' | 'deny';
  /** The permission code the gate evaluated (route mapping / apikey scope arm). */
  matchedCode: string;
  /** Data-scope binding when the code is scope-governed (users surface, v1). */
  scope?: string;
}

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
  responseStatus?: number;
  success: boolean;
  errorMessage?: string;

  /** 4A T2: authorization provenance — identifier-free (AuditAuthzDecision). */
  decision?: AuditAuthzDecision | undefined;
  }

/**
 * Full audit log row. Carries NO hash fields from the logger — the write path
 * (spec R-audit D4) seals rows at insert in the storage layer via rowHash,
 * which storage computes and persists; the logger only transports entries.
 */
export interface AuditLog extends AuditLogEntry {
  id: string;
  /** Set by the storage layer at insert (packages/audit/src/hashing.ts rowHash), never by the logger. */
  rowHash?: string;
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
    // lowercased compare against these (batch P W1-2/F3: oldPassword/newPassword/
    // flowToken camelCase bodies previously leaked to audit_logs in cleartext).
    fields: [
      'password',
      'token',
      'secret',
      'api_key',
      'credit_card',
      'plaintext',
      'accesstoken',
      'refreshtoken',
      'oldpassword',
      'newpassword',
      'flowtoken',
      'idplogouturl',
      'logouttoken',
    ],
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
