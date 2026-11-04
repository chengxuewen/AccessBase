#!/usr/bin/env bash
# mcp-launch — MCP entry for GUI hosts (plan Batch 4; RCH PIT-86 lesson: GUI
# hosts may spawn outside the repo root and without ~/.pixi/bin on PATH).
# Usage: mcp-launch.sh <init-script.mjs>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$HOME/.pixi/bin:$PATH"
cd "$ROOT"
exec pixi run node "$1"
