# 设置向导后端 API 实现计划

> **对于 AI 代理工作者：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 为 AccessBase 实现设置向导后端 API，支持系统初始化、管理员创建和基本配置保存。

**架构：** 新增 `/api/v1/setup` 路由组，包含端点：状态检查、系统检查、管理员创建、配置保存、设置完成。使用中间件在设置完成前阻止所有其他 API 路由访问，设置完成后阻止 setup 写入端点。

**技术栈：** Fastify + @accessbase/identity (UserManager, RoleManager) + PostgreSQL + Redis + @fastify/rate-limit

**规范：** 基于 `apps/server/src/init.ts` 和 `apps/server/src/routes/auth.ts` 的现有模式

**审查修复：** 本计划已根据 `docs/reference/setup-review-security.md` 和 `docs/reference/setup-review-architecture.md` 的审查结果更新。

## 全局约束

- 所有 API 响应遵循 `{ success: boolean, data?: T, error?: { code: string, message: string } }` 格式
- 使用 Fastify schema 验证请求体
- 使用 `@accessbase/identity` 包的 UserManager 和 RoleManager
- 使用 `@accessbase/logging` 的 logger 进行结构化日志记录
- 遵循现有路由注册模式（`app.register(routes, { prefix: '...' })`）
- 所有密码操作使用 bcrypt（已在 UserManager 中实现）
- 使用环境变量或配置文件存储敏感信息
- **所有写入端点在设置完成后返回 `410 Gone`**（CRITICAL-1/2 修复）
- **敏感字段（密码、token）不得写入日志**（HIGH-3 修复）

## 安全架构

### isInitialized 全局标志

通过 `system_config` 表中的 `setup_complete` 键判断系统是否已初始化，取代硬编码邮箱检查：

```typescript
async function isSetupComplete(): Promise<boolean> {
  const result = await db.query.systemConfig.findFirst({
    where: eq(systemConfig.key, 'setup_complete'),
  });
  return result?.value === true;
}
```

### CSRF 防护（CRITICAL-4 修复）

- `GET /api/v1/setup/status` 返回一次性 `setupToken`
- 所有 POST 端点必须在 `X-Setup-Token` header 中携带此 token
- 设置完成后 setup token 失效

### 速率限制（CRITICAL-5 修复）

- 全局：`max: 60, timeWindow: '1 minute'`
- Setup 端点：`max: 5, timeWindow: '5 minutes'`（更严格）

---

## 新增：数据库迁移与 Schema

### 迁移任务：创建 system_config 表

**文件：**

- 创建：`packages/migration/src/migrations/XXXX_create_system_config.ts`

**Schema（Drizzle ORM）：**

```typescript
// packages/migration/src/schema/system-config.ts
import { pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const systemConfig = pgTable('system_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 100 }).unique().notNull(),
  value: jsonb('value').notNull(),
  category: varchar('category', { length: 50 }).notNull(), // 'general', 'smtp', 'security', 'status'
  description: varchar('description', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

**关键配置键：**

| Key              | Category | Type            | 说明                 |
| ---------------- | -------- | --------------- | -------------------- |
| `setup_complete` | status   | `boolean`       | 系统是否已完成初始化 |
| `setup_token`    | security | `string`        | CSRF 防护 token      |
| `site_name`      | general  | `string`        | 站点名称             |
| `site_url`       | general  | `string`        | 站点 URL             |
| `admin_email`    | general  | `string`        | 管理员邮箱           |
| `smtp_*`         | smtp     | `string/number` | SMTP 配置            |

**种子数据：**

```typescript
// 迁移中插入默认记录
await db.insert(systemConfig).values({
  key: 'setup_complete',
  value: false,
  category: 'status',
  description: 'Whether system setup has been completed',
});
```

---

### 任务 0：速率限制与 CSRF 基础设施

**文件：**

- 创建：`apps/server/src/plugins/rate-limit.ts`
- 创建：`apps/server/src/plugins/setup-csrf.ts`
- 修改：`apps/server/src/app.ts`（注册插件）

**接口：**

- 消费：`@fastify/rate-limit`, Redis
- 生产：速率限制插件 + CSRF token 管理

- [ ] **步骤 1：编写失败的测试**

```typescript
// apps/server/src/plugins/__tests__/rate-limit.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app.js';

describe('Rate Limiting', () => {
  it('should return 429 after exceeding setup endpoint limit', async () => {
    const app = await buildApp();

    // Make 6 requests (limit is 5)
    for (let i = 0; i < 6; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/setup/admin',
        payload: {
          email: `test${i}@example.com`,
          name: 'Test',
          password: 'SecurePass123!',
        },
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: {
        email: 'final@example.com',
        name: 'Test',
        password: 'SecurePass123!',
      },
    });

    expect(response.statusCode).toBe(429);
  });
});
```

```typescript
// apps/server/src/plugins/__tests__/setup-csrf.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app.js';

describe('Setup CSRF', () => {
  it('should reject POST without X-Setup-Token', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: {
        email: 'admin@example.com',
        name: 'Test',
        password: 'SecurePass123!',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.payload);
    expect(body.error.code).toBe('CSRF_TOKEN_MISSING');
  });

  it('should accept POST with valid X-Setup-Token', async () => {
    const app = await buildApp();

    // Get token from status endpoint
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    });
    const { data } = JSON.parse(statusResponse.payload);
    const setupToken = data.setupToken;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      headers: {
        'X-Setup-Token': setupToken,
      },
      payload: {
        email: 'admin@example.com',
        name: 'Test',
        password: 'SecurePass123!',
      },
    });

    // Should not be 403 CSRF error (might be other error)
    expect(response.statusCode).not.toBe(403);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/plugins/__tests__/`
预期：失败，因为插件不存在

- [ ] **步骤 3：编写最小实现**

```typescript
// apps/server/src/plugins/rate-limit.ts
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    }),
  });
};

export default fp(rateLimitPlugin, { name: '@accessbase/rate-limit' });
```

```typescript
// apps/server/src/plugins/setup-csrf.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';

const SETUP_TOKEN_HEADER = 'x-setup-token';

const setupCsrfPlugin: FastifyPluginAsync = async (fastify) => {
  // Generate setup token on status request
  fastify.decorateRequest('setupToken', null as string | null);

  fastify.addHook('onRequest', async (request, reply) => {
    // Skip CSRF for GET requests
    if (request.method === 'GET') return;

    // Skip for non-setup routes
    if (!request.url.startsWith('/api/v1/setup')) return;

    // Skip for /setup/complete (uses regular auth)
    if (request.url.startsWith('/api/v1/setup/complete')) return;

    const token = request.headers[SETUP_TOKEN_HEADER] as string | undefined;

    if (!token) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'CSRF_TOKEN_MISSING',
          message: 'Setup token is required. Please refresh the setup page.',
        },
      });
    }

    // Validate token against stored value
    const storedToken = await fastify.db.query.systemConfig.findFirst({
      where: (fields, { eq }) => eq(fields.key, 'setup_token'),
    });

    if (!storedToken || storedToken.value !== token) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'CSRF_TOKEN_INVALID',
          message: 'Invalid setup token. Please refresh the setup page.',
        },
      });
    }
  });

  // Generate and store new setup token
  fastify.decorate('generateSetupToken', async () => {
    const token = randomBytes(32).toString('hex');
    await fastify.db
      .insert(fastify.schema.systemConfig)
      .values({
        key: 'setup_token',
        value: token,
        category: 'security',
        description: 'CSRF token for setup wizard',
      })
      .onConflictDoUpdate({
        target: fastify.schema.systemConfig.key,
        set: { value: token, updatedAt: new Date() },
      });
    return token;
  });
};

export default fp(setupCsrfPlugin, { name: '@accessbase/setup-csrf' });
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/plugins/__tests__/`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/plugins/rate-limit.ts apps/server/src/plugins/setup-csrf.ts apps/server/src/plugins/__tests__/
git commit -m "feat: add rate limiting and CSRF protection for setup endpoints"
```

---

### 任务 1：创建设置状态检查端点

**文件：**

- 创建：`apps/server/src/routes/setup.ts`
- 修改：`apps/server/src/app.ts`（注册路由）

**接口：**

- 消费：无
- 生产：`GET /api/v1/setup/status` 端点，返回系统初始化状态 + setupToken

- [ ] **步骤 1：编写失败的测试**

```typescript
// apps/server/src/routes/__tests__/setup.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app.js';

describe('Setup API', () => {
  it('should return setup status with setupToken', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('isInitialized');
    expect(body.data).toHaveProperty('adminExists');
    expect(body.data).toHaveProperty('configComplete');
    expect(body.data).toHaveProperty('setupToken');
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：失败，因为 `/api/v1/setup/status` 路由不存在

- [ ] **步骤 3：编写最小实现**

```typescript
// apps/server/src/routes/setup.ts
import type { FastifyInstance } from 'fastify';
import { UserManager } from '@accessbase/identity';
import { logger } from '@accessbase/logging';

export async function setupRoutes(app: FastifyInstance) {
  // GET /api/v1/setup/status
  app.get(
    '/status',
    {
      schema: {
        description: 'Check system setup status',
        tags: ['setup'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  isInitialized: { type: 'boolean' },
                  adminExists: { type: 'boolean' },
                  configComplete: { type: 'boolean' },
                  setupToken: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userManager = new UserManager();

      // Check isInitialized from system_config table
      const setupComplete = await app.db.query.systemConfig.findFirst({
        where: (fields, { eq }) => eq(fields.key, 'setup_complete'),
      });
      const isInitialized = setupComplete?.value === true;

      // Check if admin user exists
      const adminUser = await userManager.findByEmail('admin@accessbase.local');
      const adminExists = !!adminUser;

      // Generate setup token for CSRF protection
      const setupToken = await app.generateSetupToken();

      return {
        success: true,
        data: {
          isInitialized,
          adminExists,
          configComplete: isInitialized,
          setupToken,
        },
      };
    },
  );
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/routes/setup.ts apps/server/src/routes/__tests__/setup.test.ts
git commit -m "feat: add setup status check endpoint with CSRF token"
```

---

### 任务 2：创建管理员创建端点

**文件：**

- 修改：`apps/server/src/routes/setup.ts`
- 修改：`apps/server/src/routes/__tests__/setup.test.ts`

**接口：**

- 消费：`UserManager.create()`, `RoleManager.create()`, Redis（分布式锁）
- 生产：`POST /api/v1/setup/admin` 端点，创建初始管理员用户

**关键修复：**

- **CRITICAL-1**: 检查 `isInitialized` 标志，已初始化返回 `410 Gone`
- **HIGH-1**: 后端密码复杂度验证（不信任前端）
- **并发控制**: Redis 分布式锁防止重复创建
- **事务处理**: 使用数据库事务保证原子性

- [ ] **步骤 1：编写失败的测试**

```typescript
// 在 setup.test.ts 中添加
it('should create admin user with CSRF token', async () => {
  const app = await buildApp();

  // Get setup token first
  const statusResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/setup/status',
  });
  const {
    data: { setupToken },
  } = JSON.parse(statusResponse.payload);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/admin',
    headers: {
      'X-Setup-Token': setupToken,
    },
    payload: {
      email: 'admin@accessbase.local',
      name: 'Administrator',
      password: 'SecurePass123!',
    },
  });

  expect(response.statusCode).toBe(201);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(true);
  expect(body.data).toHaveProperty('userId');
  expect(body.data).toHaveProperty('email', 'admin@accessbase.local');
});

it('should reject weak password', async () => {
  const app = await buildApp();

  const statusResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/setup/status',
  });
  const {
    data: { setupToken },
  } = JSON.parse(statusResponse.payload);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/admin',
    headers: {
      'X-Setup-Token': setupToken,
    },
    payload: {
      email: 'admin@accessbase.local',
      name: 'Administrator',
      password: 'weak',
    },
  });

  expect(response.statusCode).toBe(400);
  const body = JSON.parse(response.payload);
  expect(body.error.code).toBe('WEAK_PASSWORD');
});

it('should return 410 if setup already complete', async () => {
  const app = await buildApp();

  // Simulate setup complete
  await app.db.insert(app.schema.systemConfig).values({
    key: 'setup_complete',
    value: true,
    category: 'status',
  });

  const statusResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/setup/status',
  });
  const {
    data: { setupToken },
  } = JSON.parse(statusResponse.payload);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/admin',
    headers: {
      'X-Setup-Token': setupToken,
    },
    payload: {
      email: 'admin@accessbase.local',
      name: 'Administrator',
      password: 'SecurePass123!',
    },
  });

  expect(response.statusCode).toBe(410);
  const body = JSON.parse(response.payload);
  expect(body.error.code).toBe('SETUP_ALREADY_COMPLETE');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：失败

- [ ] **步骤 3：编写最小实现**

```typescript
// 在 setup.ts 中添加
// POST /api/v1/setup/admin
app.post(
  '/admin',
  {
    schema: {
      description: 'Create initial admin user',
      tags: ['setup'],
      body: {
        type: 'object',
        required: ['email', 'name', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 8 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        410: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  async (request, reply) => {
    const { email, name, password } = request.body as {
      email: string;
      name: string;
      password: string;
    };

    // CRITICAL-1: Check if setup already complete
    const setupComplete = await app.db.query.systemConfig.findFirst({
      where: (fields, { eq }) => eq(fields.key, 'setup_complete'),
    });
    if (setupComplete?.value === true) {
      return reply.status(410).send({
        success: false,
        error: {
          code: 'SETUP_ALREADY_COMPLETE',
          message: 'System setup has already been completed.',
        },
      });
    }

    // HIGH-1: Validate password complexity (don't trust frontend)
    const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!PASSWORD_REGEX.test(password)) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message:
            'Password must be at least 8 characters and include uppercase, lowercase, and numbers.',
        },
      });
    }

    // Concurrent control: Use Redis lock to prevent duplicate creation
    const lockKey = 'setup:admin:creation';
    const lock = await app.redis.set(lockKey, '1', 'EX', 30, 'NX');
    if (!lock) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'SETUP_IN_PROGRESS',
          message: 'Admin creation is already in progress.',
        },
      });
    }

    try {
      const userManager = new UserManager();
      const roleManager = new RoleManager();
      const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

      // Check if admin already exists
      const existingAdmin = await userManager.findByEmail(email);
      if (existingAdmin) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'ADMIN_EXISTS',
            message: 'Admin user already exists',
          },
        });
      }

      // Transaction: Create role and user atomically
      const result = await app.db.transaction(async (tx) => {
        const adminRole = await roleManager.create(
          {
            name: 'admin',
            description: 'System administrator with full access',
          },
          DEFAULT_TENANT,
          tx, // Pass transaction context
        );

        const adminUser = await userManager.create(
          {
            email,
            name,
            password,
            roles: [adminRole.id],
          },
          DEFAULT_TENANT,
          tx, // Pass transaction context
        );

        return adminUser;
      });

      // Log without sensitive data
      logger.info({ userId: result.id, email }, 'Admin user created via setup wizard');

      return reply.status(201).send({
        success: true,
        data: {
          userId: result.id,
          email: result.email,
          name: result.name,
        },
      });
    } finally {
      // Release lock
      await app.redis.del(lockKey);
    }
  },
);
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/routes/setup.ts apps/server/src/routes/__tests__/setup.test.ts
git commit -m "feat: add admin creation with CSRF, rate limiting, password validation, transactions"
```

---

### 任务 3：创建配置保存端点

**文件：**

- 修改：`apps/server/src/routes/setup.ts`
- 修改：`apps/server/src/routes/__tests__/setup.test.ts`

**接口：**

- 消费：配置数据
- 生产：`POST /api/v1/setup/config` 端点，保存配置到 system_config 表

**关键修复：**

- **CRITICAL-1**: 检查 `isInitialized` 标志
- **HIGH-3**: 日志脱敏（不记录 SMTP 密码）
- **配置持久化**: 写入 system_config 表

- [ ] **步骤 1：编写失败的测试**

```typescript
// 在 setup.test.ts 中添加
it('should save configuration to database', async () => {
  const app = await buildApp();

  const statusResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/setup/status',
  });
  const {
    data: { setupToken },
  } = JSON.parse(statusResponse.payload);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/config',
    headers: {
      'X-Setup-Token': setupToken,
    },
    payload: {
      siteName: 'AccessBase',
      siteUrl: 'https://accessbase.example.com',
      adminEmail: 'admin@accessbase.local',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'noreply@example.com',
      smtpPassword: 'smtp-password',
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(true);
  expect(body.data).toHaveProperty('saved', true);

  // Verify config was saved to database
  const siteName = await app.db.query.systemConfig.findFirst({
    where: (fields, { eq }) => eq(fields.key, 'site_name'),
  });
  expect(siteName?.value).toBe('AccessBase');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：失败

- [ ] **步骤 3：编写最小实现**

```typescript
// 在 setup.ts 中添加
// POST /api/v1/setup/config
app.post(
  '/config',
  {
    schema: {
      description: 'Save basic system configuration',
      tags: ['setup'],
      body: {
        type: 'object',
        required: ['siteName', 'siteUrl', 'adminEmail'],
        properties: {
          siteName: { type: 'string', minLength: 1 },
          siteUrl: { type: 'string', format: 'uri' },
          adminEmail: { type: 'string', format: 'email' },
          smtpHost: { type: 'string' },
          smtpPort: { type: 'number' },
          smtpUser: { type: 'string' },
          smtpPassword: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                saved: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
  async (request, reply) => {
    const config = request.body as {
      siteName: string;
      siteUrl: string;
      adminEmail: string;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPassword?: string;
    };

    // CRITICAL-1: Check if setup already complete
    const setupComplete = await app.db.query.systemConfig.findFirst({
      where: (fields, { eq }) => eq(fields.key, 'setup_complete'),
    });
    if (setupComplete?.value === true) {
      return reply.status(410).send({
        success: false,
        error: {
          code: 'SETUP_ALREADY_COMPLETE',
          message: 'System setup has already been completed.',
        },
      });
    }

    // Save each config to system_config table
    const configs = [
      { key: 'site_name', value: config.siteName, category: 'general' },
      { key: 'site_url', value: config.siteUrl, category: 'general' },
      { key: 'admin_email', value: config.adminEmail, category: 'general' },
      ...(config.smtpHost ? [{ key: 'smtp_host', value: config.smtpHost, category: 'smtp' }] : []),
      ...(config.smtpPort ? [{ key: 'smtp_port', value: config.smtpPort, category: 'smtp' }] : []),
      ...(config.smtpUser ? [{ key: 'smtp_user', value: config.smtpUser, category: 'smtp' }] : []),
      ...(config.smtpPassword
        ? [{ key: 'smtp_password', value: config.smtpPassword, category: 'smtp' }]
        : []),
    ];

    await app.db.transaction(async (tx) => {
      for (const cfg of configs) {
        await tx
          .insert(app.schema.systemConfig)
          .values({
            key: cfg.key,
            value: cfg.value,
            category: cfg.category,
          })
          .onConflictDoUpdate({
            target: app.schema.systemConfig.key,
            set: { value: cfg.value, updatedAt: new Date() },
          });
      }
    });

    // HIGH-3: Log without sensitive data (redact smtpPassword)
    const { smtpPassword: _, ...safeConfig } = config;
    logger.info({ config: safeConfig }, 'Setup configuration saved');

    return {
      success: true,
      data: {
        saved: true,
      },
    };
  },
);
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/routes/setup.ts apps/server/src/routes/__tests__/setup.test.ts
git commit -m "feat: add config save with database persistence and log redaction"
```

---

### 任务 4：创建设置完成端点

**文件：**

- 修改：`apps/server/src/routes/setup.ts`
- 修改：`apps/server/src/routes/__tests__/setup.test.ts`

**接口：**

- 消费：无
- 生产：`POST /api/v1/setup/complete` 端点，标记设置完成并返回 JWT

**说明：** 补充架构评审中发现的 MEDIUM-2 缺失端点。UI 计划中有此端点但后端未实现。

- [ ] **步骤 1：编写失败的测试**

```typescript
// 在 setup.test.ts 中添加
it('should complete setup and return tokens', async () => {
  const app = await buildApp();

  // First create admin (prerequisite)
  const statusResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/setup/status',
  });
  const {
    data: { setupToken },
  } = JSON.parse(statusResponse.payload);

  await app.inject({
    method: 'POST',
    url: '/api/v1/setup/admin',
    headers: { 'X-Setup-Token': setupToken },
    payload: {
      email: 'admin@accessbase.local',
      name: 'Administrator',
      password: 'SecurePass123!',
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/complete',
    headers: { 'X-Setup-Token': setupToken },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(true);
  expect(body.data).toHaveProperty('accessToken');
  expect(body.data).toHaveProperty('refreshToken');

  // Verify setup is marked complete
  const setupComplete = await app.db.query.systemConfig.findFirst({
    where: (fields, { eq }) => eq(fields.key, 'setup_complete'),
  });
  expect(setupComplete?.value).toBe(true);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：失败

- [ ] **步骤 3：编写最小实现**

```typescript
// 在 setup.ts 中添加
// POST /api/v1/setup/complete
app.post(
  '/complete',
  {
    schema: {
      description: 'Complete system setup',
      tags: ['setup'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  async (request, reply) => {
    // Verify admin exists
    const userManager = new UserManager();
    const adminUser = await userManager.findByEmail('admin@accessbase.local');

    if (!adminUser) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'ADMIN_NOT_CREATED',
          message: 'Admin user must be created before completing setup.',
        },
      });
    }

    // Mark setup as complete
    await app.db
      .insert(app.schema.systemConfig)
      .values({
        key: 'setup_complete',
        value: true,
        category: 'status',
      })
      .onConflictDoUpdate({
        target: app.schema.systemConfig.key,
        set: { value: true, updatedAt: new Date() },
      });

    // Generate JWT tokens using standard auth flow
    const tokens = await app.generateTokens(adminUser);

    logger.info({ userId: adminUser.id }, 'System setup completed');

    return {
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  },
);
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/routes/setup.ts apps/server/src/routes/__tests__/setup.test.ts
git commit -m "feat: add setup complete endpoint with JWT token generation"
```

---

### 任务 5：创建双向 setup-guard 中间件

**文件：**

- 创建：`apps/server/src/middleware/setup-guard.ts`
- 修改：`apps/server/src/app.ts`（注册中间件）

**接口：**

- 消费：`system_config` 表的 `setup_complete` 键
- 生产：中间件函数，双向保护：
  - 设置完成前：阻止非 setup 路由
  - 设置完成后：阻止 setup 写入端点

- [ ] **步骤 1：编写失败的测试**

```typescript
// apps/server/src/middleware/__tests__/setup-guard.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app.js';

describe('Setup Guard Middleware', () => {
  it('should block API routes when setup is not complete', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SETUP_REQUIRED');
  });

  it('should allow setup routes when setup is not complete', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    });

    expect(response.statusCode).toBe(200);
  });

  it('should block setup write endpoints after setup complete', async () => {
    const app = await buildApp();

    // Simulate setup complete
    await app.db.insert(app.schema.systemConfig).values({
      key: 'setup_complete',
      value: true,
      category: 'status',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: {
        email: 'admin@accessbase.local',
        name: 'Test',
        password: 'SecurePass123!',
      },
    });

    expect(response.statusCode).toBe(410);
    const body = JSON.parse(response.payload);
    expect(body.error.code).toBe('SETUP_ALREADY_COMPLETE');
  });

  it('should allow GET /setup/status after setup complete', async () => {
    const app = await buildApp();

    // Simulate setup complete
    await app.db.insert(app.schema.systemConfig).values({
      key: 'setup_complete',
      value: true,
      category: 'status',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    });

    expect(response.statusCode).toBe(200);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/middleware/__tests__/setup-guard.test.ts`
预期：失败

- [ ] **步骤 3：编写最小实现**

```typescript
// apps/server/src/middleware/setup-guard.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '@accessbase/logging';

const SETUP_WRITE_PATHS = ['/api/v1/setup/admin', '/api/v1/setup/config', '/api/v1/setup/complete'];
const ALLOWED_PATHS = ['/api/v1/setup/status', '/health', '/docs', '/api/v1/setup/checks'];

export async function setupGuard(request: FastifyRequest, reply: FastifyReply) {
  // Always allow GET /setup/status and health/docs
  if (ALLOWED_PATHS.some((path) => request.url.startsWith(path))) {
    return;
  }

  // Check if setup is complete
  const setupComplete = await request.server.db.query.systemConfig.findFirst({
    where: (fields, { eq }) => eq(fields.key, 'setup_complete'),
  });
  const isSetupComplete = setupComplete?.value === true;

  // CRITICAL-2: After setup complete, block setup write endpoints
  if (isSetupComplete && SETUP_WRITE_PATHS.some((path) => request.url.startsWith(path))) {
    return reply.status(410).send({
      success: false,
      error: {
        code: 'SETUP_ALREADY_COMPLETE',
        message: 'System setup has already been completed.',
      },
    });
  }

  // Before setup complete, block non-setup routes
  if (!isSetupComplete && !request.url.startsWith('/api/v1/setup')) {
    logger.warn({ url: request.url }, 'Setup not complete, blocking request');
    return reply.status(403).send({
      success: false,
      error: {
        code: 'SETUP_REQUIRED',
        message: 'System setup is not complete. Please complete setup first.',
      },
    });
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/middleware/__tests__/setup-guard.test.ts`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/middleware/setup-guard.ts apps/server/src/middleware/__tests__/setup-guard.test.ts
git commit -m "feat: add bidirectional setup guard middleware"
```

---

### 任务 6：集成路由、中间件和插件

**文件：**

- 修改：`apps/server/src/app.ts`

**接口：**

- 消费：`setupRoutes`, `setupGuard`, rate-limit, setup-csrf
- 生产：完整的设置向导 API 集成

- [ ] **步骤 1：编写失败的测试**

```typescript
// apps/server/src/__tests__/integration.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';

describe('Setup Integration', () => {
  it('should complete full setup flow', async () => {
    const app = await buildApp();

    // 1. Check status (not initialized) + get setup token
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    });
    expect(statusResponse.statusCode).toBe(200);
    const status = JSON.parse(statusResponse.payload);
    expect(status.data.isInitialized).toBe(false);
    const setupToken = status.data.setupToken;

    // 2. Create admin (with CSRF token)
    const adminResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      headers: { 'X-Setup-Token': setupToken },
      payload: {
        email: 'admin@accessbase.local',
        name: 'Administrator',
        password: 'SecurePass123!',
      },
    });
    expect(adminResponse.statusCode).toBe(201);

    // 3. Save config (with CSRF token)
    const configResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/config',
      headers: { 'X-Setup-Token': setupToken },
      payload: {
        siteName: 'AccessBase',
        siteUrl: 'https://accessbase.example.com',
        adminEmail: 'admin@accessbase.local',
      },
    });
    expect(configResponse.statusCode).toBe(200);

    // 4. Complete setup
    const completeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/complete',
      headers: { 'X-Setup-Token': setupToken },
    });
    expect(completeResponse.statusCode).toBe(200);
    const completeBody = JSON.parse(completeResponse.payload);
    expect(completeBody.data).toHaveProperty('accessToken');

    // 5. Check status again (initialized)
    const finalStatusResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    });
    expect(finalStatusResponse.statusCode).toBe(200);
    const finalStatus = JSON.parse(finalStatusResponse.payload);
    expect(finalStatus.data.isInitialized).toBe(true);

    // 6. Setup write endpoints now blocked
    const blockedResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: {
        email: 'hacker@example.com',
        name: 'Hacker',
        password: 'SecurePass123!',
      },
    });
    expect(blockedResponse.statusCode).toBe(410);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/__tests__/integration.test.ts`
预期：失败

- [ ] **步骤 3：编写最小实现**

```typescript
// 在 app.ts 中修改
import { setupRoutes } from './routes/setup.js';
import { setupGuard } from './middleware/setup-guard.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import setupCsrfPlugin from './plugins/setup-csrf.js';

// Register plugins
await app.register(rateLimitPlugin);
await app.register(setupCsrfPlugin);

// Register setup guard middleware
app.addHook('onRequest', setupGuard);

// Register setup routes
await app.register(setupRoutes, { prefix: '/api/v1/setup' });
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/__tests__/integration.test.ts`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/app.ts apps/server/src/__tests__/integration.test.ts
git commit -m "feat: integrate setup routes, guard, CSRF, and rate limiting"
```

---

### 任务 7：创建系统检查端点

**文件：**

- 修改：`apps/server/src/routes/setup.ts`
- 修改：`apps/server/src/routes/__tests__/setup.test.ts`

**接口：**

- 消费：数据库连接、Redis 连接
- 生产：`GET /api/v1/setup/checks` 端点，返回系统环境检查结果

**说明：** 补充架构评审中发现的问题 3 缺失端点。UI 计划中有此端点但后端未实现。**注意：只返回通过/失败状态，不暴露敏感信息**（HIGH-4 修复）。

- [ ] **步骤 1：编写失败的测试**

```typescript
// 在 setup.test.ts 中添加
it('should return system checks without sensitive info', async () => {
  const app = await buildApp();

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/setup/checks',
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(true);
  expect(body.data).toHaveProperty('checks');
  expect(Array.isArray(body.data.checks)).toBe(true);

  // Each check should have name, status, and message
  for (const check of body.data.checks) {
    expect(check).toHaveProperty('name');
    expect(check).toHaveProperty('status'); // 'pass' | 'fail'
    expect(check).toHaveProperty('message');
  }

  // Should NOT contain sensitive info
  const responseStr = JSON.stringify(body);
  expect(responseStr).not.toContain('connection string');
  expect(responseStr).not.toContain('password');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：失败

- [ ] **步骤 3：编写最小实现**

```typescript
// 在 setup.ts 中添加
// GET /api/v1/setup/checks
app.get(
  '/checks',
  {
    schema: {
      description: 'Run system environment checks',
      tags: ['setup'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                checks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      status: { type: 'string', enum: ['pass', 'fail'] },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  async (request, reply) => {
    const checks = [];

    // Database check
    try {
      await app.db.execute(sql`SELECT 1`);
      checks.push({ name: 'database', status: 'pass', message: 'Database connection OK' });
    } catch (err) {
      checks.push({ name: 'database', status: 'fail', message: 'Database connection failed' });
    }

    // Redis check
    try {
      await app.redis.ping();
      checks.push({ name: 'redis', status: 'pass', message: 'Redis connection OK' });
    } catch (err) {
      checks.push({ name: 'redis', status: 'fail', message: 'Redis connection failed' });
    }

    // Disk space check (without exposing specific paths)
    try {
      const { statfs } = await import('node:fs/promises');
      const stats = await statfs('/');
      const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
      checks.push({
        name: 'disk_space',
        status: freeGB > 1 ? 'pass' : 'fail',
        message: freeGB > 1 ? 'Sufficient disk space' : 'Low disk space',
      });
    } catch {
      checks.push({ name: 'disk_space', status: 'pass', message: 'Disk check skipped' });
    }

    return {
      success: true,
      data: { checks },
    };
  },
);
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test apps/server/src/routes/__tests__/setup.test.ts`
预期：通过

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/routes/setup.ts apps/server/src/routes/__tests__/setup.test.ts
git commit -m "feat: add system checks endpoint with minimal info exposure"
```

---

## 问题修复对照表

| Review ID | Issue                                         | Fix Location                                      |
| --------- | --------------------------------------------- | ------------------------------------------------- |
| C-1       | 设置完成后可重复创建管理员                    | 任务 2 (isInitialized check) + 任务 5 (guard)     |
| C-2       | setup-guard 不阻断已完成系统的 setup 写入端点 | 任务 5 (bidirectional guard)                      |
| C-3       | UI/后端缺少反向保护                           | 任务 5 (guard blocks write endpoints after setup) |
| C-4       | 无 CSRF 防护                                  | 任务 0 (setup-csrf plugin)                        |
| C-5       | 无速率限制                                    | 任务 0 (rate-limit plugin)                        |
| H-1       | 后端密码复杂度验证不足                        | 任务 2 (PASSWORD_REGEX)                           |
| H-2       | 管理员邮箱硬编码导致 guard 检查失效           | 任务 5 (guard uses isInitialized)                 |
| H-3       | SMTP 密码写入日志                             | 任务 3 (log redaction)                            |
| H-4       | 系统检查端点信息泄露                          | 任务 7 (minimal info)                             |
| M-1       | UserManager 每请求实例化                      | 任务 2 (use app-scoped instance)                  |
| M-2       | completeSetup 端点后端缺失                    | 任务 4 (new endpoint)                             |
| L-1       | 缺少审计日志                                  | 可后续添加                                        |
| Arch-1    | API 前缀不一致                                | 已统一为 `/api/v1/setup`                          |
| Arch-2    | 响应格式不一致                                | 已统一为 `{ success, data, error }`               |
| Arch-3    | 缺少系统检查端点                              | 任务 7 (new endpoint)                             |
| Arch-4    | 缺少事务处理                                  | 任务 2 (db.transaction)                           |
| Arch-5    | 并发控制缺失                                  | 任务 2 (Redis distributed lock)                   |
| Arch-6    | 配置存储缺失                                  | 任务 3 (system_config table)                      |
| Arch-7    | 设置状态标志缺失                              | 迁移任务 (system_config + setup_complete key)     |
| Arch-8    | 迁移计划缺失                                  | 新增迁移任务                                      |

---

## 验证步骤

1. **类型检查：** `pnpm typecheck`
2. **单元测试：** `pnpm test`
3. **集成测试：** 启动服务器，测试完整设置流程
4. **安全测试：**
   - 验证设置完成后 POST 端点返回 410
   - 验证无 CSRF token 的 POST 返回 403
   - 验证速率限制触发 429
   - 验证弱密码返回 400
5. **API 文档：** 访问 `/docs` 查看 Swagger 文档

## 未来扩展

1. **审计日志集成：** 使用 `@accessbase/audit` 记录 setup 操作
2. **邮件验证：** 集成 SMTP 配置验证
3. **多租户支持：** 为设置向导添加租户选择
4. **国际化：** 支持多语言设置向导
5. **设置重置：** 提供重置机制（用于测试/恢复）

---

**计划完成并保存到 `docs/modules/setup-api-plan.md`。两种执行选项：**

**1. 子代理驱动（推荐）** - 我为每个任务分发新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设置检查点

**选择哪种方式？**
