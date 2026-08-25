# 架构基础设施

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§17 架构基础设施

---

## 17. 架构基础设施

### 17.1 健康检查机制

#### 17.1.1 三探针方案

| 探针                      | 端点              | 用途                 | 检查内容                       |
| ------------------------- | ----------------- | -------------------- | ------------------------------ |
| **存活探针（Liveness）**  | `/health/live`    | 检查服务是否存活     | 进程是否运行、是否死锁         |
| **就绪探针（Readiness）** | `/health/ready`   | 检查服务是否就绪     | 依赖服务是否可用、配置是否加载 |
| **启动探针（Startup）**   | `/health/startup` | 检查服务是否启动完成 | 初始化是否完成、依赖是否就绪   |

#### 17.1.2 健康检查接口

```typescript
interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    [key: string]: {
      status: 'healthy' | 'unhealthy';
      message?: string;
      duration: number;
    };
  };
}
```

#### 17.1.3 Fastify 集成

```typescript
// 存活探针
fastify.get('/health/live', async (request, reply) => {
  const result = await healthCheck.checkLiveness();
  return reply.status(result.status === 'healthy' ? 200 : 503).send(result);
});

// 就绪探针
fastify.get('/health/ready', async (request, reply) => {
  const result = await healthCheck.checkReadiness();
  return reply.status(result.status === 'healthy' ? 200 : 503).send(result);
});

// 启动探针
fastify.get('/health/startup', async (request, reply) => {
  const result = await healthCheck.checkStartup();
  return reply.status(result.status === 'healthy' ? 200 : 503).send(result);
});
```

### 17.2 限流与容错

#### 17.2.1 限流策略

| 策略         | 算法       | 适用场景 |
| ------------ | ---------- | -------- |
| **固定窗口** | 计数器     | 简单限流 |
| **滑动窗口** | 滑动计数器 | 精确限流 |
| **令牌桶**   | 令牌桶     | 平滑限流 |
| **漏桶**     | 漏桶       | 流量整形 |

#### 17.2.2 熔断器

```typescript
interface CircuitBreaker {
  execute<T>(operation: () => Promise<T>): Promise<T>;
  getState(): 'closed' | 'open' | 'half-open';
  reset(): void;
}

// 使用示例
const circuitBreaker = new CircuitBreakerImpl({
  failureThreshold: 5,
  resetTimeout: 30000,
  monitoringPeriod: 60000,
});

const result = await circuitBreaker.execute(() => fetchExternalService());
```

#### 17.2.3 降级策略

```typescript
// 带熔断和降级的调用
const result = await fallback.execute(
  () => circuitBreaker.execute(() => fetchExternalService()),
  () => getCachedData(), // 降级：返回缓存数据
);
```

### 17.3 缓存策略

#### 17.3.1 缓存层次

| 层次        | 位置     | 速度 | 容量 | 适用场景       |
| ----------- | -------- | ---- | ---- | -------------- |
| **L1 缓存** | 进程内存 | 最快 | 小   | 热点数据、配置 |
| **L2 缓存** | Redis    | 快   | 中   | 会话、临时数据 |
| **L3 缓存** | 数据库   | 慢   | 大   | 持久化数据     |

#### 17.3.2 缓存策略

| 策略              | 说明                             | 适用场景   |
| ----------------- | -------------------------------- | ---------- |
| **Cache-Aside**   | 应用先查缓存，未命中查数据库     | 读多写少   |
| **Read-Through**  | 缓存层自动加载数据               | 读多写少   |
| **Write-Through** | 写入时同时更新缓存和数据库       | 写多读少   |
| **Write-Behind**  | 写入时先更新缓存，异步更新数据库 | 高写入性能 |

#### 17.3.3 缓存穿透防护

```typescript
// 空值缓存
async getOrSetWithNullProtection<T>(
  key: string,
  factory: () => Promise<T | null>,
  ttl: number = 60
): Promise<T | null> {
  const cached = await this.cache.get<T | null>(key)
  if (cached !== undefined) return cached

  const value = await factory()

  if (value === null) {
    await this.cache.set(key, null, ttl)  // 缓存空值
    return null
  }

  await this.cache.set(key, value, ttl)
  return value
}
```

### 17.4 消息队列

#### 17.4.1 方案选择

**选择：Redis Streams**

| 方案              | 性能       | 可靠性     | 复杂度   | 适用场景           |
| ----------------- | ---------- | ---------- | -------- | ------------------ |
| **Redis Streams** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐   | ⭐       | 中小规模、事件溯源 |
| **RabbitMQ**      | ⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐ | ⭐⭐⭐   | 企业级、复杂路由   |
| **Kafka**         | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 大数据、高吞吐     |

#### 17.4.2 事件驱动架构

```typescript
// 事件总线
class EventBus {
  private mq: MessageQueue;

  async publish<T>(event: Event<T>): Promise<void> {
    await this.mq.publish(event.type, event);
  }

  async subscribe<T>(eventType: string, handler: EventHandler<T>): Promise<void> {
    await this.mq.subscribe(eventType, async (message) => {
      await handler(message.payload as Event<T>);
    });
  }
}

// 使用示例
await eventBus.subscribe('user.created', async (event) => {
  console.log('User created:', event.payload);
  await sendWelcomeEmail(event.payload.email);
});
```

### 17.5 配置示例

```yaml
# config.yaml
infrastructure:
  # 健康检查
  health:
    enabled: true
    liveness:
      path: /health/live
      interval: 10s
    readiness:
      path: /health/ready
      interval: 5s
    startup:
      path: /health/startup
      interval: 5s

  # 限流
  rate_limit:
    enabled: true
    global:
      limit: 100
      window: 60
    user:
      limit: 1000
      window: 60

  # 熔断器
  circuit_breaker:
    enabled: true
    failure_threshold: 5
    reset_timeout: 30000

  # 缓存
  cache:
    enabled: true
    strategy: cache-aside
    ttl:
      default: 300
      user: 600
      config: 3600

  # 消息队列
  message_queue:
    enabled: true
    implementation: redis-streams
    consumer:
      group: accessbase
      prefetch: 10
```

---
