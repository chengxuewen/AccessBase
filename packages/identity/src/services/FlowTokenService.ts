/**
 * FlowTokenService - single-use short-lived tokens for multi-step flows
 * (MFA challenge, email verification, password reset hand-off). Phase 6b Task 2.
 *
 * issue(purpose, payload, ttl) → opaque random token
 * consume(token, purpose)      → payload | null (single-use; purpose mismatch
 *                                still burns the token)
 *
 * Storage: redis `flow:{token}` when a RedisLike is supplied, in-memory Map
 * with lazy TTL sweep otherwise. Redis errors fall back to the in-memory map
 * — never throw to the caller for storage hiccups (single instance scope).
 */
import { randomBytes } from 'node:crypto';
import type { RedisLike } from './redis.js';
import { logger } from '@accessbase/logging';

const DEFAULT_TTL_SECONDS = 300;
const KEY_PREFIX = 'flow:';

interface FlowRecord {
  purpose: string;
  payload: unknown;
  expiresAt: number;
}

export class FlowTokenService {
  private readonly redis: RedisLike | null;
  private readonly memory = new Map<string, FlowRecord>();

  constructor(redis?: RedisLike) {
    this.redis = redis ?? null;
  }

  async issue(
    purpose: string,
    payload: unknown,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const record: FlowRecord = {
      purpose,
      payload,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };

    let stored = false;
    if (this.redis) {
      try {
        await this.redis.set(KEY_PREFIX + token, JSON.stringify(record));
        stored = true;
      } catch (err) {
        logger.warn({ err }, 'FlowToken redis write failed, using in-memory fallback');
      }
    }
    if (!stored) {
      this.memory.set(token, record);
      this.sweepExpired();
    }
    return token;
  }

  async consume<T = unknown>(token: string, purpose: string): Promise<T | null> {
    let record: FlowRecord | null = null;
    let fromRedis = false;

    if (this.redis) {
      try {
        const raw = await this.redis.get(KEY_PREFIX + token);
        if (raw !== null) {
          await this.redis.del(KEY_PREFIX + token); // single-use: burn first
          record = JSON.parse(raw) as FlowRecord;
          fromRedis = true;
        }
      } catch (err) {
        logger.warn({ err }, 'FlowToken redis read failed, checking in-memory fallback');
      }
    }

    if (!fromRedis) {
      const local = this.memory.get(token) ?? null;
      if (local) this.memory.delete(token);
      record = local;
    }

    if (!record) return null;
    if (record.expiresAt <= Date.now()) return null;
    if (record.purpose !== purpose) return null; // token already burned above

    return record.payload as T;
  }

  /** ponytail: sweep-on-write; fine for flow tokens, cron if volume ever matters */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [token, rec] of this.memory) {
      if (rec.expiresAt <= now) this.memory.delete(token);
    }
  }
}
