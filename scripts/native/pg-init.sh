#!/usr/bin/env bash
# pg-init.sh — Initialize PostgreSQL data directory for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

PG_DATA="${PROJECT_ROOT}/.pixi/data/pg"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-accessbase}"
PG_DB="${PG_DB:-accessbase}"

pg_init() {
    if [ -f "$PG_DATA/PG_VERSION" ]; then
        log_ok "PostgreSQL already initialized at $PG_DATA"
        return 0
    fi

    log_info "Initializing PostgreSQL in $PG_DATA..."
    mkdir -p "$PG_DATA"

    # Use locale=C for maximum portability (en_US.UTF-8 may not exist on all systems)
    initdb \
        -D "$PG_DATA" \
        --username="$PG_USER" \
        --encoding=UTF8 \
        --locale=C \
        --auth=trust \
        --auth-host=trust

    # Configure postgresql.conf
    cat >> "$PG_DATA/postgresql.conf" <<EOF

# AccessBase native config
listen_addresses = 'localhost'
port = $PG_PORT
unix_socket_directories = '$PG_DATA'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
EOF

    # Configure pg_hba.conf (trust for local/socket — dev only)
    cat > "$PG_DATA/pg_hba.conf" <<EOF
# TYPE  DATABASE    USER        ADDRESS         METHOD
local   all         all                         trust
host    all         all         127.0.0.1/32    trust
host    all         all         ::1/128         trust
EOF

    log_ok "PostgreSQL initialized"
}

create_initial_db() {
    log_info "Starting temporary PostgreSQL for user/db creation..."
    pg_ctl -D "$PG_DATA" -l "$PG_DATA/init.log" -w start

    for i in {1..30}; do
        if pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
            break
        fi
        sleep 1
    done

    psql -h localhost -p "$PG_PORT" -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'" | grep -q 1 \
        || createuser -h localhost -p "$PG_PORT" -U postgres "$PG_USER"

    psql -h localhost -p "$PG_PORT" -U postgres -c "ALTER USER $PG_USER PASSWORD 'accessbase_dev';"

    psql -h localhost -p "$PG_PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" | grep -q 1 \
        || createdb -h localhost -p "$PG_PORT" -U postgres -O "$PG_USER" "$PG_DB"

    pg_ctl -D "$PG_DATA" stop

    log_ok "User '$PG_USER' and database '$PG_DB' created"
}

main() {
    pg_init
    create_initial_db
}

main "$@"