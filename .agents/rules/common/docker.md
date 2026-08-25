# Docker & Network Constraints

> AccessBase 容器开发约束。完整事故记录见 `memorys/pitfalls.md`，此文件为工作约束。

## Docker Constraints

### PostgreSQL 监听地址

- 官方 postgres 镜像默认 `listen_addresses='localhost'` — 只监听容器内 127.0.0.1
- 跨容器网络连接（server→postgres）会被拒绝；host 端口映射可能恰好可用造成假象
- **必须**在 docker-compose.yml postgres command 加 `-c listen_addresses='*'`
- 验证：容器内 `netstat -tln | grep 5432` 显示 `0.0.0.0:5432`

### Docker COPY glob 不保留目录结构

- `COPY packages/*/package.json packages/*/` 会把所有源文件平铺到目标目录，同名互相覆盖
- Monorepo 必须逐行 `COPY packages/{name}/package.json packages/{name}/`
- 验证：COPY 后 `pnpm install` 能解析全部 workspace 项目

### pnpm --filter 切换 cwd

- `pnpm --filter @audebase/core exec ...` 会把进程 cwd 切到包目录，相对路径会错
- 容器内用绝对路径（`/app/...`）或先 `cd /app`
- drizzle-kit push 需根 `package.json` 声明 drizzle-kit（hoist 到根 node_modules 才能被 drizzle.config.ts 解析）

### Shell 管道吞噬 set -e 退出码

- `set -e` 只检查管道最后一个命令的退出码
- 脚本必须 `set -euo pipefail`，否则迁移失败会静默继续

## Network Constraints

### 端口约定

- 后端 API: `5101`（生产容器内 0.0.0.0）
- 前端 Admin UI: `5173`（dev server 必须 `--host 0.0.0.0`）
- 服务启动后三步验证：`ss -tlnp | grep PORT` → 外部 IP curl → 防火墙 iptables

## See Also

- [constraints.md](constraints.md) — Git/lockfile 提交规则
- [platform.md](platform.md) — macOS 开发约束
- `memorys/pitfalls.md` — PIT 事故记录（Docker COPY glob / listen_addresses / pipefail 等）
