#!/usr/bin/env node
// License: MIT
// Requires: POSTGRES_MCP_CONNECTION_STRING environment variable
// init-mcp-postgres.mjs — PostgreSQL MCP startup wrapper (cross-platform)
// Uses @vitalyostanin/postgres-mcp package for PostgreSQL database access via MCP
// Connection is configured through the POSTGRES_MCP_CONNECTION_STRING env var
// Example: postgresql://user:password@localhost:5432/database
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isWin = process.platform === 'win32'

// 1. Check POSTGRES_MCP_CONNECTION_STRING is set
if (!process.env.POSTGRES_MCP_CONNECTION_STRING) {
  console.error('[postgres-mcp] ERROR: POSTGRES_MCP_CONNECTION_STRING environment variable is not set.')
  console.error('[postgres-mcp] Set it to your PostgreSQL connection string, e.g.:')
  console.error('[postgres-mcp]   export POSTGRES_MCP_CONNECTION_STRING=postgresql://user:pass@localhost:5432/db')
  process.exit(1)
}

// 2. Check package is installed; install if missing
const pkgDir = join(__dirname, 'node_modules', '@vitalyostanin', 'postgres-mcp')
if (!existsSync(pkgDir)) {
  console.error('[postgres-mcp] Installing @vitalyostanin/postgres-mcp...')
  execSync('pnpm add -D @vitalyostanin/postgres-mcp', { cwd: __dirname, stdio: 'inherit' })
}

// 3. Launch MCP server via npx
// Using npx -y ensures the binary is found even in pnpm's strict node_modules layout
const child = spawn('npx', ['-y', '@vitalyostanin/postgres-mcp'], { stdio: 'inherit' })
child.on('error', (err) => { console.error(err); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))
