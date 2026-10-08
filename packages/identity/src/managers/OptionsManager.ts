/**
 * OptionsManager - Runtime configuration with env > option > default priority.
 *
 * R-A cross-node coherence: every write announces through a publish hook so
 * OTHER nodes drop their per-process caches (ab:options:invalidate channel,
 * wired server-side in options-coherence.ts on the cache-coherence.ts
 * pattern). Redis absent => hook never registered => silent single-node mode.
 */
import { eq } from 'drizzle-orm';
import { logger } from '@accessbase/logging';
import { createDb, type DrizzleDB } from '../db/index.js';
import { options } from '../db/schema.js';

export interface OptionEntry {
  key: string;
  value: unknown;
  updatedAt: Date;
}

// ponytail: per-process cache; R-A adds Redis pub/sub invalidation (publish
// hook below) instead of deleting the cache — listAll/list get hot on the
// request path.

/**
 * R-A: server boot registers a redis-publisher so OTHER nodes drop their
 * per-process caches too (cross-node coherence without changing the
 * manager's constructor shape or adding a redis dep to identity).
 */
export type OptionsPublishHook = () => void;
let publishHook: OptionsPublishHook | undefined;
export function setOptionsPublishHook(hook: OptionsPublishHook | undefined): void {
  publishHook = hook;
}

export class OptionsManager {
  private readonly db: DrizzleDB;
  private cache: OptionEntry[] | null = null;

  constructor(databaseUrl?: string | DrizzleDB) {
    this.db =
      typeof databaseUrl === 'string' || databaseUrl === undefined
        ? createDb(databaseUrl)
        : databaseUrl;
  }

  async listAll(): Promise<OptionEntry[]> {
    const rows = await this.load();
    return [...rows];
  }

  async get<T>(key: string, envValue: T | undefined, defaultValue: T): Promise<T> {
    if (envValue !== undefined) {
      logger.debug({ key, source: 'env' }, 'option resolved');
      return envValue;
    }

    const rows = await this.load();
    const row = rows.find((r) => r.key === key);
    if (row) {
      logger.debug({ key, source: 'option' }, 'option resolved');
      return row.value as T;
    }

    logger.debug({ key, source: 'default' }, 'option resolved');
    return defaultValue;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(options)
      .values({ key, value })
      .onConflictDoUpdate({
        target: options.key,
        set: { value, updatedAt: new Date() },
      });
    this.cache = null;
    publishHook?.();
  }

  /** Insert only if the key does not exist yet (used by setup config: first write wins). */
  async setIfAbsent(key: string, value: unknown): Promise<void> {
    await this.db.insert(options).values({ key, value }).onConflictDoNothing();
    this.cache = null;
    publishHook?.();
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(options).where(eq(options.key, key));
    this.cache = null;
    publishHook?.();
  }

  /**
   * Drop the local cache. fromRemote:true marks a pub/sub-delivered drop so
   * the subscriber never republishes (loop prevention, permission-cache
   * precedent). With no per-key granularity today the whole cache drops.
   */
  invalidate(opts?: { fromRemote?: boolean }): void {
    this.cache = null;
    if (!opts?.fromRemote) publishHook?.();
  }

  private async load(): Promise<OptionEntry[]> {
    if (!this.cache) {
      this.cache = await this.db.select().from(options);
    }
    return this.cache;
  }
}