import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: '../identity/src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ||
      'postgresql://accessbase:accessbase_dev@localhost:5432/accessbase',
  },
});
