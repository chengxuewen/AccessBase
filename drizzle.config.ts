// drizzle.config.ts — placeholder for Drizzle MCP (Phase 1a)
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/*/src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgres://localhost:5432/audebase' },
})
