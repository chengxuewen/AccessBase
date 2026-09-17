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
