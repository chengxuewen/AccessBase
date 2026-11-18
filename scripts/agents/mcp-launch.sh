#!/usr/bin/env bash
# mcp-launch — MCP entry for GUI hosts (plan Batch 4; RCH PIT-86 lesson: GUI
# hosts may spawn outside the repo root and without ~/.pixi/bin on PATH).
# 2026-11-18 (serena plan C): converted to the RCH pure-passthrough form —
#   mcp-launch.sh node .opencode/init-x.mjs        (npm servers)
#   mcp-launch.sh -e serena mcp-serena             (pixi servers)
# Plus two RCH-measured lessons as cheap stdio insurance: NO_PROXY for
# localhost (enterprise proxies hijacking local probes) and a TMPDIR
# writability probe (sandboxed pixi activation fails silently without it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$HOME/.pixi/bin:$PATH"
export NO_PROXY="localhost,127.0.0.1,::1${NO_PROXY:+,$NO_PROXY}"
export no_proxy="$NO_PROXY"
cd "$ROOT"

if [ -n "${TMPDIR:-}" ] && [ ! -w "${TMPDIR:-/nonexistent}" ]; then
  echo "mcp-launch: TMPDIR ($TMPDIR) is not writable — pixi activation will fail silently" >&2
  exit 1
fi

exec pixi run "$@"
