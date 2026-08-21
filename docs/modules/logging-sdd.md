# @accessbase/logging — 结构化日志包 SDD

> 本文档为 `@accessbase/logging` 包的软件设计文档（SDD）。

---

## 1. 包概述

### 1.1 职责

`@accessbase/logging` 负责提供高性能、结构化的日志记录服务，支持日志脱敏、请求追踪、日志聚合和告警。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| **高性能** | 基于 pino，比 winston 快 3-4 倍 |
| **结构化** | 原生 JSON 输出，便于日志聚合 |
| **安全性** | 内置日志脱敏，防止敏感信息泄露 |
| **可观测** | 支持 X-Request-ID 追踪，链路关联 |

### 1.3 技术选型

| 特性 | 说明 |
|------|------|
| **框架** | pino |
| **性能** | 比 winston 快 3-4 倍 |
| **结构化** | 原生 JSON 输出 |
| **Fastify 集成** | 内置支持，零配置 |
| **日志脱敏** | 内置 `redact` 选项 |
| **npm 周下载** | ~35M |

---

## 2. 核心接口

### 2.1 日志级别

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

### 2.2 Logger 接口

```typescript
interface Logger {
  // 基础日志方法
  fatal(msg: string, ...args: unknown[]): void
  fatal(obj: object, msg?: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  error(obj: object, msg?: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  warn(obj: object, msg?: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  info(obj: object, msg?: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
  debug(obj: object, msg?: string, ...args: unknown[]): void
  trace(msg: string, ...args: unknown[]): void
  trace(obj: object, msg?: string, ...args: unknown[]): void

  // 子日志器（绑定上下文）
  child(bindings: Record<string, unknown>): Logger

  // 设置日志级别
  level: LogLevel
}
```

### 2.3 RequestContext 请求上下文

```typescript
interface RequestContext {
  requestId: string     // X-Request-ID
  tenantId?: string     // 租户 ID
  userId?: string       // 用户 ID
  method?: string       // HTTP 方法
  url?: string          // 请求 URL
  userAgent?: string    // User-Agent
  ip?: string           // 客户端 IP
  startTime?: number    // 请求开始时间（用于计算耗时）
}
```

### 2.4 LogEntry 日志条目

```typescript
interface LogEntry {
  // 时间
  timestamp: string       // ISO 8601

  // 级别
  level: number           // pino 级别数字
  levelName: string       // 级别名称

  // 消息
  msg?: string            // 日志消息

  // 请求上下文
  requestId?: string
  tenantId?: string
  userId?: string

  // HTTP 信息
  req?: {
    method: string
    url: string
    headers: Record<string, string>  // 脱敏后
    query?: Record<string, string>
    params?: Record<string, string>
  }

  // 响应信息
  res?: {
    statusCode: number
    headers?: Record<string, string>
  }

  // 性能
  responseTime?: number   // 响应耗时（ms）

  // 错误信息
  err?: {
    type: string
    message: string
    stack?: string
    code?: string
  }

  // 附加数据
  [key: string]: unknown
}
```

### 2.5 LoggerFactory 日志工厂

```typescript
interface LoggerFactory {
  // 创建日志器实例
  createLogger(options?: LoggerOptions): Logger

  // 创建请求绑定的日志器
  createRequestLogger(context: RequestContext): Logger

  // 获取全局日志器
  getLogger(): Logger
}
```

---

## 3. 生命周期钩子

### 3.1 Fastify onRequest Hook

```typescript
// 请求开始 — 注入请求 ID
fastify.addHook('onRequest', (request, reply, done) => {
  // 生成或提取请求 ID
  request.id = request.headers['x-request-id'] || generateRequestId()

  // 设置响应头
  reply.header('x-request-id', request.id)

  // 创建请求绑定的日志器
  request.log = logger.child({
    requestId: request.id,
    tenantId: request.user?.tenantId,
    userId: request.user?.id
  })

  // 记录请求开始
  request.startTime = Date.now()
  request.log.info({
    req: {
      method: request.method,
      url: request.url,
      headers: sanitizeHeaders(request.headers),
      query: request.query,
      params: request.params
    }
  }, 'Request started')

  done()
})
```

### 3.2 Fastify onResponse Hook

```typescript
// 请求完成 — 记录响应信息
fastify.addHook('onResponse', (request, reply, done) => {
  const responseTime = Date.now() - request.startTime

  request.log.info({
    res: {
      statusCode: reply.statusCode,
      headers: sanitizeHeaders(reply.getHeaders())
    },
    responseTime
  }, 'Request completed')

  // 慢请求告警
  if (responseTime > 1000) {
    request.log.warn({
      responseTime,
      threshold: 1000
    }, 'Slow request detected')
  }

  done()
})
```

### 3.3 Fastify onError Hook

```typescript
// 请求错误 — 记录错误信息
fastify.addHook('onError', (request, reply, error, done) => {
  request.log.error({
    err: {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    statusCode: reply.statusCode
  }, 'Request error')

  done()
})
```

### 3.4 进程生命周期钩子

```typescript
// 未捕获异常
process.on('uncaughtException', (error) => {
  logger.fatal({
    err: {
      type: 'UncaughtException',
      message: error.message,
      stack: error.stack
    }
  }, 'Uncaught exception')
  process.exit(1)
})

// 未处理 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error({
    err: {
      type: 'UnhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined
    }
  }, 'Unhandled rejection')
})

// 进程信号
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
})
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
})
```

---

## 4. 依赖关系

### 4.1 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@accessbase/shared-types` | workspace | 共享类型定义 |
| `pino` | ^8.0.0 | 日志框架 |
| `pino-pretty` | ^10.0.0 | 开发环境格式化 |
| `pino-loki` | ^2.0.0 | Loki 集成 |
| `fastify` | ^4.0.0 | 请求上下文 |

### 4.2 内部依赖

| 模块 | 依赖说明 |
|------|---------|
| `@accessbase/identity` | 提供用户信息、租户信息 |
| `@accessbase/admin` | 提供配置管理 |

### 4.3 外部服务依赖

| 服务 | 说明 |
|------|------|
| Loki | 日志聚合存储（可选） |
| Grafana | 日志查询和可视化（可选） |

---

## 5. 错误码

### 5.1 错误码定义

| 错误码 | HTTP 状态码 | 说明 | 处理建议 |
|--------|------------|------|---------|
| `LOG_001` | 500 | 日志初始化失败 | 检查配置，触发告警 |
| `LOG_002` | 500 | 日志写入失败 | 检查磁盘空间，降级到 stderr |
| `LOG_003` | 400 | 日志级别无效 | 检查配置参数 |
| `LOG_004` | 500 | 日志传输失败（Loki） | 检查 Loki 连接，降级到文件 |
| `LOG_005` | 500 | 日志格式化失败 | 检查 pino-pretty 依赖 |
| `LOG_006` | 500 | 日志脱敏配置错误 | 检查 redact 路径配置 |

### 5.2 错误处理策略

```typescript
// 日志写入失败 — 降级到 stderr
function createFallbackLogger(): Logger {
  return {
    fatal: (...args) => process.stderr.write(JSON.stringify({ level: 'fatal', ...args }) + '\n'),
    error: (...args) => process.stderr.write(JSON.stringify({ level: 'error', ...args }) + '\n'),
    warn: (...args) => process.stderr.write(JSON.stringify({ level: 'warn', ...args }) + '\n'),
    info: (...args) => process.stderr.write(JSON.stringify({ level: 'info', ...args }) + '\n'),
    debug: (...args) => process.stderr.write(JSON.stringify({ level: 'debug', ...args }) + '\n'),
    trace: (...args) => process.stderr.write(JSON.stringify({ level: 'trace', ...args }) + '\n'),
    child: () => createFallbackLogger(),
    level: 'info'
  }
}

// Loki 连接失败 — 降级到本地文件
function createFileTransport(): pino.Transport {
  return {
    target: 'pino-roll',
    options: {
      file: './logs/accessbase.log',
      size: '100m',
      interval: '1d',
      compress: 'gzip'
    }
  }
}
```

---

## 6. 配置项

### 6.1 配置结构

```typescript
interface LoggerConfig {
  // 日志级别
  level: LogLevel

  // 环境配置
  environment: 'development' | 'production' | 'test'

  // 格式化配置
  format: {
    // 开发环境：pino-pretty 格式化
    pretty: boolean
    translateTime: string    // 时间格式，默认 'HH:MM:ss Z'
    ignore: string[]         // 忽略的字段，默认 ['pid', 'hostname']
  }

  // 脱敏配置
  redact: {
    enabled: boolean
    paths: string[]          // 需要脱敏的路径
    censor: string           // 脱敏替换符，默认 '[REDACTED]'
  }

  // 请求追踪
  tracing: {
    enabled: boolean
    headerName: string       // 请求 ID 头名称，默认 'x-request-id'
    generateIfMissing: boolean // 未提供时自动生成，默认 true
  }

  // 传输配置
  transport: {
    // Loki 集成
    loki?: {
      enabled: boolean
      url: string            // Loki 推送 URL
      labels: Record<string, string>  // 默认标签
      batchSize: number      // 批量大小，默认 100
      flushInterval: number  // 刷新间隔（ms），默认 5000
    }

    // 本地文件
    file?: {
      enabled: boolean
      path: string           // 日志文件路径
      maxSize: string        // 单文件最大大小，默认 '100m'
      maxFiles: number       // 最大文件数，默认 10
      compress: boolean      // 是否压缩归档，默认 true
    }
  }

  // 性能配置
  performance: {
    // 慢请求阈值（ms）
    slowRequestThreshold: number  // 默认 1000

    // 采样率（0-1，1 表示全量记录）
    sampleRate: number       // 默认 1
  }
}
```

### 6.2 默认配置

```typescript
const defaultLoggerConfig: LoggerConfig = {
  level: 'info',
  environment: process.env.NODE_ENV || 'development',
  format: {
    pretty: process.env.NODE_ENV !== 'production',
    translateTime: 'HH:MM:ss Z',
    ignore: ['pid', 'hostname']
  },
  redact: {
    enabled: true,
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-csrf-token',
      'req.body.password',
      'req.body.token',
      'req.body.secret',
      'req.body.api_key',
      'req.body.credit_card',
      'res.body.data.token',
      'res.body.data.refresh_token',
      'user.mfa_secret',
      'user.password_hash'
    ],
    censor: '[REDACTED]'
  },
  tracing: {
    enabled: true,
    headerName: 'x-request-id',
    generateIfMissing: true
  },
  transport: {
    loki: {
      enabled: false,
      url: 'http://loki:3100',
      labels: { job: 'accessbase' },
      batchSize: 100,
      flushInterval: 5000
    },
    file: {
      enabled: false,
      path: './logs/accessbase.log',
      maxSize: '100m',
      maxFiles: 10,
      compress: true
    }
  },
  performance: {
    slowRequestThreshold: 1000,
    sampleRate: 1
  }
}
```

### 6.3 环境变量

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `LOG_LEVEL` | 日志级别 | `info` |
| `LOG_FORMAT` | 日志格式（`json` / `pretty`） | `json`（生产）/ `pretty`（开发） |
| `LOG_REDACT_ENABLED` | 启用日志脱敏 | `true` |
| `LOG_REDACT_PATHS` | 脱敏路径（逗号分隔） | 见默认配置 |
| `LOG_REDACT_CENSOR` | 脱敏替换符 | `[REDACTED]` |
| `LOG_TRACING_ENABLED` | 启用请求追踪 | `true` |
| `LOG_TRACING_HEADER` | 请求 ID 头名称 | `x-request-id` |
| `LOG_LOKI_ENABLED` | 启用 Loki 集成 | `false` |
| `LOG_LOKI_URL` | Loki 推送 URL | `http://loki:3100` |
| `LOG_LOKI_LABELS` | Loki 标签（JSON） | `{"job":"accessbase"}` |
| `LOG_FILE_ENABLED` | 启用本地文件日志 | `false` |
| `LOG_FILE_PATH` | 日志文件路径 | `./logs/accessbase.log` |
| `LOG_SLOW_REQUEST_THRESHOLD` | 慢请求阈值（ms） | `1000` |
| `LOG_SAMPLE_RATE` | 日志采样率 | `1` |
