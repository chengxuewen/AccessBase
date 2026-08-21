#!/usr/bin/env node
// init-mcp-antd.mjs — Ant Design MCP startup wrapper
// Provides AI with component docs, props, examples, changelogs for antd 5
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const isWin = process.platform === 'win32'

// 1. Locate or auto-install @jzone-mcp/antd-components-mcp (v1 = antd 5)
const pkgName = '@jzone-mcp/antd-components-mcp'
const binName = isWin ? 'antd-components-mcp.cmd' : 'antd-components-mcp'
const binPath = join(projectRoot, 'node_modules', '.bin', binName)

if (!existsSync(binPath)) {
  console.error(`[antd-mcp] Installing ${pkgName}@1...`)
  const usePnpm = existsSync(join(projectRoot, 'pnpm-lock.yaml'))
  const installCmd = usePnpm
    ? `pnpm add -wD ${pkgName}@1`
    : `npm install -D ${pkgName}@1`
  execSync(installCmd, { cwd: projectRoot, stdio: 'inherit' })
}

// 2. Start MCP server (stdio mode for IDE integration)
const child = spawn(binPath, [], { stdio: 'inherit' })
child.on('error', (err) => { console.error(err); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))
