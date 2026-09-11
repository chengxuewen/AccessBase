/**
 * OptionsManager - Runtime configuration with env > option > default priority.
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

// ponytail: per-process cache; multi-instance deployments need Redis pub/sub invalidation
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
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(options).where(eq(options.key, key));
    this.cache = null;
  }

  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<OptionEntry[]> {
    if (!this.cache) {
      this.cache = await this.db.select().from(options);
    }
    return this.cache;
  }
}