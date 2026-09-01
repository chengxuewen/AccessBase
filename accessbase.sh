#!/usr/bin/env bash
# accessbase.sh — AccessBase CLI
# Usage: ./accessbase.sh <command> [options]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/scripts/_common.sh"

usage() {
    cat <<EOF
AccessBase CLI

Usage: ./accessbase.sh <command> [options]

Development:
  dev              Native dev (Pixi-managed PG + Redis + backend + frontend)
  dev:compose      Compose mode dev (DB + Redis in separate containers)
  dev:container   Docker all-in-one dev (single container)
  dev:native       Native dev (Pixi-managed PG + Redis + backend + frontend)
  start:native     Start native infra only (PG + Redis)
  stop:native      Stop all native services
  reset:native     Reset native data and reinitialize
  status:native    Show native service status
  start:compose    Start compose infrastructure only
  start:prod       Production start (Compose mode)
  stop:compose     Stop compose services
  status:compose   Show compose status
  logs:compose     Show compose logs

Production:
  start            Start native infra only (PG + Redis)
  start:container Production start (all-in-one mode)
  stop             Stop all native services
  stop:container  Stop container services
  status:container Show container status
  logs:container  Show container logs

Build & Test:
  build            Build all packages
  test             Run all tests
  test:e2e         Run E2E tests (Playwright)
  typecheck        Run TypeScript type checking
  lint             Run linting
  format           Format code

Database:
  db:push          Push database schema
  db:generate      Generate migration files
  db:migrate       Run database migrations
Docker:
  docker:build     Build Docker image
  docker:dev       Start dev services (PostgreSQL + Redis)
  docker:down      Stop all Docker services

Other:
  clean            Clean build artifacts
  reset            Reset native data and reinitialize
  status           Show native service status
  status           Show project status

Deploy:
  build:deploy     Build all packages to out/ directory
  start:deploy     Start deploy mode (PG + Redis + Server from out/)
  stop:deploy      Stop all deploy services
  reset:deploy     Reset deploy data (with confirmation)
  status:deploy    Show deploy service status
  logs:deploy      Show deploy service logs
EOF
}

# ===== Development Commands =====

cmd_dev() {
    ensure_node
    ensure_pnpm

    # Step 1: Start PostgreSQL + Redis if not running
    log_info "Checking dev services..."
    if has_docker; then
        local DC=$(get_docker_compose_cmd)
        if ! $DC -f docker-compose.dev.yml ps --status running 2>/dev/null | grep -q postgres; then
            log_info "Starting PostgreSQL + Redis..."
            $DC -f docker-compose.dev.yml up -d
            sleep 3
        fi
        log_ok "Dev services running"

        # Auto-set DATABASE_URL if not set
        if [ -z "${DATABASE_URL:-}" ]; then
            export DATABASE_URL="postgresql://accessbase:accessbase_dev@localhost:5432/accessbase"
            log_info "DATABASE_URL set to localhost:5432"
        fi

        # Auto-set REDIS_URL if not set
        if [ -z "${REDIS_URL:-}" ]; then
            export REDIS_URL="redis://localhost:6379"
            log_info "REDIS_URL set to localhost:6379"
        fi
    else
        log_warn "Docker not available, skipping dev services"
    fi

    # Step 2: Push database schema
    log_info "Pushing database schema..."
    pnpm db:push 2>/dev/null || log_warn "Schema push skipped (DB not ready)"

    # Step 3: Start dev servers
    log_info "Starting dev servers..."
    pnpm --filter @accessbase/server dev &
    pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &
    wait
}

# ===== Native Commands (Pixi-managed) =====

cmd_dev_native() {
    ensure_pixi
    ensure_node
    ensure_pnpm

    # Port conflict detection util (re-checked after predev build — see PIT-026)
    source "${SCRIPT_DIR}/scripts/native/_ports.sh"
    detect_required_ports

    # Initialize + start infra
    log_info "Starting native infrastructure..."
    bash "${SCRIPT_DIR}/scripts/native/pg-init.sh"
    bash "${SCRIPT_DIR}/scripts/native/pg-start.sh"
    bash "${SCRIPT_DIR}/scripts/native/redis-start.sh"

    # Auto-configure URLs
    configure_native_urls

    # Push database schema
    log_info "Pushing database schema..."
    pnpm db:push || log_warn "Schema push failed (DB may not be ready)"

    # Auto-create admin if env vars set and no admin exists (skip setup wizard)
    local server_port="${SERVER_PORT:-5101}"
    if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
      # Wait briefly for DB to be ready
      sleep 2
      local setup_status
      setup_status=$(curl -sf --noproxy localhost "http://localhost:${server_port}/api/v1/setup/status" 2>/dev/null || echo '{}')
      if echo "$setup_status" | grep -q '"adminExists":false'; then
        log_info "Auto-creating admin user: ${ADMIN_EMAIL}"
        curl -sf --noproxy localhost -X POST "http://localhost:${server_port}/api/v1/setup/admin" \
          -H 'Content-Type: application/json' \
          -d "{\"name\":\"Administrator\",\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" > /dev/null 2>&1 || log_warn "Admin auto-create failed (server may not be ready yet)"
      fi
    fi

    # PID file for safe process tracking (no lsof — avoids killing unrelated processes)
    local pidfile="${PROJECT_ROOT}/.pixi/data/.dev-pids"

    # Cleanup on exit — kill tracked PIDs + stop infra
    _native_cleaned=0
    cleanup_native() {
        [ "$_native_cleaned" -eq 1 ] && return
        _native_cleaned=1
        log_info "Stopping native services..."
        # Kill tracked dev server PIDs
        if [ -f "$pidfile" ]; then
            while IFS= read -r pid; do
                if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                    kill -15 "$pid" 2>/dev/null || true
                fi
            done < "$pidfile"
            rm -f "$pidfile"
        fi
        bash "${SCRIPT_DIR}/scripts/native/pg-stop.sh"
        bash "${SCRIPT_DIR}/scripts/native/redis-stop.sh"
        log_ok "Native services stopped"
    }
    trap cleanup_native EXIT

    # Re-check ONLY dev-server ports right before launch: predev build (~2s)
    # opens a window where an orphan can grab 5101/5173 after the early check.
    # NOT 5432/6379 — this script just started them itself (PIT-026).
    check_port_available "${SERVER_PORT:-5101}" "Server" || exit 1
    check_port_available "${UI_PORT:-5173}" "Admin UI" || exit 1

    pnpm --filter @accessbase/server dev &
    local server_pid=$!
    pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &
    local ui_pid=$!

    # Write PIDs to file for cross-session stop
    mkdir -p "$(dirname "$pidfile")"
    echo "$server_pid" > "$pidfile"
    echo "$ui_pid" >> "$pidfile"

    # Fail fast: if EITHER dev process exits, stop the other + cleanup (PIT-026)
    wait -n $server_pid $ui_pid
    local failed=$?
    if [ $failed -ne 0 ]; then
        log_error "A dev process exited unexpectedly (code $failed) — stopping everything"
        kill -15 $server_pid $ui_pid 2>/dev/null || true
        cleanup_native
        exit $failed
    fi
    wait $server_pid $ui_pid
}

cmd_start_native() {
    ensure_pixi

    source "${SCRIPT_DIR}/scripts/native/_ports.sh"
    detect_required_ports

    bash "${SCRIPT_DIR}/scripts/native/pg-init.sh"
    bash "${SCRIPT_DIR}/scripts/native/pg-start.sh"
    bash "${SCRIPT_DIR}/scripts/native/redis-start.sh"

    configure_native_urls

    log_ok "Native services started"
    log_info "  PostgreSQL: localhost:${PG_PORT:-5432}"
    log_info "  Redis:      localhost:${REDIS_PORT:-6379}"
    log_info ""
    log_info "Set these in your environment:"
    log_info "  export DATABASE_URL=\"postgresql://accessbase:accessbase_dev@localhost:${PG_PORT:-5432}/accessbase\""
    log_info "  export REDIS_URL=\"redis://localhost:${REDIS_PORT:-6379}\""
}

cmd_stop_native() {
    # Ensure pixi native env binaries are on PATH (pg_isready, pg_ctl, redis-cli)
    export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$PATH"

    # Kill dev server processes tracked by PID file
    local pidfile="${PROJECT_ROOT}/.pixi/data/.dev-pids"
    if [ -f "$pidfile" ]; then
        while IFS= read -r pid; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                kill -15 "$pid" 2>/dev/null || true
            fi
        done < "$pidfile"
        rm -f "$pidfile"
    fi

    # Fallback: kill orphaned node processes on dev ports (5101/5173)
    # Only kill processes whose command contains 'node' — safe for VS Code
    for port in ${SERVER_PORT:-5101} ${UI_PORT:-5173}; do
        local pid
        pid=$(lsof -ti :"$port" 2>/dev/null | head -1)
        if [ -n "$pid" ]; then
            local cmd
            cmd=$(ps -p "$pid" -o comm= 2>/dev/null || echo "")
            if echo "$cmd" | grep -q "node"; then
                kill -15 "$pid" 2>/dev/null || true
            fi
        fi
    done

    # Orphan sweep: pnpm/tsx/vite dev chain processes escape the PID file
    # when started outside this script (PIT-026). Match by args, not comm.
    pkill -15 -f "tsx watch src/index.ts" 2>/dev/null || true
    pkill -15 -f "@accessbase/server dev" 2>/dev/null || true
    pkill -15 -f "vite -- --host" 2>/dev/null || true
    sleep 1

    bash "${SCRIPT_DIR}/scripts/native/pg-stop.sh"
    bash "${SCRIPT_DIR}/scripts/native/redis-stop.sh"
    log_ok "Native services stopped"
}

cmd_reset_native() {
    log_warn "This will DELETE all native data and reinitialize"
    # Only stop PG/Redis (not dev servers — they should survive the reset)
    export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$PATH"
    bash "${SCRIPT_DIR}/scripts/native/pg-stop.sh"
    bash "${SCRIPT_DIR}/scripts/native/redis-stop.sh"
    log_info "Deleting data..."
    rm -rf "${PROJECT_ROOT}/.pixi/data/pg" "${PROJECT_ROOT}/.pixi/data/redis"
    log_info "Reinitializing..."
    bash "${SCRIPT_DIR}/scripts/native/pg-init.sh"
    log_ok "Reset complete. Dev servers may need a page refresh."
}

cmd_status_native() {
    # Ensure pixi native env binaries are on PATH
    export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$PATH"

    echo "=== Native Services Status ==="
    echo ""

    if pg_isready -h localhost -p "${PG_PORT:-5432}" -q 2>/dev/null; then
        echo "PostgreSQL: RUNNING (port ${PG_PORT:-5432})"
    else
        echo "PostgreSQL: STOPPED"
    fi

    if redis-cli -p "${REDIS_PORT:-6379}" ping 2>/dev/null | grep -q PONG; then
        echo "Redis:      RUNNING (port ${REDIS_PORT:-6379})"
    else
        echo "Redis:      STOPPED"
    fi

    echo ""
    echo "Data dirs:"
    echo "  PG:    .pixi/data/pg $([ -d .pixi/data/pg ] && echo '(exists)' || echo '(missing)')"
    echo "  Redis: .pixi/data/redis $([ -d .pixi/data/redis ] && echo '(exists)' || echo '(missing)')"
}


cmd_dev_compose() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi

    local DC=$(get_docker_compose_cmd)

    log_info "Starting all services with Docker Compose..."
    $DC -f docker-compose.dev.yml up --build

    log_ok "All services running:"
    log_info "  Frontend: http://localhost:5173"
    log_info "  Backend:  http://localhost:5101"
    log_info "  Database: localhost:5432"
    log_info "  Redis:    localhost:6379"
}

cmd_start_compose() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi

    local DC=$(get_docker_compose_cmd)
    log_info "Starting compose infrastructure..."
    $DC -f docker-compose.yml up -d
    log_ok "Compose services started"
}

cmd_stop_compose() {
    local DC=$(get_docker_compose_cmd)
    log_info "Stopping compose services..."
    $DC -f docker-compose.dev.yml down 2>/dev/null || true
    $DC -f docker-compose.yml down 2>/dev/null || true
    log_ok "Compose services stopped"
}

cmd_status_compose() {
    local DC=$(get_docker_compose_cmd)
    echo "=== Compose Status ==="
    echo ""
    echo "--- Base services ---"
    $DC -f docker-compose.yml ps 2>/dev/null || echo "Not running"
    echo ""
    echo "--- Dev services ---"
    $DC -f docker-compose.dev.yml ps 2>/dev/null || echo "Not running"
}

cmd_logs_compose() {
    local DC=$(get_docker_compose_cmd)
    $DC -f docker-compose.dev.yml logs -f
}

cmd_dev_container() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi

    local D=$(get_docker_cmd)
    local BUILD_ARGS=""

    # Parse arguments
    for arg in "$@"; do
        case $arg in
            --no-cache) BUILD_ARGS="--no-cache" ;;
        esac
    done

    log_info "Building Docker dev image..."
    $D build $BUILD_ARGS -t accessbase:dev -f Dockerfile.dev .

    log_info "Starting all-in-one dev container..."
    $D run -d --name accessbase-dev \
        --init \
        -p 5101:5101 \
        -p 5173:5173 \
        -p 5432:5432 \
        -p 6379:6379 \
        -v "$(pwd):/app" \
        -v /app/node_modules \
        accessbase:dev

    log_ok "AccessBase dev container running"
    log_info "  Frontend: http://localhost:5173"
    log_info "  Backend:  http://localhost:5101"
    log_info "  Database: localhost:5432"
    log_info "  Redis:    localhost:6379"
}

# ===== Production Commands =====

cmd_start() {
    ensure_node
    ensure_pnpm

    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi

    local DC=$(get_docker_compose_cmd)

    log_info "Starting production services..."
    $DC -f docker-compose.prod.yml up -d
    log_ok "AccessBase running at http://localhost:5101"
}

cmd_start_container() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi

    local D=$(get_docker_cmd)

    log_info "Building Docker image..."
    $D build -t accessbase:latest .

    log_info "Starting all-in-one container..."
    $D run -d --name accessbase \
        -p 5101:5101 \
        -e JWT_SECRET="${JWT_SECRET}" \
        -e NODE_ENV=production \
        accessbase:latest

    log_ok "AccessBase running at http://localhost:5101"
}

cmd_stop_container() {
    local D=$(get_docker_cmd)
    log_info "Stopping container services..."
    $D stop accessbase-dev 2>/dev/null || true
    $D rm -f accessbase-dev 2>/dev/null || true
    $D stop accessbase 2>/dev/null || true
    $D rm -f accessbase 2>/dev/null || true
    log_ok "Container services stopped"
}

cmd_status_container() {
    local D=$(get_docker_cmd)
    echo "=== Container Status ==="
    echo ""
    $D ps -a --filter name=accessbase --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    if curl -sf http://localhost:5101/health/live >/dev/null 2>&1; then
        echo "Health: OK"
    else
        echo "Health: UNREACHABLE"
    fi
}

cmd_logs_container() {
    local D=$(get_docker_cmd)
    local container="${1:-accessbase-dev}"
    $D logs -f "$container"
}

cmd_stop() {
    local DC=$(get_docker_compose_cmd)
    local D=$(get_docker_cmd)

    log_info "Stopping all services..."
    $DC -f docker-compose.dev.yml down 2>/dev/null || true
    $DC -f docker-compose.prod.yml down 2>/dev/null || true
    $D stop accessbase-dev 2>/dev/null || true
    $D rm -f accessbase-dev 2>/dev/null || true
    $D stop accessbase 2>/dev/null || true
    $D rm -f accessbase 2>/dev/null || true
    log_ok "All services stopped"
}

# ===== Build & Test Commands =====

cmd_build() {
    ensure_node
    ensure_pnpm
    log_info "Building all packages..."
    pnpm --filter @accessbase/types build
    pnpm --filter @accessbase/logging build
    pnpm --filter @accessbase/i18n build
    pnpm --filter @accessbase/health build
    pnpm --filter @accessbase/identity build
    pnpm --filter @accessbase/audit build
    pnpm --filter @accessbase/admin build
    pnpm --filter @accessbase/migration build
    pnpm --filter @accessbase/server build
    pnpm --filter @accessbase/admin-ui build
    log_ok "Build complete"
}

cmd_test() {
    ensure_node
    ensure_pnpm
    log_info "Running tests..."
    pnpm test
    log_ok "Tests complete"
}

cmd_test_e2e() {
    ensure_node
    ensure_pnpm
    log_info "Running E2E tests..."
    pnpm --filter @accessbase/admin-ui test:e2e
    log_ok "E2E tests complete"
}

cmd_typecheck() {
    ensure_node
    ensure_pnpm
    log_info "Running type check..."
    pnpm typecheck
    pnpm --filter @accessbase/admin-ui typecheck
    log_ok "Type check passed"
}

cmd_lint() {
    ensure_node
    ensure_pnpm
    log_info "Running lint..."
    pnpm lint
    log_ok "Lint passed"
}

cmd_format() {
    ensure_node
    ensure_pnpm
    log_info "Formatting code..."
    pnpm format
    log_ok "Format complete"
}

# ===== Database Commands =====

cmd_db_push() {
    ensure_node
    ensure_pnpm
    log_info "Pushing database schema..."
    pnpm db:push
    log_ok "Schema pushed"
}

cmd_db_generate() {
    ensure_node
    ensure_pnpm
    log_info "Generating migrations..."
    pnpm db:generate
    log_ok "Migrations generated"
}

cmd_db_migrate() {
    ensure_node
    ensure_pnpm
    log_info "Running database migrations..."
    pnpm db:migrate
    log_ok "Migrations applied"
}

# ===== Docker Commands =====

cmd_docker_build() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi
    local D=$(get_docker_cmd)
    local BUILD_ARGS=""
    for arg in "$@"; do
        case $arg in
            --no-cache) BUILD_ARGS="--no-cache" ;;
        esac
    done
    log_info "Building Docker image..."
    $D build $BUILD_ARGS -t accessbase:latest .
    log_ok "Docker image built"
}

cmd_docker_dev() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi
    local DC=$(get_docker_compose_cmd)
    log_info "Starting dev services..."
    $DC -f docker-compose.dev.yml up -d
    log_ok "PostgreSQL (5432) and Redis (6379) running"
}

cmd_docker_down() {
    local DC=$(get_docker_compose_cmd)
    local D=$(get_docker_cmd)
    $DC -f docker-compose.dev.yml down 2>/dev/null || true
    $DC -f docker-compose.prod.yml down 2>/dev/null || true
    $D stop accessbase-dev 2>/dev/null || true
    $D rm -f accessbase-dev 2>/dev/null || true
    $D stop accessbase 2>/dev/null || true
    $D rm -f accessbase 2>/dev/null || true
    log_ok "Services stopped"
}

# ===== Deploy Commands =====

cmd_build_deploy() {
    ensure_node
    ensure_pnpm
    bash "${SCRIPT_DIR}/scripts/deploy/build.sh"
}

cmd_start_deploy() {
    ensure_node
    bash "${SCRIPT_DIR}/scripts/deploy/start.sh"
}

cmd_stop_deploy() {
    bash "${SCRIPT_DIR}/scripts/deploy/stop.sh"
}

cmd_reset_deploy() {
    bash "${SCRIPT_DIR}/scripts/deploy/reset.sh"
}

cmd_status_deploy() {
    local pg_port="${PG_PORT:-5432}"
    local redis_port="${REDIS_PORT:-6379}"
    local server_port="${PORT:-5101}"
    echo "=== Deploy Mode Status ==="
    echo ""
    if pg_isready -h localhost -p "$pg_port" -q 2>/dev/null; then
        echo "PostgreSQL: RUNNING (port $pg_port)"
    else
        echo "PostgreSQL: STOPPED"
    fi
    if redis-cli -p "$redis_port" ping 2>/dev/null | grep -q PONG; then
        echo "Redis:      RUNNING (port $redis_port)"
    else
        echo "Redis:      STOPPED"
    fi
    if curl -sf --noproxy localhost "http://localhost:${server_port}/health/live" >/dev/null 2>&1; then
        echo "Server:     RUNNING (port $server_port)"
    else
        echo "Server:     STOPPED"
    fi
    echo ""
    echo "Dirs:"
    echo "  data: $( [ -d data ] && echo 'exists' || echo 'missing' )"
    echo "  out:  $( [ -d out ] && echo 'exists' || echo 'missing' )"
}

cmd_logs_deploy() {
    local DATA_DIR="${PROJECT_ROOT}/data"
    echo "=== Deploy Logs ==="
    echo "--- Server (last 20 lines) ---"
    [ -f "$DATA_DIR/.pids" ] && ps -p $(head -1 "$DATA_DIR/.pids") >/dev/null 2>&1 && echo "Server running (PID $(head -1 "$DATA_DIR/.pids"))" || echo "Server not running"
    echo "--- PostgreSQL ---"
    tail -20 "$DATA_DIR/pg/logfile" 2>/dev/null || echo "No PG log"
    echo "--- Redis ---"
    tail -20 "$DATA_DIR/redis/redis.log" 2>/dev/null || echo "No Redis log"
}

# ===== Other Commands =====

cmd_clean() {
    log_info "Cleaning build artifacts..."
    rm -rf packages/*/dist apps/*/dist
    log_ok "Clean complete"
}

cmd_status() {
    echo "=== AccessBase Project Status ==="
    echo ""
    echo "Node.js: $(node --version 2>/dev/null || echo 'not installed')"
    echo "pnpm:    $(pnpm --version 2>/dev/null || echo 'not installed')"
    echo "Docker:  $(docker --version 2>/dev/null || echo 'not installed')"
    echo ""
    echo "=== Packages ==="
    for pkg in types logging i18n migration health identity audit admin; do
        if [ -d "packages/$pkg/dist" ]; then
            echo "  @accessbase/$pkg: built"
        else
            echo "  @accessbase/$pkg: not built"
        fi
    done
    echo ""
    echo "=== Apps ==="
    for app in server admin-ui; do
        if [ -d "apps/$app/dist" ]; then
            echo "  $app: built"
        else
            echo "  $app: not built"
        fi
    done
}

cmd_logs() {
    local DC=$(get_docker_compose_cmd)
    $DC -f docker-compose.dev.yml logs -f
}

cmd_reset() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi

    local DC=$(get_docker_compose_cmd)

    log_warn "This will DELETE all data and restart from scratch"
    log_info "Stopping services..."
    $DC -f docker-compose.dev.yml down -v 2>/dev/null || true

    log_info "Starting PostgreSQL + Redis..."
    $DC -f docker-compose.dev.yml up -d
    sleep 3

    log_info "Pushing database schema..."
    export DATABASE_URL="postgresql://accessbase:accessbase_dev@localhost:5432/accessbase"
    export REDIS_URL="redis://localhost:6379"
    pnpm db:push 2>/dev/null || log_warn "Schema push skipped"

    log_info "Starting dev servers..."
    log_ok "Database reset complete. Run 'bash accessbase.sh dev' to start."
}

# Main
case "${1:-}" in
    # Development
    dev)            cmd_dev_native ;;
    dev:compose)    cmd_dev_compose ;;
    dev:container)  cmd_dev_container ;;
    # Native commands
    dev:native)     cmd_dev_native ;;
    start:native)   cmd_start_native ;;
    stop:native)    cmd_stop_native ;;
    reset:native)   cmd_reset_native ;;
    status:native)  cmd_status_native ;;
    # Compose commands
    start:compose)  cmd_start_compose ;;
    start:prod)     cmd_start ;;
    stop:compose)   cmd_stop_compose ;;
    status:compose) cmd_status_compose ;;
    logs:compose)   cmd_logs_compose ;;

    # Deploy commands
    build:deploy)   cmd_build_deploy ;;
    start:deploy)   cmd_start_deploy ;;
    stop:deploy)    cmd_stop_deploy ;;
    reset:deploy)   cmd_reset_deploy ;;
    status:deploy)  cmd_status_deploy ;;
    logs:deploy)    cmd_logs_deploy ;;



    # Production
    start)          cmd_start_native ;;
    start:container) cmd_start_container ;;
    stop:container)  cmd_stop_container ;;
    status:container) cmd_status_container ;;
    logs:container)  cmd_logs_container ;;
    # Deprecated aliases
    dev:docker)      log_warn "dev:docker is deprecated, use dev:container"; cmd_dev_container ;;
    start:docker)    log_warn "start:docker is deprecated, use start:container"; cmd_start_container ;;
    stop)           cmd_stop_native ;;

    # Build & Test
    build)          cmd_build ;;
    test)           cmd_test ;;
    test:e2e)       cmd_test_e2e ;;
    typecheck)      cmd_typecheck ;;
    lint)           cmd_lint ;;
    format)         cmd_format ;;

    # Database
    db:push)        cmd_db_push ;;
    db:generate)    cmd_db_generate ;;
    db:migrate)     cmd_db_migrate ;;
    # Docker
    docker:build)   cmd_docker_build ;;
    docker:dev)     cmd_docker_dev ;;
    docker:down)    cmd_docker_down ;;

    # Other
    clean)          cmd_clean ;;
    reset)          cmd_reset_native ;;
    logs)           log_warn "'logs' is deprecated, use 'logs:compose'"; cmd_logs_compose ;;
    status)         cmd_status_native ;;
    -h|--help|"")   usage ;;
    *)              log_error "Unknown command: $1"; usage; exit 1 ;;
esac
