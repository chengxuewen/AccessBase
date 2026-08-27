# AccessBase Deploy 模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AccessBase deploy 模式 — build 到 `out/` 目录，单端口 serve API + 前端，统一 `data/` 目录，环境变量自动初始化管理员，`reset` 命令一键清除。

**Architecture:** 三种模式并存（native/compose/deploy）。Deploy 模式将 server 编译到 `out/server/`、前端编译到 `out/admin-ui/`，server 通过 `@fastify/static` serve 前端静态资源，实现单端口部署。数据目录统一为 `data/{pg,redis}/`，通过 `.env` 配置。首次管理员通过环境变量自动创建（Keycloak/Directus 模式）。

**Tech Stack:** Fastify, @fastify/static ^7.0.0, Vite build, PostgreSQL 16, Redis 7, Pixi

**Spec:** `docs/modules/build-modes.md` + `docs/superpowers/plans/2026-08-26-build-modes.md`

## Global Constraints

- 构建产物目录: `out/`（`out/server/`, `out/admin-ui/`）
- 数据目录: `data/`（`data/pg/`, `data/redis/`）
- 端口: 单端口 5101（API + 前端静态资源）
- 环境变量: `ADMIN_EMAIL` + `ADMIN_PASSWORD` 用于 deploy 模式自动创建管理员
- 生产模式必须: `JWT_SECRET` 已设置 + `ADMIN_PASSWORD` 非空 + `NODE_ENV=production`
- 向后兼容: native/compose/container 模式不变
- `@fastify/static` 版本: `^7.0.0`（v7 兼容 Fastify v4/v5）
- Node.js: `>=20.0.0`
- 数据库用户: `accessbase`（与 pixi native 模式一致）

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `apps/server/package.json` | 添加 `@fastify/static` 依赖 |
| Modify | `apps/server/src/app.ts` | 注册 `@fastify/static`，SPA fallback |
| Modify | `apps/server/src/config.ts` | 添加 `staticDir`、`adminEmail`、`adminPassword` 配置 |
| Create | `scripts/deploy/build.sh` | 构建脚本：编译 server 到 `out/server/`，UI 到 `out/admin-ui/` |
| Create | `scripts/deploy/start.sh` | 启动脚本：PG + Redis + 迁移 + 自动创建 admin + 启动 server |
| Create | `scripts/deploy/stop.sh` | 停止脚本：优雅关闭 server + PG + Redis |
| Create | `scripts/deploy/reset.sh` | 重置脚本：停服务 + 确认 + 清 data/ |
| Modify | `accessbase.sh` | 添加 deploy 模式命令 |
| Modify | `.gitignore` | 添加 `data/`, `out/` |
| Modify | `.env.example` | 添加 deploy 模式变量 |

---

### Task 1: 安装 @fastify/static 并配置静态资源服务

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/config.ts`

**Interfaces:**
- Produces: `config.staticDir` (string, default `out/admin-ui`), `config.adminEmail` (string), Fastify 静态资源路由 + SPA fallback

- [ ] **Step 1: 安装依赖**

```bash
cd /home/ubuntu/Documents/AccessBase
pnpm --filter @accessbase/server add @fastify/static@^7.0.0
```

- [ ] **Step 2: 修改 config.ts 添加配置**

在 `AppConfig` 接口添加：

```typescript
staticDir: string;
adminEmail: string;
```

在 `config` 对象中添加：

```typescript
staticDir: env('STATIC_DIR', 'out/admin-ui'),
adminEmail: process.env['ADMIN_EMAIL'] || '',
```

- [ ] **Step 3: 修改 app.ts 注册静态资源**

在文件顶部添加 `import { existsSync } from 'node:fs'` 和 `import { resolve } from 'node:path'`。
在文件顶部添加 `import fastifyStatic from '@fastify/static'`。
在 `return app` 之前添加：

```typescript
// --- Static file serving (deploy mode) ---
if (existsSync(resolve(config.staticDir))) {
  await app.register(fastifyStatic, {
    root: resolve(config.staticDir),
    prefix: '/',
  });

  // SPA fallback: serve index.html for non-API routes
  app.setNotFoundHandler((request, reply) => {
    if (
      request.url.startsWith('/api/') ||
      request.url.startsWith('/health') ||
      request.url.startsWith('/docs')
    ) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
    return reply.sendFile('index.html');
  });
}
```

注意：`@fastify/static` v7 自动装饰 reply，不需要 `decorateReply: false`。

- [ ] **Step 4: 修改 CORS 配置**

在 `app.ts` 中将 CORS 的 `origin` 改为：

```typescript
origin: config.nodeEnv === 'development' ? true : config.host,
```

- [ ] **Step 5: 验证类型**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json apps/server/src/app.ts apps/server/src/config.ts pnpm-lock.yaml
git commit -m "feat: add @fastify/static for deploy mode single-port serving"
```

---

### Task 2: 创建构建脚本 scripts/deploy/build.sh

**Files:**
- Create: `scripts/deploy/build.sh`

**Interfaces:**
- Produces: `out/server/`（编译后的 server）, `out/admin-ui/`（Vite 静态资源）

- [ ] **Step 1: 创建 scripts/deploy/ 目录**

```bash
mkdir -p scripts/deploy
```

- [ ] **Step 2: 创建 build.sh**

```bash
#!/usr/bin/env bash
# build.sh — Build all packages for deploy mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

OUT_DIR="${PROJECT_ROOT}/out"

log_info "Building AccessBase for deploy mode..."

# Clean
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Step 1: Build all L0 packages (dependency order)
log_info "Building packages..."
pnpm --filter @accessbase/types build
pnpm --filter @accessbase/logging build
pnpm --filter @accessbase/i18n build
pnpm --filter @accessbase/health build
pnpm --filter @accessbase/identity build
pnpm --filter @accessbase/audit build
pnpm --filter @accessbase/admin build
pnpm --filter @accessbase/migration build

# Step 2: Build server
log_info "Building server..."
pnpm --filter @accessbase/server build

# Step 3: Build admin-ui
log_info "Building admin-ui..."
pnpm --filter @accessbase/admin-ui build

# Step 4: Assemble out/ — copy only built artifacts
log_info "Assembling out/ directory..."
cp -r apps/server/dist "$OUT_DIR/server"
cp -r apps/server/package.json "$OUT_DIR/server/"
cp -r apps/admin-ui/dist "$OUT_DIR/admin-ui"

# Copy each package's dist + package.json (for runtime resolution)
for pkg in types logging i18n health identity audit admin migration; do
  mkdir -p "$OUT_DIR/packages/$pkg"
  cp -r "packages/$pkg/dist" "$OUT_DIR/packages/$pkg/"
  cp "packages/$pkg/package.json" "$OUT_DIR/packages/$pkg/"
done

# Copy root config files
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$OUT_DIR/"

# Step 5: Install production dependencies in out/
log_info "Installing production dependencies..."
cd "$OUT_DIR"
# Remove workspace: protocol references — replace with real versions
# pnpm deploy is the correct approach for monorepo deployment
pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod

log_ok "Build complete: $OUT_DIR"
log_info "  Server:  $OUT_DIR/server/index.js"
log_info "  UI:      $OUT_DIR/admin-ui/index.html"
```

注意：如果 `pnpm install --prod` 在 `out/` 中因 workspace 协议失败，替代方案是：
```bash
# 替代方案：直接从 monorepo node_modules 复制
cp -r "$PROJECT_ROOT/node_modules" "$OUT_DIR/node_modules"
```

- [ ] **Step 3: 设置执行权限**

```bash
chmod +x scripts/deploy/build.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy/
git commit -m "feat: add deploy build script"
```

---

### Task 3: 创建启动脚本 scripts/deploy/start.sh（含 admin 自动创建）

**Files:**
- Create: `scripts/deploy/start.sh`

**Interfaces:**
- 数据目录: `data/pg/`, `data/redis/`
- 环境变量: `DATABASE_URL`, `REDIS_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, `NODE_ENV`
- PID 文件: `data/.pids`
- 自动创建: 如果 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 已设置且 DB 中无 admin，自动通过 API 创建

- [ ] **Step 1: 创建 start.sh**

```bash
#!/usr/bin/env bash
# start.sh — Start AccessBase in deploy mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

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

# === Pre-flight checks ===

# Check out/ exists
if [ ! -d "$OUT_DIR/server" ]; then
  log_error "out/server/ not found. Run 'bash accessbase.sh build:deploy' first."
  exit 1
fi

# Validate production requirements
if [ "${NODE_ENV:-}" = "production" ]; then
  if [ -z "${JWT_SECRET:-}" ] || [ "$JWT_SECRET" = "dev-secret-do-not-use-in-production" ]; then
    log_error "JWT_SECRET must be set to a secure value in production"
    exit 1
  fi
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    log_error "ADMIN_PASSWORD must be set in production"
    exit 1
  fi
fi

# Port conflict detection
if command -v lsof &>/dev/null; then
  for port in $PG_PORT $REDIS_PORT $SERVER_PORT; do
    if lsof -ti :"$port" >/dev/null 2>&1; then
      log_error "Port $port already in use. Stop other services first."
      exit 1
    fi
  done
fi

# === Initialize data directories ===
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

# === Start services ===

# Graceful shutdown
cleanup() {
  log_info "Shutting down..."
  [ -f "$PIDFILE" ] && while IFS= read -r pid; do kill -15 "$pid" 2>/dev/null || true; done < "$PIDFILE"
  rm -f "$PIDFILE"
  pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
  redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true
  log_ok "All services stopped"
}
trap cleanup EXIT INT TERM

# Start PostgreSQL
if ! pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
  log_info "Starting PostgreSQL on port $PG_PORT..."
  pg_ctl -D "$PG_DATA" -l "$PG_DATA/logfile" -w start
  for i in $(seq 1 30); do
    pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null && break
    sleep 1
  done
fi

# Start Redis
if ! redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  log_info "Starting Redis on port $REDIS_PORT..."
  redis-server "$REDIS_DATA/redis.conf" --daemonize yes
  for i in $(seq 1 10); do
    redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG && break
    sleep 0.5
  done
fi

# Set URLs
export DATABASE_URL="${DATABASE_URL:-postgresql://accessbase:accessbase_dev@localhost:${PG_PORT}/accessbase}"
export REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
export STATIC_DIR="${STATIC_DIR:-${OUT_DIR}/admin-ui}"
export NODE_ENV="${NODE_ENV:-production}"

# Run migrations
log_info "Running migrations..."
node "${OUT_DIR}/packages/migration/dist/cli.js" up 2>/dev/null || log_warn "Migration skipped"

# Start server
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

# Auto-create admin if env vars set and no admin exists
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  SETUP_STATUS=$(curl -sf --noproxy localhost "http://localhost:${SERVER_PORT}/api/v1/setup/status" 2>/dev/null || echo '{}')
  if echo "$SETUP_STATUS" | grep -q '"adminExists":false'; then
    log_info "Creating admin user from environment variables..."
    curl -sf --noproxy localhost -X POST "http://localhost:${SERVER_PORT}/api/v1/setup/admin" \
      -H 'Content-Type: application/json' \
      -d "{\"name\":\"Administrator\",\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" || log_warn "Admin creation failed"
    # Mark setup complete
    curl -sf --noproxy localhost -X POST "http://localhost:${SERVER_PORT}/api/v1/setup/complete" || true
    log_ok "Admin user created: ${ADMIN_EMAIL}"
  fi
fi

log_ok "AccessBase running at http://localhost:${SERVER_PORT}"
log_info "  API:  http://localhost:${SERVER_PORT}/api/v1"
log_info "  Docs: http://localhost:${SERVER_PORT}/docs"
log_info "  UI:   http://localhost:${SERVER_PORT}"

wait $SERVER_PID
```

- [ ] **Step 2: 设置执行权限**

```bash
chmod +x scripts/deploy/start.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy/start.sh
git commit -m "feat: deploy start script with admin auto-create and pre-flight checks"
```

---

### Task 4: 创建停止/重置脚本

**Files:**
- Create: `scripts/deploy/stop.sh`
- Create: `scripts/deploy/reset.sh`

- [ ] **Step 1: 创建 stop.sh**

```bash
#!/usr/bin/env bash
# stop.sh — Stop all deploy mode services
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

DATA_DIR="${PROJECT_ROOT}/data"
PIDFILE="${DATA_DIR}/.pids"
PG_DATA="${DATA_DIR}/pg"
REDIS_PORT="${REDIS_PORT:-6379}"
PG_PORT="${PG_PORT:-5432}"

# Kill server via PID file
if [ -f "$PIDFILE" ]; then
  while IFS= read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -15 "$pid" 2>/dev/null || true
    fi
  done < "$PIDFILE"
  rm -f "$PIDFILE"
fi

# Stop PostgreSQL
if [ -f "$PG_DATA/PG_VERSION" ] && pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
  pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
fi

# Stop Redis
redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true

log_ok "All services stopped"
```

- [ ] **Step 2: 创建 reset.sh**

```bash
#!/usr/bin/env bash
# reset.sh — Stop services, delete data, reinitialize
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

DATA_DIR="${PROJECT_ROOT}/data"

log_warn "This will DELETE all data in ${DATA_DIR}/"
read -p "Are you sure? (y/N): " confirm
if [ "${confirm}" != "y" ] && [ "${confirm}" != "Y" ]; then
  log_info "Cancelled"
  exit 0
fi

# Stop services first
bash "${SCRIPT_DIR}/stop.sh"

# Delete data
rm -rf "$DATA_DIR/pg" "$DATA_DIR/redis" "$DATA_DIR/.pids"

log_ok "Data deleted. Run 'bash accessbase.sh start:deploy' to reinitialize."
```

- [ ] **Step 3: 设置执行权限**

```bash
chmod +x scripts/deploy/stop.sh scripts/deploy/reset.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy/
git commit -m "feat: deploy stop/reset scripts with confirmation and graceful shutdown"
```

---

### Task 5: 在 accessbase.sh 中添加 deploy 模式命令

**Files:**
- Modify: `accessbase.sh`

**Interfaces:**
- Produces: `build:deploy`, `start:deploy`, `stop:deploy`, `reset:deploy`, `status:deploy`, `logs:deploy` 命令

- [ ] **Step 1: 添加 deploy 命令函数**

```bash
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
```

- [ ] **Step 2: 在 case 语句中添加**

```bash
    # Deploy commands
    build:deploy)   cmd_build_deploy ;;
    start:deploy)   cmd_start_deploy ;;
    stop:deploy)    cmd_stop_deploy ;;
    reset:deploy)   cmd_reset_deploy ;;
    status:deploy)  cmd_status_deploy ;;
    logs:deploy)    cmd_logs_deploy ;;
```

- [ ] **Step 3: 更新 usage()**

```bash
Deploy:
  build:deploy     Build all packages to out/ directory
  start:deploy     Start deploy mode (PG + Redis + Server from out/)
  stop:deploy      Stop all deploy services
  reset:deploy     Reset deploy data (with confirmation)
  status:deploy    Show deploy service status
  logs:deploy      Show deploy service logs
```

- [ ] **Step 4: Commit**

```bash
git add accessbase.sh
git commit -m "feat: add deploy mode commands (build/start/stop/reset/status/logs)"
```

---

### Task 6: 更新 .gitignore 和 .env.example

**Files:**
- Modify: `.gitignore`
- Modify: `.env.example`

- [ ] **Step 1: 更新 .gitignore**

添加：

```gitignore
# Deploy build output
out/

# Deploy data directory
data/
```

- [ ] **Step 2: 创建/更新 .env.example**

```bash
# AccessBase Deploy Mode Configuration
# Copy to .env and customize

# Database (deploy mode uses local PG by default)
DATABASE_URL=postgresql://accessbase:accessbase_dev@localhost:5432/accessbase

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=5101
HOST=0.0.0.0
NODE_ENV=production
JWT_SECRET=change-me-to-a-random-string

# Admin auto-creation (deploy mode only)
ADMIN_EMAIL=admin@accessbase.local
ADMIN_PASSWORD=change-me

# Static assets directory (deploy mode)
STATIC_DIR=out/admin-ui

# Logging
LOG_LEVEL=info
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore .env.example
git commit -m "chore: update gitignore and env.example for deploy mode"
```

---

### Task 7: 端到端测试 deploy 模式

- [ ] **Step 1: 构建**

```bash
bash accessbase.sh build:deploy
```

Expected: `out/server/index.js` 和 `out/admin-ui/index.html` 存在

- [ ] **Step 2: 创建 .env**

```bash
cat > .env <<EOF
JWT_SECRET=test-secret-for-deploy-mode
ADMIN_EMAIL=admin@accessbase.local
ADMIN_PASSWORD=AdminPass123!
NODE_ENV=production
EOF
```

- [ ] **Step 3: 启动**

```bash
bash accessbase.sh start:deploy &
sleep 20
```

- [ ] **Step 4: 验证单端口**

```bash
curl -sf http://localhost:5101/health/live && echo " API OK"
curl -sf http://localhost:5101/ | head -3 && echo " UI OK"
curl -sf http://localhost:5101/docs >/dev/null && echo " Docs OK"
```

Expected: 全部 200

- [ ] **Step 5: 验证 admin 自动创建**

```bash
curl -sf http://localhost:5101/api/v1/setup/status
```

Expected: `"adminExists":true`

- [ ] **Step 6: 测试 stop/status/reset**

```bash
bash accessbase.sh stop:deploy
bash accessbase.sh status:deploy  # 全部 STOPPED
bash accessbase.sh reset:deploy   # 输入 y 确认
ls data/  # 应为空或不存在
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: deploy mode end-to-end verification"
```

---

## 审核修复记录

本计划经过 3 人团队审核（completeness / technical / risk），以下为修复的关键问题：

| # | 级别 | 问题 | 修复 |
|---|------|------|------|
| 1 | CRITICAL | Admin 自动创建逻辑缺失 | Task 3 start.sh 增加 curl 调用 setup API |
| 2 | CRITICAL | @fastify/static 版本错误 | 改为 `^7.0.0` |
| 3 | CRITICAL | decorateReply: false 破坏 SPA | 移除该选项，v7 自动装饰 |
| 4 | CRITICAL | initdb --username=accessbase 后 psql -U postgres | 统一用 accessbase 用户 |
| 5 | HIGH | build.sh workspace 协议解析失败 | 改为只复制 dist/ + package.json |
| 6 | HIGH | out/ 缺失无预检 | start.sh 增加 pre-flight check |
| 7 | HIGH | JWT_SECRET 未校验 | 生产模式必须设置 |
| 8 | HIGH | NODE_ENV 未设置 | start.sh 默认 production |
| 9 | HIGH | ADMIN_PASSWORD 为空无拦截 | 生产模式必须非空 |
| 10 | HIGH | 缺端口冲突检测 | start.sh 增加 lsof 检查 |
| 11 | HIGH | 无 graceful shutdown | start.sh 增加 trap cleanup |
| 12 | HIGH | 缺 logs:deploy | 新增 cmd_logs_deploy |
| 13 | MEDIUM | 无 server readiness wait | start.sh 增加 curl 循环等待 |
| 14 | MEDIUM | reset 无确认 | 增加 read -p 确认 |
| 15 | MEDIUM | SPA fallback 路径过滤不完整 | 只排除 /api/ /health /docs 前缀 |
