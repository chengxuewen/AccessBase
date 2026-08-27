#!/usr/bin/env bash
# start.sh — Start AccessBase in deploy mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

# Load .env if exists
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a; source "${PROJECT_ROOT}/.env"; set +a
fi

OUT_DIR="${PROJECT_ROOT}/out"
DATA_DIR="${PROJECT_ROOT}/data"
PG_DATA="${DATA_DIR}/pg"
REDIS_DATA="${DATA_DIR}/redis"
PIDFILE="${DATA_DIR}/.pids"
PG_PORT="${PG_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
SERVER_PORT="${PORT:-5101}"

# === Pre-flight checks ===

# Check out/ exists
if [ ! -d "$OUT_DIR/server" ]; then
  log_error "out/server/ not found. Run 'bash accessbase.sh build:deploy' first."
  exit 1
fi

# Validate production requirements
if [ "${NODE_ENV:-}" = "production" ]; then
  if [ -z "${JWT_SECRET:-}" ] || [ "$JWT_SECRET" = "dev-secret-do-not-use-in-production" ]; then
    log_error "JWT_SECRET must be set to a secure value in production"
    exit 1
  fi
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    log_error "ADMIN_PASSWORD must be set in production"
    exit 1
  fi
fi

# Port conflict detection
if command -v lsof &>/dev/null; then
  for port in $PG_PORT $REDIS_PORT $SERVER_PORT; do
    if lsof -ti :"$port" >/dev/null 2>&1; then
      log_error "Port $port already in use. Stop other services first."
      exit 1
    fi
  done
fi

# === Initialize data directories ===
mkdir -p "$PG_DATA" "$REDIS_DATA"

# Initialize PostgreSQL if needed
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  log_info "Initializing PostgreSQL..."
  initdb -D "$PG_DATA" --username=accessbase --encoding=UTF8 --locale=C --auth=trust --auth-host=trust
  cat >> "$PG_DATA/postgresql.conf" <<EOF
listen_addresses = 'localhost'
port = $PG_PORT
unix_socket_directories = '$PG_DATA'
EOF
  cat > "$PG_DATA/pg_hba.conf" <<EOF
local   all   all   trust
host    all   all   127.0.0.1/32   trust
host    all   all   ::1/128   trust
EOF
  pg_ctl -D "$PG_DATA" -w start
  psql -h localhost -p "$PG_PORT" -U accessbase -d postgres -c "CREATE DATABASE accessbase;" 2>/dev/null || true
  pg_ctl -D "$PG_DATA" stop
  log_ok "PostgreSQL initialized"
fi

# Generate Redis config
cat > "$REDIS_DATA/redis.conf" <<EOF
port $REDIS_PORT
bind 127.0.0.1
dir $REDIS_DATA
appendonly yes
logfile "$REDIS_DATA/redis.log"
maxmemory 256mb
maxmemory-policy allkeys-lru
EOF

# === Start services ===

# Graceful shutdown
cleanup() {
  log_info "Shutting down..."
  [ -f "$PIDFILE" ] && while IFS= read -r pid; do kill -15 "$pid" 2>/dev/null || true; done < "$PIDFILE"
  rm -f "$PIDFILE"
  pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
  redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true
  log_ok "All services stopped"
}
trap cleanup EXIT INT TERM

# Start PostgreSQL
if ! pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
  log_info "Starting PostgreSQL on port $PG_PORT..."
  pg_ctl -D "$PG_DATA" -l "$PG_DATA/logfile" -w start
  for i in $(seq 1 30); do
    pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null && break
    sleep 1
  done
fi

# Start Redis
if ! redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  log_info "Starting Redis on port $REDIS_PORT..."
  redis-server "$REDIS_DATA/redis.conf" --daemonize yes
  for i in $(seq 1 10); do
    redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG && break
    sleep 0.5
  done
fi

# Set URLs
export DATABASE_URL="${DATABASE_URL:-postgresql://accessbase:accessbase_dev@localhost:${PG_PORT}/accessbase}"
export REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
export STATIC_DIR="${STATIC_DIR:-${OUT_DIR}/admin-ui}"
export NODE_ENV="${NODE_ENV:-production}"

# Run migrations
log_info "Running migrations..."
node "${OUT_DIR}/packages/migration/dist/cli.js" up 2>/dev/null || log_warn "Migration skipped"

# Start server
log_info "Starting server on port $SERVER_PORT..."
node "${OUT_DIR}/server/index.js" &
SERVER_PID=$!
echo "$SERVER_PID" > "$PIDFILE"

# Wait for server ready
for i in $(seq 1 30); do
  if curl -sf --noproxy localhost "http://localhost:${SERVER_PORT}/health/live" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Auto-create admin if env vars set and no admin exists
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  SETUP_STATUS=$(curl -sf --noproxy localhost "http://localhost:${SERVER_PORT}/api/v1/setup/status" 2>/dev/null || echo '{}')
  if echo "$SETUP_STATUS" | grep -q '"adminExists":false'; then
    log_info "Creating admin user from environment variables..."
    curl -sf --noproxy localhost -X POST "http://localhost:${SERVER_PORT}/api/v1/setup/admin" \
      -H 'Content-Type: application/json' \
      -d "{\"name\":\"Administrator\",\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" || log_warn "Admin creation failed"
    # Mark setup complete
    curl -sf --noproxy localhost -X POST "http://localhost:${SERVER_PORT}/api/v1/setup/complete" || true
    log_ok "Admin user created: ${ADMIN_EMAIL}"
  fi
fi

log_ok "AccessBase running at http://localhost:${SERVER_PORT}"
log_info "  API:  http://localhost:${SERVER_PORT}/api/v1"
log_info "  Docs: http://localhost:${SERVER_PORT}/docs"
log_info "  UI:   http://localhost:${SERVER_PORT}"

wait $SERVER_PID
