#!/usr/bin/env bash
# _ports.sh — Port conflict detection utilities for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

# Check if a port is in use (cross-platform: Linux + macOS)
# Args: $1=port, $2=service_name
# Returns: 0=free, 1=in_use
check_port_available() {
    local port=$1
    local service=$2

    # Use lsof (works on both Linux and macOS)
    if command -v lsof &>/dev/null; then
        local pid
        pid=$(lsof -ti :"$port" 2>/dev/null | head -1)
        if [ -n "$pid" ]; then
            local proc
            proc=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
            log_error "Port $port already in use (needed for $service)"
            log_error "  Process: $proc (PID: $pid)"
            log_error "  Fix: kill $pid or set ${service^^}_PORT=<other>"
            return 1
        fi
    elif command -v ss &>/dev/null; then
        if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
            local pid
            pid=$(ss -tlnp 2>/dev/null | grep ":${port} " | sed 's/.*pid=\([0-9]*\).*/\1/' | head -1)
            local proc
            proc=$(ps -p "${pid:-0}" -o comm= 2>/dev/null || echo "unknown")
            log_error "Port $port already in use (needed for $service)"
            log_error "  Process: $proc (PID: ${pid:-unknown})"
            log_error "  Fix: kill ${pid:-<PID>} or set ${service^^}_PORT=<other>"
            return 1
        fi
    fi

    return 0
}

# Detect all required ports, exit on conflict
detect_required_ports() {
    local pg_port="${PG_PORT:-5432}"
    local redis_port="${REDIS_PORT:-6379}"
    local server_port="${SERVER_PORT:-5101}"
    local ui_port="${UI_PORT:-5173}"

    local has_conflict=0

    check_port_available "$pg_port" "PostgreSQL" || has_conflict=1
    check_port_available "$redis_port" "Redis" || has_conflict=1
    check_port_available "$server_port" "Server" || has_conflict=1
    check_port_available "$ui_port" "Admin UI" || has_conflict=1

    if [ $has_conflict -ne 0 ]; then
        log_error "Port conflicts detected. Resolve before starting."
        exit 1
    fi
}