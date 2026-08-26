# AccessBase 三种构建模式设计文档

**日期**: 2026-08-26
**状态**: 设计中
**影响范围**: accessbase.sh, pixi.toml, docker-compose.*, Dockerfile.*, scripts/native/

---

## 1. 概述

AccessBase 支持三种独立的基础设施构建模式，覆盖不同开发/部署场景：

| 模式 | 依赖 | 场景 | 优势 | 劣势 |
|------|------|------|------|------|
| **Native (pixi)** | pixi + conda-forge | 开发、CI、无 Docker 环境 | 零 Docker 依赖、快速启动、跨平台一致 | 需要 pixi 安装 |
| **Single Container** | Docker | 快速体验、小规模部署 | 一条命令全栈 | 调试不便、数据持久化需挂载 |
| **Compose** | Docker + Docker Compose | 开发、生产、团队协作 | 灵活、可选服务、适合生产 | 依赖 Docker Desktop |

**核心原则**：三种模式共享相同的代码库、构建产物和测试框架。差异仅在基础设施层（PG/Redis 如何启动）。

---

## 2. 命令矩阵

### 2.1 完整命令表

| 生命周期 | Native (pixi) | Single Container | Compose |
|----------|---------------|------------------|---------|
| **开发** | `dev:native` | `dev:container` | `dev:compose` |
| **启动 (infra)** | `start:native` | — | `start:compose` |
| **启动 (prod)** | `start:prod-native` | `start:container` | `start:prod` |
| **停止** | `stop:native` | `stop:container` | `stop:compose` |
| **构建** | `build` (共享) | `build:container` | `build` (共享) |
| **测试** | `test` (共享) | `test` (共享) | `test` (共享) |
| **重置数据** | `reset:native` | `reset:container` | `reset:compose` |
| **状态** | `status:native` | `status:container` | `status:compose` |
| **日志** | `logs:native` | `logs:container` | `logs:compose` |
| **打包** | `package:native` | `package:container` | `package:compose` |

### 2.2 命名规范

```
<操作>:<模式>

操作: dev | start | stop | build | test | reset | status | logs | package
模式: native | container | compose | prod-native
```

**无后缀命令** = 向后兼容别名（映射到默认模式 compose）

### 2.3 共享命令（所有模式通用）

| 命令 | 说明 |
|------|------|
| `build` | 构建所有包（纯 Node，不涉及基础设施） |
| `test` | 运行所有测试 |
| `test:e2e` | E2E 测试 |
| `typecheck` | TypeScript 类型检查 |
| `lint` | 代码检查 |
| `format` | 代码格式化 |
| `db:push` | 推送数据库 schema |
| `db:generate` | 生成迁移文件 |
| `db:migrate` | 执行迁移 |
| `clean` | 清理构建产物 |

---

## 3. 模式一：Native (Pixi)

### 3.1 依赖管理

通过 `pixi.toml` 管理，conda-forge 提供：

| 包 | 版本约束 | 平台 |
|---|---|---|
| `nodejs` | `>=20.0.0` | linux-64, osx-arm64, osx-64 |
| `pnpm` | `>=9.0.0` | linux-64, osx-arm64, osx-64 |
| `postgresql` | `>=16.0.0,<17` | linux-64, osx-arm64, osx-64 |
| `redis-server` | `>=7.0.0,<8` | linux-64, osx-arm64, osx-64 |

### 3.2 数据目录

```
.pixi/data/
├── pg/
│   ├── PG_VERSION
│   ├── postgresql.conf
│   ├── pg_hba.conf
│   ├── logfile
│   └── ... (PG 数据文件)
└── redis/
    ├── redis.conf
    ├── redis.log
    ├── appendonly.aof
    └── dump.rdb
```

- `.pixi/` 加入 `.gitignore`
- 数据持久化在项目目录内，`reset:native` 可清除重建

### 3.3 端口管理

| 服务 | 默认端口 | 环境变量覆盖 |
|------|---------|-------------|
| PostgreSQL | 5432 | `PG_PORT` |
| Redis | 6379 | `REDIS_PORT` |
| Server | 5101 | `SERVER_PORT` |
| Admin UI | 5173 | `UI_PORT` |

**端口冲突检测**：启动前检查，有冲突则报错并提示修复命令。

### 3.4 生命周期脚本

| 脚本 | 功能 |
|------|------|
| `scripts/native/pg-init.sh` | initdb + 创建用户/数据库 |
| `scripts/native/pg-start.sh` | pg_ctl start + 等待就绪 |
| `scripts/native/pg-stop.sh` | pg_ctl stop -m fast |
| `scripts/native/redis-start.sh` | 生成配置 + redis-server --daemonize |
| `scripts/native/redis-stop.sh` | redis-cli shutdown |
| `scripts/native/_ports.sh` | 端口冲突检测 |

### 3.5 命令详情

**`dev:native`** — 全栈开发

```
1. ensure_pixi / ensure_node / ensure_pnpm
2. detect_required_ports (检查 5432, 6379)
3. pg-init.sh (幂等，已初始化则跳过)
4. pg-start.sh
5. redis-start.sh
6. configure_native_urls (自动设置 DATABASE_URL/REDIS_URL)
7. pnpm db:push
8. trap cleanup EXIT/INT/TERM (停止 PG + Redis)
9. pnpm --filter @accessbase/server dev &
10. pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &
11. wait
```

**`start:native`** — 仅启动基础设施

```
1. pg-init.sh + pg-start.sh
2. redis-start.sh
3. 输出 DATABASE_URL/REDIS_URL 供用户手动 export
```

**`stop:native`** — 停止所有原生服务

```
1. pg-stop.sh
2. redis-stop.sh
```

**`reset:native`** — 清除数据重新初始化

```
1. stop:native
2. rm -rf .pixi/data/pg .pixi/data/redis
3. pg-init.sh
```

**`package:native`** — 打包发布

```
1. build (所有包)
2. 打包 .pixi/data + dist/ 为 tarball
```

### 3.6 pixi.toml

```toml
[project]
name = "accessbase"
version = "0.1.0"
description = "Enterprise access control foundation"
channels = ["conda-forge"]
platforms = ["linux-64", "osx-arm64", "osx-64"]

[dependencies]
nodejs = ">=20.0.0"
pnpm = ">=9.0.0"

[feature.postgres.dependencies]
postgresql = ">=16.0.0,<17"

[feature.redis.dependencies]
redis-server = ">=7.0.0,<8"

[feature.native.dependencies]
postgresql = ">=16.0.0,<17"
redis-server = ">=7.0.0,<8"

[feature.native.tasks]
dev = { cmd = "bash accessbase.sh dev:native", description = "Full native dev" }
start = { cmd = "bash accessbase.sh start:native", description = "Start infra only" }
stop = { cmd = "bash accessbase.sh stop:native", description = "Stop all native" }
reset = { cmd = "bash accessbase.sh reset:native", description = "Reset and reinit" }
status = { cmd = "bash accessbase.sh status:native", description = "Show status" }

[environments]
native = ["native"]
```

---

## 4. 模式二：Single Container

### 4.1 镜像结构

**开发镜像** (`Dockerfile.dev`)：
- 基础: node:22-slim + PostgreSQL 16 + Redis
- 挂载源码: `.:/app`
- 所有服务在单容器内运行
- 端口: 5101 (server), 5173 (frontend), 5432 (PG), 6379 (Redis)

**生产镜像** (`Dockerfile`)：
- 多阶段构建: base → builder → runtime
- 运行时基于 postgres:16-bookworm + Node + Redis
- 内置 entrypoint.sh 管理所有服务生命周期
- 端口: 5101 (对外暴露)

### 4.2 命令详情

**`dev:container`** — 开发模式（单容器，热重载）

```bash
docker build -t accessbase:dev -f Dockerfile.dev .
docker run -d --name accessbase-dev \
    --init \
    -p 5101:5101 -p 5173:5173 \
    -p 5432:5432 -p 6379:6379 \
    -v "$(pwd):/app" \
    -v /app/node_modules \
    accessbase:dev
```

**`start:container`** — 生产模式（单容器）

```bash
docker build -t accessbase:latest .
docker run -d --name accessbase \
    -p 5101:5101 \
    -v accessbase-data:/var/lib/postgresql/data \
    -v accessbase-redis:/var/lib/redis \
    -e JWT_SECRET="${JWT_SECRET}" \
    -e NODE_ENV=production \
    accessbase:latest
```

**`stop:container`** — 停止并删除容器

```bash
docker stop accessbase-dev accessbase 2>/dev/null || true
docker rm -f accessbase-dev accessbase 2>/dev/null || true
```

**`status:container`** — 查看容器状态

```bash
docker ps -a --filter name=accessbase
curl -sf http://localhost:5101/health/live
```

**`logs:container`** — 查看容器日志

```bash
docker logs -f accessbase-dev  # dev
docker logs -f accessbase      # prod
```

**`build:container`** — 构建镜像

```bash
docker build -t accessbase:latest .
docker build -t accessbase:dev -f Dockerfile.dev .
```

**`package:container`** — 导出镜像

```bash
docker save accessbase:latest | gzip > accessbase-latest.tar.gz
```

### 4.3 改进项

| 项目 | 当前 | 改进 |
|------|------|------|
| entrypoint.sh | 基础 | 添加健康检查、优雅关闭、日志格式化 |
| 数据持久化 | 匿名卷 | 命名卷 + 挂载说明 |
| 环境变量 | 硬编码 | 支持 `.env` 文件覆盖 |
| 健康检查 | 只有 prod | dev 也添加 |

---

## 5. 模式三：Docker Compose

### 5.1 文件结构

| 文件 | 用途 | 服务 |
|------|------|------|
| `docker-compose.yml` | 基础设施（PG + Redis） | postgres, redis |
| `docker-compose.dev.yml` | 开发全栈 | postgres, redis, server, admin-ui |
| `docker-compose.prod.yml` | 生产部署 | server (外部化 DB/Redis) |

### 5.2 命令详情

**`dev:compose`** — 开发模式（多容器，热重载）

```bash
docker compose -f docker-compose.dev.yml up --build
```

**`start:compose`** — 启动基础设施

```bash
docker compose -f docker-compose.yml up -d
```

**`start:prod`** — 生产部署

```bash
# 需要先设置环境变量
export JWT_SECRET="..."
export DATABASE_URL="postgresql://..."
export REDIS_URL="redis://..."
docker compose -f docker-compose.prod.yml up -d
```

**`stop:compose`** — 停止所有 Compose 服务

```bash
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.yml down
```

**`status:compose`** — 查看状态

```bash
docker compose -f docker-compose.dev.yml ps
```

**`logs:compose`** — 查看日志

```bash
docker compose -f docker-compose.dev.yml logs -f
```

**`package:compose`** — 导出镜像

```bash
docker compose -f docker-compose.prod.yml pull
docker save ghcr.io/accessbase/accessbase:latest | gzip > accessbase-compose.tar.gz
```

### 5.3 改进项

| 项目 | 当前 | 改进 |
|------|------|------|
| 生产 DB/Redis | 硬编码 localhost | `${DATABASE_URL:-default}` 模式 |
| 健康检查 | server/admin-ui 无 | 添加 healthcheck + depends_on condition |
| Vite HMR | 可能不可靠 | 添加 `CHOKIDAR_USEPOLLING` 环境变量 |
| 日志 | 无轮转 | 添加 logging driver 配置 |
| Profiles | 无 | 添加 `infra` profile 控制可选服务 |

### 5.4 生产 Compose 改进示例

```yaml
# docker-compose.prod.yml (改进后)
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

---

## 6. 环境变量统一处理

### 6.1 变量清单

| 变量 | 说明 | 默认值 | 所有模式 |
|------|------|--------|---------|
| `DATABASE_URL` | PG 连接串 | `postgresql://accessbase:accessbase_dev@localhost:5432/accessbase` | ✅ |
| `REDIS_URL` | Redis 连接串 | `redis://localhost:6379` | ✅ |
| `JWT_SECRET` | JWT 签名密钥 | dev: 固定值; prod: **必须设置** | ✅ |
| `NODE_ENV` | 运行环境 | `development` | ✅ |
| `LOG_LEVEL` | 日志级别 | dev: `debug`; prod: `info` | ✅ |
| `PG_PORT` | Native PG 端口 | `5432` | native only |
| `REDIS_PORT` | Native Redis 端口 | `6379` | native only |
| `SERVER_PORT` | 服务端口 | `5101` | ✅ |
| `UI_PORT` | 前端端口 | `5173` | native/compose |

### 6.2 自动配置逻辑

每种模式在 `cmd_dev_<mode>` 中自动：
1. 检测端口冲突
2. 设置缺失的环境变量（带日志提示）
3. 推送数据库 schema
4. 启动服务

用户可通过环境变量覆盖任何默认值。

---

## 7. `.gitignore` 更新

```gitignore
# Pixi native data
.pixi/data/
.pixi/env/

# Docker volumes (local)
postgres-dev/
redis-dev/
postgres_data/
redis_data/

# Docker build artifacts
*.tar.gz
```

---

## 8. 实施计划

### Phase 1: Native 模式（新增）
1. 创建 `pixi.toml`
2. 创建 `scripts/native/` 目录（6 个脚本）
3. 在 `accessbase.sh` 中添加 native 命令
4. 更新 `.gitignore`
5. 测试 `dev:native` / `start:native` / `stop:native`

### Phase 2: Container 模式改进
1. 重命名 `dev:docker` → `dev:container`
2. 改进 `Dockerfile.dev` entrypoint
3. 添加容器健康检查
4. 实现 `status:container` / `logs:container`

### Phase 3: Compose 模式改进
1. 修复 `docker-compose.prod.yml` 环境变量外部化
2. 添加 dev 服务健康检查
3. 实现 `start:compose` / `stop:compose` / `status:compose`
4. 更新 `usage()` 帮助文本

### Phase 4: 统一命令 + 文档
1. 实现无后缀别名（向后兼容）
2. 更新 README.md
3. 更新 AGENTS.md 约定
4. 添加 `package:<mode>` 命令

---

## 9. 向后兼容

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `dev` | `dev:compose` | 默认模式改为 compose |
| `dev:docker` | `dev:container` | 重命名 |
| `start` | `start:prod` | 明确 prod |
| `start:docker` | `start:container` | 重命名 |
| `stop` | `stop:compose` + `stop:container` | 停止所有 |
| `reset` | `reset:compose` | 保持 |
| `logs` | `logs:compose` | 保持 |
| `status` | `status` (增强) | 显示所有模式状态 |

**过渡期**：旧命令保留 2 个版本，输出 deprecation warning。

---

## 10. 验证矩阵

| 测试项 | Native | Container | Compose |
|--------|--------|-----------|---------|
| 首次启动（无数据） | ✅ | ✅ | ✅ |
| 重启（有数据） | ✅ | ✅ | ✅ |
| 端口冲突检测 | ✅ | — | — |
| 健康检查 | pg_isready + redis-cli ping | curl /health/live | docker healthcheck |
| 数据持久化 | .pixi/data/ | 命名卷 | 命名卷 |
| 数据重置 | rm -rf .pixi/data | docker volume rm | docker compose down -v |
| 热重载 | 直接支持 | 挂载卷 | 挂载卷 |
| 生产模式 | ✅ | ✅ | ✅ |
| 外部 DB/Redis | ✅ (设置 URL) | ✅ (设置 URL) | ✅ (设置 URL) |
