#!/usr/bin/env bash
# bootstrap.sh — First-time setup for AccessBase development
# Usage: source bootstrap.sh
set -euo pipefail

START_TIME=$(date +%s)
BOOTSTRAP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${BOOTSTRAP_DIR}/scripts/_common.sh"

echo "================================================"
echo "  AccessBase Development Environment Bootstrap"
echo "================================================"
echo ""

# Step 1: Install Node.js via nvm
echo "[1/4] Checking Node.js..."
if command -v node &>/dev/null; then
    echo "  Node.js $(node --version) found"
else
    echo "  Installing nvm + Node.js 22..."
    export NVM_DIR="$HOME/.nvm"
    if [ ! -d "$NVM_DIR" ]; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
    fi
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm use 22
    echo "  Node.js $(node --version) installed"
fi

# Step 2: Install pnpm
echo "[2/4] Checking pnpm..."
if command -v pnpm &>/dev/null; then
    echo "  pnpm $(pnpm --version) found"
else
    echo "  Installing pnpm..."
    npm install -g pnpm@9
    echo "  pnpm $(pnpm --version) installed"
fi

# Step 3: Install dependencies
echo "[3/4] Installing dependencies..."
cd "${PROJECT_ROOT}"
pnpm install
echo "  Dependencies installed"

# Step 3.5: activate repo-owned git hooks (a fresh clone has NO hooks —
# RCH PIT-250 lesson; the hook itself is best-effort, agents check verifies)
git config core.hooksPath .githooks
echo "  Git hooks activated (core.hooksPath=.githooks)"

# Step 3.6: rebuild per-machine generated host layers (fresh clone has none —
# the root cause of the ADJ-7f fresh-clone red). Warning-only, non-fatal: the
# gates re-verify on the next commit regardless.
echo "[3.6] Rebuilding generated host layers (agents sync)..."
if command -v node &>/dev/null && node -e 'process.exit(parseInt(process.versions.node) >= 22.6 ? 0 : 1)' 2>/dev/null; then
    node scripts/agents/agent-links.mts sync || echo "  agents sync failed (non-fatal — run it manually: node scripts/agents/agent-links.mts sync)"
else
    echo "  SKIPPED (needs node >= 22.6) — run: node scripts/agents/agent-links.mts sync"
fi

# Step 4: Start dev services
echo "[4/4] Starting development services..."
if command -v docker &>/dev/null; then
    docker compose -f docker-compose.dev.yml up -d 2>/dev/null || echo "  Docker services skipped (docker not running)"
else
    echo "  Docker not found, skipping dev services"
fi

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "================================================"
echo "  AccessBase environment ready! (${ELAPSED}s)"
echo "================================================"
echo ""
echo "Next steps:"
echo "  ./accessbase.sh dev       # Start dev servers"
echo "  ./accessbase.sh test      # Run tests"
echo "  ./accessbase.sh build     # Build all packages"
echo "  ./accessbase.sh docker    # Build Docker image"
