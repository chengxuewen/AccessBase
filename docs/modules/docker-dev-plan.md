# AccessBase Docker 开发模式实施方案

**日期**: 2026-08-25
**状态**: 待实施

## 概述

AccessBase 支持三种开发模式，本文档详细说明单容器和 Compose 两种 Docker 开发模式的实施方案。

| 模式 | 命令 | 适用场景 | 特点 |
|------|------|---------|------|
| 非容器 | `bash accessbase.sh dev` | 日常开发 | 前后端本地，DB/Redis 在 Docker |
| **单容器** | `bash accessbase.sh dev:docker` | 快速演示、CI 测试 | 全部在单容器，无热重载 |
| **Compose** | `bash accessbase.sh dev:compose` | 团队开发、完整环境 | 前后端+DB/Redis 分离容器，支持热重载 |

---

## 一、Compose 开发模式

### 1.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Network                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   postgres    │  │    redis     │  │    server    │  │
│  │   :5432       │  │    :6379     │  │    :5101     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────┐                                       │
│  │  admin-ui    │                                       │
│  │   :5173      │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

### 1.2 docker-compose.dev.yml 更新

```yaml
# Development docker-compose — all services with hot reload
name: accessbase-dev
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: accessbase
      POSTGRES_PASSWORD: accessbase_dev
      POSTGRES_DB: accessbase
    volumes:
      - postgres-dev:/var/lib/postgresql/data
    command: postgres -c listen_addresses='*'
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U accessbase -d accessbase"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-dev:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    build:
      context: .
      target: dev
    ports:
      - "5101:5101"
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://accessbase:accessbase_dev@postgres:5432/accessbase
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-jwt-secret
      LOG_LEVEL: debug
    volumes:
      - .:/app
      - /app/node_modules
      - /app/packages/types/node_modules
      - /app/packages/logging/node_modules
      - /app/packages/i18n/node_modules
      - /app/packages/migration/node_modules
      - /app/packages/health/node_modules
      - /app/packages/identity/node_modules
      - /app/packages/audit/node_modules
      - /app/packages/admin/node_modules
      - /app/apps/server/node_modules
      - /app/apps/admin-ui/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: pnpm --filter @accessbase/server dev

  admin-ui:
    build:
      context: .
      target: dev
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://server:5101
    volumes:
      - .:/app
      - /app/node_modules
      - /app/apps/admin-ui/node_modules
      - /app/packages/types/node_modules
      - /app/packages/logging/node_modules
      - /app/packages/i18n/node_modules
      - /app/packages/migration/node_modules
      - /app/packages/health/node_modules
      - /app/packages/identity/node_modules
      - /app/packages/audit/node_modules
      - /app/packages/admin/node_modules
    depends_on:
      - server
    command: pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0

volumes:
  postgres-dev:
  redis-dev:
```

### 1.3 Vite 代理配置更新

```typescript
// apps/admin-ui/vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5101',
        changeOrigin: true,
      },
    },
  },
  // ...
});
```

### 1.4 CLI 命令更新

```bash
# accessbase.sh
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
```

### 1.5 优势

| 优势 | 说明 |
|------|------|
| ✅ 热重载 | 前后端代码变更自动重启 |
| ✅ 网络隔离 | 服务间通过 Docker 网络通信 |
| ✅ 一致性 | 与生产环境架构一致 |
| ✅ 依赖隔离 | node_modules 在容器内 |
| ✅ 团队协作 | 统一开发环境 |

---

## 二、单容器开发模式

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    Single Container                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  PostgreSQL   │  │    Redis     │  │   Server     │  │
│  │   :5432       │  │    :6379     │  │   :5101      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────┐                                       │
│  │  Admin UI    │                                       │
│  │   :5173      │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Dockerfile.dev

```dockerfile
# syntax=docker/dockerfile:1

# ---- Dev: all-in-one with hot reload ----
FROM node:22-slim AS dev

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Install PostgreSQL + Redis
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-16 redis-server curl \
    && rm -rf /var/lib/apt/lists/*

# PostgreSQL setup
ENV PGDATA=/var/lib/postgresql/data
ENV PGUSER=accessbase
ENV PGPASSWORD=accessbase_dev
ENV PGDATABASE=accessbase
RUN mkdir -p /var/run/postgresql /var/lib/postgresql/data && \
    chown -R postgres:postgres /var/run/postgresql /var/lib/postgresql/data
USER postgres
RUN initdb -D $PGDATA --auth=trust --username=accessbase && \
    echo "listen_addresses='*'" >> $PGDATA/postgresql.conf && \
    echo "host all all 0.0.0.0/0 trust" >> $PGDATA/pg_hba.conf
USER root

# Redis setup
RUN mkdir -p /var/lib/redis && chown redis:redis /var/lib/redis

WORKDIR /app

# Copy package files first for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/
COPY packages/logging/package.json packages/logging/
COPY packages/i18n/package.json packages/i18n/
COPY packages/migration/package.json packages/migration/
COPY packages/health/package.json packages/health/
COPY packages/identity/package.json packages/identity/
COPY packages/audit/package.json packages/audit/
COPY packages/admin/package.json packages/admin/
COPY apps/server/package.json apps/server/
COPY apps/admin-ui/package.json apps/admin-ui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# Copy source
COPY . .

# Entrypoint
COPY docker/entrypoint-dev.sh /entrypoint-dev.sh
RUN chmod +x /entrypoint-dev.sh

EXPOSE 5101 5173 5432 6379

ENTRYPOINT ["/entrypoint-dev.sh"]
```

### 2.3 docker/entrypoint-dev.sh

```bash
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

# Set environment
export DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@localhost:5432/$PGDATABASE"
export REDIS_URL="redis://localhost:6379"

# Push schema
echo "Pushing database schema..."
cd /app
pnpm db:push 2>/dev/null || echo "Schema push skipped"

# Start all services
echo "Starting all services..."
pnpm --filter @accessbase/server dev &
pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &

wait
```

### 2.4 CLI 命令更新

```bash
# accessbase.sh
cmd_dev_docker() {
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
    $D build $BUILD_ARGS -t accessbase:dev -f Dockerfile.dev .

    log_info "Starting all-in-one container..."
    $D run -d --name accessbase-dev \
        -p 5101:5101 \
        -p 5173:5173 \
        -v "$(pwd):/app" \
        -v /app/node_modules \
        accessbase:dev

    log_ok "AccessBase running at http://localhost:5173"
}
```

### 2.5 优势

| 优势 | 说明 |
|------|------|
| ✅ 快速启动 | 单容器，启动快 |
| ✅ 资源占用少 | 仅一个容器 |
| ✅ 简单部署 | 适合演示和测试 |
| ✅ 数据持久化 | Volume 挂载源码 |

---

## 三、实施计划

### 3.1 Phase 1: Compose 模式（优先）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 更新 docker-compose.dev.yml | `docker-compose.dev.yml` | 小 |
| 更新 Vite 代理配置 | `apps/admin-ui/vite.config.ts` | 小 |
| 更新 CLI 命令 | `accessbase.sh` | 小 |
| 测试验证 | - | 中 |

### 3.2 Phase 2: 单容器模式

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 创建 Dockerfile.dev | `Dockerfile.dev` | 中 |
| 创建 entrypoint-dev.sh | `docker/entrypoint-dev.sh` | 小 |
| 更新 CLI 命令 | `accessbase.sh` | 小 |
| 测试验证 | - | 中 |

### 3.3 Phase 3: 文档更新

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 更新 README | `README.md` | 小 |
| 更新 CLI 帮助 | `accessbase.sh` | 小 |

---

## 四、验收标准

### 4.1 Compose 模式

- [ ] `bash accessbase.sh dev:compose` 启动所有服务
- [ ] 前端热重载生效
- [ ] 后端热重载生效
- [ ] 服务间网络通信正常
- [ ] 数据库连接正常
- [ ] Redis 连接正常

### 4.2 单容器模式

- [ ] `bash accessbase.sh dev:docker` 启动单容器
- [ ] 所有服务在容器内运行
- [ ] 源码变更生效（volume 挂载）
- [ ] 端口映射正常

---

## 五、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Volume 挂载权限问题 | 高 | 使用 `--chown` 参数 |
| node_modules 冲突 | 中 | 使用匿名 volume 隔离 |
| 网络延迟 | 低 | 使用 Docker 网络优化 |
| 构建时间长 | 中 | 使用 BuildKit 缓存 |

---

## 六、参考资料

- [Docker Compose 文档](https://docs.docker.com/compose/)
- [Dockerfile 最佳实践](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Vite 代理配置](https://vitejs.dev/config/server-options.html#server-proxy)
