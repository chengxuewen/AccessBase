import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: '../identity/src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env['DATABASE_URL'] || 'postgresql://accessbase:accessbase_dev@localhost:5432/accessbase',
  },
});
