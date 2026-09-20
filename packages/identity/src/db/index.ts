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

  const pool = new Pool({
    connectionString: url,
  });

  const db = drizzle(pool, { schema });
  dbPoolMap.set(db, pool);
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

/**
 * End the underlying pg Pool of a db created via createDb. A no-op for any
 * db that did not come from this module. Necessary because drizzle-orm 0.29's
 * node-postgres driver does not expose the pool as a typed property
 * (".$client" only arrived in later versions).
 */
export async function closeDb(db: DrizzleDB): Promise<void> {
  const pool = dbPoolMap.get(db);
  if (pool) {
    await pool.end();
  }
}

