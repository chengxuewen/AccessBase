/**
 * LockoutService — account lockout counters + manual IP blacklist (Phase 6b Task 5).
 *
 * Redis-backed (get/set/del structural subset) with in-memory Map fallback for
 * tests / redis-less installs. Same counter pattern for both: failures count in
 * a sliding-fixed window; reaching the threshold locks until the window ends.
 * IP blacklist is manual-only for now — no auto-blacklist wiring.
 */
import type { RedisLike } from './redis.js';

export const MAX_FAILURES = 5;
export const WINDOW_SECONDS = 900;

export interface LockoutOptions {
  maxFailures?: number;
  windowSeconds?: number;
  redis?: RedisLike | null;
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export class LockoutService {
  private readonly redis: RedisLike | null;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly maxFailures: number;
  private readonly windowSeconds: number;

  constructor(opts: LockoutOptions = {}) {
    this.redis = opts.redis ?? null;
    this.maxFailures = opts.maxFailures ?? MAX_FAILURES;
    this.windowSeconds = opts.windowSeconds ?? WINDOW_SECONDS;
  }

  /** Count a failed attempt. Returns current failure count. */
  async recordFailure(identifier: string): Promise<number> {
    const key = `lockout:${identifier}`;
    const current = await this.getInt(key);
    const next = current + 1;
    await this.setEx(key, String(next), this.windowSeconds);
    return next;
  }

  /** True while the failure window is live AND the threshold was reached. */
  async isLocked(identifier: string): Promise<boolean> {
    return (await this.getInt(`lockout:${identifier}`)) >= this.maxFailures;
  }

  /** Clear failures after a successful login. */
  async clear(identifier: string): Promise<void> {
    await this.delete(`lockout:${identifier}`);
  }

  /** Manually blacklist an IP. ttl defaults to the lockout window. */
  async blacklistIp(ip: string, ttlSeconds = this.windowSeconds): Promise<void> {
    await this.setEx(`bl:${ip}`, '1', ttlSeconds);
  }

  async isIpBlacklisted(ip: string): Promise<boolean> {
    return (await this.getInt(`bl:${ip}`)) >= 1;
  }

  // ---- storage: redis first, memory fallback; both entries carry expiry ----

  private async getInt(key: string): Promise<number> {
    const raw = this.redis ? await this.redis.get(key).catch(() => null) : null;
    if (raw === null || raw === undefined) return this.memGet(key);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        // fall through to memory
      }
    }
    this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  private async delete(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch {
        // fall through
      }
    }
    this.memory.delete(key);
  }

  private memGet(key: string): number {
    const entry = this.memory.get(key);
    if (!entry) return 0;
    if (Date.now() > entry.expiresAt) {
      this.memory.delete(key);
      return 0;
    }
    return Number(entry.value) || 0;
  }
}
