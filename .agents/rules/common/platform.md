# Platform Constraints

> macOS/Linux 开发约束。

## 平台约束

### macOS 开发

- **pixi 环境**: 依赖 `.pixi/envs/default/bin/node`。首次运行前必须 `pixi install`，否则所有经 `run-node.sh` 的 MCP/LSP 超时
- **pixi platforms 跨平台**: 添加新平台后必须 `pixi lock` 重新生成锁文件；win-64 未在 platforms 列表，Windows 上 `pixi install` 不可用
- **realpath 不可用**: 脚本用 `cd "$dir" && pwd -P` 解析路径（`_common.sh` SCRIPT_DIR 模式）
- **服务启动**: `nohup ... & disown` 必须同时使用，bash 超时会杀 shell 会话内后台进程（见 pitfalls）

### Docker Compose（PostgreSQL 16 + Valkey 8）

- 开发依赖数据库/缓存容器：`docker compose up -d postgres valkey`
- 清库后必须 `pixi run npx drizzle-kit push` 重建表，再启动后端（见 pitfalls 事故 5）

### Linux / CI

- CI（GitHub Actions）运行 `ubuntu-latest`，依赖 pg 服务容器 + Valkey
- Docker 生产部署（D26）：pnpm workspace 31 个项目，COPY 逐行（见 docker.md）

## macOS Gotchas 速查

| 问题                    | 处理                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| MCP 全部超时 30000ms    | 未 `pixi install` → run-node.sh 报 node not found                  |
| `pixi install` 失败     | platforms 变更后未 `pixi lock`                                     |
| macOS `realpath` 不可用 | 用 `pwd -P` 替代                                                   |
| bash 超时后服务被杀     | `nohup ... & disown` + 分步启动验证                                |
| 后端 health db:false    | postgres listen_addresses（docker.md）或 DATABASE_URL 用 127.0.0.1 |

## See Also

- [constraints.md](constraints.md) — Git/lockfile 提交规则
- [docker.md](docker.md) — Docker + 网络约束
- `memorys/pitfalls.md` — PIT 事故记录
