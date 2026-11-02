# API 设计规范

> **Implementation status (2026-09-23 gap audit):** `partial` — envelope shipped; §23.10 API-key shape drift (A10); versioning/deprecation policy unwritten. Q1–Q4 surface (groups/webhooks/events/enroll-mfa/captcha/invite/device/sms endpoints) not yet written up — tracked in gap-audit round2 report H4; machine-readable current truth is `docs/openapi.json`. See [gap-audit](../superpowers/reports/2026-09-23-gap-audit.md).

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。

---

## Current surface (2026-11-02, hygiene-batch-v2 T4 / G11)

> **Generated inventory** — join of `docs/openapi.json` (methods/paths/summaries) × `packages/identity/src/hooks/authorize.ts` routePermissions (wire permission codes). Regenerate with `pnpm --filter @accessbase/server exec tsx ../../scripts/gen-api-inventory.mts` and replace the section below. `—` in the Permission column = no wire permission code (public/auth surfaces riding bearer-only semantics, per the route table's own design).

Generated 2026-11-02 from docs/openapi.json (methods/paths) × packages/identity/src/hooks/authorize.ts routePermissions (codes).
Regenerate: `pixi run npx tsx scripts/gen-api-inventory.mts >> docs/modules/api.md` (paste under this heading). Total paths: 104.

### /api/v1/audit-logs (3)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/audit-logs/` | audit:read | List audit logs (paginated, filterable) |
| GET | `/api/v1/audit-logs/export` | audit:read | Export audit logs as CSV (all rows matching list filters) |
| GET | `/api/v1/audit-logs/verify` | audit:read | Verify the audit tamper-evidence chain (platform tenant only; chainOk:false is still a 200 |

### /api/v1/auth (50)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| POST | `/api/v1/auth/api-keys/` | apikeys:write | Create an API key (plaintext revealed once) |
| GET | `/api/v1/auth/api-keys/` | apikeys:read | List API keys (no secret material) |
| DELETE | `/api/v1/auth/api-keys/{id}` | apikeys:delete | Revoke an API key |
| GET | `/api/v1/auth/captcha` | — | Fresh SVG captcha challenge (one-time, 5min) |
| GET | `/api/v1/auth/captcha/status` | — | Whether the local captcha challenge is active |
| POST | `/api/v1/auth/change-password` | — | Change password: verifies old, rejects last-5 reuse, revokes other sessions |
| POST | `/api/v1/auth/forgot-password` | — | Request password reset. Always succeeds regardless of account existence. |
| POST | `/api/v1/auth/ldap/login` | — | LDAP login |
| POST | `/api/v1/auth/login` | — | Password login |
| POST | `/api/v1/auth/logout` | — | Logout revokes the DB session when a refresh token is supplied |
| POST | `/api/v1/auth/magic/consume` | — | Consume a magic sign-in link token (or receive an MFA step-up). |
| POST | `/api/v1/auth/magic/request` | — | Request a magic sign-in link. Always succeeds regardless of account existence. |
| GET | `/api/v1/auth/me` | — | Get current user profile |
| POST | `/api/v1/auth/mfa/disable` | — | Disable MFA after password re-verification |
| POST | `/api/v1/auth/mfa/enable` | — | Confirm MFA enable with a TOTP code |
| POST | `/api/v1/auth/mfa/setup` | — | Start TOTP MFA setup: returns otpauth URL, QR and one-time recovery codes |
| POST | `/api/v1/auth/mfa/verify` | — | Verify MFA challenge and exchange flow token for a session |
| DELETE | `/api/v1/auth/oauth/{provider}` | — | Unlink an OAuth provider from the current user |
| GET | `/api/v1/auth/oauth/{provider}/authorize` | — |  |
| GET | `/api/v1/auth/oauth/{provider}/callback` | — |  |
| POST | `/api/v1/auth/oauth/backchannel-logout` | — |  |
| GET | `/api/v1/auth/oauth/end-session-url` | — | Resolve the generic OIDC end-session URL (id_token_hint) for the current user |
| POST | `/api/v1/auth/oauth/exchange` | — | Exchange OAuth one-time code for session tokens |
| GET | `/api/v1/auth/oauth/links` | — | List OAuth providers linked to the current user |
| GET | `/api/v1/auth/oauth/providers` | — | List configured OAuth provider names for the login page |
| POST | `/api/v1/auth/refresh` | — | Refresh access token |
| POST | `/api/v1/auth/register` | — | User registration |
| POST | `/api/v1/auth/reset-password` | — | Reset password with a flow token from forgot-password |
| POST | `/api/v1/auth/saml/acs` | — | SAML assertion consumer service (browser redirect channel) |
| POST | `/api/v1/auth/saml/exchange` | — | Exchange SAML one-time code for session tokens (or MFA step-up) |
| GET | `/api/v1/auth/saml/login` | — | Begin SAML SP-initiated login (redirect to the IdP) |
| GET | `/api/v1/auth/saml/logout` | — | Get the IdP single-logout URL for the authenticated SAML principal |
| GET | `/api/v1/auth/saml/metadata` | — | SAML SP metadata XML |
| GET | `/api/v1/auth/saml/slo` | — | SAML single logout endpoint (IdP-initiated LogoutRequest + SP-initiated LogoutResponse ret |
| POST | `/api/v1/auth/saml/slo` | — | SAML single logout endpoint, POST binding (same three arms as GET) |
| GET | `/api/v1/auth/saml/status` | — | Report whether SAML SP login is enabled |
| GET | `/api/v1/auth/sessions` | — | List active sessions for the current user (each item flagged current:true for the caller's |
| POST | `/api/v1/auth/sessions/revoke` | — | Revoke a single session belonging to the current user |
| POST | `/api/v1/auth/sessions/revoke-others` | — | Revoke all other sessions, keeping the one matching the supplied refresh token |
| POST | `/api/v1/auth/sms-otp/request` | — | Request an SMS OTP sign-in code. Always succeeds regardless of account existence. |
| POST | `/api/v1/auth/sms-otp/verify` | — | Verify an SMS OTP code (or receive an MFA step-up). |
| GET | `/api/v1/auth/sms/status` | — | Whether SMS OTP sign-in is configured (public gate probe). |
| POST | `/api/v1/auth/verify-email` | — | Consume an email-verification link token |
| POST | `/api/v1/auth/verify-email/request` | — | Send an email-verification link to the authenticated user |
| GET | `/api/v1/auth/webauthn/credentials` | — | List passkey credentials for the current user |
| DELETE | `/api/v1/auth/webauthn/credentials/{id}` | — | Delete a passkey credential owned by the current user |
| POST | `/api/v1/auth/webauthn/login/options` | — | Generate WebAuthn authentication options (discoverable credentials, D108) |
| POST | `/api/v1/auth/webauthn/login/verify` | — | Verify WebAuthn assertion and establish a session |
| POST | `/api/v1/auth/webauthn/register/options` | — | Generate WebAuthn registration options (passkey enrollment) |
| POST | `/api/v1/auth/webauthn/register/verify` | — | Verify WebAuthn registration response and store the credential |

### /api/v1/clients (4)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| POST | `/api/v1/clients` | clients:write | Register a new OIDC client (secret returned once) |
| GET | `/api/v1/clients` | clients:read | List registered OIDC clients (no secrets) |
| DELETE | `/api/v1/clients/{clientId}` | clients:write | Delete an OIDC client |
| POST | `/api/v1/clients/{clientId}/rotate-secret` | clients:write | Rotate client secret (new secret returned once) |

### /api/v1/email-templates (4)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/email-templates/email-templates` | options:read | List email templates (built-in defaults merged with stored overrides) |
| PUT | `/api/v1/email-templates/email-templates/{id}` | options:write | Store a template override (partial arms allowed; null-value clears) |
| POST | `/api/v1/email-templates/email-templates/{id}/preview` | options:write | Render a preview (stored + request-body overrides, sample vars; never sends) |
| POST | `/api/v1/email-templates/email-templates/{id}/test` | options:write | Send the stored template to a test address (fire-and-forget) |

### /api/v1/events (2)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/events/` | audit:read | List domain events (paginated, filterable) |
| GET | `/api/v1/events/{id}` | audit:read | Get one event by id |

### /api/v1/groups (10)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/groups/` | groups:read | List user groups with member/role counts |
| POST | `/api/v1/groups/` | groups:write | Create a group |
| GET | `/api/v1/groups/{id}` | groups:read | Get group by ID |
| PUT | `/api/v1/groups/{id}` | groups:write | Update a group |
| DELETE | `/api/v1/groups/{id}` | groups:delete | Delete a group (cascades membership + bindings) |
| GET | `/api/v1/groups/{id}/members` | groups:read | List group members |
| POST | `/api/v1/groups/{id}/members` | groups:write | Add a member (must belong to the group tenant) |
| DELETE | `/api/v1/groups/{id}/members/{userId}` | groups:delete | Remove a member |
| GET | `/api/v1/groups/{id}/roles` | groups:read | List bound role ids |
| PUT | `/api/v1/groups/{id}/roles` | groups:write | Replace role bindings (transaction; last-admin census guarded) |

### /api/v1/oidc (2)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/oidc/interaction/{uid}` | — | OIDC interaction details for the frontend login/consent pages |
| POST | `/api/v1/oidc/interaction/{uid}` | — | Approve or deny the OIDC interaction (login/consent step) |

### /api/v1/options (3)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/options` | options:read | List runtime options (sensitive keys masked) |
| PUT | `/api/v1/options` | options:write | Set a runtime option |
| DELETE | `/api/v1/options/{key}` | options:write | Delete a runtime option |

### /api/v1/permissions (1)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/permissions/` | permissions:read | List permissions (paginated) |

### /api/v1/roles (5)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/roles/` | roles:read | List roles (paginated) |
| POST | `/api/v1/roles/` | roles:write | Create a new role |
| GET | `/api/v1/roles/{id}` | roles:read | Get role by ID |
| PUT | `/api/v1/roles/{id}` | roles:write | Update role |
| DELETE | `/api/v1/roles/{id}` | roles:delete | Delete role |

### /api/v1/root (3)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/health/live` | — | Liveness probe |
| GET | `/health/ready` | — | Readiness probe |
| GET | `/health/startup` | — | Startup probe |

### /api/v1/scim (15)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/scim/v2/ResourceTypes` | — |  |
| GET | `/api/v1/scim/v2/Schemas` | — |  |
| GET | `/api/v1/scim/v2/ScimGroups` | — |  |
| POST | `/api/v1/scim/v2/ScimGroups` | — |  |
| GET | `/api/v1/scim/v2/ScimGroups/{id}` | — |  |
| PUT | `/api/v1/scim/v2/ScimGroups/{id}` | — |  |
| PATCH | `/api/v1/scim/v2/ScimGroups/{id}` | — |  |
| DELETE | `/api/v1/scim/v2/ScimGroups/{id}` | — |  |
| GET | `/api/v1/scim/v2/ServiceProviderConfig` | — |  |
| GET | `/api/v1/scim/v2/Users` | — |  |
| POST | `/api/v1/scim/v2/Users` | — |  |
| GET | `/api/v1/scim/v2/Users/{id}` | — |  |
| PUT | `/api/v1/scim/v2/Users/{id}` | — |  |
| DELETE | `/api/v1/scim/v2/Users/{id}` | — |  |
| PATCH | `/api/v1/scim/v2/Users/{id}` | — |  |

### /api/v1/setup (5)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| POST | `/api/v1/setup/admin` | — | Create initial admin user |
| GET | `/api/v1/setup/checks` | — | Run system environment checks |
| POST | `/api/v1/setup/complete` | — | Complete system setup |
| POST | `/api/v1/setup/config` | — | Save basic system configuration |
| GET | `/api/v1/setup/status` | — | Check system setup status |

### /api/v1/stats (1)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/stats` | stats:read | Dashboard statistics |

### /api/v1/tenants (6)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/tenants/` | tenants:read | List tenants (paginated) |
| POST | `/api/v1/tenants/` | tenants:write | Create a new tenant |
| GET | `/api/v1/tenants/{id}` | tenants:read | Get tenant by ID |
| PUT | `/api/v1/tenants/{id}` | tenants:write | Update tenant |
| DELETE | `/api/v1/tenants/{id}` | tenants:delete | Delete tenant (soft: suspends the tenant) |
| POST | `/api/v1/tenants/{id}/bootstrap` | tenants:write | Bootstrap a tenant: create its admin role and first administrator |

### /api/v1/users (12)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/users/` | users:read | List users (paginated) |
| POST | `/api/v1/users/` | users:write | Create a new user |
| GET | `/api/v1/users/{id}` | users:read | Get user by ID |
| PUT | `/api/v1/users/{id}` | users:write | Update user |
| DELETE | `/api/v1/users/{id}` | users:delete | Delete user (optional body {eraseAudit:true, legalBasis} triggers sanctioned audit erasure |
| POST | `/api/v1/users/{id}/force-logout` | users:write | Revoke all sessions for a user (force logout) |
| POST | `/api/v1/users/{id}/invite` | users:write | Send a set-password invitation email (72h single-use link) |
| POST | `/api/v1/users/{id}/reset-password` | users:write | Admin password reset (arms force-change, revokes sessions) |
| PATCH | `/api/v1/users/{id}/status` | users:write | Change user status |
| GET | `/api/v1/users/export` | users:read | Export users as CSV |
| POST | `/api/v1/users/import` | users:write | Import users (two-phase: dry-run report, then commit) |
| GET | `/api/v1/users/me` | users:read | Get current user profile |

### /api/v1/webhooks (7)

| Method | Path | Permission | Summary |
|--------|------|------------|---------|
| GET | `/api/v1/webhooks/` | webhooks:read |  |
| POST | `/api/v1/webhooks/` | webhooks:write |  |
| PUT | `/api/v1/webhooks/{id}` | webhooks:write |  |
| DELETE | `/api/v1/webhooks/{id}` | webhooks:write |  |
| GET | `/api/v1/webhooks/{id}/deliveries` | webhooks:read |  |
| POST | `/api/v1/webhooks/{id}/ping` | webhooks:write |  |
| POST | `/api/v1/webhooks/{id}/rotate-secret` | webhooks:write |  |



> 原始章节：§23 API 设计规范

---

## 23. API 设计规范

### 23.1 RESTful API 标准

| 方法   | 路径                     | 说明     | 示例                     |
| ------ | ------------------------ | -------- | ------------------------ |
| GET    | `/api/v1/{resource}`     | 列表查询 | GET /api/v1/users        |
| GET    | `/api/v1/{resource}/:id` | 单个查询 | GET /api/v1/users/123    |
| POST   | `/api/v1/{resource}`     | 创建     | POST /api/v1/users       |
| PUT    | `/api/v1/{resource}/:id` | 全量更新 | PUT /api/v1/users/123    |
| PATCH  | `/api/v1/{resource}/:id` | 部分更新 | PATCH /api/v1/users/123  |
| DELETE | `/api/v1/{resource}/:id` | 删除     | DELETE /api/v1/users/123 |

### 23.2 API 版本控制

```typescript
// URL 路径版本控制
// /api/v1/users
// /api/v2/users

fastify.register(
  async (v1) => {
    v1.get('/users', getUsersV1);
    v1.post('/users', createUserV1);
  },
  { prefix: '/api/v1' },
);

fastify.register(
  async (v2) => {
    v2.get('/users', getUsersV2);
    v2.post('/users', createUserV2);
  },
  { prefix: '/api/v2' },
);
```

### 23.3 分页标准

```typescript
// 请求参数
interface PaginationParams {
  page?: number; // 页码（默认 1）
  pageSize?: number; // 每页数量（默认 20，最大 100）
  sortBy?: string; // 排序字段
  sortOrder?: 'asc' | 'desc'; // 排序方向
}

// 响应格式
interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

### 23.4 OpenAPI/Swagger 文档

```typescript
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

fastify.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'AccessBase API',
      description: 'AccessBase 基石层 API 文档',
      version: '1.0.0',
    },
    servers: [
      { url: 'http://localhost:5101', description: '开发环境' },
      { url: 'https://api.example.com', description: '生产环境' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
});

fastify.register(fastifySwaggerUi, {
  routePrefix: '/docs',
});
```

### 23.5 核心 API 端点

| 模块   | 端点                                    | 方法           | 说明          |
| ------ | --------------------------------------- | -------------- | ------------- |
| 认证   | `/api/v1/auth/login`                    | POST           | 密码登录      |
| 认证   | `/api/v1/auth/logout`                   | POST           | 登出          |
| 认证   | `/api/v1/auth/refresh`                  | POST           | 刷新令牌      |
| 认证   | `/api/v1/auth/oauth/:provider`          | GET            | OAuth 授权    |
| 认证   | `/api/v1/auth/oauth/:provider/callback` | GET            | OAuth 回调    |
| 认证   | `/api/v1/auth/mfa/enable`               | POST           | 启用 MFA      |
| 认证   | `/api/v1/auth/mfa/verify`               | POST           | 验证 MFA      |
| 用户   | `/api/v1/users`                         | GET/POST       | 用户列表/创建 |
| 用户   | `/api/v1/users/:id`                     | GET/PUT/DELETE | 用户 CRUD     |
| 用户   | `/api/v1/users/me`                      | GET            | 当前用户信息  |
| 角色   | `/api/v1/roles`                         | GET/POST       | 角色列表/创建 |
| 角色   | `/api/v1/roles/:id`                     | GET/PUT/DELETE | 角色 CRUD     |
| 角色   | `/api/v1/roles/:id/permissions`         | PUT            | 角色权限      |
| 权限   | `/api/v1/permissions`                   | GET            | 权限列表      |
| 审计   | `/api/v1/audit-logs`                    | GET            | 审计日志查询  |
| 审计   | `/api/v1/audit-logs/export`             | GET            | 审计日志导出  |
| 租户   | `/api/v1/tenants`                       | GET/POST       | 租户列表/创建 |
| 租户   | `/api/v1/tenants/:id`                   | GET/PUT/DELETE | 租户 CRUD     |
| 许可证 | `/api/v1/license`                       | GET            | 许可证信息    |
| 许可证 | `/api/v1/license/install`               | POST           | 安装许可证    |
| 健康   | `/health/live`                          | GET            | 存活探针      |
| 健康   | `/health/ready`                         | GET            | 就绪探针      |
| 文档   | `/docs`                                 | GET            | Swagger UI    |

---

### 23.10 API Key 格式规范

API Key 用于服务间通信和第三方集成认证。

#### 格式

```
ab_<32位字母数字随机串>
```

示例：`ab_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

- 固定前缀 `ab_`（AccessBase 标识）
- 后续 32 位随机字母数字（a-z、0-9）
- 总共 35 个字符

#### 存储

- 数据库中仅存储 SHA-256 哈希值，原始密钥永不持久化
- 创建时一次性展示完整密钥，之后无法再次查看
- 支持密钥哈希轮转（重新生成）

#### 作用域

API Key 支持细粒度权限作用域，限制密钥可调用的资源范围：

```typescript
interface ApiKeyScope {
  resource: string; // 资源路径，如 'users', 'roles:*'
  actions: string[]; // 允许的操作，如 ['read', 'write']
}

interface ApiKey {
  id: string;
  name: string; // 密钥名称（便于管理）
  prefix: string; // 前缀（ab_），用于识别密钥类型
  hash: string; // SHA-256 哈希
  scopes: ApiKeyScope[]; // 权限作用域
  expiresAt?: Date; // 可选过期时间
  rateLimit?: number; // 可选每秒请求上限
  createdAt: Date;
  lastUsedAt?: Date;
  enabled: boolean;
}
```

#### 过期时间

- 支持设置可选的过期时间戳
- 过期密钥自动失效，返回 401
- 创建时未设置过期时间视为永不过期

#### 速率限制

- 支持按密钥设置独立的速率限制
- 超出限制返回 429 Too Many Requests
- 默认值由全局配置决定，密钥级别设置可覆盖全局

---
