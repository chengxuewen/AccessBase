# @accessbase/identity — 软件设计文档（SDD）

> **包名**：`@accessbase/identity`
> **版本**：0.1.0（设计阶段）
> **层级**：L0 基石层
> **最后更新**：2026-08-21

---

## 1. 包概述

### 1.1 定位

`@accessbase/identity` 是 AccessBase 基石层的核心包，负责**认证（Authentication）**与**授权（Authorization）**两大安全基础能力。它是所有 L0/L1/L2 应用的安全入口，任何需要"谁能进来、能干什么"的平台都必须依赖此包。

### 1.2 职责范围

| 能力     | 说明                                           | 对应接口            |
| -------- | ---------------------------------------------- | ------------------- |
| 认证     | 密码、OAuth、WebAuthn、LDAP、OIDC 多种认证方式 | `AuthProvider`      |
| 用户管理 | 用户 CRUD、状态管理、租户隔离                  | `UserManager`       |
| 角色管理 | RBAC1 角色继承、租户级角色                     | `RoleManager`       |
| 权限管理 | 权限 CRUD、角色-权限关联                       | `PermissionManager` |
| 会话管理 | JWT 生命周期、Refresh Token 轮转、SSO 会话     | `SessionManager`    |
| MFA      | TOTP 多因素认证、可信设备机制                  | `MfaManager`        |

### 1.3 设计原则

- **配置驱动 + 可插拔**：认证方式通过配置声明启用，代码实现可插拔的 Provider 接口
- **零平台概念**：不依赖 Schema 引擎、插件体系等 L1 特性
- **租户隔离**：所有数据操作自动附加租户过滤
- **安全优先**：JWT RS256、密码 bcrypt、Token 轮转、RBAC 权限即时生效

### 1.4 技术栈

| 技术                 | 用途                                |
| -------------------- | ----------------------------------- |
| Fastify              | HTTP 框架，路由注册与请求处理       |
| Drizzle ORM          | 数据库访问，类型安全的 Schema 定义  |
| PostgreSQL 16        | 主存储（用户、角色、权限、会话）    |
| Redis                | Token 缓存、会话缓存、RBAC 失效广播 |
| jsonwebtoken (RS256) | JWT 签发与验证                      |
| bcrypt               | 密码哈希                            |
| i18next              | 错误消息国际化                      |

---

## 2. 核心接口

### 2.1 AuthProvider — 认证提供商接口

**设计原则**：可插拔架构，每种认证方式实现统一接口，由 `AuthManager` 统一管理。

```typescript
interface AuthProvider {
  /** 提供商标识名（如 'password', 'github', 'webauthn'） */
  name: string;

  /** 提供商类型 */
  type: 'password' | 'oauth' | 'webauthn' | 'saml' | 'oidc';

  /** 是否启用（配置驱动） */
  enabled: boolean;

  /** 执行认证，返回认证结果 */
  authenticate(credentials: unknown): Promise<AuthResult>;

  /** 用户注册（可选，OAuth 等方式可能不需要） */
  register?(userData: unknown): Promise<AuthResult>;

  /** Token 验证（可选） */
  verify?(token: string): Promise<VerifyResult>;
}

interface AuthResult {
  success: boolean;
  user?: User;
  accessToken?: string;
  refreshToken?: string;
  requiresMfa?: boolean;
  error?: AuthError;
}

interface VerifyResult {
  valid: boolean;
  user?: User;
  error?: AuthError;
}
```

**内置提供商**：

| 提供商             | type     | 说明                                                |
| ------------------ | -------- | --------------------------------------------------- |
| `PasswordProvider` | password | 邮箱+密码登录，支持密码策略、域名限制、邮箱别名过滤 |
| `OAuthProvider`    | oauth    | GitHub/Discord/Telegram/LinuxDO/微信 等 OAuth 2.0   |
| `WebAuthnProvider` | webauthn | 通行密钥（Passkey）认证                             |
| `OIDCProvider`     | oidc     | 标准 OpenID Connect 协议                            |
| `LdapProvider`     | oidc     | LDAP/AD SSO，Admin Bind 模式，自动供给+属性同步     |

**AuthManager**：

```typescript
class AuthManager {
  private providers: Map<string, AuthProvider>;

  /** 注册认证提供商 */
  register(provider: AuthProvider): void;

  /** 获取所有启用的提供商列表 */
  getEnabledProviders(): AuthProvider[];

  /** 按提供商名称执行认证 */
  authenticate(providerName: string, credentials: unknown): Promise<AuthResult>;

  /** 获取前端可用提供商配置（脱敏） */
  getPublicProviderConfigs(): ProviderPublicConfig[];
}
```

---

### 2.2 UserManager — 用户管理接口

```typescript
interface UserManager {
  /** 创建用户（自动哈希密码、分配默认角色） */
  create(data: CreateUserInput, tenantId: string): Promise<User>;

  /** 按 ID 查询用户（租户隔离） */
  findById(id: string, tenantId: string): Promise<User | null>;

  /** 按邮箱查询用户（全局，用于登录） */
  findByEmail(email: string): Promise<User | null>;

  /** 分页查询用户列表 */
  findAll(params: UserQueryParams, tenantId: string): Promise<PaginatedResult<User>>;

  /** 更新用户信息 */
  update(id: string, data: UpdateUserInput, tenantId: string): Promise<User>;

  /** 删除用户（软删除 / 硬删除） */
  delete(id: string, tenantId: string): Promise<void>;

  /** 变更用户状态（active / suspended / pending） */
  changeStatus(id: string, status: UserStatus, tenantId: string): Promise<User>;

  /** 验证密码 */
  verifyPassword(email: string, password: string): Promise<User>;

  /** 重置密码（通过重置 Token） */
  resetPassword(token: string, newPassword: string): Promise<void>;

  /** 发送邮箱验证 */
  sendEmailVerification(userId: string): Promise<void>;

  /** 验证邮箱 */
  verifyEmail(token: string): Promise<User>;
}

interface CreateUserInput {
  email: string;
  name: string;
  password?: string; // OAuth 用户可能无密码
  avatarUrl?: string;
  roles?: string[]; // 角色 ID 列表
  metadata?: Record<string, unknown>;
}

interface UpdateUserInput {
  name?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

type UserStatus = 'active' | 'suspended' | 'pending';

interface UserQueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string; // 搜索邮箱/名称
  status?: UserStatus;
  roleId?: string;
}
```

---

### 2.3 RoleManager — 角色管理接口

```typescript
interface RoleManager {
  /** 创建角色（租户级） */
  create(data: CreateRoleInput, tenantId: string): Promise<Role>;

  /** 按 ID 查询角色 */
  findById(id: string, tenantId: string): Promise<Role | null>;

  /** 查询角色列表 */
  findAll(params: RoleQueryParams, tenantId: string): Promise<PaginatedResult<Role>>;

  /** 更新角色 */
  update(id: string, data: UpdateRoleInput, tenantId: string): Promise<Role>;

  /** 删除角色（禁止删除系统角色） */
  delete(id: string, tenantId: string): Promise<void>;

  /** 设置角色继承关系 */
  setParent(roleId: string, parentId: string | null, tenantId: string): Promise<Role>;

  /** 解析角色继承链（含父角色权限） */
  resolveInheritedPermissions(roleId: string, tenantId: string): Promise<Permission[]>;

  /** 为用户分配角色 */
  assignToUser(userId: string, roleId: string, tenantId: string): Promise<void>;

  /** 撤销用户角色 */
  revokeFromUser(userId: string, roleId: string, tenantId: string): Promise<void>;

  /** 查询用户在指定租户下的所有角色（含继承） */
  getUserRoles(userId: string, tenantId: string): Promise<Role[]>;
}

interface CreateRoleInput {
  name: string;
  description?: string;
  parentId?: string; // 父角色 ID（RBAC1 继承）
  permissionIds?: string[]; // 初始权限列表
}

interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissionIds?: string[]; // 全量替换权限列表
}

interface RoleQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  parentId?: string;
}
```

**RBAC1 继承规则**：

- 子角色自动继承父角色的所有权限
- 继承链深度无限制，但需防环（A→B→A）
- 权限解析为扁平化合并（子权限 ∪ 父权限）

---

### 2.4 PermissionManager — 权限管理接口

```typescript
interface PermissionManager {
  /** 创建权限定义 */
  create(data: CreatePermissionInput): Promise<Permission>;

  /** 查询所有权限定义 */
  findAll(params?: PermissionQueryParams): Promise<PaginatedResult<Permission>>;

  /** 按 ID 查询 */
  findById(id: string): Promise<Permission | null>;

  /** 更新权限 */
  update(id: string, data: UpdatePermissionInput): Promise<Permission>;

  /** 删除权限（若被角色引用则禁止） */
  delete(id: string): Promise<void>;

  /** 查询用户的有效权限列表（含角色继承） */
  getUserEffectivePermissions(userId: string, tenantId: string): Promise<Permission[]>;

  /** 检查用户是否拥有指定权限 */
  hasPermission(userId: string, permission: string, tenantId: string): Promise<boolean>;

  /** 批量检查权限 */
  hasPermissions(
    userId: string,
    permissions: string[],
    tenantId: string,
  ): Promise<Map<string, boolean>>;

  /** 为角色设置权限（全量替换） */
  setRolePermissions(roleId: string, permissionIds: string[]): Promise<void>;
}

interface CreatePermissionInput {
  name: string;
  resource: string; // 资源标识，如 'users', 'roles', 'config'
  action: string; // 操作标识，如 'read', 'write', 'delete', 'manage'
  description?: string;
}

interface UpdatePermissionInput {
  name?: string;
  description?: string;
}

interface PermissionQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  resource?: string;
  action?: string;
}
```

**权限命名规范**：`{resource}:{action}`（如 `users:read`, `roles:manage`）

---

### 2.5 SessionManager — 会话管理接口

```typescript
interface SessionManager {
  /** 创建会话（签发 Access Token + Refresh Token） */
  createSession(user: User, context: SessionContext): Promise<SessionTokens>;

  /** 验证 Access Token */
  verifyAccessToken(token: string): Promise<TokenPayload>;

  /** 刷新 Token（轮转机制：旧 Refresh Token 失效，签发新对） */
  refreshTokens(refreshToken: string): Promise<SessionTokens>;

  /** 撤销会话（登出） */
  revokeSession(sessionId: string): Promise<void>;

  /** 撤销用户所有会话（安全事件） */
  revokeAllSessions(userId: string): Promise<number>;

  /** 查询用户活跃会话列表 */
  getUserSessions(userId: string): Promise<Session[]>;

  /** 创建 SSO 会话 */
  createSSOSession(userId: string, idpId: string): Promise<SSOSession>;

  /** 创建本地会话（绑定 SSO 会话） */
  createLocalSession(userId: string, ssoSessionId: string, tenantId: string): Promise<LocalSession>;

  /** 校验本地会话有效性（含 SSO 会话级联检查） */
  validateSession(localSessionId: string): Promise<SessionValidation>;

  /** 单点登出（SLO） */
  singleLogout(userId: string, ssoSessionId: string): Promise<void>;
}

interface SessionTokens {
  accessToken: string; // RS256 签名，15 分钟有效期
  refreshToken: string; // 7 天有效期，可配置
  expiresIn: number; // Access Token 过期秒数
}

interface TokenPayload {
  sub: string; // 用户 ID
  email: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  tokenVersion: number; // 用于 RBAC 失效检查
  iat: number;
  exp: number;
}

interface SessionContext {
  ipAddress: string;
  userAgent: string;
  deviceInfo?: DeviceInfo;
  tenantId: string;
}

interface SessionValidation {
  valid: boolean;
  reason?:
    | 'session_not_found'
    | 'idle_timeout'
    | 'absolute_timeout'
    | 'sso_session_expired'
    | 'sso_idle_timeout';
}

interface SSOSession {
  id: string;
  userId: string;
  identityProviderId: string;
  createdAt: Date;
  lastActivityAt: Date;
  idleTimeout: number; // 默认 1800s（30 分钟）
  absoluteTimeout: number; // 默认 28800s（8 小时）
  expiresAt: Date;
  status: 'active' | 'expired' | 'revoked';
}

interface LocalSession {
  id: string;
  userId: string;
  ssoSessionId: string; // 绑定的 SSO 会话
  tenantId: string;
  createdAt: Date;
  lastActivityAt: Date;
  idleTimeout: number;
  absoluteTimeout: number;
  expiresAt: Date; // ≤ SSO 会话过期时间
  status: 'active' | 'expired' | 'revoked';
}
```

**JWT 策略**：

| 参数                 | 值             | 说明                                  |
| -------------------- | -------------- | ------------------------------------- |
| Access Token 有效期  | 15 分钟        | 短生命周期，安全性高                  |
| Refresh Token 有效期 | 7 天           | 可配置，平衡安全与体验                |
| Token 轮转           | 启用           | 每次刷新时轮转，防止重放攻击          |
| 签名算法             | RS256          | 非对称加密，公钥可安全分发            |
| Token 存储           | Redis + 数据库 | Redis 快速验证 + 数据库 token_version |

---

### 2.6 MfaManager — 多因素认证接口

```typescript
interface MfaManager {
  /** 为用户启用 MFA（生成 TOTP 密钥 + 恢复码） */
  enable(userId: string): Promise<MfaSetupResult>;

  /** 确认 MFA 启用（用户输入 TOTP 验证码确认） */
  confirm(userId: string, code: string): Promise<void>;

  /** 禁用 MFA（需验证当前密码） */
  disable(userId: string, password: string): Promise<void>;

  /** 验证 MFA 代码 */
  verify(userId: string, code: string): Promise<MfaVerifyResult>;

  /** 使用恢复码（MFA 设备丢失时） */
  verifyRecoveryCode(userId: string, code: string): Promise<MfaVerifyResult>;

  /** 重新生成恢复码（旧恢复码作废） */
  regenerateRecoveryCodes(userId: string): Promise<string[]>;

  /** 检查设备是否可信 */
  isTrustedDevice(userId: string, deviceFingerprint: string): Promise<boolean>;

  /** 信任当前设备 */
  trustDevice(
    userId: string,
    deviceFingerprint: string,
    metadata: DeviceMetadata,
  ): Promise<TrustedDevice>;

  /** 撤销单个可信设备 */
  revokeTrustedDevice(userId: string, deviceId: string): Promise<void>;

  /** 撤销所有可信设备（安全事件） */
  revokeAllTrustedDevices(userId: string): Promise<number>;
}

interface MfaSetupResult {
  secret: string; // TOTP 密钥（Base32）
  qrCodeUrl: string; // otpauth:// URI
  recoveryCodes: string[]; // 一次性恢复码（8 位，共 10 个）
}

interface MfaVerifyResult {
  success: boolean;
  remainingRecoveryCodes?: number;
  error?: AuthError;
}

interface TrustedDevice {
  id: string;
  userId: string;
  deviceFingerprint: string;
  deviceName: string;
  trustGrantedAt: Date;
  trustExpiresAt: Date; // 默认 30 天
  lastUsedAt: Date;
  ipAddress: string;
  userAgent: string;
  revoked: boolean;
}

interface DeviceMetadata {
  deviceName: string;
  ipAddress: string;
  userAgent: string;
}
```

**MFA 认证流程**：

```
用户登录（密码通过）
    ↓
检查设备是否可信
    ├─ 可信 → 直接进入系统
    └─ 不可信 → 触发 MFA 验证
           ├─ 输入 TOTP 验证码 → 验证通过
           └─ 输入恢复码 → 验证通过
           ↓
        弹窗：「是否信任此设备？」
        ├─ 是 → 存储可信设备（30 天）→ 进入系统
        └─ 否 → 进入系统（下次仍需 MFA）
```

---

## 3. 生命周期钩子

### 3.1 Fastify 插件生命周期

`@accessbase/identity` 以 Fastify 插件形式注册，利用 Fastify 生命周期钩子完成初始化和清理。

```typescript
// 注册入口
export default fp(async function identityPlugin(fastify, opts) {
  // === 阶段 1：依赖注入 ===
  const identityService = new IdentityService({
    db: fastify.db,
    redis: fastify.redis,
    config: opts.config,
  });

  // === 阶段 2：提供商注册 ===
  identityService.authManager.register(new PasswordProvider(config.password));
  identityService.authManager.register(new OAuthProvider(config.github, 'github'));
  // ... 按配置注册其他提供商

  // === 阶段 3：装饰器注入 ===
  fastify.decorate('identity', identityService);

  // === 阶段 4：请求钩子 ===
  fastify.addHook('onRequest', authenticateHook);
  fastify.addHook('preHandler', authorizeHook);
  fastify.addHook('onResponse', auditHook);

  // === 阶段 5：路由注册 ===
  fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  fastify.register(userRoutes, { prefix: '/api/v1/users' });
  fastify.register(roleRoutes, { prefix: '/api/v1/roles' });
  fastify.register(permissionRoutes, { prefix: '/api/v1/permissions' });

  // === 阶段 6：RBAC 传播订阅 ===
  identityService.rbacPropagation.subscribeInvalidation();
});
```

### 3.2 请求生命周期钩子

| 钩子         | 时机       | 行为                                                  |
| ------------ | ---------- | ----------------------------------------------------- |
| `onRequest`  | 请求进入时 | 从 Authorization header 提取 JWT，注入 `request.user` |
| `preHandler` | 路由处理前 | 检查 `request.user` 是否拥有当前路由所需权限          |
| `onResponse` | 响应发送后 | 审计日志记录（写操作）                                |

### 3.3 认证钩子详细流程

```typescript
// onRequest：认证
async function authenticateHook(request, reply) {
  // 1. 跳过公开路由（login, register, health 等）
  if (isPublicRoute(request.url)) return;

  // 2. 提取 Bearer Token
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    return reply.status(401).send({ error: 'AUTH_001', message: 'Missing token' });
  }

  // 3. 验证 JWT 签名和过期时间
  const payload = await sessionManager.verifyAccessToken(token);

  // 4. 检查 token_version（RBAC 失效）
  const user = await userManager.findById(payload.sub, payload.tenantId);
  if (user.tokenVersion !== payload.tokenVersion) {
    return reply.status(401).send({ error: 'AUTH_003', message: 'Token invalidated' });
  }

  // 5. 注入用户上下文
  request.user = payload;
}

// preHandler：授权
async function authorizeHook(request, reply) {
  if (isPublicRoute(request.url)) return;

  const requiredPermission = getRequiredPermission(request.method, request.url);
  if (!requiredPermission) return;

  const hasPermission = await permissionManager.hasPermission(
    request.user.sub,
    requiredPermission,
    request.user.tenantId,
  );

  if (!hasPermission) {
    return reply.status(403).send({ error: 'AUTH_007', message: 'Insufficient permissions' });
  }
}
```

### 3.4 RBAC 权限变更传播

当角色权限发生变更时，所有受影响用户的会话**立即失效**：

```
角色权限变更
    ↓
查询受影响用户列表
    ↓
批量递增 token_version（数据库）
    ↓
清除 Redis 中的会话/权限缓存
    ↓
通过 Redis Pub/Sub 通知所有实例
    ↓
各实例清除本地权限缓存
    ↓
受影响用户的下次请求 → token_version 不匹配 → 401 → 强制重新登录
```

---

## 4. 依赖关系

### 4.1 包依赖图

```
@accessbase/identity
    ├── @accessbase/logging      （日志记录，结构化日志 + 请求追踪）
    ├── @accessbase/audit        （审计日志，认证/授权事件记录）
    ├── @accessbase/i18n         （国际化，错误消息翻译）
    ├── @accessbase/migration    （数据库迁移，Schema 变更管理）
    ├── @accessbase/config       （配置管理，运行时配置读取）
    ├── fastify                  （HTTP 框架）
    ├── drizzle-orm              （数据库 ORM）
    ├── ioredis                  （Redis 客户端）
    ├── jsonwebtoken             （JWT 签发/验证）
    ├── bcrypt                   （密码哈希）
    ├── zod                      （输入验证 Schema）
    └── @simplewebauthn/server   （WebAuthn 服务端）
```

### 4.2 数据库表依赖

| 表名                 | 用途                    | 关系                       |
| -------------------- | ----------------------- | -------------------------- |
| `users`              | 用户主表                | 租户隔离                   |
| `roles`              | 角色表                  | 租户隔离，自引用 parent_id |
| `permissions`        | 权限定义表              | 全局（不按租户隔离）       |
| `user_roles`         | 用户-角色关联           | 租户隔离，三元主键         |
| `role_permissions`   | 角色-权限关联           | 全局                       |
| `sessions`           | 会话表（Refresh Token） | 关联 users                 |
| `oauth_accounts`     | OAuth 账户关联          | 关联 users                 |
| `mfa_recovery_codes` | MFA 恢复码              | 关联 users                 |
| `trusted_devices`    | 可信设备                | 关联 users                 |
| `tenants`            | 租户表                  | 被 users/roles 引用        |

### 4.3 Redis 依赖

| Key 模式                    | 用途                   | TTL     |
| --------------------------- | ---------------------- | ------- |
| `session:{userId}`          | 用户会话缓存           | 15 分钟 |
| `permissions:{userId}`      | 用户权限缓存           | 5 分钟  |
| `mfa:attempts:{userId}`     | MFA 尝试次数（防暴力） | 15 分钟 |
| `password:attempts:{email}` | 密码尝试次数（防暴力） | 15 分钟 |
| `email:verify:{token}`      | 邮箱验证 Token         | 24 小时 |
| `password:reset:{token}`    | 密码重置 Token         | 1 小时  |

### 4.4 事件发布

`@accessbase/identity` 在关键操作时发布事件，供其他包监听：

| 事件                           | 触发时机      | 消费者              |
| ------------------------------ | ------------- | ------------------- |
| `user.created`                 | 用户注册/创建 | audit, notification |
| `user.updated`                 | 用户信息变更  | audit               |
| `user.deleted`                 | 用户删除      | audit               |
| `user.statusChanged`           | 用户状态变更  | audit, notification |
| `auth.login`                   | 登录成功      | audit               |
| `auth.loginFailed`             | 登录失败      | audit, security     |
| `auth.logout`                  | 登出          | audit               |
| `role.permissionChanged`       | 角色权限变更  | session（触发失效） |
| `mfa.enabled` / `mfa.disabled` | MFA 状态变更  | audit               |
| `session.revoked`              | 会话撤销      | audit               |

---

## 5. 错误码体系

### 5.1 错误码范围

`@accessbase/identity` 使用 **AUTH_001 ~ AUTH_099** 错误码范围。

### 5.2 错误码定义

#### 认证错误（AUTH_001 ~ AUTH_019）

| 错误码     | HTTP | 错误标识                   | 说明                                       | 用户提示                 |
| ---------- | ---- | -------------------------- | ------------------------------------------ | ------------------------ |
| `AUTH_001` | 401  | `MISSING_TOKEN`            | 请求未携带 Authorization header            | 请先登录                 |
| `AUTH_002` | 401  | `INVALID_TOKEN`            | JWT 签名无效或格式错误                     | 登录状态异常，请重新登录 |
| `AUTH_003` | 401  | `TOKEN_EXPIRED`            | Access Token 已过期或 token_version 不匹配 | 登录已过期，请重新登录   |
| `AUTH_004` | 401  | `REFRESH_TOKEN_INVALID`    | Refresh Token 无效（已过期/已撤销/已轮转） | 登录已过期，请重新登录   |
| `AUTH_005` | 401  | `REFRESH_TOKEN_EXPIRED`    | Refresh Token 已过期                       | 登录已过期，请重新登录   |
| `AUTH_006` | 403  | `ACCOUNT_SUSPENDED`        | 用户账户已停用                             | 账户已停用，请联系管理员 |
| `AUTH_007` | 403  | `INSUFFICIENT_PERMISSIONS` | 用户无权执行该操作                         | 权限不足，无法执行此操作 |
| `AUTH_008` | 401  | `INVALID_CREDENTIALS`      | 邮箱或密码错误                             | 邮箱或密码错误           |
| `AUTH_009` | 401  | `EMAIL_NOT_VERIFIED`       | 邮箱未验证                                 | 请先验证邮箱             |
| `AUTH_010` | 403  | `ACCOUNT_LOCKED`           | 密码错误次数过多，账户已锁定               | 账户已锁定，请稍后再试   |

#### MFA 错误（AUTH_020 ~ AUTH_029）

| 错误码     | HTTP | 错误标识                       | 说明                 | 用户提示                 |
| ---------- | ---- | ------------------------------ | -------------------- | ------------------------ |
| `AUTH_020` | 401  | `MFA_REQUIRED`                 | 需要 MFA 验证        | 请输入验证码             |
| `AUTH_021` | 401  | `MFA_INVALID_CODE`             | TOTP 验证码无效      | 验证码错误，请重试       |
| `AUTH_022` | 401  | `MFA_INVALID_RECOVERY_CODE`    | 恢复码无效           | 恢复码错误               |
| `AUTH_023` | 400  | `MFA_ALREADY_ENABLED`          | MFA 已启用           | 双因素认证已启用         |
| `AUTH_024` | 400  | `MFA_NOT_ENABLED`              | MFA 未启用           | 双因素认证未启用         |
| `AUTH_025` | 400  | `MFA_SETUP_NOT_CONFIRMED`      | MFA 设置未确认       | 请先完成双因素认证设置   |
| `AUTH_026` | 429  | `MFA_RATE_LIMITED`             | MFA 验证尝试次数过多 | 验证次数过多，请稍后再试 |
| `AUTH_027` | 400  | `TRUSTED_DEVICE_LIMIT_REACHED` | 可信设备数量达上限   | 可信设备数量已达上限     |
| `AUTH_028` | 400  | `TRUSTED_DEVICE_NOT_FOUND`     | 可信设备不存在       | 设备未找到               |

#### 用户管理错误（AUTH_030 ~ AUTH_039）

| 错误码     | HTTP | 错误标识                       | 说明                | 用户提示                   |
| ---------- | ---- | ------------------------------ | ------------------- | -------------------------- |
| `AUTH_030` | 409  | `USER_ALREADY_EXISTS`          | 邮箱已注册          | 该邮箱已注册               |
| `AUTH_031` | 404  | `USER_NOT_FOUND`               | 用户不存在          | 用户不存在                 |
| `AUTH_032` | 400  | `INVALID_EMAIL_FORMAT`         | 邮箱格式无效        | 请输入有效的邮箱地址       |
| `AUTH_033` | 400  | `EMAIL_DOMAIN_BLOCKED`         | 邮箱域名被禁止      | 该邮箱域名不被允许         |
| `AUTH_034` | 400  | `EMAIL_ALIAS_BLOCKED`          | 邮箱别名被禁止      | 请使用真实邮箱地址         |
| `AUTH_035` | 400  | `PASSWORD_TOO_WEAK`            | 密码不符合策略要求  | 密码强度不足               |
| `AUTH_036` | 400  | `PASSWORD_REUSE`               | 新密码与旧密码相同  | 新密码不能与旧密码相同     |
| `AUTH_037` | 400  | `INVALID_PASSWORD_RESET_TOKEN` | 密码重置 Token 无效 | 重置链接无效或已过期       |
| `AUTH_038` | 400  | `EMAIL_VERIFICATION_EXPIRED`   | 邮箱验证 Token 过期 | 验证链接已过期，请重新发送 |

#### 角色/权限错误（AUTH_040 ~ AUTH_049）

| 错误码     | HTTP | 错误标识                    | 说明                             | 用户提示                   |
| ---------- | ---- | --------------------------- | -------------------------------- | -------------------------- |
| `AUTH_040` | 409  | `ROLE_ALREADY_EXISTS`       | 角色名已存在（同租户下）         | 该角色名已存在             |
| `AUTH_041` | 404  | `ROLE_NOT_FOUND`            | 角色不存在                       | 角色不存在                 |
| `AUTH_042` | 400  | `SYSTEM_ROLE_DELETE`        | 禁止删除系统内置角色             | 系统角色不可删除           |
| `AUTH_043` | 400  | `ROLE_INHERITANCE_CYCLE`    | 角色继承形成环                   | 角色继承关系存在循环       |
| `AUTH_044` | 400  | `ROLE_HAS_USERS`            | 角色下仍有用户，禁止删除         | 请先移除该角色下的所有用户 |
| `AUTH_045` | 409  | `PERMISSION_ALREADY_EXISTS` | 权限已存在（同 resource+action） | 该权限已存在               |
| `AUTH_046` | 404  | `PERMISSION_NOT_FOUND`      | 权限不存在                       | 权限不存在                 |
| `AUTH_047` | 400  | `PERMISSION_IN_USE`         | 权限被角色引用，禁止删除         | 请先从所有角色中移除该权限 |

#### 会话错误（AUTH_050 ~ AUTH_059）

| 错误码     | HTTP | 错误标识                | 说明                        | 用户提示               |
| ---------- | ---- | ----------------------- | --------------------------- | ---------------------- |
| `AUTH_050` | 404  | `SESSION_NOT_FOUND`     | 会话不存在                  | 会话不存在             |
| `AUTH_051` | 401  | `SESSION_EXPIRED`       | 会话已过期（空闲/绝对超时） | 会话已过期，请重新登录 |
| `AUTH_052` | 401  | `SSO_SESSION_EXPIRED`   | SSO 会话已过期              | 单点登录会话已过期     |
| `AUTH_053` | 400  | `MAX_SESSIONS_EXCEEDED` | 并发会话数超限              | 并发会话数已达上限     |

#### OAuth/OIDC/LDAP 错误（AUTH_060 ~ AUTH_069）

| 错误码     | HTTP | 错误标识                     | 说明                   | 用户提示             |
| ---------- | ---- | ---------------------------- | ---------------------- | -------------------- |
| `AUTH_060` | 400  | `OAUTH_STATE_MISMATCH`       | OAuth state 参数不匹配 | 登录请求无效，请重试 |
| `AUTH_061` | 400  | `OAUTH_CODE_INVALID`         | OAuth 授权码无效       | 授权码无效，请重试   |
| `AUTH_062` | 502  | `OAUTH_PROVIDER_ERROR`       | OAuth 提供商返回错误   | 第三方登录服务异常   |
| `AUTH_063` | 500  | `LDAP_CONNECTION_FAILED`     | LDAP 连接失败          | 目录服务连接失败     |
| `AUTH_064` | 401  | `LDAP_AUTH_FAILED`           | LDAP 认证失败          | LDAP 认证失败        |
| `AUTH_065` | 500  | `LDAP_ATTRIBUTE_SYNC_FAILED` | LDAP 属性同步失败      | 属性同步失败         |

#### WebAuthn 错误（AUTH_070 ~ AUTH_079）

| 错误码     | HTTP | 错误标识                         | 说明             | 用户提示         |
| ---------- | ---- | -------------------------------- | ---------------- | ---------------- |
| `AUTH_070` | 400  | `WEBAUTHN_REGISTRATION_FAILED`   | Passkey 注册失败 | Passkey 注册失败 |
| `AUTH_071` | 400  | `WEBAUTHN_AUTHENTICATION_FAILED` | Passkey 认证失败 | Passkey 认证失败 |
| `AUTH_072` | 400  | `WEBAUTHN_INVALID_ORIGIN`        | 来源不匹配       | 安全验证失败     |

### 5.3 错误响应格式

```typescript
interface AuthErrorResponse {
  success: false;
  error: {
    code: string; // 'AUTH_001' ~ 'AUTH_099'
    message: string; // 用户可读的国际化消息
    details?: unknown; // 附加信息（仅开发环境返回）
  };
  requestId: string; // 请求追踪 ID
}
```

---

## 6. 配置项

### 6.1 配置结构

```typescript
interface IdentityConfig {
  auth: {
    password: PasswordConfig;
    jwt: JwtConfig;
    mfa: MfaConfig;
    oauth: Record<string, OAuthProviderConfig>;
    webauthn: WebAuthnConfig;
    ldap: LdapConfig;
    rbacPropagation: RbacPropagationConfig;
    sso: SsoConfig;
    rateLimit: RateLimitConfig;
  };
}
```

### 6.2 各模块配置详情

#### JWT 配置

```typescript
interface JwtConfig {
  /** Access Token 有效期（秒），默认 900（15 分钟） */
  accessTokenTTL: number;

  /** Refresh Token 有效期（秒），默认 604800（7 天） */
  refreshTokenTTL: number;

  /** 是否启用 Token 轮转，默认 true */
  tokenRotation: boolean;

  /** RSA 私钥路径（RS256 签名） */
  privateKeyPath: string;

  /** RSA 公钥路径（RS256 验证） */
  publicKeyPath: string;

  /** 签发者标识 */
  issuer: string;
}
```

#### 密码策略配置

```typescript
interface PasswordConfig {
  enabled: boolean;

  /** 最小长度，默认 8 */
  minLength: number;

  /** 要求大写字母，默认 true */
  requireUppercase: boolean;

  /** 要求小写字母，默认 true */
  requireLowercase: boolean;

  /** 要求数字，默认 true */
  requireNumbers: boolean;

  /** 要求特殊字符，默认 false */
  requireSpecialChars: boolean;

  /** 是否要求邮箱验证，默认 true */
  requireEmailVerification: boolean;

  /** 允许的邮箱域名列表（空=不限制） */
  allowedDomains: string[];

  /** 禁止的邮箱域名列表 */
  blockedDomains: string[];

  /** 禁止邮箱别名（如 user+tag@gmail.com），默认 true */
  blockEmailAliases: boolean;

  /** 密码哈希轮次，默认 12 */
  bcryptRounds: number;

  /** 密码历史检查（禁止最近 N 个密码重复），默认 5 */
  passwordHistoryCount: number;

  /** 账户锁定阈值（连续失败次数），默认 5 */
  lockoutThreshold: number;

  /** 账户锁定时间（秒），默认 900（15 分钟） */
  lockoutDuration: number;
}
```

#### MFA 配置

```typescript
interface MfaConfig {
  /** 是否启用 MFA，默认 true */
  enabled: boolean;

  /** TOTP 参数 */
  totp: {
    /** 有效期（秒），默认 30 */
    period: number;

    /** 位数，默认 6 */
    digits: number;

    /** 算法，默认 'SHA1' */
    algorithm: 'SHA1' | 'SHA256' | 'SHA512';

    /** 容忍窗口（前后各几个周期），默认 1 */
    window: number;
  };

  /** 可信设备配置 */
  trustedDevices: {
    enabled: boolean;
    trustWindowDays: number; // 默认 30
    maxTrustedDevices: number; // 默认 10
    requireMfaToTrust: boolean; // 默认 true
  };

  /** 恢复码配置 */
  recoveryCodes: {
    count: number; // 默认 10
    length: number; // 默认 8
  };
}
```

#### OAuth 提供商配置

```typescript
interface OAuthProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  callbackUrl: string;
  authorizationUrl?: string; // OIDC 自定义
  tokenUrl?: string;
  userInfoUrl?: string;
}
```

#### WebAuthn 配置

```typescript
interface WebAuthnConfig {
  enabled: boolean;
  rpName: string; // 人类可读名称
  rpId: string; // 有效域
  origin: string; // 允许的来源
  authenticatorSelection: {
    authenticatorAttachment: 'platform' | 'cross-platform';
    userVerification: 'required' | 'preferred' | 'discouraged';
    residentKey: 'required' | 'preferred' | 'discouraged';
  };
  attestation: 'none' | 'indirect' | 'direct';
}
```

#### LDAP 配置

```typescript
interface LdapConfig {
  enabled: boolean;

  /** 服务器地址 */
  url: string;

  /** Admin Bind DN */
  bindDN: string;

  /** Admin Bind 密码（加密存储） */
  bindPassword: string;

  /** 用户搜索基础 DN */
  searchBase: string;

  /** 用户搜索过滤器 */
  searchFilter: string;

  /** 属性映射 */
  attributeMapping: {
    uid: string; // 默认 'userId'
    mail: string; // 默认 'email'
    cn: string; // 默认 'displayName'
    department: string; // 默认 'department'
    sAMAccountName?: string; // AD 特有
  };

  /** 自动供给（首次登录自动创建本地用户），默认 true */
  autoProvision: boolean;

  /** 属性同步（每次登录同步），默认 true */
  syncAttributes: boolean;

  /** 加密方案，默认 'AES-256-GCM' */
  encryptionScheme: string;

  /** LDAP 失败时降级到本地密码，默认 false */
  fallbackToLocal: boolean;
}
```

#### RBAC 传播配置

```typescript
interface RbacPropagationConfig {
  enabled: boolean;

  /** Redis Pub/Sub 频道名，默认 'rbac:invalidation' */
  channel: string;

  /** 本地权限缓存 TTL（秒），默认 300 */
  localCacheTTL: number;

  /** 批量递增批次大小，默认 1000 */
  batchSize: number;
}
```

#### SSO 会话配置

```typescript
interface SsoConfig {
  session: {
    /** 空闲超时（秒），默认 1800（30 分钟） */
    idleTimeout: number;

    /** 绝对超时（秒），默认 28800（8 小时） */
    absoluteTimeout: number;

    /** 最大并发会话数，默认 10 */
    maxSessionsPerUser: number;

    /** 单点登出，默认 true */
    singleLogoutEnabled: boolean;

    /** 租户级覆盖 */
    tenantOverrides?: Record<
      string,
      {
        idleTimeout?: number;
        absoluteTimeout?: number;
      }
    >;
  };
}
```

#### 限流配置

```typescript
interface RateLimitConfig {
  /** 登录接口限流（次/分钟），默认 10 */
  login: number;

  /** 注册接口限流（次/分钟），默认 5 */
  register: number;

  /** 密码重置限流（次/小时），默认 3 */
  passwordReset: number;

  /** MFA 验证限流（次/分钟），默认 5 */
  mfaVerify: number;
}
```

### 6.3 完整配置示例

```yaml
# config.yaml — identity 模块配置
auth:
  password:
    enabled: true
    minLength: 8
    requireUppercase: true
    requireLowercase: true
    requireNumbers: true
    requireSpecialChars: false
    requireEmailVerification: true
    allowedDomains: [] # 空=不限制
    blockEmailAliases: true
    bcryptRounds: 12
    lockoutThreshold: 5
    lockoutDuration: 900

  jwt:
    accessTokenTTL: 900
    refreshTokenTTL: 604800
    tokenRotation: true
    privateKeyPath: ${JWT_PRIVATE_KEY_PATH}
    publicKeyPath: ${JWT_PUBLIC_KEY_PATH}
    issuer: accessbase

  mfa:
    enabled: true
    totp:
      period: 30
      digits: 6
      algorithm: SHA1
      window: 1
    trustedDevices:
      enabled: true
      trustWindowDays: 30
      maxTrustedDevices: 10
      requireMfaToTrust: true
    recoveryCodes:
      count: 10
      length: 8

  github:
    enabled: true
    clientId: ${GITHUB_CLIENT_ID}
    clientSecret: ${GITHUB_CLIENT_SECRET}
    scopes: ['user:email']
    callbackUrl: https://example.com/oauth/github

  webauthn:
    enabled: true
    rpName: AccessBase
    rpId: example.com
    origin: https://example.com
    authenticatorSelection:
      userVerification: preferred

  ldap:
    enabled: false
    url: ldap://ldap.example.com:389
    bindDN: cn=admin,dc=example,dc=com
    bindPassword: ${LDAP_BIND_PASSWORD}
    searchBase: ou=users,dc=example,dc=com
    searchFilter: (|(uid={{username}})(mail={{username}}))
    autoProvision: true
    syncAttributes: true
    fallbackToLocal: false

  rbacPropagation:
    enabled: true
    channel: rbac:invalidation
    localCacheTTL: 300
    batchSize: 1000

  sso:
    session:
      idleTimeout: 1800
      absoluteTimeout: 28800
      maxSessionsPerUser: 10
      singleLogoutEnabled: true

  rateLimit:
    login: 10
    register: 5
    passwordReset: 3
    mfaVerify: 5
```

---

## 附录

### A. 关联文档

| 文档                            | 说明                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `docs/modules/core-packages.md` | §10 核心包详细设计（JWT 策略、RBAC 模型、LDAP SSO）                         |
| `docs/modules/auth-provider.md` | §12 认证提供商架构（完整 Provider 实现、RBAC 传播、MFA 可信设备、SSO 会话） |
| `docs/modules/database.md`      | §22 数据库 Schema 设计（核心表结构、索引策略）                              |
| `docs/modules/api.md`           | §23 API 设计规范（RESTful 端点定义）                                        |
| `docs/modules/security.md`      | §19+§25+§29+§36 安全全量设计                                                |
| `.agents/memorys/decisions.md`  | 设计决策记录（D1-D80）                                                      |

### B. 数据库 Schema 速查

```sql
-- 核心表（详见 docs/modules/database.md）
users (id, email, name, password_hash, avatar_url, email_verified, mfa_enabled, mfa_secret, status, tenant_id, token_version, ...)
roles (id, name, description, tenant_id, parent_id, is_system, ...)
permissions (id, name, resource, action, description)
user_roles (user_id, role_id, tenant_id)
role_permissions (role_id, permission_id)
sessions (id, user_id, refresh_token_hash, device_info, ip_address, expires_at, revoked_at, ...)
oauth_accounts (id, user_id, provider, provider_account_id, access_token, refresh_token, ...)
mfa_recovery_codes (id, user_id, code_hash, used, used_at, ...)
```
