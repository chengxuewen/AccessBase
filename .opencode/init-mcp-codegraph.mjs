#!/usr/bin/env node
// init-mcp-codegraph.mjs — CodeGraph MCP startup wrapper (cross-platform)
// Auto-detects Node.js environment, starts codegraph MCP server
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const isWin = process.platform === 'win32'

// 1. Locate codegraph binary
const binName = isWin ? 'codegraph.cmd' : 'codegraph'
const codegraphBin = join(projectRoot, 'node_modules', '.bin', binName)

// 2. Auto-install if missing — HARD GUARD (RA-1818-3, PIT-090 family):
// under MCP_NO_INSTALL=1 (exported by scripts/agents/mcp-launch.sh for the
// GUI host face) a missing binary is a FATAL error, NEVER a self-heal that
// mutates the dependency tree. Explicit path: bash accessbase.sh mcp setup.
if (!existsSync(codegraphBin)) {
  if (process.env.MCP_NO_INSTALL === '1') {
    console.error('[codegraph] binary missing and MCP_NO_INSTALL=1 — refusing to self-install (PIT-090). Run: bash accessbase.sh mcp setup')
    process.exit(1)
  }
  console.error('[codegraph] Installing @colbymchenry/codegraph... (self-heal mutates the pnpm tree — see PIT-090; use mcp setup for reproducible installs)')
  const usePnpm = existsSync(join(projectRoot, 'pnpm-lock.yaml'))
  const installCmd = usePnpm
    ? 'pnpm add -wD @colbymchenry/codegraph'
    : 'npm install -D @colbymchenry/codegraph'
  execSync(installCmd, { cwd: projectRoot, stdio: 'inherit' })
}

// 3. Start MCP server
const child = spawn(codegraphBin, ['serve', '--mcp'], { stdio: 'inherit' })
child.on('error', (err) => { console.error(err); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))