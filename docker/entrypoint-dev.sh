#!/usr/bin/env bash
set -euo pipefail

# Graceful shutdown
cleanup() {
    echo "[entrypoint] Shutting down..."
    pg_ctl -D "$PGDATA" stop -m fast 2>/dev/null || true
    redis-cli shutdown nosave 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# Start PostgreSQL
echo "[entrypoint] Starting PostgreSQL..."
pg_ctl -D "$PGDATA" -l /var/lib/postgresql/data/logfile -w start

# Wait for PG
for i in {1..30}; do
    if pg_isready -h localhost -p 5432 -q 2>/dev/null; then
        echo "[entrypoint] PostgreSQL ready"
        break
    fi
    sleep 1
done

# Create database if not exists
psql -U "$PGUSER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1 || \
    psql -U "$PGUSER" -d postgres -c "CREATE DATABASE $PGDATABASE"

# Start Redis
echo "[entrypoint] Starting Redis..."
redis-server --daemonize yes --port 6379 --bind 127.0.0.1 --appendonly yes

# Wait for Redis
for i in {1..10}; do
    if redis-cli ping 2>/dev/null | grep -q PONG; then
        echo "[entrypoint] Redis ready"
        break
    fi
    sleep 0.5
done

# Set environment
export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@localhost:5432/${PGDATABASE}"
export REDIS_URL="redis://localhost:6379"

# Push schema — loud (batch M D4 / flows R3): failures must NOT be swallowed;
# a broken schema on a fresh volume would otherwise boot the server against an
# empty DB and the setup wizard dies with no signal. Retries cover PG-ready races.
echo "[entrypoint] Pushing database schema..."
cd /app
push_ok=0
for attempt in 1 2 3; do
    if pnpm db:push; then
        push_ok=1
        break
    fi
    echo "[entrypoint] Schema push attempt ${attempt}/3 failed - retrying in 3s..."
    sleep 3
done
if [ "${push_ok}" -ne 1 ]; then
    echo "[entrypoint] FATAL: schema push failed after 3 attempts - refusing to start server against an unsynced database" >&2
    exit 1
fi

# Start application
echo "[entrypoint] Starting application..."
exec "$@"
