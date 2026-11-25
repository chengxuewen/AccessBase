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

// 5. Browser + launch contract (2026-11-25, D136)
//    Resolution lives in the RECORD written by `bash accessbase.sh mcp setup`
//    (out/mcp-browser.json, atomic write). Browser selection is driven by ENV
//    here — NEVER by CLI flags: flags outrank envs (`cliOptions.x ?? env`), so
//    a baked-in `--browser` would block every env-driven fallback.
//    The record is authoritative: missing/unreadable/mode-less = fatal with a
//    setup pointer. The launcher must NOT retry the install ladder — on a
//    dropped host that retry only produces a misleading "unsupported OS" error.
import { readFileSync } from 'node:fs'
const recordPath = join(projectRoot, 'out', 'mcp-browser.json')
let resolution = null
try {
  resolution = JSON.parse(readFileSync(recordPath, 'utf8')).resolutions?.['local-playwright'] ?? null
} catch {
  resolution = null
}
if (!resolution || !resolution.mode) {
  console.error(
    '[playwright-mcp] browser record missing/unreadable (out/mcp-browser.json) — run: bash accessbase.sh mcp setup',
  )
  process.exit(1)
}
// Symmetric env handoff: export the record's selector, UNSET the other — a
// stale shell value must never override the record.
const childEnv = { ...process.env }
delete childEnv.PLAYWRIGHT_MCP_BROWSER
delete childEnv.PLAYWRIGHT_MCP_EXECUTABLE_PATH
if (resolution.mode === 'playwright') {
  childEnv.PLAYWRIGHT_MCP_BROWSER = resolution.browser
} else if (resolution.mode === 'system') {
  childEnv.PLAYWRIGHT_MCP_EXECUTABLE_PATH = resolution.executable
} else {
  console.error(
    `[playwright-mcp] browser unresolved (mode '${resolution.mode}') — run: bash accessbase.sh mcp setup`,
  )
  process.exit(1)
}
// PATH prepend: npm bin shims start with `#!/usr/bin/env node` — an ancient
// GUI-inherited node must never win over the node running this launcher.
childEnv.PATH = join(process.execPath, '..') + (isWin ? ';' : ':') + (childEnv.PATH ?? '')

const args = [
  '--isolated',
  // always absolute: the server's default `./.playwright-mcp` would pollute the
  // CWD (repo root). The server creates this dir recursively; out/ is gitignored.
  '--output-dir',
  join(projectRoot, 'out', 'local-playwright', 'mcp'),
]
// Headless rule: the server forces headless only when DISPLAY is unset (it does
// NOT look at WAYLAND_DISPLAY), so a Wayland-only host needs the explicit flag.
// Escape hatches: MCP_HEADLESS_FORCE=1 / MCP_HEADED_FORCE=1.
const wantsHeadless =
  process.env.MCP_HEADLESS_FORCE === '1' ||
  (process.env.MCP_HEADED_FORCE !== '1' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
if (wantsHeadless) args.push('--headless')

const child = spawn(mcpBin, args, { stdio: 'inherit', env: childEnv })
child.on('error', (err) => { console.error(err); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))
