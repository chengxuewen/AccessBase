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
- 操作反馈用页面内 inline `<Alert data-testid="...">`，禁用 antd 静态 `message.*` API（当前渲染器下不挂载，见 PIT-023）

## Setup 状态语义约束（D113，2026-09-02）

### DB 推导下的向导时序不变量

- `isInitialized` 在 admin 建成瞬间即为 true——**config/complete 是向导内的合法写**，任何 `isInitialized→410` 拦截都会死锁向导后半程（PIT-027 同族，已在 9c633e3 修复）
- guard `SETUP_WRITE_PATHS` 只允许 `/setup/admin`（防重复建 admin）；config/complete 的防重由 handler 内部业务检查负责（complete 幂等重发 token）
- 前端 `checkSetupStatus` 三态（`{needsSetup, ok}`）：**catch 分支禁止直接映射为路由决策**——后端不可达须走重试页（useSetupGuardState，3s），不能落 /login（PIT-029）
- 检查命令: `grep -n "isInitialized" apps/server/src/routes/setup.ts` 只应出现在 /admin handler 与 status 推导；`grep -rn "catch(() => set" apps/admin-ui/src/App.tsx` 应零命中（已由 useSetupGuardState 替代）
