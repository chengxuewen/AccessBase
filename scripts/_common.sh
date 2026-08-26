#!/usr/bin/env bash
# _common.sh — Shared functions for AccessBase scripts
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Ensure Node.js is available
ensure_node() {
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        \. "$NVM_DIR/nvm.sh"
    fi
    if ! command -v node &>/dev/null; then
        log_error "Node.js not found. Run: source bootstrap.sh"
        exit 1
    fi
}

# Ensure pnpm is available
ensure_pnpm() {
    if ! command -v pnpm &>/dev/null; then
        log_error "pnpm not found. Run: npm install -g pnpm@9"
        exit 1
    fi
}

# Ensure pixi is available (native mode dependency)
ensure_pixi() {
    export PATH="$HOME/.pixi/bin:$PATH"
    if ! command -v pixi &>/dev/null; then
        log_error "pixi not found. Install: curl -fsSL https://pixi.sh/install.sh | bash"
        exit 1
    fi
    # Also add native env binaries to PATH (initdb, pg_ctl, redis-server)
    export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$PATH"
}

# Auto-configure DATABASE_URL/REDIS_URL for native mode
configure_native_urls() {
    local pg_port="${PG_PORT:-5432}"
    local redis_port="${REDIS_PORT:-6379}"

    if [ -z "${DATABASE_URL:-}" ]; then
        export DATABASE_URL="postgresql://accessbase:accessbase_dev@localhost:${pg_port}/accessbase"
        log_info "DATABASE_URL auto-set to localhost:${pg_port}"
    else
        log_info "DATABASE_URL already set: ${DATABASE_URL%%@*}@..."
    fi

    if [ -z "${REDIS_URL:-}" ]; then
        export REDIS_URL="redis://localhost:${redis_port}"
        log_info "REDIS_URL auto-set to localhost:${redis_port}"
    else
        log_info "REDIS_URL already set: $REDIS_URL"
    fi
}


# Check if Docker is available
has_docker() {
    command -v docker &>/dev/null
}

# Get docker command (with or without sudo)
get_docker_cmd() {
    if docker info &>/dev/null 2>&1; then
        echo "docker"
    elif sudo -n docker info &>/dev/null 2>&1; then
        echo "sudo docker"
    else
        echo "sudo docker"
    fi
}

# Get docker compose command
get_docker_compose_cmd() {
    if docker info &>/dev/null 2>&1; then
        echo "docker compose"
    elif sudo -n docker info &>/dev/null 2>&1; then
        echo "sudo docker compose"
    else
        echo "sudo docker compose"
    fi
}
