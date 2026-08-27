# AccessBase 已知坑点与反模式

**更新日期**: 2026-08-27

## PIT-001: pino logger 类型重载问题

- **症状**: `logger.error('message', error)` 报类型错误
- **根因**: pino 的 `error` 方法有两个重载：`(obj: object, msg?: string)` 和 `(msg: string, ...args)`，当第二个参数是 `unknown` 类型时无法匹配
- **解法**: 使用对象作为第一个参数: `logger.error({ err: error }, 'message')`
- **验证**: `pnpm typecheck` 通过

## PIT-002: Fastify 插件 declare module 冲突

- **症状**: 多个插件文件中的 `declare module 'fastify'` 产生类型冲突
- **根因**: TypeScript 模块增强在同一编译单元中多次声明同一接口会冲突
- **解法**: 将类型增强放在单独的 `fastify.d.ts` 文件中
- **验证**: `pnpm typecheck` 通过

## PIT-003: process.env 属性访问

- **症状**: `process.env.KEY` 报错 `Property comes from an index signature`
- **根因**: tsconfig 启用了 `noPropertyAccessFromIndexSignature`
- **解法**: 使用 `process.env['KEY']` 语法
- **验证**: `pnpm typecheck` 通过

## PIT-004: vitest 配置排除 .refinfo 目录

- **症状**: 运行测试时包含 `.refinfo/` 和 `.opencode/` 中的测试文件
- **根因**: vitest 默认 include 匹配所有 `**/*.test.ts`
- **解法**: 在 vitest.config.ts 中配置 `include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts']`
- **验证**: `pnpm test` 只运行项目测试

## PIT-005: Fastify dual version 类型冲突

- **症状**: `fp(plugin)` 报 `FastifyInstance` 类型不匹配
- **根因**: monorepo 中同时存在 Fastify 4.x 和 5.x，类型增强只应用于一个版本
- **解法**: 统一 Fastify 版本，或使用 `skipLibCheck: true`
- **验证**: `pnpm typecheck` 通过

## PIT-006: useRef 在 React 19 中需要初始值

- **症状**: `useRef<ActionType>()` 报 `Expected 1 arguments, but got 0`
- **根因**: React 19 的 `useRef` 要求显式初始值
- **解法**: `useRef<ActionType>(null)`
- **验证**: `pnpm --filter @accessbase/admin-ui typecheck` 通过

## PIT-007: Zustand persist 残留 localStorage 导致页面状态错误 (2026-08-26)

- **症状**: reset 数据库后刷新浏览器，setup wizard 跳到 CompleteStep 而非 WelcomeStep
- **根因**: Zustand persist 中间件将 `currentStep` 持久化到 localStorage（key: `accessbase-setup-store`），reset 后 DB 清空但 localStorage 残留旧值
- **解法**: 1) `partialize` 不持久化 `currentStep`；2) SetupWizard 组件 mount 时 `setCurrentStep(0)` 双保险
- **验证**: `localStorage.setItem('accessbase-setup-store', '{"state":{"currentStep":3}}')` → 刷新 → 应显示 WelcomeStep

## PIT-008: pnpm 幽灵依赖导致 ESM 模块解析失败 (2026-08-27)

- **症状**: `node out/server/index.js` 报 `Cannot find package 'fastify'`，即使 `node_modules` symlink 存在
- **根因**: pnpm 的幽灵依赖结构 — `fastify` 在 `apps/server/node_modules/fastify`（symlink → `.pnpm/`），不在根 `node_modules`。symlink `out/node_modules → root/node_modules` 无法解析。`NODE_PATH` 对 ESM 无效
- **解法**: `ln -sf apps/server/node_modules out/server/node_modules` — 让 Node 从 `out/server/` 的相对路径找到正确的 `node_modules`
- **验证**: `ls out/server/node_modules/fastify/package.json` 存在

## PIT-009: @fastify/static 版本必须匹配 Fastify 主版本 (2026-08-27)

- **症状**: `@fastify/static` v7 + Fastify v4 → 403 Forbidden 对所有静态文件
- **根因**: v7 是 Fastify v5 专用，v4 需要 v6。版本不匹配时插件注册静默失败或返回 403
- **解法**: `pnpm add @fastify/static@^6.0.0`（Fastify 4.x）或升级到 Fastify 5
- **验证**: `cat apps/server/node_modules/@fastify/static/package.json | grep version` 确认 v6.x

## PIT-0010: setupGuard 拦截静态资源导致 403 (2026-08-27)

- **症状**: Deploy 模式下 `/` 返回 403 Forbidden，API 正常
- **根因**: setupGuard 中间件对所有非 `/api/v1/setup` 路径返回 403（setup 未完成时）。`/`、`/assets/*`、`/index.html` 都被拦截
- **解法**: `ALLOWED_PATHS` 数组添加 `'/'`, `'/index.html'`, `'/assets/'`, `'/favicon'`
- **验证**: `curl http://localhost:5101/` 返回 `<!DOCTYPE html>`

## PIT-0011: lsof | xargs kill 误杀 VS Code 进程 (2026-08-26)

- **症状**: `bash accessbase.sh reset` 后 VS Code SSH 远程连接断开
- **根因**: `lsof -ti :PORT | xargs kill` 可能匹配到 VS Code 的 Node.js 子进程（extensionHost、language server）
- **解法**: 用 PID 文件追踪（`dev` 写 PID，`stop` 读 PID 杀进程）。兜底用 `lsof` 但检查 `ps -p PID -o comm=` 是否含 `node`
- **验证**: `bash accessbase.sh dev` → 另终端 `bash accessbase.sh stop` → VS Code 不断连

## PIT-0012: bash set -u 与 $! 后台 PID 不兼容 (2026-08-27)

- **症状**: `start.sh` 报 `$!: unbound variable`，即使 node 正常后台启动
- **根因**: `set -euo pipefail` 中的 `nounset` 对 `$!`（最近后台 PID）生效。如果 node 启动瞬间失败，`$!` 未设置
- **解法**: `set -eo pipefail`（去掉 `u`），或 `set +u` 包裹 `$!` 使用处
- **验证**: `bash -n scripts/deploy/start.sh` 通过

## PIT-0013: initializeAdmin 不标记 setupState 导致 wizard 重复出现 (2026-08-27)

- **症状**: Server 启动自动创建 admin，但浏览器仍显示 setup wizard，尝试创建 admin 返回 400
- **根因**: `initializeAdmin()` 创建 admin 后没调用 `setAdminExists(true)` + `setIsInitialized(true)` + `setSetupComplete(true)`
- **解法**: admin 创建成功或已存在时，都标记三个状态为 true
- **验证**: `curl /api/v1/setup/status` → `isInitialized: true, adminExists: true`

## PIT-0014: 前端 API 路径缺 /v1 前缀 (2026-08-27)

- **症状**: `POST /api/auth/login 404`，后端路由在 `/api/v1/auth/login`
- **根因**: 前端 `client.post('/auth/login')` + `baseURL: '/api'` → 实际 `/api/auth/login`，缺 `/v1`
- **解法**: `client.post('/v1/auth/login')`
- **验证**: 浏览器 Network 面板确认请求路径包含 `/v1/`
