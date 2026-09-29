import type { AuditLog, AuditLogEntry, AuditConfig } from './types.js';
import { logger } from '@accessbase/logging';

/**
 * Storage abstraction for audit persistence. Implementations receive entries
 * WITHOUT hash fields — sealing (createdAt + rowHash) happens at insert in the
 * storage layer (spec R-audit D4).
 */
export interface AuditStorage {
  write(entries: AuditLog[]): Promise<void>;
}

/**
 * Storage options for AuditLogger
 */
export interface AuditLoggerOptions {
  storage?: AuditStorage;
}

/**
 * AuditLogger class for recording write operations
 */
export class AuditLogger {
  private config: AuditConfig;
  private logger: typeof logger;
  private storage: AuditStorage | null;
  private buffer: AuditLogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config: AuditConfig, options: AuditLoggerOptions = {}) {
    this.config = config;
    this.logger = logger;
    this.storage = options.storage ?? null;

    // No storage configured → writeToStorage falls back to console (test env).
    if (config.async.enabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Log an audit entry
   */
  async log(entry: AuditLogEntry): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    if (!this.shouldAudit(entry.action)) {
      return;
    }

    const sanitizedEntry = this.sanitizeEntry(entry);

    if (this.config.async.enabled) {
      this.buffer.push(sanitizedEntry);

      if (this.buffer.length >= this.config.async.bufferSize) {
        await this.flushBuffer();
      }
    } else {
      await this.writeToStorage({ ...sanitizedEntry, id: this.generateId() });
    }
  }

  /**
   * Log multiple entries in batch
   */
  async logBatch(entries: AuditLogEntry[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const filteredEntries = entries.filter((entry) => this.shouldAudit(entry.action));

    if (filteredEntries.length === 0) {
      return;
    }

    if (this.config.async.enabled) {
      this.buffer.push(...filteredEntries);

      if (this.buffer.length >= this.config.async.bufferSize) {
        await this.flushBuffer();
      }
    } else {
      for (const entry of filteredEntries) {
        await this.log(entry);
      }
    }
  }

  /**
   * Flush the async buffer
   */
  async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const entriesToFlush = [...this.buffer];
    this.buffer = [];

    try {
      // Batch write via storage when configured; console fallback otherwise
      if (this.storage) {
        const entries = entriesToFlush.map((entry) => ({
          ...entry,
          id: this.generateId(),
        }));
        await this.storage.write(entries);
      } else {
        for (const entry of entriesToFlush) {
          await this.writeToStorage({ ...entry, id: this.generateId() });
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, entries: entriesToFlush.length },
        'Failed to flush audit buffer',
      );
      // Re-add entries to buffer for retry
      this.buffer.unshift(...entriesToFlush);
    }
  }

  /**
   * Check if action should be audited based on config level
   */
  private shouldAudit(action: AuditLogEntry['action']): boolean {
    switch (this.config.level) {
      case 'all':
        return true;
      case 'write':
        return ['CREATE', 'UPDATE', 'DELETE'].includes(action);
      case 'auth':
        return ['LOGIN', 'LOGOUT', 'LOGIN_FAILED'].includes(action);
      case 'config':
        return action === 'UPDATE'; // Assuming config changes are UPDATE actions
      default:
        return true;
    }
  }

  /**
   * Sanitize entry by redacting sensitive fields
   */
  private sanitizeEntry(entry: AuditLogEntry): AuditLogEntry {
    if (!this.config.sanitize.enabled) {
      return entry;
    }

    // Request side carries OTP/TOTP `code` (secret); response envelopes carry a
    // legitimate non-secret `code` — extras apply to the request body only (batch P W1-2).
    const sanitizedRequestBody = this.redactFields(entry.requestBody, ['code']);
    const sanitizedResponseBody = entry.responseBody
      ? this.redactFields(entry.responseBody)
      : undefined;

    return {
      ...entry,
      requestBody: sanitizedRequestBody,
      responseBody: sanitizedResponseBody,
    };
  }

  /**
   * Redact sensitive fields from an object. `extras` extends the base field
   * list for this call only (and threads through recursion).
   */
  private redactFields(
    obj: Record<string, unknown>,
    extras: readonly string[] = [],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const normalized = key.toLowerCase();
      if (this.config.sanitize.fields.includes(normalized) || extras.includes(normalized)) {
        result[key] = this.config.sanitize.replacement;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.redactFields(value as Record<string, unknown>, extras);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Generate a unique ID for audit log
   */
  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Persist one entry: storage (drizzle/memory) when configured, console fallback otherwise.
   */
  protected async writeToStorage(entry: AuditLog): Promise<void> {
    if (this.storage) {
      await this.storage.write([entry]);
      return;
    }

    this.logger.info(
      {
        audit: true,
        id: entry.id,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        userId: entry.userId,
        tenantId: entry.tenantId,
        success: entry.success,
      },
      'Audit log entry',
    );
  }

  /**
   * Start the flush timer for async mode
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      await this.flushBuffer();
    }, this.config.async.flushInterval);
  }

  /**
   * Stop the flush timer and flush remaining entries
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flushBuffer();
  }
}
