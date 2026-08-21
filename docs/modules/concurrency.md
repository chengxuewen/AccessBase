# 并发处理

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§18 并发处理

---

## 18. 并发处理

### 18.1 并发场景分析

| 场景 | 类型 | 挑战 | 解决方案 |
|------|------|------|---------|
| **并发读取** | 读-读 | 缓存一致性 | 缓存失效策略 |
| **并发写入** | 写-写 | 数据竞争 | 锁机制 |
| **读写混合** | 读-写 | 脏读、不可重复读 | 事务隔离级别 |
| **分布式并发** | 多节点 | 网络延迟、分区 | 分布式锁 |

### 18.2 锁机制设计

#### 18.2.1 乐观锁（Optimistic Lock）

**原理**：假设冲突很少发生，只在提交时检查冲突

```typescript
// 乐观锁实现
interface OptimisticLock {
  version: number
  update(id: string, data: UpdateData, expectedVersion: number): Promise<boolean>
}

// 数据库实现
class DatabaseOptimisticLock implements OptimisticLock {
  async update(id: string, data: UpdateData, expectedVersion: number): Promise<boolean> {
    const result = await this.db.query(`
      UPDATE users
      SET name = $1, email = $2, version = version + 1
      WHERE id = $3 AND version = $4
    `, [data.name, data.email, id, expectedVersion])
    return result.rowCount > 0
  }
}
```

**适用场景**：读多写少、冲突概率低、需要高并发

#### 18.2.2 悲观锁（Pessimistic Lock）

**原理**：假设冲突经常发生，先加锁再操作

```typescript
// 悲观锁实现
interface PessimisticLock {
  acquire(key: string, timeout?: number): Promise<boolean>
  release(key: string): Promise<void>
  isLocked(key: string): Promise<boolean>
}

// Redis 实现
class RedisPessimisticLock implements PessimisticLock {
  async acquire(key: string, timeout: number = 30): Promise<boolean> {
    const result = await this.redis.set(
      `lock:${key}`,
      process.pid.toString(),
      'EX',
      timeout,
      'NX'
    )
    return result === 'OK'
  }
}
```

**适用场景**：写多读少、冲突概率高、需要强一致性

#### 18.2.3 分布式锁（Distributed Lock）

**原理**：在分布式系统中实现锁机制

```typescript
// 分布式锁接口
interface DistributedLock {
  acquire(key: string, options?: LockOptions): Promise<LockHandle>
  release(handle: LockHandle): Promise<void>
  renew(handle: LockHandle): Promise<boolean>
}

// Redlock 实现
class RedlockDistributedLock implements DistributedLock {
  async acquire(key: string, options?: LockOptions): Promise<LockHandle> {
    const timeout = options?.timeout || 30
    const value = `${process.pid}:${Date.now()}:${Math.random()}`
    
    const result = await this.redis.set(
      `lock:${key}`,
      value,
      'EX',
      timeout,
      'NX'
    )
    
    if (result === 'OK') {
      return { key, value, acquiredAt: Date.now(), expiresAt: Date.now() + timeout * 1000 }
    }
    
    throw new Error('Failed to acquire lock')
  }
}
```

**适用场景**：分布式系统、多节点并发、需要强一致性

### 18.3 事务处理

#### 18.3.1 数据库事务

```typescript
// 事务接口
interface Transaction {
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  execute<T>(operation: () => Promise<T>): Promise<T>
}

// PostgreSQL 事务实现
class PostgreSQLTransaction implements Transaction {
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.db.query('BEGIN')
    
    try {
      const result = await operation()
      await this.db.query('COMMIT')
      return result
    } catch (error) {
      await this.db.query('ROLLBACK')
      throw error
    }
  }
}
```

#### 18.3.2 隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 性能 |
|---------|------|-----------|------|------|
| **READ UNCOMMITTED** | ✅ | ✅ | ✅ | 最高 |
| **READ COMMITTED** | ❌ | ✅ | ✅ | 高 |
| **REPEATABLE READ** | ❌ | ❌ | ✅ | 中 |
| **SERIALIZABLE** | ❌ | ❌ | ❌ | 低 |

**推荐**：`REPEATABLE READ`（平衡一致性与性能）

### 18.4 连接池管理

```typescript
// 连接池配置
interface PoolConfig {
  min: number           // 最小连接数
  max: number           // 最大连接数
  idleTimeout: number   // 空闲超时（毫秒）
  connectionTimeout: number  // 连接超时（毫秒）
  maxLifetime: number   // 最大生命周期（毫秒）
}

// PostgreSQL 连接池
const poolConfig: PoolConfig = {
  min: 5,
  max: 20,
  idleTimeout: 30000,
  connectionTimeout: 5000,
  maxLifetime: 1800000
}
```

### 18.5 异步处理

#### 18.5.1 异步任务队列

```typescript
// 异步任务接口
interface AsyncTask {
  id: string
  type: string
  payload: any
  status: 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: Date
  completedAt?: Date
  error?: string
}

// 异步队列
class AsyncTaskQueue {
  async enqueue(task: Omit<AsyncTask, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const id = generateId()
    
    // 保存到数据库
    await this.db.query(`
      INSERT INTO async_tasks (id, type, payload, status, created_at)
      VALUES ($1, $2, $3, 'pending', NOW())
    `, [id, task.type, JSON.stringify(task.payload)])
    
    // 发送到消息队列
    await this.mq.publish('async_tasks', { id, ...task })
    
    return id
  }
  
  async process(taskId: string, handler: (payload: any) => Promise<void>): Promise<void> {
    await this.db.query(`
      UPDATE async_tasks SET status = 'processing' WHERE id = $1
    `, [taskId])
    
    try {
      const task = await this.db.query(`
        SELECT * FROM async_tasks WHERE id = $1
      `, [taskId])
      
      await handler(JSON.parse(task.payload))
      
      await this.db.query(`
        UPDATE async_tasks
        SET status = 'completed', completed_at = NOW()
        WHERE id = $1
      `, [taskId])
    } catch (error) {
      await this.db.query(`
        UPDATE async_tasks
        SET status = 'failed', error = $2
        WHERE id = $1
      `, [taskId, error.message])
    }
  }
}
```

### 18.6 并发安全

#### 18.6.1 竞态条件防护

```typescript
// 竞态条件防护
class RaceConditionProtection {
  async preventDuplicate<T>(
    key: string,
    operation: () => Promise<T>,
    ttl: number = 60
  ): Promise<T> {
    const lockKey = `race:${key}`
    const acquired = await this.lock.acquire(lockKey, { timeout: ttl })
    
    if (!acquired) {
      throw new Error('Duplicate operation detected')
    }
    
    try {
      return await operation()
    } finally {
      await this.lock.release({ key: lockKey, value: '', acquiredAt: 0, expiresAt: 0 })
    }
  }
}
```

#### 18.6.2 死锁防护

```typescript
// 死锁防护
class DeadlockProtection {
  // 按固定顺序获取锁
  async acquireLocksInOrder(keys: string[]): Promise<LockHandle[]> {
    const sortedKeys = [...keys].sort()
    const handles: LockHandle[] = []
    
    for (const key of sortedKeys) {
      const handle = await this.lock.acquire(key)
      handles.push(handle)
    }
    
    return handles
  }
}
```

### 18.7 配置示例

```yaml
# config.yaml
concurrency:
  # 连接池
  pool:
    database:
      min: 5
      max: 20
      idle_timeout: 30000
      connection_timeout: 5000
    redis:
      min: 5
      max: 20
      idle_timeout: 30000
  
  # 锁机制
  lock:
    optimistic:
      enabled: true
      version_field: version
    pessimistic:
      enabled: true
      timeout: 30
      retry_count: 3
      retry_delay: 100
    distributed:
      enabled: true
      timeout: 30
      retry_count: 3
      retry_delay: 100
  
  # 事务
  transaction:
    isolation_level: REPEATABLE_READ
    timeout: 30000
  
  # 异步任务
  async_tasks:
    enabled: true
    max_concurrent: 10
    retry_count: 3
    retry_delay: 1000
```

---
