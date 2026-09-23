#!/usr/bin/env bash
# start.sh — Start AccessBase in deploy mode (PG + Redis + Server)
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

# Ensure pixi native env binaries are on PATH (pg_ctl, initdb, redis-server, etc.)
export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$HOME/.pixi/bin:$PATH"

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

# L-T3 (addendum LOW-1): default NODE_ENV BEFORE the production pre-flight so
# the JWT/ADMIN checks actually fire under a default deploy (clean exit 1
# instead of a crash loop). _common.sh does not key off NODE_ENV (verified).
export NODE_ENV="${NODE_ENV:-production}"

# === Pre-flight checks ===
if [ ! -d "$OUT_DIR/server" ]; then
  log_error "out/server/ not found. Run 'bash accessbase.sh build:deploy' first."
  exit 1
fi

if [ "${NODE_ENV:-}" = "production" ]; then
  if [ -z "${JWT_SECRET:-}" ] || [ "$JWT_SECRET" = "dev-secret-do-not-use-in-production" ]; then
    log_error "JWT_SECRET must be set in production"
    exit 1
  fi
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    log_error "ADMIN_PASSWORD must be set in production"
    exit 1
  fi
  if [ -z "${CORS_ORIGINS:-}" ]; then
    log_error "CORS_ORIGINS must be set in production (config.ts requires it; comma-separated allowlist)"
    exit 1
  fi
fi

# === Initialize ===
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

# === Graceful shutdown ===
cleanup() {
  DEPLOY_STOPPING=1
  log_info "Shutting down..."
  if [ -f "$PIDFILE" ]; then
    while IFS= read -r pid; do
      kill -15 "$pid" 2>/dev/null || true
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  rm -f "${DATA_DIR}/.startpid"
  pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
  redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true
  log_ok "All services stopped"
}
trap cleanup EXIT INT TERM

# B2: stop.sh TERMs this wrapper via .startpid → trap sets DEPLOY_STOPPING →
# the restart loop breaks → EXIT cleanup reaps the stack. Written early so a
# stop during init/migrate is handled too.
DEPLOY_STOPPING=0
echo $$ > "${DATA_DIR}/.startpid"

# === Start PostgreSQL ===
if ! pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
  log_info "Starting PostgreSQL on port $PG_PORT..."
  pg_ctl -D "$PG_DATA" -l "$PG_DATA/logfile" -w start
fi

# === Start Redis ===
if ! redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  log_info "Starting Redis on port $REDIS_PORT..."
  redis-server "$REDIS_DATA/redis.conf" --daemonize yes
  sleep 1
fi

# === Set environment ===
export DATABASE_URL="${DATABASE_URL:-postgresql://accessbase:accessbase_dev@localhost:${PG_PORT}/accessbase}"
export REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
export STATIC_DIR="${STATIC_DIR:-${OUT_DIR}/admin-ui}"

# === Run migrations ===
log_info "Running migrations..."
bash "${PROJECT_ROOT}/scripts/migrate.sh" "${PROJECT_ROOT}/packages/migration/drizzle" || { log_error "Migrations failed — aborting"; exit 1; }

# === Start server ===
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

# === Auto-create admin ===
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  SETUP_STATUS=$(curl -sf --noproxy localhost "http://localhost:${SERVER_PORT}/api/v1/setup/status" 2>/dev/null || echo '{}')
  if echo "$SETUP_STATUS" | grep -q '"adminExists":false'; then
    log_info "Creating admin user from environment variables..."
    # W3-4 (F15b): JSON via stdin through node (no argv password, real escaping).
    node -e 'process.stdout.write(JSON.stringify({ name: "Administrator", email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" }))' \
      | curl -sf --noproxy localhost -X POST "http://localhost:${SERVER_PORT}/api/v1/setup/admin" \
          -H 'Content-Type: application/json' --data @- || log_warn "Admin creation failed"
    curl -sf --noproxy localhost -X POST "http://localhost:${SERVER_PORT}/api/v1/setup/complete" || true
    log_ok "Admin user created: ${ADMIN_EMAIL}"
  fi
fi

log_ok "AccessBase running at http://localhost:${SERVER_PORT}"
log_info "  API:  http://localhost:${SERVER_PORT}/api/v1"
log_info "  Docs: http://localhost:${SERVER_PORT}/docs"
log_info "  UI:   http://localhost:${SERVER_PORT}"

# === Server restart loop (D4 / B1 B2 L-1) ===
# B1: under global `set -eo pipefail` a bare non-zero `wait` would kill the
# script before any restart branch — capture the status and branch on $code.
RESET_TIMES=()
while [ "$DEPLOY_STOPPING" != "1" ]; do
  code=0; wait "$SERVER_PID" || code=$?
  # B2: stop.sh TERMs this wrapper → trap ran cleanup (kills server, sets the
  # flag, stops PG/Redis) → break instead of reviving onto a dead stack.
  if [ "$DEPLOY_STOPPING" = "1" ]; then
    break
  fi
  # L-1: 3 exits inside a 15s window = crash loop (bad env) → abort to the
  # EXIT trap instead of spamming a restart every 3s forever.
  RESET_TIMES+=("$SECONDS")
  while [ "${#RESET_TIMES[@]}" -gt 0 ] && [ $(( SECONDS - ${RESET_TIMES[0]} )) -ge 15 ]; do
    RESET_TIMES=(${RESET_TIMES[@]:1})
  done
  if [ "${#RESET_TIMES[@]}" -ge 3 ]; then
    log_error "crash loop — aborting"
    break
  fi
  log_warn "Server exited (code $code) — restarting in 3s..."
  sleep 3
  node "${OUT_DIR}/server/index.js" &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PIDFILE"
done
