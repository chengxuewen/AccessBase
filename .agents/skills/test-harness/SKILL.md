---
name: test-harness
description: 'AccessBase TypeScript 全栈自动化测试工具架。从 SDD 文档生成 TDD 测试计划与测试代码骨架、AAA 模式强制执行、SDD-测试一致性验证、覆盖率缺口分析。交互式菜单驱动。支持 Vitest + Playwright + React Testing Library，Phase 感知（跳过未就绪模块）。'
---

# 测试工具架 (Test Harness)

为 AccessBase TypeScript 全栈项目提供自动化测试生成与验证。从 SDD 文档直接产出 TDD 测试计划与测试代码，确保 AAA 模式、Phase 对齐、AccessBase 测试惯例一致。

**哲学**: 测试不是写完代码再补的东西，是从 SDD 规范直接长出来的。一个好测试文件 = 规范的可执行副本。

---

## 入口：命令结构

### `/test-harness`（无参数）

显示场景菜单：

```
[1] gen-tdd      - SDD -> TDD 文档生成
[2] gen-tests    - TDD doc -> 测试代码骨架
[3] tdd-cycle    - TDD RED->GREEN->IMPROVE 引导
[4] verify       - SDD-测试一致性验证
[5] gen-seeds    - 种子/Mock 生成
[6] gen-e2e      - E2E 测试生成
[7] gen-contract - 契约测试生成
[8] coverage     - 覆盖率分析+缺口识别
[9] init         - 测试基础设施初始化
[0] full         - 全流程 (init -> gen-tdd -> gen-tests -> tdd-cycle -> verify -> coverage)
```

### 命令速查

```
/test-harness              -> 显示场景菜单
/test-harness init         -> 测试基础设施初始化
/test-harness gen-tdd      -> SDD -> TDD 文档生成
/test-harness gen-tests    -> TDD doc -> 测试代码骨架
/test-harness tdd-cycle    -> TDD RED->GREEN->IMPROVE 引导
/test-harness verify       -> SDD-测试一致性验证
/test-harness gen-seeds    -> 种子/Mock 生成
/test-harness gen-e2e      -> E2E 测试生成
/test-harness gen-contract -> 契约测试生成
/test-harness coverage     -> 覆盖率分析+缺口识别
/test-harness full         -> 全流程
```

---

## 工作流

### 模式 1: SDD -> TDD 文档生成

```
/test-harness gen-tdd
```

#### Step 1: 识别 SDD 源

自动扫描 `docs/modules/` 目录：

```
docs/modules/
├── rbac-sdd.md              -> RBAC 权限引擎
├── plugin-framework-sdd.md   -> 插件框架
├── manifest-engine-sdd.md    -> manifest.yaml 引擎
├── migration-engine-sdd.md   -> 迁移管理
├── audit-sdd.md              -> 审计日志
├── i18n-sdd.md               -> 国际化
├── logging-infra-sdd.md      -> 日志/调试
├── plugin-core-sdd.md        -> 内核插件 Bootstrap
├── shared-types-sdd.md       -> 公共类型
└── health-check-sdd.md       -> 健康检查（待生成）
```

让用户选择 SDD 文档（单选或多选）。

#### Step 2: 解析 SDD 8 节结构

AccessBase SDD 标准结构（见 `.agents/memorys/conventions.md`）：

| 节  | 标题             | 测试生成用途                                       |
| --- | ---------------- | -------------------------------------------------- |
| §1  | 概要             | 模块定位、职责边界 -> 生成 describe 块标题         |
| §2  | 接口定义         | TypeScript 类型签名 -> **生成测试函数签名 + 断言** |
| §3  | 生命周期         | 启动/关闭/加载/卸载顺序 -> 生命周期测试            |
| §4  | 依赖关系         | 依赖模块列表 -> mock 设置                          |
| §5  | 错误码与错误处理 | 错误码枚举 -> **错误路径测试**                     |
| §6  | 安全考虑         | 权限检查点、数据过滤 -> 安全测试                   |
| §7  | Mock 约束        | Phase 1 mock 接口约束 -> **mock 设置**             |
| §8  | 变更记录         | 版本历史（不参与测试生成）                         |

#### Step 3: Phase 感知过滤

读取 `docs/phase-planning.md`，判定当前 Phase：

| Phase    | 可用模块                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1a | shared-types, plugin-framework, plugin-core, manifest-engine, migration-engine, rbac, audit, i18n, health-check, logging-infra, admin-ui |
| Phase 1b | plugin-communication, event-bus, cron (BullMQ), api-versioning                                                                           |
| Phase 2  | schema-engine, websocket, notification                                                                                                   |

自动过滤模块：

- 当前 Phase 未就绪的模块 -> 标记 ⏭️ 跳过，生成注释说明
- 当前 Phase 的模块 -> 完整生成 TDD 文档

#### Step 4: 生成 TDD 文档

对每个 SDD 文档，生成对应的 `docs/modules/{module}-tdd.md`，包含：

- 测试用例清单（AAA 格式）
- 覆盖率目标（Phase 1a: 全局 60% lines，核心路径 80%；Phase 1b+: 全局 80% 强制）
- Mock 约束（从 SDD §7 提取）
- 种子数据需求（从 SDD §2 接口参数推导）

---

### 模式 2: TDD 文档 -> 测试代码骨架

```
/test-harness gen-tests
```

#### 生成层级（每次询问）

1. **stubs**: 仅函数签名 + `expect(true).toBe(false)` 占位 - 编译通过，测试失败
2. **AAA 骨架**: Arrange/Act/Assert 注释 + 占位 -> 结构就绪，断言待填
3. **完整填充**: 从 SDD §2 接口定义提取具体值，断言完整可运行

#### Step 1: 读取 TDD 文档

读取选定的 `docs/modules/{module}-tdd.md`，提取测试用例清单。

#### Step 2: 生成测试文件

对每个测试用例，生成 TypeScript 测试函数：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';

describe('RBAC Permission Check', () => {
  it('should allow admin user to access all resources', async () => {
    // Arrange
    const user = await seedAdminUser(testApp);
    const resource = 'admin.users';

    // Act
    const result = await rbac.can(user.id, resource, 'read');

    // Assert
    expect(result).toBe(true);
  });
});
```

#### Step 3: 写入并验证

1. 写入测试文件到 `packages/{module}/src/__tests__/{file}.test.ts`
2. 运行 `tsc --noEmit` 编译检查
3. 运行 `vitest run` 测试（预期: stubs 失败，完整填充通过）
4. 报告: `生成 N 个测试函数 -> M 通过 / K 失败 / P 跳过`

---

### 模式 3: TDD RED->GREEN->IMPROVE 引导

```
/test-harness tdd-cycle
```

1. **RED**: 运行测试，确认全部失败（测试存在但实现未完成）
2. **GREEN**: 引导用户编写最小实现使测试通过
3. **IMPROVE**: 检查覆盖率，引导补充边界测试
4. 循环直到覆盖率达到目标

**绝不**: 修改测试让实现通过（除非测试本身有错误）。优先级: SDD > 测试 > 实现。

---

### 模式 4: SDD-测试一致性验证

```
/test-harness verify
```

检查现有测试覆盖，与 SDD 接口定义交叉比对：

1. 扫描所有测试文件 `packages/*/src/__tests__/*.test.ts`
2. 提取测试函数名 -> 映射到 SDD §2 接口定义
3. 产生覆盖矩阵:

```
SDD 接口              | 测试函数                              | 状态
---------------------|--------------------------------------|------
RBAC.can()           | test_rbac_can_admin_all              | ✅
RBAC.assignRole()    | test_rbac_assign_role                | ✅
RBAC.revokeRole()    | -                                    | ❌ 缺失
RBAC.checkRecordRule | test_rbac_record_rule_partial        | ⚠️ 不完整
```

4. 标记:
   - ❌ 缺失 -> 推荐从 SDD 生成
   - ⚠️ 不完整 -> 边界条件未覆盖（对照 SDD §5 错误码）
   - ✅ 完整

---

### 模式 5: 种子/Mock 生成

```
/test-harness gen-seeds
```

从 SDD §2 接口定义和 §7 Mock 约束自动生成：

#### 种子数据工厂

```typescript
// packages/*/src/__tests__/seeds/{entity}.ts
import { randomUUID } from 'crypto';

export function seedAdminUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    email: 'admin@test.com',
    role: 'admin',
    tenantId: 'test-tenant',
    is_active: true,
    token_version: 0,
    ...overrides,
  };
}
```

#### ProcessPluginHost Mock（5 项约束）

从 SDD §7 提取 Mock 约束，生成满足 5 项约束的 mock：

```typescript
// packages/*/src/__tests__/helpers/mockPluginHost.ts
import { vi } from 'vitest';

// 1. async Promise - 所有 mock 方法返回 Promise
// 2. JSON 序列化/反序列化 - mock 验证序列化往返
// 3. 30s 超时 - 模拟跨进程超时行为
// 4. 1-5ms 延迟注入 - 模拟通信延迟
// 5. AUDE_STRICT_PLUGIN_HOST=1 强制 JSON 序列化往返断言

const STRICT = process.env.AUDE_STRICT_PLUGIN_HOST === '1';
const MOCK_DELAY_MS = 2; // 1-5ms 范围

export function createMockPluginHost() {
  const call = vi.fn(async (method: string, ...args: unknown[]) => {
    // 4. 延迟注入
    await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));

    // 2 + 5. JSON 序列化往返
    const serialized = JSON.parse(JSON.stringify(args));

    if (STRICT) {
      // 5. 严格模式断言序列化往返无损
      expect(serialized).toEqual(args);
    }

    return mockResponses[method]?.(serialized) ?? undefined;
  });

  // 3. 30s 超时
  const withTimeout = vi.fn(async (...args: unknown[]) => {
    return Promise.race([
      call(...args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PluginHost timeout (30s)')), 30_000),
      ),
    ]);
  });

  return { call: withTimeout };
}
```

---

### 模式 6: E2E 测试生成

```
/test-harness gen-e2e
```

从 `docs/modules/e2e-test-flows.md` 定义的 5 核心流程生成 Playwright 测试骨架：

1. **auth.e2e.ts** - 认证流程（登录/错误密码/速率限制/Token刷新）
2. **plugins.e2e.ts** - 插件管理（列表/启用/禁用/权限控制）
3. **users.e2e.ts** - 用户管理（创建/编辑/删除/分页）
4. **roles.e2e.ts** - 角色管理（创建/分配权限/列表）
5. **health.e2e.ts** - 基础健康检查（ProLayout/菜单导航）

#### preSeed 声明模式

每个 E2E 测试文件声明其所需的种子数据：

```typescript
// packages/admin-ui/__e2e__/auth.e2e.ts
import { test } from '@playwright/test';
import { seedE2EData } from '../test-helpers/seed-e2e';

export const preSeed = {
  admin: true, // seedAdminUser(): admin / Admin@123
} as const;

test.describe('Auth Flow', () => {
  test.beforeEach(async () => {
    await seedE2EData(preSeed);
  });

  test('normal login returns 200', async ({ page }) => {
    // Arrange
    await page.goto('/login');

    // Act
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'Admin@123');
    await page.click('button[type="submit"]');

    // Assert
    await page.waitForURL('/admin');
  });
});
```

---

### 模式 7: 契约测试生成

```
/test-harness gen-contract
```

从 SDD §2 接口定义和 API 规范 (`docs/modules/api-specification.md`) 生成契约测试：

```typescript
// packages/*/src/__tests__/contracts/{module}.contract.test.ts
import { describe, it } from 'vitest';
import { z } from 'zod';
import { validateContract } from '../helpers/validateContract';
import { withTestApp } from '../helpers/withTestApp';
import { seedAdminUser } from '../seeds/admin';
import { userResponseSchema, errorResponseSchema } from '@audebase/shared-types/schemas';

describe('GET /api/v1/users', () => {
  it('returns paginated user list', async () => {
    // Arrange
    await withTestApp(async (app) => {
      await seedAdminUser(app);

      // Act + Assert
      await validateContract('GET', '/api/v1/users', {
        response: userResponseSchema,
        status: 200,
      });
    });
  });

  it('returns AUTH_REQUIRED without token', async () => {
    // Arrange
    await withTestApp(async () => {
      // Act + Assert
      await validateContract('GET', '/api/v1/users', {
        response: errorResponseSchema,
        status: 401,
      });
    });
  });
});
```

契约测试验证 API 端点的响应形状与 Zod schema 匹配，存放于 `packages/*/src/__tests__/contracts/`。

---

### 模式 8: 覆盖率分析+缺口识别

```
/test-harness coverage
```

1. 运行 `vitest run --coverage`
2. 按模块聚合并展示:

```
模块                | 行覆盖    | 分支覆盖   | SDD 接口覆盖
-------------------|----------|----------|----------
shared-types        | 95%      | 90%      | 12/12
plugin-framework    | 82%      | 75%      | 18/20
rbac                | 78%      | 71%      | 14/16
audit               | 85%      | 80%      | 8/8
i18n                | 90%      | 85%      | 6/6
───────────────────|──────────|──────────|────────
总计                | 81%      | 74%      | 58/62
```

3. 缺口排序: 未覆盖 SDD 接口 / 低分支覆盖函数
4. 推荐: 优先补充的 N 项测试

#### 覆盖率目标

| Phase     | 全局 lines | 核心路径 | 闸门        |
| --------- | ---------- | -------- | ----------- |
| Phase 1a  | 60%        | 80%      | CI 警告     |
| Phase 1b+ | 80%        | 80%      | CI 强制失败 |

---

### 模式 9: 测试基础设施初始化

```
/test-harness init
```

为新模块或新项目创建测试基础设施：

#### 安装依赖

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @playwright/test ioredis-mock
```

#### 生成配置文件

**vitest.config.ts**:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['packages/*/src/**/*.integration.test.ts', 'packages/*/src/**/*.contract.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: process.env.AUDE_PHASE_1A ? 60 : 80,
      },
    },
  },
});
```

**vitest.workspace.ts** (workspace 分层):

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/*/src/**/*.test.ts'],
      exclude: ['packages/*/src/**/*.integration.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'integration',
      include: ['packages/*/src/**/*.integration.test.ts'],
      environment: 'node',
    },
  },
]);
```

**test-utils.tsx** (前端组件测试):

```typescript
import { render, type RenderOptions } from '@testing-library/react'
import { type ReactElement } from 'react'

// MockACLWrapper - 提供 ACLContext 给组件测试
interface MockACLWrapperOptions {
  aclPermissions?: Set<string>
}

function MockACLWrapper({
  children,
  permissions,
}: {
  children: React.ReactNode
  permissions: Set<string>
}) {
  // ACLProvider mock 实现
  // 返回包裹了 ACLContext.Provider 的 children
  return <>{children}</>
}

export function renderWithProviders(
  ui: ReactElement,
  options: MockACLWrapperOptions & RenderOptions = {},
) {
  const { aclPermissions = new Set<string>(), ...renderOptions } = options
  return render(ui, {
    wrapper: ({ children }) => (
      <MockACLWrapper permissions={aclPermissions}>{children}</MockACLWrapper>
    ),
    ...renderOptions,
  })
}
```

**createTestApp.ts** (后端集成测试 helper):

```typescript
import Redis from 'ioredis-mock';
import { type FastifyInstance } from 'fastify';
import { type Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

interface TestAppOptions {
  withRedis?: boolean;
  withBullMQ?: boolean;
  queues?: string[];
  seeds?: {
    admin?: boolean;
    tenant?: string;
  };
}

interface TestApp {
  app: FastifyInstance;
  db: DrizzleDB;
  redis: { client: Redis; publisher: Redis; subscriber: Redis } | null;
  queues: Record<string, Queue> | null;
  withTransaction: <T>(fn: (tx: DrizzleDB) => Promise<T>) => Promise<T>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  // 构建 Fastify app（无 Redis - 快速启动）
  // 条件注入 ioredis-mock
  // 条件注入 BullMQ testMode
  // 条件执行 seeds
  // 返回 TestApp
}

// 事务回滚 helper
export async function withTestApp(fn: (app: TestApp) => Promise<void>): Promise<void> {
  const app = await createTestApp();
  await app.db.transaction(async (tx) => {
    try {
      await fn(app.withTransaction(tx));
      await tx.rollback();
    } catch (error: unknown) {
      await tx.rollback();
      throw error;
    }
  });
}
```

**playwright.config.ts** (E2E 测试):

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './packages/admin-ui/__e2e__',
  globalSetup: './packages/admin-ui/__e2e__/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    storageState: 'packages/admin-ui/__e2e__/.auth/admin.json',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'AUDE_DEV=1 npx aude dev --testing',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

---

### 模式 10: 全流程

```
/test-harness full
```

依次执行:

1. `init` - 确保测试基础设施就绪
2. `gen-tdd` - 从 SDD 生成 TDD 文档
3. `gen-tests` - 从 TDD 文档生成测试代码骨架
4. `tdd-cycle` - RED->GREEN->IMPROVE 引导
5. `verify` - SDD-测试一致性验证
6. `coverage` - 覆盖率分析与缺口识别

---

## AccessBase 特定测试模式

### 种子数据工厂模式

每个包在 `src/__tests__/seeds/` 目录下提供工厂函数（见 `docs/modules/test-seed-strategy.md`）：

```typescript
// packages/*/src/__tests__/seeds/admin.ts
export async function seedAdminUser(testApp: TestApp) {
  const admin = await testApp.db
    .insert(users)
    .values({
      username: 'admin',
      password_hash: await hash('Admin@123'),
      token_version: 0,
      is_active: true,
    })
    .returning()
    .get();
  return admin;
}

// packages/*/src/__tests__/seeds/tenant.ts
export async function seedTestTenant(testApp: TestApp, slug = 'test-corp') {
  return testApp.db
    .insert(tenants)
    .values({
      slug,
      name: 'Test Corporation',
      status: 'active',
    })
    .returning()
    .get();
}
```

**约定**:

- 命名: `seed{Noun}()`
- 幂等性: 先检查记录是否存在，避免重复
- 隔离: `createTestApp()` 提供独立 DB 事务 (BEGIN/ROLLBACK)
- 目录: `packages/*/src/__tests__/seeds/*.ts`

### 事务回滚模式

所有集成测试在单个数据库事务中运行，确保零副作用：

```typescript
// 每个集成测试: BEGIN -> seed -> test -> ROLLBACK
beforeEach(async () => {
  await db.execute(sql`BEGIN`);
});

afterEach(async () => {
  await db.execute(sql`ROLLBACK`);
});
```

或使用 `withTestApp` helper：

```typescript
await withTestApp(async (app) => {
  // Arrange
  await seedAdminUser(app);
  // Act
  const result = await app.app.inject({ method: 'GET', url: '/api/v1/users' });
  // Assert
  expect(result.statusCode).toBe(200);
});
// 事务自动回滚
```

### ProcessPluginHost Mock（5 项约束）

Phase 1a inline mock 必须满足 5 项约束（见 SDD §7 + `docs/plugin-architecture-analysis.md`）：

1. **async Promise** - 所有 mock 方法返回 Promise
2. **JSON 序列化/反序列化** - mock 验证序列化往返
3. **30s 超时** - 模拟跨进程超时行为
4. **1-5ms 延迟注入** - 模拟通信延迟
5. **AUDE_STRICT_PLUGIN_HOST=1** 强制 JSON 序列化往返断言

### Redis Mock

使用 `ioredis-mock` 透明替换 `ioredis`（见 `docs/modules/redis-mock-guide.md`）：

```typescript
import Redis from 'ioredis-mock';

// 透明替换 - API 完全兼容
const redis = new Redis();
await redis.set('key', 'value');
const val = await redis.get('key'); // 'value'

// Pub/Sub mock 原生支持
await redis.subscribe('events');
redis.on('message', (channel, message) => {
  // channel === 'events'
});
await redis.publish('events', JSON.stringify({ type: 'test' }));
```

### BullMQ Mock

BullMQ 内置 testMode，完全脱离 Redis：

```typescript
import { Queue } from 'bullmq';

beforeEach(() => {
  Queue.testMode = true;
});
afterEach(async () => {
  await Queue.testMode.clear();
  Queue.testMode = false;
});
```

### 前端组件测试

使用 React Testing Library + `MockACLWrapper`（见 `docs/modules/frontend-spec.md`）：

```typescript
// packages/admin-ui/src/__tests__/UserCard.test.tsx
import { renderWithProviders } from '../helpers/test-utils'

it('renders user email', () => {
  // Arrange
  const mockUser = { id: '1', email: 'test@audebase.dev', is_active: true }

  // Act
  const { result } = renderWithProviders(<UserCard user={mockUser} />, {
    aclPermissions: new Set(['admin.users.view']),
  })

  // Assert
  expect(result.getByText('test@audebase.dev')).toBeInTheDocument()
})
```

### 契约测试

契约测试验证 API 端点的响应形状与 Zod schema 匹配（见 `docs/modules/test-seed-strategy.md` §7）：

```typescript
// packages/*/src/__tests__/contracts/{module}.contract.test.ts
import { validateContract } from '../helpers/validateContract';
import { withTestApp } from '../helpers/withTestApp';
import { userResponseSchema, errorResponseSchema } from '@audebase/shared-types/schemas';

describe('GET /api/v1/users', () => {
  it('returns paginated user list', async () => {
    await withTestApp(async (app) => {
      await seedAdminUser(app);
      await validateContract('GET', '/api/v1/users', {
        response: userResponseSchema,
        status: 200,
      });
    });
  });

  it('returns error without auth', async () => {
    await withTestApp(async () => {
      await validateContract('GET', '/api/v1/users', {
        response: errorResponseSchema,
        status: 401,
      });
    });
  });
});
```

### E2E 测试 (Playwright)

5 核心流程（见 `docs/modules/e2e-test-flows.md`），使用 preSeed 声明模式：

| 流程     | 文件           | preSeed                                               |
| -------- | -------------- | ----------------------------------------------------- |
| 认证     | auth.e2e.ts    | `{ admin: true }`                                     |
| 插件管理 | plugins.e2e.ts | `{ admin: true, plugins: 'zero' }`                    |
| 用户管理 | users.e2e.ts   | `{ admin: true, tenant: 'e2e-tenant', users: [...] }` |
| 角色管理 | roles.e2e.ts   | `{ admin: true, roles: ['admin', 'member'] }`         |
| 健康检查 | health.e2e.ts  | `{}` (无需种子)                                       |

### 集成测试边界

每个模块边界至少 2 个集成测试用例（见 `docs/modules/test-seed-strategy.md` §6）：

| 边界            |         最小用例数         |
| --------------- | :------------------------: |
| DB -> ORM       |             2+             |
| DB -> Migration |             2+             |
| API -> DB       | 3+ (GET + POST + 错误路径) |
| Auth -> JWT     |  3+ (签发 + 验证 + 过期)   |
| Config -> env   |             2+             |
| RateLimit -> IP |             2+             |

### 环境要求

| 组件     | 要求                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| 数据库   | **真实 PostgreSQL**（不允许 SQLite mock）。通过 `pg_tmp` 或 Docker 创建临时数据库 |
| Redis    | **允许 mock**。使用 `ioredis-mock` 替代真实 Redis                                 |
| 文件系统 | 使用 `os.tmpdir()` 临时目录，测试结束自动清理                                     |

---

## 文件结构参考

```
docs/modules/
├── {module}-sdd.md    # SDD source (8 sections)
├── {module}-tdd.md    # TDD test plan (AAA format)

packages/{module}/
├── src/
│   ├── __tests__/
│   │   ├── {file}.test.ts           # 单元测试
│   │   ├── {file}.integration.test.ts # 集成测试
│   │   ├── {file}.contract.test.ts  # 契约测试
│   │   ├── seeds/
│   │   │   └── {entity}.ts          # 种子工厂
│   │   ├── contracts/
│   │   │   └── {module}.contract.test.ts
│   │   └── helpers/
│   │       ├── createTestApp.ts     # 测试 app helper
│   │       ├── withTestApp.ts       # 事务回滚 helper
│   │       ├── mockPluginHost.ts    # ProcessPluginHost mock
│   │       └── validateContract.ts  # 契约测试辅助
│   └── ...

packages/admin-ui/
├── __e2e__/
│   ├── auth.e2e.ts                  # E2E: 认证流程
│   ├── plugins.e2e.ts               # E2E: 插件管理
│   ├── users.e2e.ts                 # E2E: 用户管理
│   ├── roles.e2e.ts                 # E2E: 角色管理
│   ├── health.e2e.ts               # E2E: 健康检查
│   ├── global-setup.ts             # E2E global setup
│   ├── auth.fixture.ts             # 登录 + storageState
│   └── .auth/admin.json            # cached auth state
├── src/
│   └── __tests__/
│       └── helpers/
│           └── test-utils.tsx       # renderWithProviders + MockACLWrapper
```

---

## 交互模式

所有测试生成操作在写入文件前展现 diff 预览，由用户确认：

```
将生成以下变更:
  packages/rbac/src/__tests__/permission.test.ts (新文件, 120行)
  packages/rbac/src/__tests__/seeds/admin.ts (新文件, 25行)
  packages/rbac/src/__tests__/helpers/mockPluginHost.ts (新文件, 60行)

总计: 3 文件, +205 行, 15 测试函数

执行? [Y/n]
```

---

## Phase 感知规则

自动读取 `docs/phase-planning.md` 确认当前 Phase。

| 检查点               | 行为                                 |
| -------------------- | ------------------------------------ |
| 模块所需依赖尚未定义 | 生成 stub 或跳过，标注 "⏭️ Phase 1b" |
| Phase 1a 模块        | 完整填充 + 断言                      |
| Phase 1b 模块        | AAA 骨架（依赖未就绪时）             |
| Phase 2 模块         | stub 占位                            |

Phase 变化时，重新运行 `gen-tests` -> 之前跳过的测试自动填充。

---

## 质量规则 (Guardrails)

1. **每个测试一个断言目标** - 一个 test 函数验证一个 SDD 接口行为
2. **AAA 注释必须显式** - `// Arrange` / `// Act` / `// Assert` 不可省略
3. **不修改测试让实现通过** - SDD > 测试 > 实现（优先级）
4. **禁止删除测试** - 构建失败时修复实现，不删除测试
5. **禁止 `as any` / `@ts-ignore`** - 使用 `unknown` + 类型收窄
6. **禁止 SQLite mock** - 必须使用真实 PostgreSQL + 事务回滚
7. **禁止弱 Mock** - ProcessPluginHost mock 必须满足 5 项约束
8. **禁止硬编码数据** - 使用 `seed{Noun}()` 工厂函数
9. **禁止 `console.log`** - 使用 vitest 的 `expect` / `toBe` 断言
10. **边界条件优先** - SDD §5 错误码的每个条目 -> 独立错误路径测试
11. **命名可追溯** - 测试用例名包含模块名（如 `rbac_can_admin_all_resources`）
12. **Phase 对齐** - 不生成当前 Phase 无法运行的测试
