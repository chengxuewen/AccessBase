#!/usr/bin/env bash
# stop.sh — Stop all deploy mode services
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

# Ensure pixi native env binaries are on PATH
export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$HOME/.pixi/bin:$PATH"

DATA_DIR="${PROJECT_ROOT}/data"
PIDFILE="${DATA_DIR}/.pids"
PG_DATA="${DATA_DIR}/pg"
REDIS_PORT="${REDIS_PORT:-6379}"
PG_PORT="${PG_PORT:-5432}"

# Kill server via PID file
if [ -f "$PIDFILE" ]; then
  while IFS= read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -15 "$pid" 2>/dev/null || true
    fi
  done < "$PIDFILE"
  rm -f "$PIDFILE"
fi

# Stop PostgreSQL
if [ -f "$PG_DATA/PG_VERSION" ] && pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
  pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
fi

# Stop Redis
redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true

log_ok "All services stopped"
