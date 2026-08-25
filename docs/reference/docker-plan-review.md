# Docker 开发模式方案 — 性能评审

**评审人**: performance-reviewer  
**日期**: 2026-08-25  
**方案**: `docs/modules/docker-dev-plan.md`  
**结论**: ⚠️ **CONDITIONAL PASS** — 有 2 个性能隐患需在实施前修正

---

## 1. 构建时间优化

### 1.1 Compose 模式

**评分**: ⚠️ 中等风险

```yaml
server:
  build:
    context: .
    target: dev
```

- `context: .` 将整个项目根目录作为构建上下文发送给 Docker daemon。monorepo 含大量无关文件（docs、.git、node_modules），每次构建上下文传输量大。
- **缺失**: 无 `.dockerignore` 说明。方案引用了 BuildKit 缓存但未在 compose 文件中启用 `BUILDKIT=1` 或 `cache_from`。
- **缺失**: 两个服务（server、admin-ui）使用同一个 Dockerfile 但都用 `context: .`，意味着构建上下文被发送两次。

**建议**:
1. 明确列出 `.dockerignore` 内容（至少排除 `node_modules`、`.git`、`docs`、`.refinfo`）
2. 在 docker-compose.dev.yml 中为两个服务声明 `cache_from` 互相引用，避免重复构建基础层
3. 优先使用 `docker compose build` 的 `--parallel` 选项（默认行为）

### 1.2 单容器模式

**评分**: ⚠️ 中等风险

```dockerfile
RUN pnpm install --no-frozen-lockfile
```

- `--no-frozen-lockfile` 在 dev 模式下可以接受，但会导致每次构建都重新解析依赖树，增加 10-30 秒构建时间。
- `COPY . .` 在 `pnpm install` 之后是正确的分层策略，但缺少 `--mount=type=cache` 用于 pnpm store。
- PostgreSQL + Redis apt 安装是重操作（~200MB），应利用 BuildKit 缓存挂载。

**建议**:
1. 使用 `RUN --mount=type=cache,target=/root/.local/share/pnpm pnpm install` 避免重复下载
2. apt 层使用 `RUN --mount=type=cache,target=/var/cache/apt` 加速
3. 考虑在 Dockerfile.dev 基础镜像中预装 PG+Redis，减少重复安装

---

## 2. 热重载性能

### 2.1 Compose 模式

**评分**: ✅ 良好

```yaml
volumes:
  - .:/app
  - /app/node_modules
  - /app/packages/*/node_modules
```

- 源码绑定挂载支持文件变更即时检测。
- 匿名 volume 隔离 node_modules 正确，避免宿主/容器冲突。
- Vite HMR 通过 `--host 0.0.0.0` 暴露，容器网络内 WebSocket 连接正常。
- pnpm 的 `dev` 命令通常带 `--watch` 标志（tsx/tsup watch 模式），与绑定挂载配合良好。

**隐患**: `volumes: - /app/packages/*/node_modules` 使用了 glob 模式。Docker Compose **不支持** glob 展开在 volumes 中——这是一个 YAML 列表项，不是 shell glob。每个 workspace 包的 node_modules 需要逐行声明，否则只有第一个包的 node_modules 被隔离。

**严重性**: 🔴 高 — 如果 glob 不生效，宿主 node_modules 会覆盖容器内的 node_modules，导致架构不匹配（macOS arm64 vs Linux amd64）的原生模块崩溃。

**修正**:
```yaml
volumes:
  - .:/app
  - /app/node_modules
  - /app/packages/identity/node_modules
  - /app/packages/audit/node_modules
  - /app/packages/admin/node_modules
  - /app/packages/logging/node_modules
  - /app/packages/i18n/node_modules
  - /app/packages/migration/node_modules
  - /app/packages/health/node_modules
  - /app/packages/types/node_modules
```

### 2.2 单容器模式

**评分**: ⚠️ 可用但有性能代价

```yaml
- "$(pwd):/app"
- /app/node_modules
```

- 只隔离了根 node_modules，**未隔离** packages/*/node_modules。与 Compose 模式相同的 glob 问题，但更严重——单容器模式有 8 个 workspace 包。
- 源码绑定挂载 + `wait` 阻塞模式意味着前台进程不会退出，但 entrypoint 中 `pnpm --filter @accessbase/server dev &` 是后台进程——如果 server crash，`wait` 不会感知（只有所有子进程退出才返回）。

---

## 3. 资源使用

### 3.1 Compose 模式

**评分**: ✅ 合理

- 4 个容器（postgres、redis、server、admin-ui）是标准开发配置。
- Alpine 基础镜像（postgres:16-alpine、redis:7-alpine）内存占用低。
- 未声明 `mem_limit` / `cpus` 等资源限制——开发环境可接受，但应注释说明生产需调整。

### 3.2 单容器模式

**评分**: ⚠️ 资源竞争风险

```dockerfile
FROM node:22-slim AS dev
```

- 单容器运行 4 个进程（PostgreSQL + Redis + server + admin-ui），无进程管理器（无 supervisord，仅 bash `&` + `wait`）。
- PostgreSQL 默认 shared_buffers=128MB，加上 Vite dev server（~200MB）+ Fastify dev（~150MB），单容器至少需 768MB RAM。
- 无 cgroup 限制：如果宿主内存紧张，OOM killer 可能随机杀进程。

**建议**:
1. entrypoint 中为 PG 设置 `shared_buffers=64MB` 降低内存占用
2. 考虑使用 `tini` 或 `dumb-init` 作为 PID 1，正确处理信号传播
3. 文档中注明最低内存要求 1GB

---

## 4. 缓存利用率

### 4.1 Docker 层缓存

**评分**: ⚠️ 部分有效

单容器 Dockerfile 的分层策略：
```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json packages/*/
COPY apps/*/package.json apps/*/
RUN pnpm install --no-frozen-lockfile
COPY . .
```

- ✅ package.json 先于源码 COPY，依赖安装层可缓存
- ❌ `--no-frozen-lockfile` 破坏了可重复性，每次可能解析不同版本
- ❌ 缺少 pnpm store 缓存挂载（`--mount=type=cache,target=/root/.local/share/pnpm/store`）
- ❌ `COPY packages/*/package.json packages/*/` — 根据项目已记录的 PIT（Docker COPY glob），此模式**不保留目录结构**，会将所有 package.json 平铺到同一目录。

**严重性**: 🔴 高 — 这是已知 PIT（见 `memorys/pitfalls.md` Docker COPY glob），方案重复了已知错误。

**修正**:
```dockerfile
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
```

### 4.2 pnpm 缓存

- Compose 模式：匿名 volume 隔离了 node_modules 但未持久化 pnpm store。每次 `docker compose down -v` 后重新 install。
- 单容器模式：`pnpm install` 无缓存挂载，构建时全量下载。

---

## 5. 启动时间

### 5.1 Compose 模式

**评分**: ✅ 良好

- `depends_on` + `condition: service_healthy` 确保启动顺序。
- healthcheck `interval: 10s` + `retries: 5` 意味着最长等待 50 秒（可接受）。
- 各服务独立启动，无阻塞。

**小优化**: `pg_isready` healthcheck 初始等待 `start_period` 未设置。建议加 `start_period: 5s` 避免容器启动初期的失败计数。

### 5.2 单容器模式

**评分**: ⚠️ 启动慢

```bash
for i in $(seq 1 30); do
    pg_isready -U $PGUSER -d $PGDATABASE && break
    sleep 1
done
```

- PG + Redis 串行等待（最长 60 秒）。
- `pnpm db:push` 是同步操作，可能需要 5-10 秒。
- 两个 dev server 以 `&` 后台启动 + `wait`，但 Vite dev server 首次编译需要 3-10 秒。
- **总计预估启动时间**: 20-80 秒（取决于机器性能和首次编译）。

**建议**:
1. PG 和 Redis 等待可并行（用 `&` 并行等待 + `wait`）
2. `pnpm db:push` 失败时 `|| echo "skipped"` 会吞掉错误——应至少记录 exit code
3. 添加启动完成标志，避免用户在服务就绪前访问

---

## 综合评定

| 维度 | Compose 模式 | 单容器模式 | 权重 |
|------|-------------|-----------|------|
| 构建时间 | ⚠️ 中（缺 .dockerignore） | ⚠️ 中（缺 cache mount） | 20% |
| 热重载 | 🔴 **需修正**（glob volume） | ⚠️ 同样问题 | 25% |
| 资源使用 | ✅ 合理 | ⚠️ 需注释限制 | 15% |
| 缓存利用率 | ⚠️ 部分 | 🔴 **需修正**（COPY glob PIT） | 20% |
| 启动时间 | ✅ 良好 | ⚠️ 可优化 | 20% |

### 结论: ⚠️ CONDITIONAL PASS

**必须修复（阻塞）**:
1. 🔴 Compose volumes glob 不生效 — 逐行声明 workspace 包 volume
2. 🔴 Dockerfile COPY glob 已知 PIT — 逐行 COPY 每个包的 package.json

**建议修复（非阻塞）**:
3. 添加 `.dockerignore` 说明
4. 使用 BuildKit cache mount 加速 pnpm install
5. 单容器模式使用 `tini` 作为 PID 1
6. 设置 `start_period` 在 healthcheck 中
7. 并行化单容器启动等待

---

# Docker 开发模式实施方案 — DevOps 审查报告

**审查人**: devops-reviewer  
**审查日期**: 2026-08-25  
**审查对象**: `docs/modules/docker-dev-plan.md`  
**结论**: ⚠️ **PASS（附条件）** — 有 2 项 CRITICAL 必须修复后方可实施

---

## 审查总览

| 维度 | 结论 | 备注 |
|------|------|------|
| 1. Compose 架构 | ⚠️ PASS | 设计合理，COPY glob 有已知陷阱 |
| 2. Volume 挂载 | ✅ PASS | 热重载配置正确 |
| 3. 网络配置 | ✅ PASS | 默认 Docker 网络可用 |
| 4. 健康检查 | ⚠️ PASS | 缺少 server/admin-ui 健康检查 |
| 5. 安全问题 | ⚠️ PASS | 开发环境可接受，需文档化 |
| 6. 单容器可行性 | ⚠️ PASS | 进程管理需加固 |

---

## 1. Compose 架构正确性 — ⚠️ PASS

### 优点

- 四服务架构（postgres + redis + server + admin-ui）符合项目需求
- `depends_on` + `condition: service_healthy` 确保启动顺序正确
- 命名 volume（`postgres-dev`、`redis-dev`）便于管理和清理
- `name: accessbase-dev` 明确项目名，避免冲突

### CRITICAL: COPY glob 陷阱

**文件**: `Dockerfile.dev` 第 228 行

```dockerfile
COPY packages/*/package.json packages/*/
```

**问题**: Docker COPY glob 不保留目录结构。此命令会将所有 `packages/*/package.json` 平铺到 `packages/` 目录，同名文件互相覆盖。

**影响**: monorepo 包结构被破坏，`pnpm install` 无法解析 workspace 依赖。

**修复**: 必须逐行 COPY（参考现有 `Dockerfile` dev stage 的做法）：

```dockerfile
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
```

**来源**: `.agents/rules/common/docker.md` § Docker COPY glob 不保留目录结构

### 次要问题

- `--no-frozen-lockfile` 与现有 dev stage 的 `--frozen-lockfile` 不一致。开发模式用 `--no-frozen-lockfile` 可接受，但建议加注释说明理由

---

## 2. Volume 挂载热重载 — ✅ PASS

### Compose 模式

```yaml
volumes:
  - .:/app                              # 源码挂载 → 热重载生效
  - /app/node_modules                   # 匿名 volume 保护容器内依赖
  - /app/packages/*/node_modules        # 逐包依赖隔离
```

**评价**: 正确。匿名 volume 防止宿主机 `node_modules` 覆盖容器内已安装的依赖，这是 Docker 开发的标准模式。

### 单容器模式

```yaml
-v "$(pwd):/app"      # 源码挂载
-v /app/node_modules  # 匿名 volume
```

**评价**: 同样正确。但宿主机挂载整个目录后，单容器内无热重载工具（plan §2.5 已说明"无热重载"），源码变更需重启容器。

### Vite 代理冗余（LOW）

方案同时配置了：
1. `vite.config.ts` 中 `host: '0.0.0.0'`
2. CLI 命令中 `-- --host 0.0.0.0`

两者等效，CLI 参数会覆盖配置文件。建议二选一，推荐保留 CLI 参数（更明确）。

---

## 3. 网络配置 — ✅ PASS

### 优点

- 所有服务在同一 Compose 项目内，Docker 自动创建默认 bridge 网络
- 服务间通过服务名（`postgres`、`redis`、`server`）进行 DNS 解析
- 端口映射符合项目约定（5101/5173/5432/6379）

### 注意事项

- 未显式定义 `networks:` 配置，使用默认网络即可满足开发需求
- 若未来需要网络隔离（如禁止 admin-ui 直连 postgres），可后续添加

---

## 4. 健康检查 — ⚠️ PASS

### Compose 模式

| 服务 | 健康检查 | 状态 |
|------|---------|------|
| postgres | `pg_isready -U accessbase -d accessbase` | ✅ 完善 |
| redis | `redis-cli ping` | ✅ 完善 |
| server | **未定义** | ❌ 缺失 |
| admin-ui | **未定义** | ❌ 缺失 |

**建议**: 为 server 和 admin-ui 添加健康检查：

```yaml
server:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:5101/health/live"]
    interval: 15s
    timeout: 5s
    retries: 3
    start_period: 30s

admin-ui:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:5173"]
    interval: 15s
    timeout: 5s
    retries: 3
    start_period: 20s
```

### 单容器模式

entrypoint-dev.sh 中有等待循环（`pg_isready` + `redis-cli ping`），但：
- 使用 `for i in $(seq 1 30)` + `sleep 1` 但无 `break` 条件检查失败
- 若 postgres 启动超时，脚本会继续执行（`set -e` 不捕获循环内的失败）

---

## 5. 安全问题 — ⚠️ PASS（开发环境可接受）

### 安全风险清单

| 风险 | 严重性 | 说明 | 是否可接受 |
|------|--------|------|-----------|
| `JWT_SECRET: dev-jwt-secret` | 中 | 弱密钥 | ✅ 开发环境 |
| Redis 无密码 | 中 | `redis-server --appendonly yes` 无 `--requirepass` | ✅ 仅开发 |
| PG trust 认证 | 中 | `host all all 0.0.0.0/0 trust` | ✅ 仅开发 |
| 端口暴露到宿主机 | 低 | 5432/6379 对外开放 | ⚠️ 需注意 |
| `pg_hba.conf` trust all | 中 | 允许任何 IP 无密码连接 | ✅ 仅开发 |

### 对比：现有 docker-compose.yml 的差异

现有生产 compose 文件中 redis 使用了 `--requirepass accessbase_dev`，但开发计划中 redis 无密码。建议统一或在文档中明确说明差异原因。

### 建议

- 在 README 或 `.env.example` 中明确标注：**开发环境密钥仅用于本地，禁止用于生产**
- 考虑在 `docker-compose.dev.yml` 中添加注释说明安全边界

---

## 6. 单容器可行性 — ⚠️ PASS

### 架构评估

单容器运行 postgres + redis + server + admin-ui 在技术上可行，但有以下风险：

### CRITICAL: entrypoint-dev.sh 进程管理

```bash
set -e
# ...
pnpm --filter @accessbase/server dev &
pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &
wait
```

**问题**:
1. `set -e` 不捕获后台进程（`&`）的失败
2. `wait` 等待所有后台进程，但任一进程崩溃不会导致容器退出
3. 若 server 崩溃，admin-ui 继续运行，容器显示"健康"但实际不可用

**修复建议**: 使用 `trap` + 进程监控：

```bash
set -euo pipefail

cleanup() {
    kill $(jobs -p) 2>/dev/null || true
    exit 1
}
trap cleanup EXIT INT TERM

pnpm --filter @accessbase/server dev &
SERVER_PID=$!

pnpm --filter @accessbase/admin-ui dev -- --host 0.0.0.0 &
UI_PID=$!

# 监控进程，任一退出则容器退出
while kill -0 $SERVER_PID 2>/dev/null && kill -0 $UI_PID 2>/dev/null; do
    sleep 2
done
echo "A process exited unexpectedly"
cleanup
```

### 次要问题

- 安装 postgresql-16 + redis-server 从 Debian 仓库，版本可能滞后于 Alpine 镜像
- 单容器不适合日常开发（无热重载），仅适合演示/CI
- 资源占用：postgres + redis + node 进程，最低需 2GB+ 内存

---

## 与现有文件的一致性检查

| 项目 | 计划 | 现有 | 一致性 |
|------|------|------|--------|
| PG listen_addresses | `postgres -c listen_addresses='*'` | 相同 | ✅ |
| PG 用户/密码 | `accessbase/accessbase_dev` | 相同 | ✅ |
| Redis 命令 | `redis-server --appendonly yes` | 生产有密码 | ⚠️ |
| 端口映射 | 5101/5173/5432/6379 | 相同 | ✅ |
| 健康检查（PG） | `pg_isready -U accessbase -d accessbase` | 相同 | ✅ |
| COPY 模式 | glob（有问题） | 逐行（正确） | ❌ |

---

## 必须修复项（CRITICAL）

1. **COPY glob 陷阱** — 改为逐行 COPY，否则 monorepo 构建失败
2. **entrypoint-dev.sh 进程管理** — 添加 trap + 进程监控，否则容器静默半死

## 建议修复项（HIGH）

3. 为 server/admin-ui 添加健康检查
4. 清理 Vite 代理配置冗余

## 建议改进项（LOW）

5. 在文档中标注开发环境安全边界
6. 统一 Redis 密码策略（开发/生产）

---

## 结论

方案整体设计合理，Compose 架构符合项目需求，Volume 挂载和网络配置正确。**修复 2 项 CRITICAL 后可实施**。

审查状态: **PASS（附条件）**
