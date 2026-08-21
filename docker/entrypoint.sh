#!/bin/bash
set -e

# Start PostgreSQL
echo "Starting PostgreSQL..."
pg_ctl -D $PGDATA start -w

# Create database if not exists
psql -U $PGUSER -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1 || \
    psql -U $PGUSER -d postgres -c "CREATE DATABASE $PGDATABASE"

# Start Redis
echo "Starting Redis..."
redis-server --daemonize yes --port 6379 --dir /var/lib/redis --appendonly yes

# Wait for services
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
    pg_isready -U $PGUSER -d $PGDATABASE && break
    sleep 1
done

echo "Waiting for Redis..."
for i in $(seq 1 30); do
    redis-cli ping && break
    sleep 1
done

# Run migrations
echo "Running migrations..."
cd /app
node packages/migration/dist/cli.js up || true

# Start server
echo "Starting AccessBase server..."
exec node apps/server/dist/index.js
