#!/bin/bash
set -e

# Batch P W2-2 (F9): idempotent RUNTIME init (trust semantics identical to
# the removed build-time bake; W2-4 hardens host auth separately).
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "BOOT: $PGDATA is empty — initializing EMPTY database (persist across containers by mounting a volume at $PGDATA)"
  # W2-4 (F11): local socket stays trust (this script's own psql/pg_isready),
  # every HOST/TCP connection — including the app's loopback DATABASE_URL —
  # requires scram with the PGPASSWORD provisioned via pwfile. initdb emits
  # the 127.0.0.1/::1 host rules itself; no append-ordering gamble needed.
  initdb -D "$PGDATA" --username="$PGUSER" --auth-local=trust --auth-host=scram-sha-256 --pwfile=<(printf '%s\n' "${PGPASSWORD:-accessbase}")
  echo "listen_addresses='localhost'" >> "$PGDATA/postgresql.conf"
fi

# Start PostgreSQL
echo "Starting PostgreSQL..."
pg_ctl -D "$PGDATA" start -w

# Create database if not exists
psql -U $PGUSER -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1 || \
    psql -U $PGUSER -d postgres -c "CREATE DATABASE $PGDATABASE"

# Start Redis
echo "Starting Redis..."
redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --dir /var/lib/redis --appendonly yes

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
bash /app/scripts/migrate.sh /app/packages/migration/drizzle

# Start server
echo "Starting AccessBase server..."
exec node apps/server/dist/index.js
