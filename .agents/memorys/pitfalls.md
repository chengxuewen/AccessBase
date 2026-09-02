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

## PIT-0015: axios response.data 双层解构 (2026-08-27)

- **症状**: `login()` 后 `token` 为 `undefined`，localStorage 只存了 `{isAuthenticated: true}`
- **根因**: axios 的 `response.data` 已经是 `{success, data: {accessToken, ...}}`。代码 `const { data } = await client.post(...); const { accessToken } = data` 解构的是外层（得到 `success`），不是内层 `data.data`
- **解法**: `const { data: { accessToken, refreshToken, user } } = data` 或 `const result = data.data; const { accessToken } = result;`
- **验证**: `console.log` 登录后 localStorage 的 `auth-storage`，确认 `token` 非空

## PIT-0016: Zustand persist 不持久化 isAuthenticated 导致 PrivateRoute 误判 (2026-08-27)

- **症状**: 登录成功后刷新页面，跳回 `/login`。`PrivateRoute` 检查 `isAuthenticated` 为 `false`
- **根因**: Zustand persist 的 `partialize` 没包含 `isAuthenticated`。页面刷新后 store 重置为默认值 `false`，localStorage 没存它
- **解法**: `partialize` 加 `isAuthenticated: state.isAuthenticated`，同时 `PrivateRoute` 检查 `token || isAuthenticated`（token 总是被持久化）
- **验证**: 登录后刷新页面，确认不跳回 `/login`

## PIT-0017: E2E 测试中 Vite 进程被 bash timeout 杀掉 (2026-08-27)

- **症状**: Playwright 测试报 `ERR_CONNECTION_REFUSED at http://localhost:5173`。Vite 进程在 bash 工具 timeout 后被 SIGTERM
- **根因**: bash 工具 timeout 会杀掉所有子进程（包括后台 `&` 的 Vite）。`nohup`/`disown` 不够，`setsid` 也可能被杀
- **解法**: Playwright 的 `webServer` 配置加 `reuseExistingServer: true`，让 Playwright 管理 Vite 生命周期。或在 CI 中用独立 shell 启动服务
- **验证**: `npx playwright test` 不报 `ERR_CONNECTION_REFUSED`

## PIT-0018: E2E beforeEach login 失败因 admin 用户被前一个测试删除 (2026-08-27)

- **症状**: 第 4 个 E2E 测试 `beforeEach` 登录失败 `401 Invalid credentials`
- **根因**: 第 3 个测试 (delete) 删除了 admin 用户。后续测试的 `beforeEach` 尝试用已删除的用户登录
- **解法**: `beforeEach` 中检测 401 → 通过 API 重新创建 admin → 重试登录。或用 mock 模式避免真实后端依赖
- **验证**: 连续运行所有 E2E 测试，每个测试都能独立通过

## PIT-0019: Ant Design Modal 按钮文本是 i18n 翻译值不是 "OK" (2026-08-27)

- **症状**: E2E 测试 `button:has-text("OK")` 找不到 Modal 确认按钮
- **根因**: `okText={t('common.confirm')}` → 英文环境显示 "Confirm"，中文环境显示 "确认"，不是 "OK"
- **解法**: E2E 用 `button:has-text("Confirm"), button:has-text("确认")` 匹配。或用 `.ant-modal .ant-btn-primary` 选择器
- **验证**: E2E 测试能找到 Modal 按钮并点击

## PIT-020: Deploy 脚本缺 pixi PATH 导致 pg_ctl 未找到 (2026-08-27)

- **症状**: `bash accessbase.sh start:deploy` 报 `pg_ctl：未找到命令`
- **根因**: deploy 脚本（start/stop/reset.sh）没导出 pixi 环境 PATH，pg_ctl/redis-server 等命令只在 `.pixi/envs/native/bin/` 里
- **解法**: 脚本顶部加 `export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$HOME/.pixi/bin:$PATH"`
- **验证**: `bash accessbase.sh start:deploy` 不报命令未找到

## PIT-021: Deploy 模式 CORS + @fastify/static 配置错误 (2026-08-27)

- **症状**: Deploy 模式下 `http://localhost:5101/` 返回 403 Forbidden，API 正常
- **根因**: 1) CORS `origin: config.host` = `'0.0.0.0'` 不匹配浏览器的 `localhost`。2) `@fastify/static` v7 是 Fastify v5 专用，v4 需要 v6。3) `setupGuard` 拦截了 `/` 等静态资源路径
- **解法**: 1) CORS 改为 `origin: true`。2) 安装 `@fastify/static@^6.0.0`。3) `ALLOWED_PATHS` 添加 `/`, `/index.html`, `/assets/`, `/favicon`
- **验证**: `curl http://localhost:5101/` 返回 `<!DOCTYPE html>`

## PIT-022: 工具调用长数组组合时输出流损坏 (2026-08-28)

- **症状**: edit/write 调用中多行 lines 数组内容中途被替换为垃圾片段（`async () HMAC path {`、错误 UUID、幻影参数 `workdir=`/`filePath=`），部分调用直接 malformed 失败
- **根因**: 高速连续组合长 tool-call JSON 时采样流退化（degenerate composition loop），非环境问题
- **解法**: (1) 每条消息一个干净调用，function_calls 块必须结尾（tool result 强制新回合打破循环）(2) 优先 insert-only 小编辑（1 行新内容，零转录）(3) 避免 UUID 长字符串从记忆转录，用简单值 (`id: 'u1'`) (4) 失败后重读文件确认真实状态再重试
- **验证**: `grep -c "findById" <file>` 确认编辑实际落盘；tsc + vitest 全绿
- **禁止**: 检测到垃圾片段后继续叠加编辑；批量长数组编辑；从记忆转录长 UUID

## PIT-023: antd5 静态 message API 在当前 React 渲染器下不弹提示 (2026-08-31)

- **症状**: E2E auth.spec 登录失败 toast 断言（`page.getByText('Login failed')`）一直失败；手动操作也不见任何提示
- **根因**: antd5 的静态方法 `message.success/error` 不走 React 渲染管线，在当前 React 渲染器下不挂载，提示永不出现；项目也全站未配 `App.useApp()` 上下文
- **解法**: 全站约定改用页面内 inline `<Alert data-testid="xxx-error">`（Login.tsx 已落地）；E2E 用 `getByTestId` 断言
- **验证**: `pixi run npx playwright test e2e/auth.spec.ts --project=chromium` → 5/5 通过
- **禁止**: 新代码使用 `message.success/error` 静态 API；已有 Users/UserDetail/UserEdit 中的调用属于同一隐患，迁移时一并替换
## PIT-024: JSX 包裹重构孤儿 return ( 泄漏为页面文本 (2026-09-01)

- **症状**: 登录页左上角出现字面文本 'return ('；所有页面 #root 顶部均有
- **根因**: App.tsx 包裹 <GlobalErrorBoundary> 时旧 'return (' 未删除，成为 JSX 子文本。JSX 裸文本语法合法，tsc 不报错
- **解法**: 删除孤儿行。重构包裹层时必须整体替换函数体（write > edit 局部插入）
- **验证**: NO_PROXY pixi run node 复现脚本 body.innerText.includes('return (') === false；E2E 60/2 无回归
- **禁止**: JSX 包裹重构用局部 edit 插入开闭标签；交付前无杂散文本断言
## PIT-025: 清环境后 dist/ 缺失致 tsx dev 启动 ERR_MODULE_NOT_FOUND (2026-09-01)

- **症状**: pnpm --filter server dev 报 Cannot find module '@accessbase/identity/dist/index.js'；Vite 起来但 proxy ECONNREFUSED 5101
- **根因**: workspace 包 exports 指向 dist/（gitignored 构建产物），clean/重 clone 后未 build；tsx 直跑 TS 不经任何构建管线
- **解法**: apps/server/package.json 加 predev 钩子: pnpm -r --filter '!@accessbase/server' --filter '!@accessbase/admin-ui' run build（自动构建全部依赖包，3-5s）
- **验证**: NO_PROXY curl -X POST /api/v1/auth/login 返回 accessToken（带 DATABASE_URL/REDIS_URL 启动）
- **禁止**: 清环境后直接 dev；手动启动 server 缺 DATABASE_URL/REDIS_URL 环境变量
## PIT-026: dev 端口预检时序窗口 + stop 清理范围缺口 (2026-09-01)

- **症状**: bash accessbase.sh stop 后 dev 报 EADDRINUSE 5101；stop 杀不到脚本外启动的 tsx/vite 孤儿
- **根因**: (1) 预检与实际启动之间隔着 predev 构建 ~2s，孤儿进程可在此窗口抢端口 (2) stop 只杀 .dev-pids 登记进程，setsid/nohup 起的进程逃逸 (3) server 崩溃后 vite 存活形成半死会话
- **解法**: accessbase.sh 三处加固: 启动前二次预检(仅 5101/5173，不查脚本自己刚起的 5432/6379)、wait -n fail-fast(任一 dev 进程退出即全停+cleanup)、stop 加 pkill 模式清扫(tsx watch/server dev/vite --host)
- **验证**: 全周期冒烟 dev(健康 200) → stop → 4 端口全清 0 残留进程；预检拦截验证: infra 未起时 dev 快速失败并自动 cleanup
- **禁止**: 脚本外 setsid/nohup 起 dev 进程(逃逸 PID 登记成为 stop 盲区)；二次预检包含 infra 端口(会自残拦截刚启动的 PG/Redis)

## PIT-027: reset 后 server 未重启 → 内存 setupState 与 DB 漂移 (2026-09-01)

- **症状**: reset 清库后访问不出向导，/setup/status 仍报 initialized（旧机制下）
- **根因**: setupState/setupComplete 为内存变量，与 DB 生命周期不同步；reset 不重启 server
- **解法**: D113 DB 推导制落地后免疫；accessbase.sh reset 补 db:push + 重启提示
- **验证**: reset → dev 重启 → /setup/status 返回 adminExists:false
- **禁止**: 重新引入内存态 setup 标记；reset 后不重启 server 继续操作

## PIT-028: stop 清扫 pkill 模式带二进制前缀匹配不到 node 子进程 (2026-09-02)

- **症状**: `bash accessbase.sh stop` 后 tsx watch 的真实 node 子进程存活（5101 仍被占），后续 dev 报 EADDRINUSE
- **根因**: `pkill -15 -f "tsx watch src/index.ts"` 的 cmdline 只匹配 `sh -c` 包装进程；真实子进程 cmdline 是 `node .../tsx/dist/cli.mjs watch src/index.ts`（无 "tsx watch" 连续子串）
- **解法**: 模式去掉二进制名前缀，改为 `pkill -15 -f "watch src/index.ts"` — 同时匹配包装进程与 node 子进程
- **验证**: 起 dev → stop → `ps aux | grep "[t]sx.*watch src"` = 0
- **禁止**: pkill -f 模式假设 cmdline 含包名+子命令连续子串；先 `ps aux | grep` 看真实 cmdline 再写模式
- **同函数附带修复**: `pid=$(lsof -ti :$port | head -1)` 在无监听时 lsof 退出码 1，`set -euo pipefail` 下直接中止整个 stop（exit 1）→ 改为 `| head -1 || true`

## PIT-029: 前端 guard 对后端不可达 fail-open → reset 后无法进入向导 (2026-09-02)

- **症状**: reset→stop→dev 后访问站点落在 /login，向导不出现；后端恢复后需手动刷新才恢复
- **根因**: GlobalGuard/SetupGuard 的 checkSetupStatus().catch(() => setNeedsSetup(false)) 把"检查失败"等同"无需 setup"；dev EXIT trap 连带停 PG/Redis 加长不可达窗口
- **解法**: checkSetupStatus 三态（ok 标志）+ useSetupGuardState 3s 自动重试；dev trap 只杀 dev 进程；dev 预检收窄 5101/5173 使 infra 常驻时可复用
- **验证**: T5.4 E2E（abort status → retry testid → 恢复后自动进 /setup）；dev 被杀后 psql 仍通
- **禁止**: guard catch 分支做路由决策；EXIT trap 停 infra；dev 预检包含 infra 端口
