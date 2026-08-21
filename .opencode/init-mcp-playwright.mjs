#!/usr/bin/env node
// init-mcp-playwright.mjs — Playwright MCP startup wrapper (cross-platform)
// Auto-checks dependencies, starts MCP server
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const isWin = process.platform === 'win32'

// 1. Locate playwright-mcp binary
const binName = isWin ? 'playwright-mcp.cmd' : 'playwright-mcp'
const mcpBin = join(projectRoot, 'node_modules', '.bin', binName)

// 2. Auto-install if missing
if (!existsSync(mcpBin)) {
  console.error('[playwright-mcp] Installing @playwright/mcp...')
  const usePnpm = existsSync(join(projectRoot, 'pnpm-lock.yaml'))
  const installCmd = usePnpm
    ? 'pnpm add -wD @playwright/mcp'
    : 'npm install -D @playwright/mcp'
  execSync(installCmd, { cwd: projectRoot, stdio: 'inherit' })
}

// 3. Start MCP server (stdio inherited, opencode communicates via stdin/stdout)
//    --isolated mode: browser starts on-demand per tool call, no pre-installed chromium needed
// 4. Cleanup zombie processes (Unix only)
if (!isWin) {
  try { execSync("pkill -f 'ms-playwright/mcp-chrome'", { stdio: 'ignore' }) } catch {}
}

// 5. Start MCP server (stdio inherited, opencode communicates via stdin/stdout)
const child = spawn(mcpBin, ['--isolated'], { stdio: 'inherit' })
child.on('error', (err) => { console.error(err); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))