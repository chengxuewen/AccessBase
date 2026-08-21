#!/usr/bin/env node
// init-lsp-wrap.mjs — LSP command wrapper
// Usage: node init-lsp-wrap.mjs <command> [args...]
// Checks if LSP server is installed, auto-installs if missing, then spawns the server process

import { execSync, spawn } from 'node:child_process'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

// Command → npm package mapping (for npm-installable LSPs)
const NPM_MAP = {
  'typescript-language-server': 'typescript-language-server',
  'pyright-langserver': 'pyright',
  'bash-language-server': 'bash-language-server',
  'vscode-html-language-server': 'vscode-langservers-extracted',
  'remark-language-server': 'remark-language-server',
}

function has(cmd) {
  try {
    execSync(`${isWin ? 'where' : 'command -v'} ${cmd}`, { stdio: 'ignore' })
    return true
  } catch { return false }
}

function ensureInstalled(cmd) {
  if (has(cmd)) return true

  // npm-based LSPs
  if (cmd in NPM_MAP) {
    const pkg = NPM_MAP[cmd]
    if (!has('npm')) {
      console.error(`[init-lsp-wrap] Cannot install ${pkg}: npm not found`)
      return false
    }
    console.error(`[init-lsp-wrap] Installing ${pkg} ...`)
    try {
      execSync(`npm install -g ${pkg}`, { stdio: 'inherit' })
      if (has(cmd)) return true
    } catch {}
    console.error(`[init-lsp-wrap] Failed to install ${pkg}`)
    return false
  }


  // rust-analyzer — rustup
  if (cmd === 'rust-analyzer') {
    if (has('rustup')) {
      try { execSync('rustup component add rust-analyzer', { stdio: 'inherit' }); if (has('rust-analyzer')) return true } catch {}
    }
    console.error('[init-lsp-wrap] rust-analyzer not found. Install via: https://rustup.rs')
    return false
  }

  // gopls — go install
  if (cmd === 'gopls') {
    if (has('go')) {
      try { execSync('go install golang.org/x/tools/gopls@latest', { stdio: 'inherit' }); if (has('gopls')) return true } catch {}
    }
    console.error('[init-lsp-wrap] gopls not found. Install Go first: https://go.dev/dl/')
    return false
  }

  // clangd — mise or brew
  if (cmd === 'clangd') {
    if (has('mise')) {
      try { execSync('mise install clangd', { stdio: 'inherit' }); if (has('clangd')) return true } catch {}
    }
    if (isMac && has('brew')) {
      try { execSync('brew install llvm', { stdio: 'inherit' }); } catch {}
    }
    console.error('[init-lsp-wrap] clangd not found. Install via mise or brew.')
    return false
  }

  console.error(`[init-lsp-wrap] Unknown LSP command: ${cmd}`)
  return false
}

// --- Main ---
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node init-lsp-wrap.mjs <command> [args...]')
  process.exit(1)
}

const cmd = args[0]
const cmdArgs = args.slice(1)

if (!ensureInstalled(cmd)) {
  console.error(`[init-lsp-wrap] ${cmd} is not available. LSP will not start.`)
  process.exit(1)
}

// Spawn the LSP server, inheriting stdio for LSP protocol communication
const child = spawn(cmd, cmdArgs, { stdio: 'inherit' })

child.on('exit', (code) => {
  process.exit(code ?? 1)
})

child.on('error', (err) => {
  console.error(`[init-lsp-wrap] Failed to spawn ${cmd}:`, err.message)
  process.exit(1)
})
