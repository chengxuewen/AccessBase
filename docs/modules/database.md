# 数据库 Schema 设计

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§22 数据库 Schema 设计

---

## 22. 数据库 Schema 设计

### 22.1 核心表结构

```sql
-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255),
  avatar_url VARCHAR(500),
  email_verified BOOLEAN DEFAULT FALSE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  mfa_secret VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

-- 角色表
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  parent_id UUID REFERENCES roles(id),  -- 角色继承
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, tenant_id)
);

-- 权限表
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description TEXT,
  UNIQUE(resource, action)
);

-- 用户-角色关联表
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (user_id, role_id, tenant_id)
);

-- 角色-权限关联表
CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 租户表
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 审计日志表
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(255),
  request_body JSONB,
  response_status INTEGER,
  ip_address INET,
  user_agent TEXT,
  tenant_id UUID REFERENCES tenants(id),
  request_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会话表（Refresh Token 持久化）
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  device_info JSONB,
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth 账户关联表
CREATE TABLE oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_account_id)
);

-- MFA 恢复码表
CREATE TABLE mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 22.2 索引策略

```sql
-- 用户表索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_status ON users(status);

-- 角色表索引
CREATE INDEX idx_roles_tenant ON roles(tenant_id);
CREATE INDEX idx_roles_parent ON roles(parent_id);

-- 审计日志索引
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);

-- 会话表索引
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- OAuth 账户索引
CREATE INDEX idx_oauth_accounts_user ON oauth_accounts(user_id);
CREATE INDEX idx_oauth_accounts_provider ON oauth_accounts(provider, provider_account_id);
```

### 22.3 多租户数据隔离

```typescript
// Drizzle ORM 租户隔离
import { sql } from 'drizzle-orm'

// 所有查询自动附加租户过滤
function withTenantFilter(tenantId: string) {
  return sql`${table.tenant_id} = ${tenantId}`
}

// 使用示例
const users = await db
  .select()
  .from(usersTable)
  .where(withTenantFilter(request.tenantId))
```

---

### 22.4 审计日志保留策略

审计日志是合规和安全调查的关键数据，但无限期保留会导致存储成本激增。本节定义各类型日志的保留周期和自动化清理机制。

#### 保留周期

| 日志类型 | 保留周期 | 说明 |
|----------|----------|------|
| 审计日志（audit_logs） | 1 年 | 满足等保三级、ISO 27001 等合规要求 |
| 登录历史（login_history） | 90 天 | 账户安全审计，异常登录追踪 |
| 会话数据（sessions） | 过期后 7 天 | 过期后保留用于异常分析，超期自动清理 |

#### 自动化清理机制

通过定时任务（cron）自动执行清理，避免人工干预：

```sql
-- 审计日志：删除超过 1 年的记录
DELETE FROM audit_logs
WHERE created_at < NOW() - INTERVAL '1 year';

-- 登录历史：删除超过 90 天的记录
DELETE FROM login_history
WHERE created_at < NOW() - INTERVAL '90 days';

-- 会话数据：删除过期超过 7 天的记录
DELETE FROM sessions
WHERE expires_at < NOW() - INTERVAL '7 days';
```

#### 归档策略

清理前先将数据迁移至冷存储，确保数据可追溯：

1. **导出阶段**：按月分区导出为 Parquet 格式，压缩后上传至对象存储（S3/MinIO）
2. **校验阶段**：对导出文件计算 SHA-256 哈希，记录至归档元数据表
3. **删除阶段**：校验通过后执行数据库清理
4. **保留元数据**：归档索引表（archive_index）记录归档时间范围和存储位置，支持按需检索

```sql
-- 归档索引表
CREATE TABLE archive_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  archive_month DATE NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  record_count INTEGER NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_archive_table ON archive_index(table_name, archive_month);
```

#### Cron 调度配置

| 任务 | Cron 表达式 | 执行时间 |
|------|------------|----------|
| 审计日志清理 | `0 3 1 * *` | 每月 1 日凌晨 3:00 |
| 登录历史清理 | `0 3 * * 0` | 每周日凌晨 3:00 |
| 会话数据清理 | `0 2 * * *` | 每日凌晨 2:00 |

> **注意事项**：清理任务应在业务低峰期执行，建议使用批量删除（每批 1000 条）避免长时间锁表影响在线业务。
