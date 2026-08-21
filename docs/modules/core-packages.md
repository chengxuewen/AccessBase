# 核心包详细设计

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§10 核心包详细设计

---

## 10. 核心包详细设计

### 10.1 `@accessbase/identity` — 认证授权

#### JWT 策略

| 参数 | 值 | 说明 |
|------|-----|------|
| Access Token 有效期 | 15 分钟 | 短生命周期，安全性高 |
| Refresh Token 有效期 | 7 天 | 可配置，平衡安全与体验 |
| Token 轮转 | 启用 | 每次刷新时轮转，防止重放攻击 |
| Token 存储 | Redis + 数据库 | Redis 快速验证 + 数据库 token_version |

#### RBAC 模型

**选择：RBAC1（角色继承）**

```typescript
// 角色继承示例
const roles = {
  user: ['profile:read', 'profile:write'],
  admin: ['inherits user', 'users:read', 'users:write', 'roles:manage'],
  superadmin: ['inherits admin', 'system:config']
}
```

**租户隔离**：
- `tenant_roles`：租户级角色
- `tenant_permissions`：租户级权限
- `user_tenant_roles`：用户在租户下的角色

#### LDAP SSO

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 集成模式 | Admin Bind | 服务账号查询用户，再验证密码 |
| 自动供给 | 启用 | 首次登录自动创建本地用户 |
| 属性同步 | 启用 | 每次登录同步 LDAP 属性 |
| 加密方案 | AES-256-GCM | 企业级安全标准 |
| 故障降级 | 可配置 | LDAP 失败时尝试本地密码 |

**属性映射配置**：
```yaml
ldap:
  attribute_mapping:
    uid: userId
    mail: email
    cn: displayName
    department: department
    sAMAccountName: username  # AD 特有
```

### 10.2 `@accessbase/admin` — 后台框架

#### 扩展机制

**设计原则**：L0 提供配置点+扩展接口，不引入插件机制

**配置点示例**：
```typescript
// 自定义登录页组件
<AccessBaseAdmin
  loginComponent={CustomLoginPage}
  brandTokens={{
    primaryColor: '#1890ff',
    logo: '/logo.svg',
    brandName: 'Weave'
  }}
/>
```

**扩展接口示例**：
```typescript
// beforeLogin 钩子
beforeLogin: async (credentials) => {
  // 自定义验证逻辑
  await customValidation(credentials)
}
```

#### 主题机制

**BrandTokens 接口**：
```typescript
interface BrandTokens {
  // 品牌色
  primaryColor: string
  secondaryColor: string
  
  // Logo
  logo: string | ReactNode
  logoCollapsed: string | ReactNode
  
  // 品牌语
  brandName: string
  brandTagline?: string
  
  // 字体
  fontFamily?: string
}
```

**主题继承**：
```
L2 应用层    品牌定制（Logo、品牌语、业务主题）
               ↑ 继承/覆盖
L1 平台层    平台品牌令牌（品牌色、品牌字体）
               ↑ 继承/覆盖
L0 基石层    默认中性主题 + BrandTokens 注入接口
```

#### 配置管理

**方案**：环境变量 + 数据库

| 配置类型 | 存储位置 | 示例 |
|---------|---------|------|
| 基础设施 | 环境变量 | 数据库连接、Redis URL |
| 业务配置 | 数据库 + UI | LDAP 设置、邮件配置 |
| 功能开关 | 数据库 + UI | 启用/禁用模块 |
| 主题配置 | 数据库 + UI | 品牌色、Logo |

### 10.3 `@accessbase/audit` — 审计日志

#### 审计范围

| 操作类型 | 示例 | 审计级别 |
|---------|------|---------|
| 认证事件 | 登录/登出/登录失败 | 必须审计 |
| 授权事件 | 权限变更/角色变更 | 必须审计 |
| 数据写操作 | POST/PUT/PATCH/DELETE | 必须审计 |
| 配置变更 | 系统配置/集成配置 | 必须审计 |
| 读操作 | GET 请求 | 可选（敏感数据查询） |

#### 审计记录结构

```typescript
interface AuditLog {
  // 操作者
  userId: string
  username: string
  userIp: string
  userAgent: string
  
  // 操作信息
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT'
  resourceType: string  // 'user', 'role', 'config'
  resourceId: string    // 具体资源 ID
  
  // 操作详情
  requestBody: object   // 请求参数（敏感字段脱敏）
  responseBody: object  // 响应摘要（可选）
  
  // 上下文
  timestamp: Date
  tenantId: string      // 租户 ID
  requestId: string     // 请求追踪 ID
  
  // 结果
  success: boolean
  errorMessage?: string // 失败时的错误信息
}
```

#### 审计钩子

```typescript
// Fastify onResponse hook
fastify.addHook('onResponse', (request, reply, done) => {
  // 只审计写操作
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    auditService.log({
      userId: request.user?.id,
      action: mapMethodToAction(request.method),
      resourceType: extractResourceType(request.url),
      resourceId: request.params.id,
      requestBody: sanitize(request.body),
      // ...
    })
  }
  done()
})
```

#### 审计存储

**方案**：独立审计表

- 与业务数据隔离，防止误删
- 索引优化：`timestamp`, `userId`, `resourceType`
- 支持按时间范围、用户、操作类型查询
- 导出功能（CSV/Excel）

### 10.4 `@accessbase/logging` — 结构化日志

#### 日志框架

**选择：pino**

| 特性 | 说明 |
|------|------|
| 性能 | 比 winston 快 3-4 倍 |
| 结构化 | 原生 JSON 输出 |
| Fastify 集成 | 内置支持，零配置 |
| 日志脱敏 | 内置 `redact` 选项 |
| npm 周下载 | ~35M |

#### 日志级别

```typescript
type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

// 级别说明
fatal: 系统崩溃、不可恢复错误
error: 可恢复错误、业务异常
warn: 警告信息、潜在问题
info: 业务流程、关键操作
debug: 调试信息、开发阶段
trace: 详细追踪、性能分析
```

#### X-Request-ID 追踪

```typescript
// Fastify onRequest hook
fastify.addHook('onRequest', (request, reply, done) => {
  request.id = request.headers['x-request-id'] || generateRequestId()
  reply.header('x-request-id', request.id)
  done()
})

// 日志自动携带 requestId
logger.info({
  requestId: request.id,
  msg: 'Request completed',
  statusCode: reply.statusCode,
  duration: reply.elapsedTime
})
```

#### 日志配置

```typescript
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // 开发环境：pino-pretty 格式化
    ...(process.env.NODE_ENV !== 'production' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' }
      }
    }),
    // 生产环境：脱敏配置
    redact: ['req.headers.authorization', 'req.headers.cookie']
  }
})
```

### 10.5 `@accessbase/i18n` — 国际化

#### i18n 框架

**选择：i18next + react-i18next**

| 特性 | 说明 |
|------|------|
| 生态 | 最流行、插件丰富 |
| React 集成 | `useTranslation` Hook |
| 命名空间 | 原生支持模块化翻译 |
| 动态加载 | 支持按需加载语言包 |
| TypeScript | 类型安全的翻译键 |

#### 双命名空间设计

```typescript
// 包名命名空间：L0 内部翻译
{
  "identity": {
    "login": "登录",
    "logout": "登出",
    "username": "用户名"
  },
  "admin": {
    "menu": "菜单",
    "settings": "设置"
  }
}

// client 命名空间：复用方翻译
{
  "client": {
    "welcome": "欢迎",
    "custom_field": "自定义字段"
  }
}

// 翻译键使用
t('identity:login')  // 包名:键名
t('client:welcome')  // client:键名
```

**优先级**：client > 包名（复用方可覆盖 L0 翻译）

#### 语言检测

```typescript
// 检测顺序
1. URL 路径（/zh/..., /en/...）
2. Cookie（用户偏好）
3. Accept-Language header
4. 默认语言（zh-CN）
```

### 10.6 `@accessbase/migration` — 数据库迁移

#### 迁移框架

**选择：Drizzle ORM**

| 特性 | 说明 |
|------|------|
| TypeScript 原生 | 类型安全的 Schema 定义 |
| 轻量级 | 依赖最小化 |
| SQL-like | 接近 SQL 的语法，易于理解 |
| 性能 | 比 Prisma/TypeORM 更快 |

#### 三阶段迁移

```typescript
// 迁移文件结构
migrations/
  001_create_users.ts        // 默认阶段（postsync）
  002_seed_admin_user.ts     // preload 阶段
  003_add_user_avatar.ts     // postload 阶段

// 迁移文件内容
export const phase = 'preload'  // 或 'postsync', 'postload'

export async function up(db: Database) {
  // 迁移逻辑
}

export async function down(db: Database) {
  // 回滚逻辑
}
```

**阶段说明**：
- **preload**：数据库初始化前执行（如创建扩展、设置参数）
- **postsync**：Schema 同步后执行（默认阶段，大多数迁移）
- **postload**：数据加载后执行（如种子数据、索引优化）

#### CLI 命令

```bash
# 执行迁移
npx accessbase-migrate up

# 回滚迁移
npx accessbase-migrate down

# 查看迁移状态
npx accessbase-migrate status

# 生成迁移文件
npx accessbase-migrate generate create_users

# 回滚到指定版本
npx accessbase-migrate down --to 001
```

#### 迁移安全

| 安全措施 | 说明 |
|---------|------|
| 回滚机制 | 每个迁移必须实现 `down` 函数 |
| 备份策略 | 执行迁移前自动备份 |
| 并发控制 | 迁移锁，防止并发执行 |

---
