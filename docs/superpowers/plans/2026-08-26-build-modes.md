# AccessBase 三种构建模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AccessBase 三种独立构建模式（Native/Pixi、Single Container、Docker Compose），统一命令矩阵，支持 dev/start/stop/build/test/reset/status/logs/package 全生命周期。

**Architecture:** 三种模式共享代码库和构建产物，差异仅在基础设施层。Native 模式通过 pixi 管理 PG/Redis，Container 模式通过 Dockerfile，Compose 模式通过 docker-compose.yml。所有模式通过 `accessbase.sh <cmd>:<mode>` 统一入口。

**Tech Stack:** Bash (CLI), Pixi (conda-forge), Docker, Docker Compose, PostgreSQL 16, Redis 7, Node.js 20+, pnpm 9+

**Spec:** `docs/modules/build-modes.md`

## Global Constraints

- 平台: linux-64, osx-arm64, osx-64
- Node.js >= 20.0.0, pnpm >= 9.0.0
- PostgreSQL >= 16.0.0,<17 (conda-forge)
- Redis >= 7.0.0,<8 (conda-forge)
- 端口: PG=5432, Redis=6379, Server=5101, UI=5173
- 数据目录: `.pixi/data/{pg,redis}/` (native), Docker volumes (container/compose)
- 向后兼容: 旧命令保留 2 版本，输出 deprecation warning

---

## Phase 1: Native 模式基础设施

### Task 1: 创建 pixi.toml

**Files:**
- Create: `pixi.toml`

**Interfaces:**
- Produces: `pixi install -e native` 可用, `pixi run dev/start/stop/reset/status` 可用

- [ ] **Step 1: 创建 pixi.toml**

```toml
[project]
name = "accessbase"
version = "0.1.0"
description = "Enterprise access control foundation (IAM)"
channels = ["conda-forge"]
platforms = ["linux-64", "osx-arm64", "osx-64"]

[dependencies]
nodejs = ">=20.0.0"
pnpm = ">=9.0.0"

[feature.native.dependencies]
postgresql = ">=16.0.0,<17"
redis-server = ">=7.0.0,<8"

[feature.native.tasks]
dev = { cmd = "bash accessbase.sh dev:native", description = "Full native dev (PG + Redis + Server + UI)" }
start = { cmd = "bash accessbase.sh start:native", description = "Start native infra only (PG + Redis)" }
stop = { cmd = "bash accessbase.sh stop:native", description = "Stop all native services" }
reset = { cmd = "bash accessbase.sh reset:native", description = "Reset native data and reinitialize" }
status = { cmd = "bash accessbase.sh status:native", description = "Show native service status" }

[environments]
native = ["native"]
```

- [ ] **Step 2: 验证 pixi.toml 语法**

Run: `export PATH="$HOME/.pixi/bin:$PATH" && pixi info`
Expected: 显示项目信息，platforms 包含 linux-64

- [ ] **Step 3: 安装 native 环境**

Run: `export PATH="$HOME/.pixi/bin:$PATH" && pixi install -e native`
Expected: 安装 nodejs, pnpm, postgresql, redis-server 到 `.pixi/envs/native/`

- [ ] **Step 4: 验证依赖可用**

Run: `export PATH="$HOME/.pixi/bin:$PATH" && pixi run -e native node --version && pixi run -e native pnpm --version && pixi run -e native pg_config --version && pixi run -e native redis-server --version`
Expected: 所有命令输出版本号

- [ ] **Step 5: 更新 .gitignore**

在 `.gitignore` 中添加:
```gitignore
# Pixi native data
.pixi/data/
.pixi/env/
```

- [ ] **Step 6: Commit**

```bash
git add pixi.toml pixi.lock .gitignore
git commit -m "feat: add pixi.toml for native build mode"
```

---

### Task 2: 创建端口冲突检测脚本

**Files:**
- Create: `scripts/native/_ports.sh`

**Interfaces:**
- Produces: `detect_required_ports` 函数, `check_port_available` 函数
- Used by: Task 3-6 的 pg-init/start, redis-start

- [ ] **Step 1: 创建 scripts/native/ 目录**

```bash
mkdir -p scripts/native
```

- [ ] **Step 2: 创建 _ports.sh**

```bash
#!/usr/bin/env bash
# _ports.sh — Port conflict detection utilities for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

# Check if a port is in use (cross-platform: Linux + macOS)
# Args: $1=port, $2=service_name
# Returns: 0=free, 1=in_use
check_port_available() {
    local port=$1
    local service=$2

    # Use lsof (works on both Linux and macOS)
    if command -v lsof &>/dev/null; then
        local pid
        pid=$(lsof -ti :"$port" 2>/dev/null | head -1)
        if [ -n "$pid" ]; then
            local proc
            proc=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
            log_error "Port $port already in use (needed for $service)"
            log_error "  Process: $proc (PID: $pid)"
            log_error "  Fix: kill $pid or set ${service^^}_PORT=<other>"
            return 1
        fi
    elif command -v ss &>/dev/null; then
        if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
            local pid
            pid=$(ss -tlnp 2>/dev/null | grep ":${port} " | sed 's/.*pid=\([0-9]*\).*/\1/' | head -1)
            local proc
            proc=$(ps -p "${pid:-0}" -o comm= 2>/dev/null || echo "unknown")
            log_error "Port $port already in use (needed for $service)"
            log_error "  Process: $proc (PID: ${pid:-unknown})"
            log_error "  Fix: kill ${pid:-<PID>} or set ${service^^}_PORT=<other>"
            return 1
        fi
    fi

    return 0
}

# Detect all required ports, exit on conflict
detect_required_ports() {
    local pg_port="${PG_PORT:-5432}"
    local redis_port="${REDIS_PORT:-6379}"
    local server_port="${SERVER_PORT:-5101}"
    local ui_port="${UI_PORT:-5173}"

    local has_conflict=0

    check_port_available "$pg_port" "PostgreSQL" || has_conflict=1
    check_port_available "$redis_port" "Redis" || has_conflict=1
    check_port_available "$server_port" "Server" || has_conflict=1
    check_port_available "$ui_port" "Admin UI" || has_conflict=1

    if [ $has_conflict -ne 0 ]; then
        log_error "Port conflicts detected. Resolve before starting."
        exit 1
    fi
}
```

- [ ] **Step 3: 设置执行权限**

```bash
chmod +x scripts/native/_ports.sh
```

- [ ] **Step 4: 验证脚本语法**

Run: `bash -n scripts/native/_ports.sh`
Expected: 无输出（语法正确）

- [ ] **Step 5: Commit**

```bash
git add scripts/native/_ports.sh
git commit -m "feat: add port conflict detection for native mode"
```

---

### Task 3: 创建 PostgreSQL 初始化脚本

**Files:**
- Create: `scripts/native/pg-init.sh`

**Interfaces:**
- Consumes: `_common.sh` 的 `log_info/log_ok/log_warn/log_error`
- Produces: `.pixi/data/pg/` 目录（PG_VERSION 存在表示已初始化）
- Used by: Task 7 的 `cmd_dev_native()`

- [ ] **Step 1: 创建 pg-init.sh**

```bash
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
```

- [ ] **Step 2: 设置执行权限**

```bash
chmod +x scripts/native/pg-init.sh
```

- [ ] **Step 3: 验证脚本语法**

Run: `bash -n scripts/native/pg-init.sh`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add scripts/native/pg-init.sh
git commit -m "feat: add PostgreSQL init script for native mode"
```

---

### Task 4: 创建 PostgreSQL 启动/停止脚本

**Files:**
- Create: `scripts/native/pg-start.sh`
- Create: `scripts/native/pg-stop.sh`

**Interfaces:**
- Consumes: `PG_DATA`, `PG_PORT` 环境变量
- Produces: PostgreSQL 服务运行/停止
- Used by: Task 7 的 `cmd_dev_native()`

- [ ] **Step 1: 创建 pg-start.sh**

```bash
#!/usr/bin/env bash
# pg-start.sh — Start PostgreSQL for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

PG_DATA="${PROJECT_ROOT}/.pixi/data/pg"
PG_PORT="${PG_PORT:-5432}"

pg_start() {
    if pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
        log_ok "PostgreSQL already running on port $PG_PORT"
        return 0
    fi

    if [ ! -f "$PG_DATA/PG_VERSION" ]; then
        log_error "PG not initialized. Run: bash scripts/native/pg-init.sh"
        exit 1
    fi

    log_info "Starting PostgreSQL on port $PG_PORT..."
    pg_ctl -D "$PG_DATA" -l "$PG_DATA/logfile" -w start

    for i in {1..30}; do
        if pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
            log_ok "PostgreSQL ready on port $PG_PORT"
            return 0
        fi
        sleep 1
    done

    log_error "PostgreSQL failed to start"
    exit 1
}

pg_start
```

- [ ] **Step 2: 创建 pg-stop.sh**

```bash
#!/usr/bin/env bash
# pg-stop.sh — Stop PostgreSQL for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

PG_DATA="${PROJECT_ROOT}/.pixi/data/pg"
PG_PORT="${PG_PORT:-5432}"

pg_stop() {
    if ! pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
        log_info "PostgreSQL not running"
        return 0
    fi

    log_info "Stopping PostgreSQL..."
    pg_ctl -D "$PG_DATA" stop -m fast
    log_ok "PostgreSQL stopped"
}

pg_stop
```

- [ ] **Step 3: 设置执行权限**

```bash
chmod +x scripts/native/pg-start.sh scripts/native/pg-stop.sh
```

- [ ] **Step 4: 验证脚本语法**

Run: `bash -n scripts/native/pg-start.sh && bash -n scripts/native/pg-stop.sh`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add scripts/native/pg-start.sh scripts/native/pg-stop.sh
git commit -m "feat: add PostgreSQL start/stop scripts for native mode"
```

---

### Task 5: 创建 Redis 启动/停止脚本

**Files:**
- Create: `scripts/native/redis-start.sh`
- Create: `scripts/native/redis-stop.sh`

**Interfaces:**
- Consumes: `REDIS_PORT` 环境变量
- Produces: Redis 服务运行/停止, `.pixi/data/redis/redis.conf`
- Used by: Task 7 的 `cmd_dev_native()`

- [ ] **Step 1: 创建 redis-start.sh**

```bash
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
```

- [ ] **Step 2: 创建 redis-stop.sh**

```bash
#!/usr/bin/env bash
# redis-stop.sh — Stop Redis for native mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

REDIS_PORT="${REDIS_PORT:-6379}"

redis_stop() {
    if ! redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
        log_info "Redis not running"
        return 0
    fi

    log_info "Stopping Redis..."
    redis-cli -p "$REDIS_PORT" shutdown nosave
    log_ok "Redis stopped"
}

redis_stop
```

- [ ] **Step 3: 设置执行权限**

```bash
chmod +x scripts/native/redis-start.sh scripts/native/redis-stop.sh
```

- [ ] **Step 4: 验证脚本语法**

Run: `bash -n scripts/native/redis-start.sh && bash -n scripts/native/redis-stop.sh`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add scripts/native/redis-start.sh scripts/native/redis-stop.sh
git commit -m "feat: add Redis start/stop scripts for native mode"
```

---

### Task 6: 在 _common.sh 中添加 ensure_pixi 和 configure_native_urls

**Files:**
- Modify: `scripts/_common.sh`

**Interfaces:**
- Consumes: `$HOME/.pixi/bin/pixi`
- Produces: `ensure_pixi()`, `configure_native_urls()` 函数
- Used by: Task 7 的 `cmd_dev_native()` 等

- [ ] **Step 1: 添加 ensure_pixi 函数**

在 `scripts/_common.sh` 的 `ensure_pnpm()` 函数后添加:

```bash
# Ensure pixi is available
ensure_pixi() {
    export PATH="$HOME/.pixi/bin:$PATH"
    if ! command -v pixi &>/dev/null; then
        log_error "pixi not found. Install: curl -fsSL https://pixi.sh/install.sh | bash"
        exit 1
    fi
}
```

- [ ] **Step 2: 添加 configure_native_urls 函数**

在 `ensure_pixi()` 后添加:

```bash
# Auto-configure DATABASE_URL/REDIS_URL for native mode
configure_native_urls() {
    local pg_port="${PG_PORT:-5432}"
    local redis_port="${REDIS_PORT:-6379}"

    if [ -z "${DATABASE_URL:-}" ]; then
        export DATABASE_URL="postgresql://accessbase:accessbase_dev@localhost:${pg_port}/accessbase"
        log_info "DATABASE_URL auto-set to localhost:${pg_port}"
    else
        log_info "DATABASE_URL already set: ${DATABASE_URL%%@*}@..."
    fi

    if [ -z "${REDIS_URL:-}" ]; then
        export REDIS_URL="redis://localhost:${redis_port}"
        log_info "REDIS_URL auto-set to localhost:${redis_port}"
    else
        log_info "REDIS_URL already set: $REDIS_URL"
    fi
}
```

- [ ] **Step 3: 验证语法**

Run: `bash -n scripts/_common.sh`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add scripts/_common.sh
git commit -m "feat: add ensure_pixi and configure_native_urls to common"
```

---

### Task 7: 在 accessbase.sh 中添加 native 命令

**Files:**
- Modify: `accessbase.sh`

**Interfaces:**
- Consumes: Task 2-6 的所有脚本和函数
- Produces: `dev:native`, `start:native`, `stop:native`, `reset:native`, `status:native` 命令

- [ ] **Step 1: 添加 cmd_dev_native 函数**

在 `cmd_dev()` 函数后添加:

```bash
# ===== Native Commands (Pixi-managed) =====

cmd_dev_native() {
    ensure_pixi
    ensure_node
    ensure_pnpm

    # Ensure pixi native env binaries are on PATH (initdb, pg_ctl, redis-server)
    export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$PATH"

    # Detect port conflicts
    source "${SCRIPT_DIR}/scripts/native/_ports.sh"
    detect_required_ports

    # Initialize + start infra
    log_info "Starting native infrastructure..."
    bash "${SCRIPT_DIR}/scripts/native/pg-init.sh"
    bash "${SCRIPT_DIR}/scripts/native/pg-start.sh"
    bash "${SCRIPT_DIR}/scripts/native/redis-start.sh"

    # Auto-configure URLs
    configure_native_urls

    # Push database schema (don't swallow errors)
    log_info "Pushing database schema..."
    pnpm db:push || log_warn "Schema push failed (DB may not be ready)"

    # Cleanup on exit (with guard to prevent double execution)
    _native_cleaned=0
    cleanup_native() {
        [ "$_native_cleaned" -eq 1 ] && return
        _native_cleaned=1
        log_info "Stopping native services..."
        bash "${SCRIPT_DIR}/scripts/native/pg-stop.sh"
        bash "${SCRIPT_DIR}/scripts/native/redis-stop.sh"
        log_ok "Native services stopped"
    }
    trap cleanup_native EXIT

    # Start dev servers in parallel
    log_info "Starting dev servers..."
    log_ok "AccessBase running:"
    log_info "  Frontend:   http://localhost:${UI_PORT:-5173}"
    log_info "  Backend:    http://localhost:${SERVER_PORT:-5101}"
    log_info "  PostgreSQL: localhost:${PG_PORT:-5432}"
    log_info "  Redis:      localhost:${REDIS_PORT:-6379}"

    pnpm --filter @accessbase/server dev &
    local server_pid=$!
    pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &
    local ui_pid=$!
    wait $server_pid $ui_pid
}
```

- [ ] **Step 2: 添加 cmd_start_native 函数**

```bash
cmd_start_native() {
    ensure_pixi

    # Ensure pixi native env binaries are on PATH
    export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$PATH"

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
```

- [ ] **Step 3: 添加 cmd_stop_native 函数**

```bash
cmd_stop_native() {
    bash "${SCRIPT_DIR}/scripts/native/pg-stop.sh"
    bash "${SCRIPT_DIR}/scripts/native/redis-stop.sh"
    log_ok "Native services stopped"
}
```

- [ ] **Step 4: 添加 cmd_reset_native 函数**

```bash
cmd_reset_native() {
    log_warn "This will DELETE all native data and reinitialize"
    cmd_stop_native
    log_info "Deleting data..."
    rm -rf "${PROJECT_ROOT}/.pixi/data/pg" "${PROJECT_ROOT}/.pixi/data/redis"
    log_info "Reinitializing..."
    bash "${SCRIPT_DIR}/scripts/native/pg-init.sh"
    log_ok "Reset complete"
}
```

- [ ] **Step 5: 添加 cmd_status_native 函数**

```bash
cmd_status_native() {
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
```

- [ ] **Step 6: 在 case 语句中添加 native 命令**

在 `case "${1:-}" in` 的 `# Development` 部分添加:

```bash
    # Native commands
    dev:native)     cmd_dev_native ;;
    start:native)   cmd_start_native ;;
    stop:native)    cmd_stop_native ;;
    reset:native)   cmd_reset_native ;;
    status:native)  cmd_status_native ;;
```

- [ ] **Step 7: 更新 usage() 帮助文本**

在 `Development:` 部分添加:

```bash
  dev:native       Native dev (Pixi-managed PG + Redis + backend + frontend)
  start:native     Start native infra only (PG + Redis)
  stop:native      Stop all native services
  reset:native     Reset native data and reinitialize
  status:native    Show native service status
```

- [ ] **Step 8: 验证脚本语法**

Run: `bash -n accessbase.sh`
Expected: 无输出

- [ ] **Step 9: Commit**

```bash
git add accessbase.sh
git commit -m "feat: add native build mode commands to accessbase.sh"
```

---

### Task 8: 端到端测试 Native 模式

**Files:**
- Test: 手动验证

- [ ] **Step 1: 清理环境（如果有旧数据）**

Run: `rm -rf .pixi/data/pg .pixi/data/redis`

- [ ] **Step 2: 测试 start:native**

Run: `export PATH="$HOME/.pixi/bin:$PATH" && bash accessbase.sh start:native`
Expected: PostgreSQL 和 Redis 启动成功

- [ ] **Step 3: 验证服务运行**

Run: `pg_isready -h localhost -p 5432 && redis-cli -p 6379 ping`
Expected: `accepting connections` + `PONG`

- [ ] **Step 4: 测试 status:native**

Run: `bash accessbase.sh status:native`
Expected: PostgreSQL: RUNNING, Redis: RUNNING

- [ ] **Step 5: 测试 stop:native**

Run: `bash accessbase.sh stop:native`
Expected: 服务停止

- [ ] **Step 6: 再次验证**

Run: `pg_isready -h localhost -p 5432 || echo "PG stopped"; redis-cli -p 6379 ping 2>&1 || echo "Redis stopped"`
Expected: 两个服务都停止

- [ ] **Step 7: 测试 reset:native**

Run: `bash accessbase.sh reset:native`
Expected: 数据删除，重新初始化

- [ ] **Step 8: 测试 dev:native（完整流程）**

Run: `bash accessbase.sh dev:native`
Expected: 所有服务启动，访问 http://localhost:5173 可用

- [ ] **Step 9: Commit 测试结果（如果需要修复）**

```bash
git add -A
git commit -m "fix: native mode fixes from end-to-end testing"
```

---

## Phase 2: Container 模式改进

### Task 9: 重命名 Container 命令 + 添加新命令

**Files:**
- Modify: `accessbase.sh`

- [ ] **Step 1: 重命名 cmd_dev_docker → cmd_dev_container**

在 `accessbase.sh` 中:
1. 将 `cmd_dev_docker()` 重命名为 `cmd_dev_container()`
2. 添加 `cmd_stop_container()`, `cmd_status_container()`, `cmd_logs_container()`

- [ ] **Step 2: 添加 cmd_stop_container**

```bash
cmd_stop_container() {
    local D=$(get_docker_cmd)
    log_info "Stopping container services..."
    $D stop accessbase-dev 2>/dev/null || true
    $D rm -f accessbase-dev 2>/dev/null || true
    $D stop accessbase 2>/dev/null || true
    $D rm -f accessbase 2>/dev/null || true
    log_ok "Container services stopped"
}
```

- [ ] **Step 3: 添加 cmd_status_container**

```bash
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
```

- [ ] **Step 4: 添加 cmd_logs_container**

```bash
cmd_logs_container() {
    local D=$(get_docker_cmd)
    local container="${1:-accessbase-dev}"
    $D logs -f "$container"
}
```

- [ ] **Step 5: 更新 case 语句**

```bash
    # Container commands
    dev:container)   cmd_dev_container ;;
    start:container) cmd_start_container ;;
    stop:container)  cmd_stop_container ;;
    status:container) cmd_status_container ;;
    logs:container)  cmd_logs_container ;;

    # Deprecated aliases
    dev:docker)      log_warn "dev:docker is deprecated, use dev:container"; cmd_dev_container ;;
    start:docker)    log_warn "start:docker is deprecated, use start:container"; cmd_start_container ;;
```

- [ ] **Step 6: 更新 usage()**

```bash
  dev:container    Single container dev (PG + Redis + Server + UI in one container)
  start:container  Production single container
  stop:container   Stop container services
  status:container Show container status
  logs:container   Show container logs
```

- [ ] **Step 7: Commit**

```bash
git add accessbase.sh
git commit -m "feat: add container mode commands, deprecate docker aliases"
```

---

### Task 10: 改进 Dockerfile.dev entrypoint

**Files:**
- Modify: `docker/entrypoint-dev.sh`

- [ ] **Step 1: 添加健康检查和优雅关闭**

```bash
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

# Push schema
echo "[entrypoint] Pushing database schema..."
pnpm db:push 2>/dev/null || echo "[entrypoint] Schema push skipped"

# Start application
echo "[entrypoint] Starting application..."
exec "$@"
```

- [ ] **Step 2: Commit**

```bash
git add docker/entrypoint-dev.sh
git commit -m "feat: improve Dockerfile.dev entrypoint with health checks and graceful shutdown"
```

---

## Phase 3: Compose 模式改进

### Task 11: 修复 docker-compose.prod.yml 环境变量外部化

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: 使用环境变量默认值模式**

```yaml
services:
  server:
    image: ghcr.io/accessbase/accessbase:latest
    ports:
      - "5101:5101"
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL:-postgresql://accessbase:accessbase@localhost:5432/accessbase}
      REDIS_URL: ${REDIS_URL:-redis://localhost:6379}
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET required}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5101/health/live"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 60s
    restart: unless-stopped
    volumes:
      - accessbase-data:/var/lib/postgresql/data
      - accessbase-redis:/var/lib/redis

volumes:
  accessbase-data:
  accessbase-redis:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat: externalize prod compose environment variables"
```

---

### Task 12: 添加 dev compose 服务健康检查

**Files:**
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: 为 server 添加健康检查**

在 `server` 服务中添加:

```yaml
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5101/health/live"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 30s
```

- [ ] **Step 2: 为 admin-ui 添加健康检查和依赖**

在 `admin-ui` 服务中添加:

```yaml
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5173"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 20s
    depends_on:
      server:
        condition: service_healthy
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat: add health checks to dev compose services"
```

---

### Task 13: 添加 Compose 模式命令

**Files:**
- Modify: `accessbase.sh`

- [ ] **Step 1: 添加 cmd_start_compose**

```bash
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
```

- [ ] **Step 2: 添加 cmd_stop_compose**

```bash
cmd_stop_compose() {
    local DC=$(get_docker_compose_cmd)
    log_info "Stopping compose services..."
    $DC -f docker-compose.dev.yml down 2>/dev/null || true
    $DC -f docker-compose.yml down 2>/dev/null || true
    log_ok "Compose services stopped"
}
```

- [ ] **Step 3: 添加 cmd_status_compose**

```bash
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
```

- [ ] **Step 4: 添加 cmd_logs_compose**

```bash
cmd_logs_compose() {
    local DC=$(get_docker_compose_cmd)
    $DC -f docker-compose.dev.yml logs -f
}
```

- [ ] **Step 5: 更新 case 语句**

```bash
    # Compose commands
    dev:compose)    cmd_dev_compose ;;
    start:compose)  cmd_start_compose ;;
    start:prod)     cmd_start ;;
    stop:compose)   cmd_stop_compose ;;
    status:compose) cmd_status_compose ;;
    logs:compose)   cmd_logs_compose ;;
```

- [ ] **Step 6: 更新 usage()**

```bash
  dev:compose      Compose mode dev (DB + Redis in separate containers)
  start:compose    Start compose infrastructure only
  start:prod       Production start (Compose mode)
  stop:compose     Stop compose services
  status:compose   Show compose status
  logs:compose     Show compose logs
```

- [ ] **Step 7: Commit**

```bash
git add accessbase.sh
git commit -m "feat: add compose mode commands"
```

---

## Phase 4: 统一命令 + 向后兼容

### Task 14: 实现无后缀别名（向后兼容）

**Files:**
- Modify: `accessbase.sh`

- [ ] **Step 1: 更新 case 语句中的向后兼容别名**

```bash
    # Backward-compatible aliases (deprecated)
    dev)            log_warn "'dev' is deprecated, use 'dev:compose' or 'dev:native'"; cmd_dev_compose ;;
    start)          log_warn "'start' is deprecated, use 'start:prod'"; cmd_start ;;
    stop)           log_warn "'stop' is deprecated, use 'stop:compose' or 'stop:native'"; cmd_stop ;;
    reset)          log_warn "'reset' is deprecated, use 'reset:native' or 'reset:compose'"; cmd_reset ;;
    logs)           log_warn "'logs' is deprecated, use 'logs:compose'"; cmd_logs_compose ;;
    status)         log_warn "'status' is deprecated, use 'status:native' or 'status:compose'"; cmd_status ;;
```

- [ ] **Step 2: Commit**

```bash
git add accessbase.sh
git commit -m "feat: add backward-compatible command aliases with deprecation warnings"
```

---

### Task 15: 更新文档

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` (在 Commands 部分)

- [ ] **Step 1: 更新 README.md Getting Started**

添加三种模式的快速开始指南:

```markdown
## Getting Started

### Prerequisites

- **Native mode:** [pixi](https://pixi.sh) installed
- **Container mode:** Docker installed
- **Compose mode:** Docker + Docker Compose installed

### Quick Start

**Native (recommended for development):**
```bash
pixi install -e native
pixi run dev
```

**Single Container:**
```bash
bash accessbase.sh dev:container
```

**Docker Compose:**
```bash
bash accessbase.sh dev:compose
```
```

- [ ] **Step 2: 更新 AGENTS.md Commands 部分**

```markdown
## Commands

```bash
# Native mode (Pixi)
bash accessbase.sh dev:native        # Full dev
bash accessbase.sh start:native      # Start infra only
bash accessbase.sh stop:native       # Stop all
bash accessbase.sh reset:native      # Reset data
bash accessbase.sh status:native     # Show status

# Container mode (Docker)
bash accessbase.sh dev:container     # Full dev
bash accessbase.sh start:container   # Production
bash accessbase.sh stop:container    # Stop
bash accessbase.sh status:container  # Status
bash accessbase.sh logs:container    # Logs

# Compose mode (Docker Compose)
bash accessbase.sh dev:compose       # Full dev
bash accessbase.sh start:compose     # Start infra
bash accessbase.sh start:prod        # Production
bash accessbase.sh stop:compose      # Stop
bash accessbase.sh status:compose    # Status
bash accessbase.sh logs:compose      # Logs

# Shared
bash accessbase.sh build             # Build all packages
bash accessbase.sh test              # Run tests
bash accessbase.sh typecheck         # Type check
bash accessbase.sh lint              # Lint
bash accessbase.sh format            # Format
bash accessbase.sh db:push           # Push schema
bash accessbase.sh clean             # Clean artifacts
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: update README and AGENTS with three build modes"
```

---

## Phase 5: 验证

### Task 16: 端到端验证三种模式

- [ ] **Step 1: 验证 Native 模式**

```bash
# 清理
rm -rf .pixi/data/pg .pixi/data/redis

# 测试
bash accessbase.sh status:native    # 应显示 STOPPED
bash accessbase.sh start:native     # 应启动成功
bash accessbase.sh status:native    # 应显示 RUNNING
bash accessbase.sh stop:native      # 应停止成功
bash accessbase.sh dev:native       # 应启动全栈
# Ctrl+C 停止
```

- [ ] **Step 2: 验证 Container 模式**

```bash
bash accessbase.sh dev:container    # 应构建并启动
bash accessbase.sh status:container # 应显示容器状态
bash accessbase.sh logs:container   # 应显示日志
bash accessbase.sh stop:container   # 应停止
```

- [ ] **Step 3: 验证 Compose 模式**

```bash
bash accessbase.sh dev:compose      # 应启动所有服务
bash accessbase.sh status:compose   # 应显示状态
bash accessbase.sh logs:compose     # 应显示日志
bash accessbase.sh stop:compose     # 应停止
```

- [ ] **Step 4: 验证向后兼容**

```bash
bash accessbase.sh dev              # 应输出 deprecation warning 并运行 dev:compose
bash accessbase.sh stop             # 应输出 deprecation warning 并停止所有
```

- [ ] **Step 5: 验证健康检查**

```bash
# Compose 模式
bash accessbase.sh dev:compose
# 等待 30s
curl -sf http://localhost:5101/health/live && echo "Health OK"
curl -sf http://localhost:5173 && echo "UI OK"
```

- [ ] **Step 6: Final Commit**

```bash
git add -A
git commit -m "feat: complete three build modes implementation"
```
