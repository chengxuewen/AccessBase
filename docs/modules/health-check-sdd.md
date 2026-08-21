# @accessbase/health-check 软件设计文档 (SDD)

> 本文档基于 [`monitoring.md`](./monitoring.md) §13 和 [`error-handling.md`](./error-handling.md) §21 生成。

---

## 1. 包概述

`@accessbase/health-check` 是 AccessBase 的健康检查包，提供系统健康状态监控、依赖项检查和健康报告功能。

### 1.1 核心职责

- 提供系统健康状态检查
- 监控关键依赖项（数据库、缓存、外部服务）
- 生成健康报告和指标
- 支持 Kubernetes 就绪性和存活性探针
- 集成监控告警系统

### 1.2 技术选型

| 技术 | 选择 | 理由 |
|------|------|------|
| 健康检查 | 自定义实现 | 轻量级、可定制 |
| 指标收集 | Prometheus | 行业标准、生态丰富 |
| 容器探针 | Kubernetes 原生 | 标准化、自动恢复 |

---

## 2. 核心接口

### 2.1 健康检查接口

```typescript
/**
 * 健康状态枚举
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded'

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  /** 检查名称 */
  name: string
  /** 健康状态 */
  status: HealthStatus
  /** 检查时间 */
  timestamp: Date
  /** 响应时间（毫秒） */
  responseTime: number
  /** 详细信息 */
  details?: Record<string, unknown>
  /** 错误信息 */
  error?: string
}

/**
 * 系统健康报告
 */
export interface HealthReport {
  /** 整体状态 */
  status: HealthStatus
  /** 检查时间 */
  timestamp: Date
  /** 版本信息 */
  version: string
  /** 运行时间（秒） */
  uptime: number
  /** 各项检查结果 */
  checks: HealthCheckResult[]
  /** 系统信息 */
  system: SystemInfo
}

/**
 * 系统信息
 */
export interface SystemInfo {
  /** Node.js 版本 */
  nodeVersion: string
  /** 操作系统 */
  os: string
  /** 架构 */
  arch: string
  /** 内存使用 */
  memory: {
    total: number
    free: number
    used: number
    usedPercentage: number
  }
  /** CPU 使用 */
  cpu: {
    cores: number
    model: string
    usage: number
  }
}
```

### 2.2 健康检查器接口

```typescript
/**
 * 健康检查器接口
 */
export interface HealthChecker {
  /** 检查名称 */
  name: string
  /** 检查类型 */
  type: 'liveness' | 'readiness' | 'startup'
  /** 执行检查 */
  check(): Promise<HealthCheckResult>
  /** 是否启用 */
  enabled: boolean
  /** 检查超时（毫秒） */
  timeout: number
  /** 检查间隔（毫秒） */
  interval?: number
}

/**
 * 数据库健康检查器
 */
export interface DatabaseHealthChecker extends HealthChecker {
  /** 检查连接 */
  checkConnection(): Promise<boolean>
  /** 检查查询 */
  checkQuery(): Promise<boolean>
  /** 检查连接池 */
  checkPool(): Promise<PoolStatus>
}

/**
 * 缓存健康检查器
 */
export interface CacheHealthChecker extends HealthChecker {
  /** 检查连接 */
  checkConnection(): Promise<boolean>
  /** 检查读写 */
  checkReadWrite(): Promise<boolean>
  /** 检查内存 */
  checkMemory(): Promise<MemoryStatus>
}

/**
 * 连接池状态
 */
export interface PoolStatus {
  /** 总连接数 */
  total: number
  /** 活跃连接数 */
  active: number
  /** 空闲连接数 */
  idle: number
  /** 等待连接数 */
  waiting: number
}

/**
 * 内存状态
 */
export interface MemoryStatus {
  /** 总内存（字节） */
  total: number
  /** 已用内存（字节） */
  used: number
  /** 峰值内存（字节） */
  peak: number
  /** 内存碎片率 */
  fragmentationRatio: number
}
```

### 2.3 健康检查服务接口

```typescript
/**
 * 健康检查服务接口
 */
export interface HealthCheckService {
  /** 注册检查器 */
  register(checker: HealthChecker): void
  /** 移除检查器 */
  unregister(name: string): void
  /** 执行所有检查 */
  checkAll(): Promise<HealthReport>
  /** 执行指定检查 */
  check(name: string): Promise<HealthCheckResult>
  /** 获取系统信息 */
  getSystemInfo(): SystemInfo
  /** 获取版本信息 */
  getVersion(): string
  /** 获取运行时间 */
  getUptime(): number
}

/**
 * 健康检查配置
 */
export interface HealthCheckConfig {
  /** 启用的检查器 */
  checkers: string[]
  /** 检查超时（毫秒） */
  timeout: number
  /** 检查间隔（毫秒） */
  interval: number
  /** 是否收集指标 */
  collectMetrics: boolean
  /** 指标前缀 */
  metricsPrefix: string
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}
```

---

## 3. 生命周期钩子

### 3.1 健康检查生命周期

```typescript
/**
 * 健康检查生命周期钩子
 */
export interface HealthCheckLifecycle {
  /** 检查开始前 */
  onBeforeCheck?: (name: string) => Promise<void>
  /** 检查完成后 */
  onAfterCheck?: (result: HealthCheckResult) => Promise<void>
  /** 检查失败时 */
  onCheckError?: (name: string, error: Error) => Promise<void>
  /** 状态变更时 */
  onStatusChange?: (name: string, oldStatus: HealthStatus, newStatus: HealthStatus) => Promise<void>
  /** 报告生成前 */
  onBeforeReport?: (report: HealthReport) => Promise<HealthReport>
  /** 报告生成后 */
  onAfterReport?: (report: HealthReport) => Promise<void>
}
```

### 3.2 检查流程

```
1. 初始化阶段
   ├── 注册检查器
   ├── 加载配置
   └── 启动定时检查

2. 检查阶段
   ├── 并行执行检查器
   ├── 收集检查结果
   ├── 计算整体状态
   └── 生成健康报告

3. 报告阶段
   ├── 格式化报告
   ├── 收集指标
   ├── 触发告警
   └── 返回响应

4. 监控阶段
   ├── 持续检查
   ├── 状态变更检测
   ├── 告警通知
   └── 自动恢复
```

---

## 4. 依赖关系

### 4.1 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| prom-client | ^15.0.0 | Prometheus 指标收集 |
| fastify | ^4.25.0 | HTTP 服务 |
| pg | ^8.11.0 | PostgreSQL 客户端 |
| ioredis | ^5.3.0 | Redis 客户端 |
| axios | ^1.6.0 | HTTP 客户端 |

### 4.2 内部依赖

| 包 | 用途 |
|------|------|
| @accessbase/shared-types | 共享类型定义 |
| @accessbase/logging | 日志记录 |

### 4.3 依赖图

```
@accessbase/health-check
├── @accessbase/shared-types
├── @accessbase/logging
├── prom-client
├── fastify
├── pg
├── ioredis
└── axios
```

---

## 5. 错误码

### 5.1 健康检查错误码

| 错误码 | 说明 | HTTP 状态码 |
|--------|------|------------|
| HC_001 | 数据库连接失败 | 503 |
| HC_002 | 缓存连接失败 | 503 |
| HC_003 | 外部服务不可达 | 503 |
| HC_004 | 检查超时 | 408 |
| HC_005 | 检查器未找到 | 404 |
| HC_006 | 配置错误 | 400 |
| HC_007 | 内存不足 | 503 |
| HC_008 | CPU 过载 | 503 |
| HC_009 | 磁盘空间不足 | 503 |
| HC_010 | 连接池耗尽 | 503 |

### 5.2 错误响应格式

```typescript
interface HealthCheckError {
  code: string
  message: string
  details?: {
    checker?: string
    status?: HealthStatus
    responseTime?: number
    stack?: string
  }
}
```

---

## 6. 配置项

### 6.1 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| HC_ENABLED | 否 | true | 是否启用健康检查 |
| HC_TIMEOUT | 否 | 5000 | 检查超时（毫秒） |
| HC_INTERVAL | 否 | 30000 | 检查间隔（毫秒） |
| HC_METRICS_ENABLED | 否 | true | 是否收集指标 |
| HC_METRICS_PREFIX | 否 | accessbase_ | 指标前缀 |
| HC_LOG_LEVEL | 否 | info | 日志级别 |
| HC_DATABASE_ENABLED | 否 | true | 是否检查数据库 |
| HC_CACHE_ENABLED | 否 | true | 是否检查缓存 |
| HC_EXTERNAL_SERVICES | 否 | - | 外部服务检查列表 |

### 6.2 配置文件

```typescript
// health-check.config.ts
export interface HealthCheckConfigFile {
  /** 健康检查配置 */
  healthCheck: {
    /** 是否启用 */
    enabled: boolean
    /** 检查超时（毫秒） */
    timeout: number
    /** 检查间隔（毫秒） */
    interval: number
    /** 启用的检查器 */
    checkers: {
      /** 数据库检查 */
      database: {
        enabled: boolean
        timeout: number
        queries: string[]
      }
      /** 缓存检查 */
      cache: {
        enabled: boolean
        timeout: number
        operations: ('ping' | 'get' | 'set')[]
      }
      /** 外部服务检查 */
      external: {
        name: string
        url: string
        timeout: number
        method: 'GET' | 'POST'
        expectedStatus: number
      }[]
    }
  }
  /** 指标配置 */
  metrics: {
    /** 是否启用 */
    enabled: boolean
    /** 指标前缀 */
    prefix: string
    /** 自定义指标 */
    custom: {
      name: string
      help: string
      type: 'counter' | 'gauge' | 'histogram'
      labels: string[]
    }[]
  }
  /** 告警配置 */
  alerts: {
    /** 是否启用 */
    enabled: boolean
    /** 告警规则 */
    rules: {
      name: string
      condition: string
      threshold: number
      duration: string
      severity: 'P0' | 'P1' | 'P2' | 'P3'
    }[]
  }
}
```

### 6.3 Fastify 插件配置

```typescript
// Fastify 插件注册
import fastifyHealthCheck from '@accessbase/health-check'

await fastify.register(fastifyHealthCheck, {
  // 健康检查路径
  path: '/health',
  
  // 启用详细报告
  detailed: true,
  
  // 自定义检查器
  checkers: [
    {
      name: 'database',
      type: 'readiness',
      check: async () => {
        // 数据库检查逻辑
      }
    },
    {
      name: 'cache',
      type: 'readiness',
      check: async () => {
        // 缓存检查逻辑
      }
    }
  ],
  
  // 指标收集
  metrics: {
    enabled: true,
    prefix: 'accessbase_',
    collectDefault: true
  },
  
  // 日志配置
  logLevel: 'info'
})
```

---

## 附录

### A. 健康检查端点

```typescript
// GET /health
// 返回完整健康报告
{
  "status": "healthy",
  "timestamp": "2026-08-21T10:30:00Z",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": [
    {
      "name": "database",
      "status": "healthy",
      "timestamp": "2026-08-21T10:30:00Z",
      "responseTime": 15,
      "details": {
        "connection": true,
        "query": true,
        "pool": {
          "total": 10,
          "active": 3,
          "idle": 7,
          "waiting": 0
        }
      }
    },
    {
      "name": "cache",
      "status": "healthy",
      "timestamp": "2026-08-21T10:30:00Z",
      "responseTime": 5,
      "details": {
        "connection": true,
        "readWrite": true,
        "memory": {
          "total": 1073741824,
          "used": 536870912,
          "peak": 805306368,
          "fragmentationRatio": 1.2
        }
      }
    }
  ],
  "system": {
    "nodeVersion": "v20.10.0",
    "os": "Linux",
    "arch": "x64",
    "memory": {
      "total": 8589934592,
      "free": 4294967296,
      "used": 4294967296,
      "usedPercentage": 50
    },
    "cpu": {
      "cores": 4,
      "model": "Intel(R) Core(TM) i7-10700K",
      "usage": 25
    }
  }
}

// GET /health/live
// Kubernetes 存活性探针
// 返回 200 表示服务存活

// GET /health/ready
// Kubernetes 就绪性探针
// 返回 200 表示服务就绪，503 表示未就绪

// GET /health/startup
// Kubernetes 启动探针
// 返回 200 表示启动完成
```

### B. Prometheus 指标

```typescript
// 指标定义
const metrics = {
  // 健康检查状态
  healthCheckStatus: new Gauge({
    name: 'accessbase_health_check_status',
    help: 'Health check status (1=healthy, 0=unhealthy)',
    labelNames: ['checker']
  }),
  
  // 健康检查响应时间
  healthCheckDuration: new Histogram({
    name: 'accessbase_health_check_duration_seconds',
    help: 'Health check duration in seconds',
    labelNames: ['checker'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5]
  }),
  
  // 系统启动时间
  systemUptime: new Gauge({
    name: 'accessbase_system_uptime_seconds',
    help: 'System uptime in seconds'
  }),
  
  // 内存使用
  memoryUsage: new Gauge({
    name: 'accessbase_memory_usage_bytes',
    help: 'Memory usage in bytes',
    labelNames: ['type']
  }),
  
  // CPU 使用
  cpuUsage: new Gauge({
    name: 'accessbase_cpu_usage_percent',
    help: 'CPU usage percentage'
  })
}
```

### C. Kubernetes 配置

```yaml
# Kubernetes 健康检查配置
apiVersion: v1
kind: Pod
metadata:
  name: accessbase
spec:
  containers:
    - name: accessbase
      image: accessbase:latest
      ports:
        - containerPort: 5101
      livenessProbe:
        httpGet:
          path: /health/live
          port: 5101
        initialDelaySeconds: 30
        periodSeconds: 10
        timeoutSeconds: 5
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 5101
        initialDelaySeconds: 5
        periodSeconds: 5
        timeoutSeconds: 3
        failureThreshold: 3
      startupProbe:
        httpGet:
          path: /health/startup
          port: 5101
        initialDelaySeconds: 10
        periodSeconds: 10
        timeoutSeconds: 5
        failureThreshold: 30
```

### D. 告警规则示例

```yaml
# Prometheus 告警规则
groups:
  - name: health-check
    rules:
      - alert: HealthCheckFailed
        expr: accessbase_health_check_status == 0
        for: 1m
        labels:
          severity: P1
        annotations:
          summary: "健康检查失败: {{ $labels.checker }}"
          description: "{{ $labels.checker }} 健康检查失败超过 1 分钟"
      
      - alert: HighResponseTime
        expr: accessbase_health_check_duration_seconds > 5
        for: 2m
        labels:
          severity: P2
        annotations:
          summary: "健康检查响应时间过长: {{ $labels.checker }}"
          description: "{{ $labels.checker }} 响应时间超过 5 秒"
      
      - alert: HighMemoryUsage
        expr: accessbase_memory_usage_bytes{type="used"} / accessbase_memory_usage_bytes{type="total"} > 0.9
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: "内存使用率过高"
          description: "内存使用率超过 90%"
```
