#!/usr/bin/env bash
# redis-start.sh — Start Redis for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

REDIS_DATA="${PROJECT_ROOT}/.pixi/data/redis"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_CONF="${REDIS_DATA}/redis.conf"

generate_config() {
    mkdir -p "$REDIS_DATA"

    cat > "$REDIS_CONF" <<EOF
# AccessBase Redis config
port $REDIS_PORT
bind 127.0.0.1
protected-mode yes

# Persistence
dir $REDIS_DATA
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec

# Logging
logfile "$REDIS_DATA/redis.log"
loglevel notice

# Memory
maxmemory 256mb
maxmemory-policy allkeys-lru

# Performance
tcp-backlog 511
timeout 0
tcp-keepalive 300

# Snapshotting
save 900 1
save 300 10
save 60 10000
dbfilename dump.rdb
EOF
}

redis_start() {
    if redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
        log_ok "Redis already running on port $REDIS_PORT"
        return 0
    fi

    generate_config

    log_info "Starting Redis on port $REDIS_PORT..."
    redis-server "$REDIS_CONF" --daemonize yes

    for i in {1..10}; do
        if redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
            log_ok "Redis ready on port $REDIS_PORT"
            return 0
        fi
        sleep 0.5
    done

    log_error "Redis failed to start"
    exit 1
}

redis_start