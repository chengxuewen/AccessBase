#!/usr/bin/env bash
# redis-stop.sh — Stop Redis for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

REDIS_PORT="${REDIS_PORT:-6379}"

redis_stop() {
    if ! redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
        log_info "Redis not running"
        return 0
    fi

    log_info "Stopping Redis..."
    redis-cli -p "$REDIS_PORT" shutdown nosave
    log_ok "Redis stopped"
}

redis_stop