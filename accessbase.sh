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

Commands:
  dev           Start development servers (backend + frontend)
  build         Build all packages
  test          Run all tests
  typecheck     Run TypeScript type checking
  lint          Run linting
  format        Format code
  docker        Build and run Docker image
  docker:dev    Start dev services (PostgreSQL + Redis)
  docker:down   Stop dev services
  db:push       Push database schema
  db:generate   Generate migration files
  clean         Clean build artifacts
  status        Show project status

EOF
}

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

cmd_docker() {
    if ! has_docker; then
        log_error "Docker not available"
        exit 1
    fi
    log_info "Building Docker image..."
    docker build -t accessbase:latest .
    log_info "Starting container..."
    docker run -d --name accessbase \
        -p 5101:5101 \
        -e JWT_SECRET="${JWT_SECRET:-dev-secret}" \
        accessbase:latest
    log_ok "AccessBase running at http://localhost:5101"
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
    $DC -f docker-compose.dev.yml down 2>/dev/null || true
    $DC -f docker-compose.prod.yml down 2>/dev/null || true
    log_ok "Services stopped"
}

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
        if [ -d "apps/$app/dist" ] || [ -d "apps/$app/dist" ]; then
            echo "  $app: built"
        else
            echo "  $app: not built"
        fi
    done
}

# Main
case "${1:-}" in
    dev)           cmd_dev ;;
    build)         cmd_build ;;
    test)          cmd_test ;;
    typecheck)     cmd_typecheck ;;
    lint)          cmd_lint ;;
    format)        cmd_format ;;
    docker)        cmd_docker ;;
    docker:dev)    cmd_docker_dev ;;
    docker:down)   cmd_docker_down ;;
    db:push)       cmd_db_push ;;
    db:generate)   cmd_db_generate ;;
    clean)         cmd_clean ;;
    status)        cmd_status ;;
    -h|--help|"")  usage ;;
    *)             log_error "Unknown command: $1"; usage; exit 1 ;;
esac
