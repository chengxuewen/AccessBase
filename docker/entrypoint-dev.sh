#!/bin/bash
set -euo pipefail

# Start PostgreSQL
echo "Starting PostgreSQL..."
/usr/lib/postgresql/16/bin/pg_ctl -D "$PGDATA" start -w

# Create database if not exists
psql -U "$PGUSER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1 || \
    psql -U "$PGUSER" -d postgres -c "CREATE DATABASE $PGDATABASE"

# Start Redis
echo "Starting Redis..."
redis-server --daemonize yes --port 6379 --dir /var/lib/redis --appendonly yes

# Wait for services in parallel
echo "Waiting for services..."
wait_for_pg() {
    for _ in $(seq 1 30); do
        /usr/lib/postgresql/16/bin/pg_isready -U "$PGUSER" -d "$PGDATABASE" -q && return 0
        sleep 1
    done
    echo "PostgreSQL not ready after 30s" >&2
    return 1
}

wait_for_redis() {
    for _ in $(seq 1 30); do
        redis-cli ping >/dev/null 2>&1 && return 0
        sleep 1
    done
    echo "Redis not ready after 30s" >&2
    return 1
}

wait_for_pg &
wait_for_redis &
wait

echo "Services ready."

# Set environment
export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@localhost:5432/${PGDATABASE}"
export REDIS_URL="redis://localhost:6379"

# Push schema
echo "Pushing database schema..."
cd /app
pnpm db:push 2>/dev/null || echo "Schema push skipped"

# Start all services
echo "Starting server..."
pnpm --filter @accessbase/server dev &

echo "Starting admin-ui..."
pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &

wait
