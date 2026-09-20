# AccessBase 编码约定

**更新日期**: 2026-08-21

## 包结构约定

### 目录结构

```
packages/{name}/
├── package.json        # type:module, workspace:* deps
├── tsconfig.json       # extends ../../tsconfig.json
└── src/
    ├── index.ts        # 公共导出
    ├── types.ts        # 接口定义
    └── __tests__/      # 测试文件
```

### package.json 模板

```json
{
  "name": "@accessbase/{name}",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  }
}
```

## TypeScript 约定

### 严格模式

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noPropertyAccessFromIndexSignature: true` → 用 `process.env['KEY']` 而非 `process.env.KEY`

### 导入导出

- 使用 `import type` 导入类型
- 使用 `.js` 扩展名（ESM 要求）
- 内部包使用 `workspace:*` 协议

## Fastify 插件约定

### 插件结构

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const myPlugin: FastifyPluginAsync<Options> = async (fastify, opts) => {
  // 实现
};

export default fp(myPlugin, { name: '@accessbase/my-plugin' });
```

### 类型增强

- 在单独的 `fastify.d.ts` 文件中声明
- 避免在插件文件中直接 `declare module 'fastify'`

## 测试约定

### 文件位置

- 测试文件放在 `src/__tests__/` 目录
- 命名: `{ClassName}.test.ts`

### 测试模式

- 使用 AAA 模式（Arrange-Act-Assert）
- 使用 `vi.mock()` 模拟外部依赖
- 测试文件与源文件同构

## 日志约定

### Pino 使用

```typescript
import { logger } from '@accessbase/logging';

// 正确：对象作为第一个参数
logger.error({ err: error }, 'Operation failed');
logger.debug({ params }, 'Querying data');

// 错误：字符串作为第一个参数
logger.error('Operation failed', error); // ❌
```

## 命名约定

| 类型      | 约定        | 示例                       |
| --------- | ----------- | -------------------------- |
| 包名      | kebab-case  | `@accessbase/health-check` |
| 文件名    | camelCase   | `AuthManager.ts`           |
| 类名      | PascalCase  | `UserService`              |
| 接口      | PascalCase  | `UserProfile`              |
| 常量      | UPPER_SNAKE | `MAX_RETRY_COUNT`          |
| 变量/函数 | camelCase   | `getUserById`              |

## 构建模式约定

| 模式 | 命令前缀 | 数据目录 | 启动方式 |
|------|----------|----------|----------|
| Native | `dev:native` | `.pixi/data/` | Pixi 管理 PG/Redis |
| Container | `dev:container` | Docker volumes | Dockerfile.dev |
| Compose | `dev:compose` | Docker volumes | docker-compose.dev.yml |
| Deploy | `build:deploy` + `start:deploy` | `data/` | node out/server/index.js |

### API 路径规范

- 所有 API 路径必须包含 `/v1/` 版本前缀
- 前端 `client.baseURL = '/api'`，所以请求路径为 `/v1/auth/login`（不是 `/auth/login`）
- 验证: `grep -r "/auth/\|/setup/\|/users/" apps/admin-ui/src/ | grep -v '/v1/'` 应无结果

### Zustand persist 约束

- 不要持久化 UI 状态（`currentStep`、`isLoading` 等）
- 只持久化业务数据（`formData`、`token`、`refreshToken`）
- 组件 mount 时不要依赖 persist 恢复的 UI 状态
- `PrivateRoute` 必须检查 `token || isAuthenticated`（token 总是被持久化）

### E2E 测试约定

- 默认用 mock API（`page.route`），只有 setup/init 类测试用真后端
- Modal 按钮用 `.ant-modal .ant-btn-primary` 或 `button:has-text("Confirm"), button:has-text("确认")`
- 每个测试独立数据（`Date.now()` 唯一标识）
- `beforeEach` 中检测 401 → 重新创建 admin → 重试登录
- Playwright 配置用 `webServer.reuseExistingServer: true` 避免 Vite 进程冲突
- 操作反馈用页面内 inline `<Alert data-testid="...">` 或 toast：toast 必须经 `src/api/feedback.ts` 的 bridge（`App.useApp()` 由 `<AppBridge>` 注入）取实例
- 禁止从 `'antd'` 直接导入静态 `message`/`notification`（React 19 渲染器下不挂载，见 PIT-023；R11 E2E 验证 bridge 渲染）
- 断言 mount effect 触发的硬导航（window.location.assign on load）用 `expect(page).toHaveURL(/re/, { timeout })` 轮询，不用 `waitForURL`：StrictMode 双发 effect 会连续两次 assign 使首次导航 ERR_ABORTED、waitForURL 的 load/commit 事件竞态报假失败（J-T3 实测；waitForURL 仅适用于用户手势后页面已稳定的 assign）；同理 mount effect 里的 POST 次数断言用 `>=1` 不用 `===1`


## Setup 状态语义约束（D113，2026-09-02）

### DB 推导下的向导时序不变量

- `isInitialized` 在 admin 建成瞬间即为 true——**config/complete 是向导内的合法写**，任何 `isInitialized→410` 拦截都会死锁向导后半程（PIT-027 同族，已在 9c633e3 修复）
- guard `SETUP_WRITE_PATHS` 只允许 `/setup/admin`（防重复建 admin）；config/complete 的防重由 handler 内部业务检查负责（complete 幂等重发 token）
- 前端 `checkSetupStatus` 三态（`{needsSetup, ok}`）：**catch 分支禁止直接映射为路由决策**——后端不可达须走重试页（useSetupGuardState，3s），不能落 /login（PIT-029）
- 检查命令: `grep -n "isInitialized" apps/server/src/routes/setup.ts` 只应出现在 /admin handler 与 status 推导；`grep -rn "catch(() => set" apps/admin-ui/src/App.tsx` 应零命中（已由 useSetupGuardState 替代）


## Phase 7 审查追加约束（2026-09-03）

### API 信封与类型层

- 所有 server 新端点必须 `{success,data}` 信封（/auth/me 裸返回例外已消除，T2-4）；前端 api 层必须 `client.get<ApiEnvelope<T>>` / `PaginatedEnvelope<T>` 泛型，禁隐式 any 响应
- 检查命令: `grep -L "Envelope" apps/admin-ui/src/api/*.ts | grep -v types.ts` 应输出空（feedback.ts 除外，无请求）

### E2E 运行与断言保真

- 跑 e2e/vitest 前必须 `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`（见 PIT-031）
- i18n 文案断言用 exact（`getByText(x,{exact:true})` 或严格正则），禁裸 `:has-text` 子串（见 PIT-032）
- 新增 mock 必须从 routes/*.ts 实际返回拷贝；委托代理断流后接手先跑 tsc+vitest 基线（见 PIT-033）
- 已知 bug 用 `test.fail()`+`// RED:` 入库，修好转绿后移除标注为完成判据（D114）；当前存量应为 0：`grep -c "^ *test.fail()" e2e/*.spec.ts` 全 0
- batch-gate vitest 基线（`pixi run npx vitest run apps/server`，2026-09-16 H′ 起）：PG up = `352 passed | 7 skipped (359)`；PG down = `352 passed | 7 skipped (359)`（mfa-integration/oidc-flow 两文件 beforeAll PG 探针跳过，非失败；security rate-limit 断言 [429,423] 双态）——后续控制器直接对表，勿再重新推导

### Zustand persist 敏感字段

- 密码/密钥类字段绝不入 persist：向导类表单走"直传 API 不落 store"（AdminStep T3-1 先例）


## Phase 8a 授权接线约束（2026-09-04）

- 新增路由的权限码必须**同时**进 authorize.ts `routePermissions` 映射表与 permissions-seed.ts `BUILTIN_PERMISSIONS`（只改其一 = 映射到了无种子码 或 种子码无人消费，均永久 403/死码）
- 检查命令 1：`grep -c "resource: '" apps/server/src/routes/permissions-seed.ts` 应 =21（码数变更时同步更新此期望值；2026-09-12 批 C Task 2 15→18：apikeys:read/write/delete + RESOURCES 数组同步加 'apikeys'；2026-09-16 batch G Task 2 升至 21：tenants:read/write/delete + RESOURCES 数组同步加 'tenants'——该计数落地于 batch G Task 2，非 Task 1，届时更新此期望值）
- 检查命令 2（映射 unique 值 vs 种子清单 diff 应空）：`diff <(grep -oE "'[a-z]+:(read|write|delete)'" packages/identity/src/hooks/authorize.ts | sort -u | tr -d "'") <(grep -oE "name: '[a-z]+:(read|write|delete)'" apps/server/src/routes/permissions-seed.ts | grep -oE "[a-z]+:(read|write|delete)" | sort -u)`
- DEFAULT_TENANT 单源 `apps/server/src/utils/constants.ts`，禁字面量散落；检查 `grep -rn "00000000-0000-0000-0000-000000000001" apps/server/src --include="*.ts" | grep -v __tests__ | grep -v constants.ts` 应零命中（2026-09-04 已收编 auth.ts 两处 + oauth.ts 一处，commit 8a987f2）
- dev 环境跑 MFA 端点需 `MFA_ENCRYPTION_KEY`（32-byte hex）：现仓库脚本/accessbase.sh/.env.example 均未透传此变量，缺失时 mfa/setup 返回 400 AUTH_MFA_002（批三 TOTP 面板接线前需补运维配置）
- `buildApp()` 工厂**禁止启动副作用**（DB 拨号/seed/定时器）：自愈 seed 只挂 `index.ts` 入口（`selfHealSeed` fire-and-forget，双层吞）。带 auditStorage 注入的测试曾因工厂内自愈向真 PG 拨号产生 FATAL 噪声与 flake（回归锁：route-guard.test 静态断言）。检查：`grep -n "permissions-seed\|ensureSeedForAdmin\|selfHealSeed" apps/server/src/app.ts` 应零命中

## 语言约束（2026-09-10 用户指令，硬约束）

- 提交信息 / 代码注释 / 架构与设计文档（docs/modules、decisions.md 新增条目）：英文
- 计划（docs/superpowers/plans、.omo/plans）与 AI 对话/报告：中文
- 既有中文记忆文件（status/pitfalls/conventions）追加沿用中文体例；decisions.md 自 D116 起英文
- 检查命令：提交后 `git log -1 --format='%s %b' | grep -P '[\x{4e00}-\x{9fa5}]'` 应无输出（新规后适用；历史中文提交不回改）
- 新增代码注释扫描：`grep -rnP '^\s*//.*[\x{4e00}-\x{9fa5}]' apps/admin-ui/src packages/*/src --include='*.ts' --include='*.tsx' | grep -v locales` 应零新增

## R3 收敛 keep-list 记录（2026-09-16）

- DEFAULT_TENANT 唯一写入 keep-list = `constants.ts` / `permissions-seed.ts` / `setup.ts` / `init.ts` 四件套
- 路由层回退形态 `request.tenantId ?? DEFAULT_TENANT`（公共路由无 authenticate → 回退 DEFAULT，语义即 spec G2）
- 检查命令：`grep -rn "00000000-0000-0000-0000-000000000001" apps/server/src --include="*.ts" | grep -v __tests__ | grep -v constants.ts | grep -v permissions-seed.ts | grep -v setup.ts | grep -v init.ts` 应零命中
## 设置/资料类页面宽度策略（2026-09-10 用户实测终裁）

- 卡片壳与列表页一致：流式全宽（width:100%，不封顶不居中）——720 居中列方案已被用户屏幕实测后推翻，勿改回
- 卡内表单控件与提示 Alert 统一 maxWidth:400 成列（ant-design-pro 同构：容器 fluid + 表单列 cap）
- 检查：probe 实测 gapL==gapR 且拉窗 cardW 跟随 contentW 变化

## Phase 9 OIDC Provider 约束（2026-09-11）

- /oidc/* 挂载为 onRequest 劫持（B1）：**禁止给 /oidc 注册任何 content-type parser**（provider 自解析 urlencoded；检查命令：`grep -c "addContentTypeParser" apps/server/src/app.ts` 应 =0）
- 客户端密钥列 secretEncrypted 为 **AES-256-GCM blob**（v1:salt:iv:tag:ct），**禁止改回 sha256 哈希**（provider 边界需明文比对）；轮换 = rotateSecret 接口，明文仅 create/rotate 响应出现一次
- Grant/Interaction 等瞬时 kind 走内存 catch-all（**重启=consent 重做+RP refresh token 全失效**）；持久化前先解决 provider payload round-trip 丢字段问题
- /oidc 不入审计（写体含密钥语义）；oidcGrants 表为部分审计轨迹——需完整审计须显式设计
- interaction resume 守卫 `/^\/oidc\/auth\//`（拒绝 \\ 与二次编码）——前端 login redirect 参数唯一合法形态

## e2e 双模式互斥与 OIDC 密钥纪律（2026-09-12）

- mock-API e2e 全量跑之前**必须确认 5101 无真后端进程**（穿透请求会污染 mock 流程）；health.spec 是唯一例外（真后端冒烟，自动探测可达性，不可达时 skip）
- 检查：`curl -s -m 2 --noproxy '*' -o /dev/null -w '%{http_code}' http://localhost:5101/health/live` 应 000（后端停）
- 客户端密钥一次性揭示是**硬约束**：create/rotate 响应之外任何路径（list/get/日志/e2e list 断言）出现明文即缺陷；OidcClientListRow 类型已从类型层排除 secretEncrypted
- dist 同步陷阱：packages/identity 的 schema/manager 改动后若 apps/server 的 tsc 报幽灵字段错误，先 `pnpm --filter @accessbase/identity build` 再查代码（server 从 dist 解析 @accessbase/identity）

## API Key 与迁移链纪律（2026-09-12，批次 C）

- **迁移链仅面向全新数据库**：drizzle 链（packages/migration/drizzle/）不含 ALTER ADD COLUMN 守卫，对存量 db:push 管理的库手动跑 migrate 会 duplicate column 报错——存量开发库一律继续 `accessbase.sh db:push`；迁移链服务全新部署（commit 0001_violet_butterfly 起与 schema 同步）
- **API Key 明文契约**：`ab_` + 32 位小写字母数字（35 总长，api.md §23.10）；明文仅 create 响应出现一次，存储 sha256 hex；认证层凭 revokedAt/isExpired 判定失效（findByHash 不过滤）

## Phase K 防线约束（2026-09-18）

- **审计/stats 读侧租户谓词**：`buildWhere(query, tenantId)` 规则 = DEFAULT_TENANT 请求见 `inArray([t,'system'])`、非默认租户严格 `eq(t)`（auth 事件写侧归 'system' 无租户可归，仅平台侧可见——写侧归属是 L 批 backlog，勿在路由层私自放宽）。检查：`grep -c "tenantId" apps/server/src/routes/audit.ts` 应 ≥4；stats 五查询（4 计数+recent）每个都带租户谓词，sessions 计数必须经 `innerJoin(users)` 归租户（sessions 表无 tenant 列）。
- **RBAC 守卫落点 = manager 漏斗，非 route**：`changeStatus`(→suspended)/`delete`/`setUserRoles`/`revokeFromUser` 的 last-admin 闸在 UserManager/RoleManager 内（SCIM 直调 changeStatus 同闸——route 级预查被双 Momus 审否）；谓词唯一源 `packages/identity/src/services/last-admin-guard.ts`（wouldOrphanLastAdmin 非私有）。新增任何写 status/角色归属的路径都自动过闸，勿在 route 复制谓词。
- **409 契约**：manager 拒绝以 `ROLE_PROTECTED:` / `LAST_ADMIN_GUARD:` message 前缀 throw → 经 `apps/server/src/utils/conflict-mapper.ts` sendConflictError 统一 409 envelope（tag 字面量在 mapper 与 identity 常量两处定义，route 测试 mock identity 模块故 mapper 刻意不 import——改 tag 名两处同步）。
- **isSystem stamp**：自愈 `UPDATE roles SET is_system=true WHERE name='admin'` 必须 direct SQL 无租户过滤且不走 RoleManager.update（幂等性）。admin 角色自此不可经 UI/API 改名/清空权限——新增权限码到 admin 走 seedBuiltinPermissions 直插路径（不过守卫），勿改道。
- **e2e route 标志断言用 `expect.poll(() => flag).toBe(true)` 不用同步 expect**：click→request 派发异步，route handler 置标志在请求到达时——同步断言抢跑（users-crud search flake 根因，b34d986 清偿）；初始 mock 数据使行数断言零屏障时尤其致命。

## Phase L 运维 P0 约束（2026-09-20）

- **运行时迁移唯一写者 = `scripts/migrate.sh`**（链目录由两调用点显式传参：容器 `/app/packages/migration/drizzle`、deploy 仓库根路径——`out/` 只含 dist，勿依赖其含链）。legacy push 管理库 = stamped（note='stamped'）+ 链尾哨兵 error 行，schema 对齐仍归 db:push，勿在 migrate.sh 私自放宽。禁对同库混用 `db:migrate`（inert `up:pg` 写 `__drizzle_migrations`，与本追踪表互不相认）。检查：`grep -c "cli.js" docker/entrypoint.sh scripts/deploy/start.sh` 应 0；`grep -n "migrate.sh" docker/entrypoint.sh scripts/deploy/start.sh` 行内不得含 `|| true`。
- **deploy 启停契约（start.sh/stop.sh）**：环体取码必须 `code=0; wait "$SERVER_PID" || code=$?`（全局 set -e 下裸 wait 非零即卒）；`data/.startpid` 存 wrapper `$$`，stop.sh **先 TERM wrapper**（trap 置 DEPLOY_STOPPING → 环干净退出走 cleanup）再 backstop；server PID 每轮重写进 `$PIDFILE`；15s 内 3 退 → crash-loop 帽 abort 收栈；`export NODE_ENV="${NODE_ENV:-production}"` 必须位于 pre-flight 块**之前**（否则 JWT/ADMIN/CORS 三查在默认部署永不触发）。静态锁：process-defenses.test.ts。
- **CI 拓扑**：`e2e` job 无服务（无 PG/Redis/build/DATABASE_URL）——5101 必须无监听（vite-only webServer CI 分支），验收措辞不得声称「真后端 e2e 已入 CI」（health.spec CI 必跳、setup-real 被 testIgnore）；`migrate` job = postgres:16 service（accessbase/accessbase 匹配 MAINT_URL）+ 单文件 vitest；test job junit 透传参数不得丢（`pnpm test:coverage -- --reporter=junit --outputFile=test-results.xml`）。coverage 阈值 = 实测逐维 floor−5，只升不降（ponytail 注释 ratchet）；include/exclude 必须 `**/node_modules/**` glob 形（前缀字符串漏 .pnpm 布局 = 假分母根因）。
- **warnDegradedChecks = 纯函数 env-only**（无 logger import、无 process.env 读取、不抛）；options 表 listen 后才预热 boot 不可见，判项文案必须带限定语；MFA_ENCRYPTION_KEY 无 options 回退（env-only 真相）。禁新增 prod fail-fast 除非该键在全部生产路径都必需（K-T4 R3 砖机教训）。
- **ESM 源内禁 `require()`**：@types/node ambient 使 tsc 放行、tsx/vitest shim 掩盖，唯编译后 dist（生产）崩——eslint `@typescript-eslint/no-require-imports: error` 已全仓把关；生产专属代码路径（如 RS256 键加载）必须 live-fire 编译产物验，不接受「测试绿」外推。
