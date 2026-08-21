#!/usr/bin/env node
// init-mcp-drizzle.mjs — Drizzle ORM MCP startup wrapper
// Provides AI with DB schema introspection, migration generation, query execution
// Package: @iflow-mcp/defrex-drizzle-mcp v1.0.0
import { execSync, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const isWin = process.platform === 'win32'

// 1. Locate or auto-install @iflow-mcp/defrex-drizzle-mcp
const pkgName = '@iflow-mcp/defrex-drizzle-mcp'
const binName = isWin ? 'iflow-mcp_defrex-drizzle-mcp.cmd' : 'iflow-mcp_defrex-drizzle-mcp'
const binPath = join(projectRoot, 'node_modules', '.bin', binName)

if (!existsSync(binPath)) {
  console.error(`[drizzle-mcp] Installing ${pkgName}...`)
  const usePnpm = existsSync(join(projectRoot, 'pnpm-lock.yaml'))
  const installCmd = usePnpm
    ? `pnpm add -wD ${pkgName}`
    : `npm install --registry=https://registry.npmjs.org/ -D ${pkgName}`
  execSync(installCmd, { cwd: projectRoot, stdio: 'inherit' })
}

// 2. Ensure placeholder drizzle config exists (MCP stays alive in standalone mode)
// Phase 1a will replace this with real drizzle.config.ts
const configPath = join(projectRoot, 'drizzle.config.ts')
if (!existsSync(configPath)) {
  const placeholder = `// drizzle.config.ts — placeholder for Drizzle MCP (Phase 1a)\nimport { defineConfig } from 'drizzle-kit'\nexport default defineConfig({\n  dialect: 'postgresql',\n  schema: './packages/*/src/db/schema.ts',\n  out: './drizzle',\n  dbCredentials: { url: process.env.DATABASE_URL || 'postgres://localhost:5432/audebase' },\n})\n`
  writeFileSync(configPath, placeholder, 'utf-8')
  console.error('[drizzle-mcp] Created placeholder drizzle.config.ts')
}

// 3. Start MCP server (stdio mode for IDE integration)
const child = spawn(binPath, ['--cwd', projectRoot, configPath], { stdio: 'inherit' })
child.on('error', (err) => { console.error(`[drizzle-mcp] spawn error:`, err.message); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))
