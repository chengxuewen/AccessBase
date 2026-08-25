# @accessbase/migration 软件设计文档 (SDD)

> 本文档基于 [`core-packages.md`](./core-packages.md) §10.6 和 [`database.md`](./database.md) §22 生成。

---

## 1. 包概述

`@accessbase/migration` 是 AccessBase 的数据库迁移管理包，基于 Drizzle ORM 构建，提供三阶段迁移机制、CLI 工具和迁移安全保障。

### 1.1 核心职责

- 管理数据库 Schema 变更的版本控制
- 支持三阶段迁移（preload → postsync → postload）
- 提供 CLI 工具执行迁移、回滚和状态查看
- 确保迁移过程的数据安全和并发控制

### 1.2 技术选型

| 技术   | 选择          | 理由                                   |
| ------ | ------------- | -------------------------------------- |
| ORM    | Drizzle ORM   | TypeScript 原生、轻量级、SQL-like 语法 |
| 数据库 | PostgreSQL 16 | 企业级、JSONB 支持、扩展丰富           |
| CLI    | Commander.js  | 成熟的 Node.js CLI 框架                |

---

## 2. 核心接口

### 2.1 迁移文件接口

```typescript
/**
 * 迁移阶段枚举
 */
export type MigrationPhase = 'preload' | 'postsync' | 'postload';

/**
 * 迁移文件接口
 */
export interface MigrationFile {
  /** 迁移版本号（如 001、002） */
  version: string;
  /** 迁移名称 */
  name: string;
  /** 迁移阶段 */
  phase: MigrationPhase;
  /** 执行迁移 */
  up(db: Database): Promise<void>;
  /** 回滚迁移 */
  down(db: Database): Promise<void>;
}

/**
 * 数据库连接接口
 */
export interface Database {
  /** 执行 SQL 语句 */
  execute(sql: string): Promise<void>;
  /** 查询数据 */
  query<T>(sql: string): Promise<T[]>;
  /** 获取表信息 */
  getTableInfo(tableName: string): Promise<TableInfo>;
}
```

### 2.2 迁移管理器接口

```typescript
/**
 * 迁移状态
 */
export interface MigrationStatus {
  /** 迁移版本 */
  version: string;
  /** 迁移名称 */
  name: string;
  /** 迁移阶段 */
  phase: MigrationPhase;
  /** 执行状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 执行时间 */
  executedAt?: Date;
  /** 执行耗时（毫秒） */
  duration?: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 迁移管理器接口
 */
export interface MigrationManager {
  /** 执行所有待执行的迁移 */
  up(): Promise<void>;
  /** 回滚最近一次迁移 */
  down(): Promise<void>;
  /** 回滚到指定版本 */
  downTo(version: string): Promise<void>;
  /** 获取迁移状态 */
  status(): Promise<MigrationStatus[]>;
  /** 生成迁移文件 */
  generate(name: string): Promise<string>;
  /** 验证迁移文件 */
  validate(): Promise<ValidationResult>;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误列表 */
  errors: ValidationError[];
  /** 警告列表 */
  warnings: ValidationWarning[];
}
```

### 2.3 CLI 接口

```bash
# 执行迁移
npx accessbase-migrate up [options]

# 回滚迁移
npx accessbase-migrate down [options]

# 查看迁移状态
npx accessbase-migrate status

# 生成迁移文件
npx accessbase-migrate generate <name> [options]

# 验证迁移文件
npx accessbase-migrate validate
```

---

## 3. 生命周期钩子

### 3.1 迁移执行生命周期

```typescript
/**
 * 迁移生命周期钩子
 */
export interface MigrationLifecycle {
  /** 迁移开始前 */
  onBeforeMigrate?: (version: string) => Promise<void>;
  /** 迁移完成后 */
  onAfterMigrate?: (version: string, duration: number) => Promise<void>;
  /** 迁移失败时 */
  onMigrateError?: (version: string, error: Error) => Promise<void>;
  /** 回滚开始前 */
  onBeforeRollback?: (version: string) => Promise<void>;
  /** 回滚完成后 */
  onAfterRollback?: (version: string) => Promise<void>;
  /** 备份开始前 */
  onBeforeBackup?: () => Promise<void>;
  /** 备份完成后 */
  onAfterBackup?: (backupPath: string) => Promise<void>;
}
```

### 3.2 阶段执行顺序

```
1. preload 阶段
   ├── 创建扩展（如 uuid-ossp）
   ├── 设置数据库参数
   └── 创建必要的类型或枚举

2. postsync 阶段（默认）
   ├── 创建表结构
   ├── 添加字段
   ├── 创建索引
   └── 添加约束

3. postload 阶段
   ├── 种子数据
   ├── 初始配置
   └── 索引优化
```

---

## 4. 依赖关系

### 4.1 外部依赖

| 依赖        | 版本    | 用途                  |
| ----------- | ------- | --------------------- |
| drizzle-orm | ^0.29.0 | ORM 核心              |
| drizzle-kit | ^0.20.0 | Schema 管理和迁移生成 |
| commander   | ^11.0.0 | CLI 框架              |
| pg          | ^8.11.0 | PostgreSQL 驱动       |
| dotenv      | ^16.3.0 | 环境变量加载          |

### 4.2 内部依赖

| 包                       | 用途         |
| ------------------------ | ------------ |
| @accessbase/shared-types | 共享类型定义 |
| @accessbase/logging      | 日志记录     |

### 4.3 依赖图

```
@accessbase/migration
├── @accessbase/shared-types
├── @accessbase/logging
├── drizzle-orm
├── drizzle-kit
├── commander
├── pg
└── dotenv
```

---

## 5. 错误码

### 5.1 迁移错误码

| 错误码  | 说明             | HTTP 状态码 |
| ------- | ---------------- | ----------- |
| MIG_001 | 迁移文件不存在   | 404         |
| MIG_002 | 迁移文件格式错误 | 400         |
| MIG_003 | 迁移执行失败     | 500         |
| MIG_004 | 回滚失败         | 500         |
| MIG_005 | 迁移锁获取失败   | 409         |
| MIG_006 | 数据库连接失败   | 503         |
| MIG_007 | 备份失败         | 500         |
| MIG_008 | 验证失败         | 400         |
| MIG_009 | 版本冲突         | 409         |
| MIG_010 | 超时             | 408         |

### 5.2 错误响应格式

```typescript
interface MigrationError {
  code: string;
  message: string;
  details?: {
    version?: string;
    phase?: MigrationPhase;
    sql?: string;
    stack?: string;
  };
}
```

---

## 6. 配置项

### 6.1 环境变量

| 变量名                   | 必需 | 默认值       | 说明                  |
| ------------------------ | ---- | ------------ | --------------------- |
| DATABASE_URL             | 是   | -            | PostgreSQL 连接字符串 |
| MIGRATIONS_DIR           | 否   | ./migrations | 迁移文件目录          |
| MIGRATIONS_TABLE         | 否   | _migrations  | 迁移状态表名          |
| MIGRATION_LOCK_TIMEOUT   | 否   | 30000        | 迁移锁超时（毫秒）    |
| MIGRATION_BACKUP_ENABLED | 否   | true         | 是否启用迁移前备份    |
| MIGRATION_BACKUP_DIR     | 否   | ./backups    | 备份文件目录          |
| MIGRATION_LOG_LEVEL      | 否   | info         | 日志级别              |

### 6.2 配置文件

```typescript
// migration.config.ts
export interface MigrationConfig {
  /** 数据库连接 */
  database: {
    url: string;
    ssl?: boolean;
    maxConnections?: number;
  };
  /** 迁移文件配置 */
  migrations: {
    directory: string;
    tableName: string;
    lockTimeout: number;
  };
  /** 备份配置 */
  backup: {
    enabled: boolean;
    directory: string;
    retentionDays: number;
  };
  /** 日志配置 */
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
}
```

### 6.3 drizzle.config.ts 配置

```typescript
// drizzle.config.ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/**/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
```

---

## 附录

### A. 迁移文件模板

```typescript
// migrations/001_create_users.ts
import { MigrationPhase, Database } from '@accessbase/migration';

export const phase: MigrationPhase = 'postsync';

export async function up(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function down(db: Database): Promise<void> {
  await db.execute('DROP TABLE IF EXISTS users');
}
```

### B. CLI 使用示例

```bash
# 执行所有待执行的迁移
npx accessbase-migrate up

# 回滚最近一次迁移
npx accessbase-migrate down

# 查看迁移状态
npx accessbase-migrate status

# 生成新的迁移文件
npx accessbase-migrate generate add_user_avatar --phase postsync

# 验证迁移文件
npx accessbase-migrate validate

# 回滚到指定版本
npx accessbase-migrate down --to 001

# 强制执行（跳过锁检查）
npx accessbase-migrate up --force

# 干运行（不实际执行）
npx accessbase-migrate up --dry-run
```
