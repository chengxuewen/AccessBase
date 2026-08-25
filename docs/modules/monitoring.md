# 监控与告警系统

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§13 监控与告警系统

---

## 13. 监控与告警系统

### 13.1 监控架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    监控数据源                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ 应用层  │  │ 数据库  │  │  缓存   │  │ 系统层  │    │
│  │ 指标    │  │ 指标    │  │ 指标    │  │ 指标    │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓               ↓               ↓               ↓
┌─────────────────────────────────────────────────────────┐
│                    指标收集器                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Prometheus                                      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│                    告警引擎                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │  告警规则评估 → 触发条件 → 通知路由              │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│                    通知渠道                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │  邮件   │  │ Webhook │  │  短信   │  │ 企业微信│    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 13.2 监控指标分类

#### 13.2.1 应用层指标

| 指标类别     | 具体指标               | 说明     |
| ------------ | ---------------------- | -------- |
| **请求指标** | QPS、延迟、错误率      | API 性能 |
| **认证指标** | 登录成功率、OAuth 耗时 | 认证性能 |
| **业务指标** | 用户数、活跃度         | 业务健康 |

#### 13.2.2 数据库指标

| 指标类别     | 具体指标                     | 说明     |
| ------------ | ---------------------------- | -------- |
| **连接池**   | 活跃连接、空闲连接、等待连接 | 连接健康 |
| **查询性能** | 查询耗时、慢查询数量         | 查询效率 |
| **存储**     | 表大小、索引大小、磁盘使用   | 存储健康 |

#### 13.2.3 系统资源指标

| 指标类别 | 具体指标                 | 说明     |
| -------- | ------------------------ | -------- |
| **CPU**  | 使用率、负载、核心数     | CPU 健康 |
| **内存** | 使用率、可用内存、交换区 | 内存健康 |
| **磁盘** | 使用率、IOPS、读写速度   | 磁盘健康 |
| **网络** | 带宽、连接数、错误包     | 网络健康 |

### 13.3 告警规则设计

#### 13.3.1 告警级别

| 级别   | 名称 | 触发条件                 | 通知方式       | 响应时间 |
| ------ | ---- | ------------------------ | -------------- | -------- |
| **P0** | 紧急 | 服务不可用、数据丢失     | 电话+短信+邮件 | 5 分钟   |
| **P1** | 严重 | 性能严重下降、错误率飙升 | 短信+邮件      | 15 分钟  |
| **P2** | 警告 | 资源使用率高、慢查询增多 | 邮件           | 1 小时   |
| **P3** | 信息 | 配置变更、计划任务完成   | 邮件           | 24 小时  |

#### 13.3.2 告警规则示例

```yaml
# alert-rules.yaml
groups:
  - name: application
    rules:
      # 错误率告警
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: P1
        annotations:
          summary: '错误率超过 5%'
          description: '当前错误率 {{ $value | humanizePercentage }}'

      # 延迟告警
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: 'P95 延迟超过 1 秒'
          description: '当前 P95 延迟 {{ $value | humanizeDuration }}'

  - name: database
    rules:
      # 连接池告警
      - alert: DatabasePoolExhausted
        expr: db_pool_connections{state="active"} / db_pool_connections{state="max"} > 0.9
        for: 2m
        labels:
          severity: P1
        annotations:
          summary: '数据库连接池使用率超过 90%'
          description: '当前连接池使用率 {{ $value | humanizePercentage }}'

      # 慢查询告警
      - alert: SlowQueries
        expr: rate(db_slow_queries_total{threshold="500ms"}[5m]) > 0.1
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: '慢查询数量增加'
          description: '每秒 {{ $value }} 个慢查询（>500ms）'

  - name: system
    rules:
      # CPU 告警
      - alert: HighCpuUsage
        expr: system_cpu_usage_percent > 80
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: 'CPU 使用率超过 80%'
          description: '当前 CPU 使用率 {{ $value | humanizePercentage }}'

      # 内存告警
      - alert: HighMemoryUsage
        expr: system_memory_usage_percent > 85
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: '内存使用率超过 85%'
          description: '当前内存使用率 {{ $value | humanizePercentage }}'

      # 磁盘告警
      - alert: HighDiskUsage
        expr: system_disk_usage_percent > 90
        for: 5m
        labels:
          severity: P1
        annotations:
          summary: '磁盘使用率超过 90%'
          description: '当前磁盘使用率 {{ $value | humanizePercentage }}'
```

### 13.4 通知渠道设计

#### 13.4.1 通知渠道接口

```typescript
// 通知渠道接口
interface NotificationChannel {
  name: string;
  type: 'email' | 'webhook' | 'sms' | 'wechat' | 'slack' | 'telegram';
  enabled: boolean;

  send(alert: Alert): Promise<boolean>;
}

// 告警信息
interface Alert {
  id: string;
  level: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: Date;
  labels: Record<string, string>;
}
```

#### 13.4.2 邮件通知

```typescript
class EmailNotificationChannel implements NotificationChannel {
  name = 'email';
  type = 'email' as const;
  enabled: boolean;

  private config: {
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      auth: {
        user: string;
        pass: string;
      };
    };
    from: string;
    to: string[]; // 收件人列表
    cc?: string[]; // 抄送列表
  };

  async send(alert: Alert): Promise<boolean> {
    const transporter = nodemailer.createTransport(this.config.smtp);

    const mailOptions = {
      from: this.config.from,
      to: this.config.to.join(','),
      cc: this.config.cc?.join(','),
      subject: `[${alert.level}] ${alert.title}`,
      html: this.renderEmailTemplate(alert),
    };

    await transporter.sendMail(mailOptions);
    return true;
  }
}
```

#### 13.4.3 Webhook 通知

```typescript
class WebhookNotificationChannel implements NotificationChannel {
  name = 'webhook';
  type = 'webhook' as const;
  enabled: boolean;

  private config: {
    url: string;
    method: 'POST' | 'PUT';
    headers?: Record<string, string>;
    timeout: number;
  };

  async send(alert: Alert): Promise<boolean> {
    const payload = {
      alert_id: alert.id,
      level: alert.level,
      title: alert.title,
      description: alert.description,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      timestamp: alert.timestamp.toISOString(),
      labels: alert.labels,
    };

    const response = await fetch(this.config.url, {
      method: this.config.method,
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    return response.ok;
  }
}
```

### 13.5 日志聚合

#### 13.5.1 方案选择

**选择：Loki + Grafana**

| 方案               | 架构                              | 性能       | 成本 | 适用场景         |
| ------------------ | --------------------------------- | ---------- | ---- | ---------------- |
| **Loki + Grafana** | Loki + Promtail + Grafana         | ⭐⭐⭐⭐⭐ | 低   | 轻量级、标签查询 |
| **ELK Stack**      | Elasticsearch + Logstash + Kibana | ⭐⭐⭐⭐   | 高   | 企业级、全文搜索 |
| **Splunk**         | 商业方案                          | ⭐⭐⭐⭐⭐ | 很高 | 大企业、合规要求 |

#### 13.5.2 Loki 架构

```
┌─────────────────────────────────────────────────────────┐
│                    应用层                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ AccessBase │  │ 数据库  │  │  缓存   │  │ 其他服务│    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓               ↓               ↓               ↓
┌─────────────────────────────────────────────────────────┐
│                    日志收集器                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Promtail                                       │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│                    日志存储                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Loki（标签索引 + 压缩日志）                     │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│                    日志查询                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Grafana（日志查询 + 仪表盘）                    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

#### 13.5.3 Loki 查询示例

```logql
# 查询所有错误日志
{job="accessbase"} |= "error"

# 查询特定用户的日志
{job="accessbase"} | json | userId="user123"

# 查询特定请求的日志
{job="accessbase"} | json | requestId="req-abc123"

# 查询慢请求（>1秒）
{job="accessbase"} | json | duration > 1000

# 统计错误率
sum(rate({job="accessbase"} |= "error" [5m])) / sum(rate({job="accessbase"} [5m]))
```

### 13.6 链路追踪

#### 13.6.1 方案选择

**选择：Jaeger**

| 方案           | 架构         | 性能       | 成本 | 适用场景            |
| -------------- | ------------ | ---------- | ---- | ------------------- |
| **Jaeger**     | Uber 开源    | ⭐⭐⭐⭐⭐ | 低   | 云原生、微服务      |
| **Zipkin**     | Twitter 开源 | ⭐⭐⭐⭐   | 低   | 传统应用、简单架构  |
| **SkyWalking** | Apache 开源  | ⭐⭐⭐⭐⭐ | 低   | Java 生态、自动探针 |

#### 13.6.2 Jaeger 架构

```
┌─────────────────────────────────────────────────────────┐
│                    应用层                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ AccessBase │  │ 数据库  │  │  缓存   │  │ 其他服务│    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓               ↓               ↓               ↓
┌─────────────────────────────────────────────────────────┐
│                    OpenTelemetry Collector               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  采集、处理、导出追踪数据                         │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│                    Jaeger 后端                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│  │ Agent   │  │Collector│  │ Query   │                 │
│  └─────────┘  └─────────┘  └─────────┘                 │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│                    存储                                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Elasticsearch / Cassandra / Badger             │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

#### 13.6.3 OpenTelemetry 集成

```typescript
// OpenTelemetry 初始化
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';

const sdk = new NodeSDK({
  serviceName: 'accessbase',
  traceExporter: new JaegerExporter({
    endpoint: 'http://jaeger:14268/api/traces',
  }),
  instrumentations: [
    new FastifyInstrumentation(),
    new HttpInstrumentation(),
    new PgInstrumentation(),
    new RedisInstrumentation(),
  ],
});

sdk.start();
```

### 13.7 配置示例

```yaml
# config.yaml
monitoring:
  # 指标收集
  metrics:
    enabled: true
    port: 9090
    path: /metrics
    collect_interval: 15s

  # 告警规则
  alerting:
    enabled: true
    rules_file: ./alert-rules.yaml
    evaluation_interval: 30s

  # 通知渠道
  notifications:
    email:
      enabled: true
      smtp:
        host: smtp.example.com
        port: 587
        secure: false
        auth:
          user: ${SMTP_USER}
          pass: ${SMTP_PASS}
      from: alert@example.com
      to:
        - admin@example.com
        - ops@example.com

    webhook:
      enabled: true
      url: https://hooks.example.com/alert
      method: POST
      timeout: 5000

  # 日志聚合
  logging:
    loki:
      enabled: true
      url: http://loki:3100

    promtail:
      enabled: true
      config_file: ./promtail-config.yaml

  # 链路追踪
  tracing:
    jaeger:
      enabled: true
      endpoint: http://jaeger:14268/api/traces

    opentelemetry:
      enabled: true
      service_name: accessbase

  # 资源监控
  resources:
    cpu:
      enabled: true
      threshold_warning: 70
      threshold_critical: 90
    memory:
      enabled: true
      threshold_warning: 70
      threshold_critical: 90
    disk:
      enabled: true
      threshold_warning: 80
      threshold_critical: 95
```

---
