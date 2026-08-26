#!/usr/bin/env bash
# pg-stop.sh — Stop PostgreSQL for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

PG_DATA="${PROJECT_ROOT}/.pixi/data/pg"
PG_PORT="${PG_PORT:-5432}"

pg_stop() {
    if ! pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
        log_info "PostgreSQL not running"
        return 0
    fi

    log_info "Stopping PostgreSQL..."
    pg_ctl -D "$PG_DATA" stop -m fast
    log_ok "PostgreSQL stopped"
}

pg_stop