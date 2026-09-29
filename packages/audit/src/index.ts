/**
 * @accessbase/audit - Audit logging for AccessBase
 *
 * Records all security-sensitive operations with integrity verification.
 */

export { AuditLogger } from './logger.js';
export type { AuditStorage, AuditLoggerOptions } from './logger.js';
export { canonicalJson, rowHash, foldRoot, receiptHash, GENESIS } from './hashing.js';
export type { AuditRowFields } from './hashing.js';

export { createAuditMiddleware, auditAuthEvent, auditConfigChange } from './middleware.js';

export type {
  AuditAction,
  AuditLogEntry,
  AuditLog,
  AuditLogFilter,
  AuditLogQueryResult,
  IntegrityResult,
  AuditConfig,
} from './types.js';

export { defaultAuditConfig } from './types.js';
