#!/usr/bin/env bash
# pg-start.sh — Start PostgreSQL for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

PG_DATA="${PROJECT_ROOT}/.pixi/data/pg"
PG_PORT="${PG_PORT:-5432}"

pg_start() {
    if pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
        log_ok "PostgreSQL already running on port $PG_PORT"
        return 0
    fi

    if [ ! -f "$PG_DATA/PG_VERSION" ]; then
        log_error "PG not initialized. Run: bash scripts/native/pg-init.sh"
        exit 1
    fi

    log_info "Starting PostgreSQL on port $PG_PORT..."
    pg_ctl -D "$PG_DATA" -l "$PG_DATA/logfile" -w start

    for i in {1..30}; do
        if pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
            log_ok "PostgreSQL ready on port $PG_PORT"
            return 0
        fi
        sleep 1
    done

    log_error "PostgreSQL failed to start"
    exit 1
}

pg_start