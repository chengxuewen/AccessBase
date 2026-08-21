# @accessbase/audit — 审计日志包 SDD

> 本文档为 `@accessbase/audit` 包的软件设计文档（SDD）。

---

## 1. 包概述

### 1.1 职责

`@accessbase/audit` 负责记录系统中所有安全敏感操作的审计日志，确保操作可追溯、合规可审计。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| **完整性** | 审计日志不可篡改，支持哈希链验证 |
| **隔离性** | 审计数据与业务数据隔离存储 |
| **性能** | 异步写入，不阻塞业务请求 |
| **合规** | 满足等保/GDPR 等合规要求 |

### 1.3 审计范围

| 操作类型 | 示例 | 审计级别 |
|---------|------|---------|
| 认证事件 | 登录/登出/登录失败 | 必须审计 |
| 授权事件 | 权限变更/角色变更 | 必须审计 |
| 数据写操作 | POST/PUT/PATCH/DELETE | 必须审计 |
| 配置变更 | 系统配置/集成配置 | 必须审计 |
| 读操作 | GET 请求 | 可选（敏感数据查询） |

---

## 2. 核心接口

### 2.1 AuditLog 记录结构

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

  // 完整性
  hash: string          // SHA-256 哈希（含前一条哈希）
  previousHash: string  // 前一条日志哈希
}
```

### 2.2 AuditService 接口

```typescript
interface AuditService {
  // 记录审计日志
  log(entry: Omit<AuditLog, 'hash' | 'previousHash'>): Promise<void>

  // 批量记录（高性能场景）
  logBatch(entries: Array<Omit<AuditLog, 'hash' | 'previousHash'>>): Promise<void>

  // 查询审计日志
  query(filter: AuditLogFilter): Promise<AuditLogQueryResult>

  // 验证哈希链完整性
  verifyIntegrity(startTime: Date, endTime: Date): Promise<IntegrityResult>

  // 导出审计日志
  export(filter: AuditLogFilter, format: 'csv' | 'excel'): Promise<Buffer>
}
```

### 2.3 AuditLogFilter 查询过滤器

```typescript
interface AuditLogFilter {
  userId?: string
  username?: string
  action?: AuditAction | AuditAction[]
  resourceType?: string
  resourceId?: string
  tenantId?: string
  requestId?: string
  success?: boolean
  startTime?: Date
  endTime?: Date
  page?: number
  pageSize?: number
  sortBy?: 'timestamp' | 'action' | 'resourceType'
  sortOrder?: 'asc' | 'desc'
}
```

### 2.4 AuditLogIntegrity 完整性验证

```typescript
class AuditLogIntegrity {
  private previousHash: string = 'GENESIS'

  // 计算日志条目哈希（含前一条哈希，形成链）
  computeHash(entry: AuditLogEntry): string

  // 验证哈希链完整性
  async verifyChain(logs: AuditLogEntry[]): Promise<boolean>
}
```

---

## 3. 生命周期钩子

### 3.1 Fastify onResponse Hook

```typescript
// 审计日志中间件 — 自动记录写操作
fastify.addHook('onResponse', (request, reply, done) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    auditService.log({
      userId: request.user?.id,
      username: request.user?.username,
      userIp: request.ip,
      userAgent: request.headers['user-agent'],
      action: mapMethodToAction(request.method),
      resourceType: extractResourceType(request.url),
      resourceId: request.params.id,
      requestBody: sanitize(request.body),
      responseBody: sanitize(reply.raw),
      timestamp: new Date(),
      tenantId: request.user?.tenantId,
      requestId: request.id,
      success: reply.statusCode < 400,
      errorMessage: reply.statusCode >= 400 ? reply.raw?.error : undefined
    })
  }
  done()
})
```

### 3.2 认证事件钩子

```typescript
// 登录/登出事件审计
function auditAuthEvent(
  event: 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED',
  request: FastifyRequest,
  user?: User
): void {
  auditService.log({
    userId: user?.id || 'anonymous',
    username: user?.username || request.body?.email,
    userIp: request.ip,
    userAgent: request.headers['user-agent'],
    action: event,
    resourceType: 'auth',
    resourceId: user?.id || 'unknown',
    requestBody: sanitize({ email: request.body?.email }),
    timestamp: new Date(),
    tenantId: user?.tenantId,
    requestId: request.id,
    success: event !== 'LOGIN_FAILED'
  })
}
```

### 3.3 配置变更钩子

```typescript
// 配置变更审计
function auditConfigChange(
  request: FastifyRequest,
  configKey: string,
  oldValue: unknown,
  newValue: unknown
): void {
  auditService.log({
    userId: request.user?.id,
    username: request.user?.username,
    userIp: request.ip,
    userAgent: request.headers['user-agent'],
    action: 'UPDATE',
    resourceType: 'config',
    resourceId: configKey,
    requestBody: { key: configKey, oldValue, newValue },
    timestamp: new Date(),
    tenantId: request.user?.tenantId,
    requestId: request.id,
    success: true
  })
}
```

---

## 4. 依赖关系

### 4.1 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@accessbase/shared-types` | workspace | 共享类型定义 |
| `@accessbase/logging` | workspace | 日志记录 |
| `drizzle-orm` | ^0.29.0 | 数据库 ORM |
| `pino` | ^8.0.0 | 结构化日志 |

### 4.2 内部依赖

| 模块 | 依赖说明 |
|------|---------|
| `@accessbase/identity` | 提供用户信息、租户信息 |
| `@accessbase/admin` | 提供请求上下文、配置管理 |

### 4.3 数据库依赖

| 表名 | 说明 |
|------|------|
| `audit_logs` | 审计日志主表 |
| `audit_logs_archive` | 归档表（历史数据） |

### 4.4 Redis 依赖

| Key 模式 | 说明 |
|----------|------|
| `audit:buffer:*` | 异步写入缓冲区（批量写入优化） |

---

## 5. 错误码

### 5.1 错误码定义

| 错误码 | HTTP 状态码 | 说明 | 处理建议 |
|--------|------------|------|---------|
| `AUDIT_001` | 500 | 审计日志写入失败 | 检查数据库连接，触发告警 |
| `AUDIT_002` | 500 | 审计日志哈希计算失败 | 检查加密模块，触发告警 |
| `AUDIT_003` | 400 | 审计日志查询参数无效 | 检查请求参数 |
| `AUDIT_004` | 500 | 审计日志导出失败 | 检查磁盘空间，触发告警 |
| `AUDIT_005` | 500 | 审计日志完整性验证失败 | **安全事件**，立即触发 P0 告警 |
| `AUDIT_006` | 500 | 审计缓冲区溢出 | 检查 Redis 连接，触发告警 |

### 5.2 错误处理策略

```typescript
// 审计日志写入失败 — 降级到文件日志
async function writeAuditLogWithFallback(entry: AuditLog): Promise<void> {
  try {
    await auditService.log(entry)
  } catch (error) {
    // 降级：写入本地文件日志
    logger.error({ err: error, auditEntry: entry }, 'Audit log write failed, falling back to file')
    await writeAuditLogToFile(entry)

    // 触发告警（非阻塞）
    alerting.send({
      level: 'P1',
      title: '审计日志写入失败',
      description: `审计日志写入数据库失败，已降级到文件日志。错误: ${error.message}`
    })
  }
}
```

---

## 6. 配置项

### 6.1 配置结构

```typescript
interface AuditConfig {
  // 启用/禁用
  enabled: boolean

  // 审计级别
  level: 'all' | 'write' | 'auth' | 'config'

  // 存储配置
  storage: {
    // 数据库表名
    tableName: string

    // 归档配置
    archive: {
      enabled: boolean
      retentionDays: number      // 保留天数，默认 365
      archiveAfterDays: number   // 多少天后归档，默认 90
    }

    // 索引配置
    indexes: string[]            // ['timestamp', 'userId', 'resourceType', 'tenantId']
  }

  // 异步写入配置
  async: {
    enabled: boolean
    bufferSize: number           // 缓冲区大小，默认 1000
    flushInterval: number        // 刷新间隔（ms），默认 5000
  }

  // 脱敏配置
  sanitize: {
    enabled: boolean
    fields: string[]             // 需要脱敏的字段名
    replacement: string          // 脱敏替换符，默认 '[REDACTED]'
  }

  // 完整性保护
  integrity: {
    enabled: boolean
    verifyInterval: number       // 定期验证间隔（小时），默认 24
    alertOnFailure: boolean      // 验证失败是否告警，默认 true
  }

  // 导出配置
  export: {
    maxRows: number              // 单次导出最大行数，默认 10000
    formats: ('csv' | 'excel')[] // 支持的导出格式
  }
}
```

### 6.2 默认配置

```typescript
const defaultAuditConfig: AuditConfig = {
  enabled: true,
  level: 'write',
  storage: {
    tableName: 'audit_logs',
    archive: {
      enabled: true,
      retentionDays: 365,
      archiveAfterDays: 90
    },
    indexes: ['timestamp', 'userId', 'resourceType', 'tenantId']
  },
  async: {
    enabled: true,
    bufferSize: 1000,
    flushInterval: 5000
  },
  sanitize: {
    enabled: true,
    fields: ['password', 'token', 'secret', 'api_key', 'credit_card'],
    replacement: '[REDACTED]'
  },
  integrity: {
    enabled: true,
    verifyInterval: 24,
    alertOnFailure: true
  },
  export: {
    maxRows: 10000,
    formats: ['csv', 'excel']
  }
}
```

### 6.3 环境变量

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `AUDIT_ENABLED` | 启用审计日志 | `true` |
| `AUDIT_LEVEL` | 审计级别 | `write` |
| `AUDIT_BUFFER_SIZE` | 异步缓冲区大小 | `1000` |
| `AUDIT_FLUSH_INTERVAL` | 刷新间隔（ms） | `5000` |
| `AUDIT_RETENTION_DAYS` | 保留天数 | `365` |
| `AUDIT_ARCHIVE_AFTER_DAYS` | 归档天数 | `90` |
| `AUDIT_VERIFY_INTERVAL` | 完整性验证间隔（小时） | `24` |
