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

# Check if Docker is available
has_docker() {
    if command -v docker &>/dev/null; then
        if docker info &>/dev/null 2>&1; then
            return 0
        fi
        # Try with sudo
        if sudo -n docker info &>/dev/null 2>&1; then
            export DOCKER_CMD="sudo docker"
            export DOCKER_COMPOSE_CMD="sudo docker compose"
            return 0
        fi
    fi
    return 1
}

# Get docker command (with or without sudo)
get_docker_cmd() {
    echo "${DOCKER_CMD:-docker}"
}

# Get docker compose command
get_docker_compose_cmd() {
    echo "${DOCKER_COMPOSE_CMD:-docker compose}"
}
