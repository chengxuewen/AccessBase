# P3 补充

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§42 P3 补充

---

## 42. P3 补充

### 42.1 性能监控（APM）

```typescript
// APM 集成
import { trace, metrics } from '@opentelemetry/api'

// 性能追踪
class PerformanceMonitor {
  private tracer = trace.getTracer('accessbase')
  private meter = metrics.getMeter('accessbase')

  // 计数器
  private requestCounter = this.meter.createCounter('http_requests_total', {
    description: 'Total HTTP requests'
  })

  // 直方图
  private requestDuration = this.meter.createHistogram('http_request_duration_ms', {
    description: 'HTTP request duration in milliseconds'
    unit: 'ms'
  })

  // 仪表
  private activeConnections = this.meter.createUpDownCounter('active_connections', {
    description: 'Active connections'
  })

  // 追踪
  async traceOperation<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      try {
        const result = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        throw error
      } finally {
        span.end()
      }
    })
  }
}
```

### 42.2 版本策略

```typescript
// 语义化版本
// MAJOR.MINOR.PATCH
// MAJOR: 不兼容的 API 变更
// MINOR: 向后兼容的功能新增
// PATCH: 向后兼容的问题修复

// 向后兼容策略
interface VersioningStrategy {
  // API 版本支持
  supportedVersions: string[]; // ['v1', 'v2']
  deprecatedVersions: string[]; // ['v0']

  // 弃用通知
  deprecationNotice(version: string): {
    sunsetDate: Date;
    migrationGuide: string;
  };
}

// 弃用中间件
function deprecationMiddleware(version: string, sunsetDate: Date) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Sunset', sunsetDate.toUTCString());
    reply.header('Deprecation', 'true');
    reply.header(
      'Link',
      `<https://docs.example.com/migration/${version}>; rel="successor-version"`,
    );
  };
}
```

### 42.3 性能基线

```yaml
# performance-baseline.yaml
endpoints:
  - path: /api/v1/auth/login
    method: POST
    targets:
      p50: 100ms
      p95: 300ms
      p99: 500ms

  - path: /api/v1/users
    method: GET
    targets:
      p50: 50ms
      p95: 150ms
      p99: 300ms

  - path: /api/v1/users/:id
    method: GET
    targets:
      p50: 30ms
      p95: 100ms
      p99: 200ms

load_test:
  concurrent_users: 100
  duration: 60s
  ramp_up: 10s
```

### 42.4 DNS/证书管理

```yaml
# DNS 配置示例
dns:
  provider: cloudflare # 或 route53, alidns
  zones:
    - name: example.com
      records:
        - type: A
          name: api
          value: ${API_IP}
          ttl: 300
        - type: CNAME
          name: www
          value: api.example.com
          ttl: 300
        - type: MX
          name: '@'
          value: mail.example.com
          priority: 10

# 证书管理
certificates:
  provider: letsencrypt
  auto_renew: true
  renew_before_days: 30
  domains:
    - example.com
    - '*.example.com'
```

### 42.5 成本监控

```typescript
// 成本监控
class CostMonitor {
  private costs: Map<string, number> = new Map();

  // 记录成本
  record(service: string, amount: number): void {
    const current = this.costs.get(service) || 0;
    this.costs.set(service, current + amount);
  }

  // 获取成本报告
  getReport(): CostReport {
    const services = Array.from(this.costs.entries()).map(([name, cost]) => ({
      name,
      cost,
      percentage: (cost / this.getTotalCost()) * 100,
    }));

    return {
      total: this.getTotalCost(),
      services,
      period: this.getPeriod(),
    };
  }

  // 预算告警
  checkBudget(budget: number): Alert | null {
    const total = this.getTotalCost();
    if (total > budget * 0.9) {
      return {
        level: 'warning',
        message: `成本已达到预算的 ${((total / budget) * 100).toFixed(1)}%`,
      };
    }
    return null;
  }
}
```

### 42.6 报表与分析

```typescript
// 报表服务
class ReportService {
  // 用户活跃度报表
  async getUserActivityReport(params: ReportParams): Promise<UserActivityReport> {
    const { startDate, endDate, tenantId } = params;

    const data = await db
      .select({
        date: sql`date(${auditLogsTable.createdAt})`,
        activeUsers: sql`count(distinct ${auditLogsTable.userId})`,
        totalActions: sql`count(*)`,
      })
      .from(auditLogsTable)
      .where(
        and(
          gte(auditLogsTable.createdAt, startDate),
          lte(auditLogsTable.createdAt, endDate),
          tenantId ? eq(auditLogsTable.tenantId, tenantId) : undefined,
        ),
      )
      .groupBy(sql`date(${auditLogsTable.createdAt})`);

    return { data, params };
  }

  // 导出报表
  async exportReport(report: any, format: 'csv' | 'excel' | 'pdf'): Promise<Buffer> {
    switch (format) {
      case 'csv':
        return this.toCSV(report);
      case 'excel':
        return this.toExcel(report);
      case 'pdf':
        return this.toPDF(report);
    }
  }
}

// 报表 API
fastify.get(
  '/api/v1/reports/user-activity',
  {
    preHandler: [authenticate, authorize('reports:read')],
  },
  async (request, reply) => {
    const report = await reportService.getUserActivityReport(request.query);
    return reply.send(report);
  },
);
```

### 42.7 API 网关功能

```typescript
// API 网关中间件
class APIGateway {
  // 请求路由
  async route(request: FastifyRequest): Promise<string> {
    const { path, method } = request;

    // 路由表查找
    const route = this.routeTable.find(path, method);

    if (!route) {
      throw new AppError('SYS_003', '路由不存在');
    }

    return route.target;
  }

  // 请求转换
  async transform(request: FastifyRequest, route: RouteConfig): Promise<TransformedRequest> {
    return {
      url: `${route.target}${request.url}`,
      method: request.method,
      headers: {
        ...request.headers,
        'X-Forwarded-For': request.ip,
        'X-Request-ID': request.id,
      },
      body: request.body,
    };
  }

  // 响应转换
  async transformResponse(response: any, route: RouteConfig): Promise<any> {
    if (route.responseTransform) {
      return route.responseTransform(response);
    }
    return response;
  }
}
```

### 42.8 配置管理增强

```typescript
// 配置管理服务
class ConfigService {
  private config: Map<string, any> = new Map();

  // 获取配置
  async get<T>(key: string, defaultValue?: T): Promise<T> {
    // 先查内存缓存
    if (this.config.has(key)) {
      return this.config.get(key) as T;
    }

    // 查数据库
    const dbConfig = await db.select().from(configsTable).where(eq(configsTable.key, key)).limit(1);

    if (dbConfig) {
      this.config.set(key, dbConfig.value);
      return dbConfig.value as T;
    }

    return defaultValue as T;
  }

  // 设置配置
  async set(key: string, value: any): Promise<void> {
    await db
      .insert(configsTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: configsTable.key,
        set: { value, updatedAt: new Date() },
      });

    this.config.set(key, value);
  }

  // 配置变更事件
  async onChange(key: string, callback: (value: any) => void): Promise<void> {
    eventBus.on(`config:${key}`, callback);
  }
}
```

---
