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

  return drizzle(pool, { schema });
}

/**
 * Type for the drizzle database instance
 */
export type DrizzleDB = ReturnType<typeof createDb>;
