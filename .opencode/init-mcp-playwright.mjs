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

// 2. Auto-install if missing — HARD GUARD (RA-1818-3, PIT-090 family):
// under MCP_NO_INSTALL=1 (exported by scripts/agents/mcp-launch.sh for the
// GUI host face) a missing binary is a FATAL error, NEVER a self-heal that
// mutates the dependency tree. Explicit path: bash accessbase.sh mcp setup.
if (!existsSync(mcpBin)) {
  if (process.env.MCP_NO_INSTALL === '1') {
    console.error('[playwright-mcp] binary missing and MCP_NO_INSTALL=1 — refusing to self-install (PIT-090). Run: bash accessbase.sh mcp setup')
    process.exit(1)
  }
  console.error('[playwright-mcp] Installing @playwright/mcp... (self-heal mutates the pnpm tree — see PIT-090; use mcp setup for reproducible installs)')
  const usePnpm = existsSync(join(projectRoot, 'pnpm-lock.yaml'))
  const installCmd = usePnpm
    ? 'pnpm add -wD @playwright/mcp'
    : 'npm install -D @playwright/mcp'
  execSync(installCmd, { cwd: projectRoot, stdio: 'inherit' })
}

// 3. Start MCP server (stdio inherited, opencode communicates via stdin/stdout)
// 4. Cleanup zombie processes (Unix only)
if (!isWin) {
  try { execSync("pkill -f 'ms-playwright/mcp-chrome'", { stdio: 'ignore' }) } catch {}
}

// 5. Start MCP server (stdio inherited, opencode communicates via stdin/stdout)
//    --isolated mode: browser starts on-demand per tool call, no persistent profile
//    --browser chromium: Playwright's bundled-browser family instead of the
//    system 'chrome' channel (the default fails on hosts without Google Chrome:
//    "Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome").
//    --executable-path: @playwright/mcp's OWN playwright (0.0.80 → 1.63-alpha)
//    ships NO ubuntu20.04 chromium build ("Playwright does not support chromium
//    on ubuntu20.04-x64"), so point it at the REPO's bundled chromium
//    (@playwright/test → chromium.executablePath(), e.g. chromium-1234) —
//    protocol-compatible, proven by scripts/agents/mcp-browser-probe.mjs.
//    Installed by `bash accessbase.sh mcp setup`; missing = fatal + explicit
//    pointer (never a silent fallback to the MCP's own un-installable build).
const { createRequire } = await import('node:module')
const repoRequire = createRequire(join(projectRoot, 'package.json'))
let repoChromium = null
try {
  repoChromium = repoRequire('@playwright/test').chromium.executablePath()
} catch {
  repoChromium = null
}
if (!repoChromium || !existsSync(repoChromium)) {
  console.error('[playwright-mcp] bundled chromium missing (' + repoChromium + ') — run: bash accessbase.sh mcp setup')
  process.exit(1)
}
const child = spawn(mcpBin, ['--isolated', '--browser', 'chromium', '--executable-path', repoChromium], { stdio: 'inherit' })
child.on('error', (err) => { console.error(err); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))
