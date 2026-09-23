/**
 * Database connection module for @accessbase/identity
 * Exports drizzle instance and schema
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

// Re-export schema for migration use
export * from './schema.js';
export { schema };

/**
 * Create a drizzle database instance from DATABASE_URL environment variable
 */
export function createDb(databaseUrl?: string) {
  const url = databaseUrl ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Q2a (F-F2): single bounded pool knob. Guarded parse: garbage/negative
  // falls back to 10 (a negative max makes pg-pool NEVER serve clients).
  const rawMax = Number(process.env['PG_POOL_MAX']);
  const max = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 10;
  const pool = new Pool({
    connectionString: url,
    max,
  });

  const db = drizzle(pool, { schema });
  dbPoolMap.set(db, pool);
  livePools.add(pool);
  return db;
}

/**
 * Type for the drizzle database instance
 */
export type DrizzleDB = ReturnType<typeof createDb>;

/**
 * Pools created by createDb, keyed by their drizzle instance. WeakMap so the
 * entry disappears with the db when a caller forgets closeDb (still leaks the
 * pool itself — call closeDb explicitly for every throwaway createDb).
 * Kept internal: Pool is a pg detail, not part of the drizzle surface.
 */
const dbPoolMap = new WeakMap<DrizzleDB, Pool>();

// Q2a (F-F1): STRONG registry of live pools for on-scrape metrics — bounded by
// the number of live dbs (closeDb removes), unlike the WeakMap it can be read.
const livePools = new Set<Pool>();

/** Aggregate pg-pool counters across all live pools (totalCount/idleCount/
 * waitingCount are sync getters on pg-pool). Null when none exist. */
export function getLivePoolStats(): { total: number; idle: number; waiting: number } | null {
  if (livePools.size === 0) return null;
  let total = 0;
  let idle = 0;
  let waiting = 0;
  for (const p of livePools) {
    total += p.totalCount;
    idle += p.idleCount;
    waiting += p.waitingCount;
  }
  return { total, idle, waiting };
}

/**
 * End the underlying pg Pool of a db created via createDb. A no-op for any
 * db that did not come from this module. Necessary because drizzle-orm 0.29's
 * node-postgres driver does not expose the pool as a typed property
 * (".$client" only arrived in later versions).
 */
export async function closeDb(db: DrizzleDB): Promise<void> {
  const pool = dbPoolMap.get(db);
  if (pool) {
    livePools.delete(pool);
    await pool.end();
  }
}

