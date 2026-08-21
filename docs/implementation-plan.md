# AccessBase 实施计划

> **状态**: 设计定稿完成（v3.0），等待启动实施
> **更新日期**: 2026-08-21
> **预计工期**: 14 周（3.5 个月）
> **最小可用版本**: v0.1.0（含 identity + admin + audit 基础能力）

---

## 1. 项目总览

### 1.1 项目目标

AccessBase 是面向"任何需要后台管理与安全治理的平台"的可复用基石层（L0），提供认证、授权、审计、日志、迁移、国际化、主题机制、基础 CRUD 八项能力。

核心交付目标：
- 8 个 L0 包通过 `@accessbase/*` npm scope 独立发布
- 任何平台（MediaServo、MES、企业应用平台等）可直接依赖，无需 L1/L2 层
- 认证+授权+审计作为安全底座，覆盖 OWASP 基础要求
- 后台管理框架开箱即用，支持品牌注入和主题定制

### 1.2 技术栈确认

| 层级 | 组件 | 选择 | 版本要求 |
|------|------|------|---------|
| 后端 | Web 框架 | Fastify | ≥5.0 |
| 后端 | ORM | Drizzle ORM | ≥0.35 |
| 后端 | 数据库 | PostgreSQL | 16 |
| 后端 | 缓存 | Redis | ≥7.0 |
| 前端 | 框架 | React | ≥19.0 |
| 前端 | UI 组件库 | Ant Design | ≥5.0 |
| 前端 | 构建工具 | Vite | ≥6.0 |
| 前端 | 状态管理 | Zustand | ≥5.0 |
| 前端 | 路由 | React Router | ≥7.0 |
| 基础 | 包管理 | pnpm (workspace) | ≥9.0 |
| 基础 | 语言 | TypeScript (strict) | ≥5.6 |
| 基础 | 测试 | Vitest + Playwright | 最新 |
| 后端 | 日志 | pino | ≥9.0 |
| 前端 | 国际化 | i18next + react-i18next | 最新 |
| 后端 | 认证 | jsonwebtoken (RS256) | 最新 |
| 后端 | 密码 | bcrypt | 最新 |

### 1.3 设计文档索引

| 类别 | 文档 | 内容 |
|------|------|------|
| 架构概述 | `docs/modules/overview.md` | §1-§7 需求/定义/架构/迁移映射 |
| 技术选型 | `docs/modules/tech-stack.md` | §9 后端+前端技术栈 |
| 核心包设计 | `docs/modules/core-packages.md` | §10 八个 L0 包详细设计 |
| 数据库 Schema | `docs/modules/database.md` | §22 核心表结构 |
| API 规范 | `docs/modules/api.md` | §23 RESTful 约定 |
| UI 设计 | `docs/modules/ui.md` | §14+§37 布局/导航/组件/页面 |
| 安全设计 | `docs/modules/security.md` | §19+§25+§29+§36 安全全量 |
| 测试策略 | `docs/modules/testing.md` | §30 测试框架与覆盖要求 |
| CI/CD | `docs/modules/cicd.md` | §31 持续集成与部署 |
| 认证架构 | `docs/modules/auth-provider.md` | §12 OAuth/WebAuthn/LDAP/OIDC |
| 监控告警 | `docs/modules/monitoring.md` | §13 APM/指标/告警 |
| 分布式 | `docs/modules/distributed.md` | §11 集群/消息/一致性 |
| 错误处理 | `docs/modules/error-handling.md` | §20 统一错误码体系 |
| 秘钥管理 | `docs/modules/secret-mgmt.md` | §28 密钥管理方案 |
| 国际化 | `docs/modules/i18n.md` | §35 i18n 架构 |
| 设计决策 | `.agents/memorys/decisions.md` | D1-D95 共 95 项决策及理由 |

**SDD（软件设计文档）**:

| 包名 | SDD 路径 |
|------|---------|
| `@accessbase/identity` | `docs/modules/identity-sdd.md`（1171 行） |
| `@accessbase/admin` | `docs/modules/admin-sdd.md`（1126 行） |
| `@accessbase/audit` | `docs/modules/audit-sdd.md` |
| `@accessbase/logging` | `docs/modules/logging-sdd.md` |
| `@accessbase/i18n` | `docs/modules/i18n-sdd.md` |
| `@accessbase/migration` | `docs/modules/migration-sdd.md` |
| `@accessbase/health-check` | `docs/modules/health-check-sdd.md` |
| `@accessbase/shared-types` | `docs/modules/shared-types-sdd.md` |

---

## 2. 实施阶段划分

### Phase 0: 基础设施搭建（Week 1-2）

目标：建立可立即开始编码的开发环境。

#### 2.0.1 Monorepo 初始化

**产出**: 可用的 pnpm workspace 项目骨架

| 任务 | 说明 | 验收标准 |
|------|------|---------|
| 创建根 `package.json` | `name: "accessbase-monorepo"`, `private: true`, 声明 `pnpm-workspace.yaml` | `pnpm install` 成功，无报错 |
| 创建 `pnpm-workspace.yaml` | 声明 `packages: ["packages/*"]` | `pnpm ls --depth 0` 列出所有 workspace 项目 |
| 创建 8 个包目录 | `packages/{shared-types,logging,i18n,migration,identity,audit,health-check,admin}` | 每个包有独立 `package.json`（含 `name: "@accessbase/xxx"`, `version: "0.1.0"`, `main`/`types` 字段） |
| 配置 `tsconfig.json` | 根 tsconfig（strict mode）+ 每包 tsconfig 引用根配置 | `tsc --noEmit` 全量通过 |
| 配置 npm scope | 所有包 `publishConfig.access: "public"`，scope `@accessbase` | `pnpm publish --dry-run` 每个包可发布 |

**目录结构**:
```
packages/
├── shared-types/    → src/index.ts (类型导出)
├── logging/         → src/index.ts (pino 封装)
├── i18n/            → src/index.ts (i18next 封装)
├── migration/       → src/index.ts (Drizzle 迁移)
├── identity/        → src/{auth,user,role,permission,session,mfa}.ts
├── audit/           → src/index.ts (审计钩子)
├── health-check/    → src/index.ts (健康检查)
└── admin/           → src/{components,hooks,stores,theme}.tsx
```

#### 2.0.2 开发环境配置

**产出**: `docker-compose.yml` 可一键启动开发环境

| 任务 | 说明 | 验收标准 |
|------|------|---------|
| PostgreSQL 16 容器 | 端口映射 5432，持久化 volume，`listen_addresses='*'` | `psql -h localhost -p 5432 -U postgres` 可连接 |
| Redis 容器 | 端口映射 6379，AOF 持久化 | `redis-cli -h localhost -p 6379 ping` 返回 PONG |
| 开发数据库初始化 | 创建 `accessbase_dev` 数据库和 `accessbase_test` 数据库 | 两个库均存在且可连接 |
| 环境变量模板 | `.env.example` 列出所有必需变量（DATABASE_URL, REDIS_URL, JWT_SECRET 等） | `cp .env.example .env` 后开发环境可运行 |

#### 2.0.3 CI/CD 基础

**产出**: GitHub Actions 工作流可触发

| 任务 | 说明 | 验收标准 |
|------|------|---------|
| TypeScript 检查工作流 | `pnpm install` → `tsc --noEmit`（全包） | push 到 main/PR 时自动运行，类型错误阻塞合并 |
| 测试工作流 | Vitest 单元测试 + 覆盖率报告 | push 时自动运行，覆盖率 < 80% 标记警告 |
| Lint 工作流 | ESLint + Prettier 检查 | 格式/规范错误阻塞合并 |
| Docker 构建验证 | `docker build` 可成功构建生产镜像 | 镜像 < 200MB，可启动并响应 health check |

#### 2.0.4 代码规范工具

**产出**: 统一的代码风格和规范

| 任务 | 说明 | 验收标准 |
|------|------|---------|
| ESLint 配置 | `eslint.config.ts`（flat config）：TypeScript + React + Import 规则 | `eslint packages/` 无报错 |
| Prettier 配置 | `.prettierrc`：单引号、分号、2 空格缩进、尾逗号 always | `prettier --check packages/` 通过 |
| EditorConfig | `.editorconfig`：UTF-8、LF 换行、缩进规则 | 所有编辑器使用统一配置 |
| Git Hooks | `husky` + `lint-staged`：commit 前自动 `tsc --noEmit` + `eslint --fix` + `prettier --write` | `git commit` 触发 pre-commit 检查 |
| 包特定规则 | 每个 L0 包的 `tsconfig.json` 引用根配置，strict 模式 | 禁止 `as any`、`@ts-ignore`、`@ts-expect-error` |

#### 2.0.5 测试框架搭建

**产出**: 测试基础设施可运行

| 任务 | 说明 | 验收标准 |
|------|------|---------|
| Vitest 配置 | 根 `vitest.config.ts`，每个包 `src/**/*.test.ts` 覆盖 | `pnpm vitest run` 可执行（当前无测试，0 结果通过） |
| Playwright 配置 | `playwright.config.ts`：chromium、超时设置、baseURL | `npx playwright install chromium` 成功 |
| 测试数据库 | `accessbase_test` 独立库，每次测试前 `drizzle-kit push` 重置 | 测试隔离，不干扰开发数据 |
| 覆盖率配置 | `vitest` coverage provider（v8），最低 80% | `vitest --coverage` 生成报告 |

---

### Phase 1: 核心包实施（Week 3-8）

按依赖顺序实施 8 个 L0 包。每个包遵循 TDD 流程：先写测试，再实现，再重构。每包完成时 `tsc --noEmit` 通过 + 单元测试 ≥ 80% 覆盖。

#### 2.1.1 `@accessbase/shared-types`（Week 3）

**依赖**: 无（最底层，其他所有包依赖）

**职责**: 跨包共享的类型定义、枚举、常量。

| 任务 | 文件 | 说明 |
|------|------|------|
| 项目错误码定义 | `src/error-codes.ts` | 统一错误码枚举（AUTH_001, RBAC_001 等），参见 `error-handling.md` |
| API 通用类型 | `src/api.ts` | `PaginationParams`, `ApiResponse<T>`, `PaginatedResponse<T>` 等 |
| 用户/角色模型类型 | `src/models.ts` | `User`, `Role`, `Permission`, `Tenant` 接口（不含 ORM Schema） |
| JWT 类型 | `src/auth.ts` | `JwtPayload`, `AccessToken`, `RefreshToken` 类型 |
| 审计日志类型 | `src/audit.ts` | `AuditLog`, `AuditAction` 等类型 |
| 类型导出 | `src/index.ts` | 统一导出所有类型 |

**测试**: 类型导出检查（`tsc --noEmit` 覆盖类型正确性，无运行时行为）

**交付物**: `@accessbase/shared-types@0.1.0`，零运行时依赖

#### 2.1.2 `@accessbase/logging`（Week 3）

**依赖**: 无

**职责**: 基于 pino 的结构化日志封装，包括敏感字段脱敏和请求追踪。

| 任务 | 文件 | 说明 |
|------|------|------|
| Logger 工厂 | `src/logger.ts` | `createLogger(options)`: pino 实例创建，环境感知（dev 用 pino-pretty，prod 用 JSON） |
| 脱敏配置 | `src/redaction.ts` | 预定义脱敏路径：`req.headers.authorization`, `req.headers.cookie`, `password`, `token`, `secret` |
| Fastify 插件 | `src/fastify-plugin.ts` | 注册 X-Request-ID hook（`onRequest`），挂载 logger 到 `request.log` |
| 日志级别管理 | `src/levels.ts` | 运行时日志级别切换 API |
| 单元测试 | `src/__tests__/logger.test.ts` | 验证：创建实例、环境切换、脱敏生效、requestId 注入 |

**交付物**: `@accessbase/logging@0.1.0`，依赖 `pino` + `pino-pretty`

#### 2.1.3 `@accessbase/i18n`（Week 3-4）

**依赖**: 无

**职责**: 双命名空间国际化（包名命名空间 + client 命名空间），语言检测，翻译加载。

| 任务 | 文件 | 说明 |
|------|------|------|
| I18nEngine | `src/engine.ts` | i18next 初始化、命名空间注册、语言切换 API |
| 双命名空间 | `src/namespaces.ts` | 包名命名空间（identity/admin/audit/...）+ client 命名空间，优先级：client > 包名 |
| 语言检测 | `src/detector.ts` | 检测顺序：URL 路径 → Cookie → Accept-Language → 默认 zh-CN |
| 语言包骨架 | `src/locales/{zh,en}/` | 基础翻译文件（common 通用键） |
| Fastify 插件 | `src/fastify-plugin.ts` | 从 Accept-Language 头初始化服务端 i18n |
| React Hook | `src/react-provider.tsx` | `<I18nProvider>` 组件 + `useTranslation()` hook 导出 |
| 单元测试 | `src/__tests__/i18n.test.ts` | 验证：命名空间优先级、语言检测、切换、fallback |

**交付物**: `@accessbase/i18n@0.1.0`，依赖 `i18next` + `react-i18next`

#### 2.1.4 `@accessbase/migration`（Week 4）

**依赖**: 无

**职责**: 基于 Drizzle ORM 的三阶段数据库迁移（preload → postsync → postload）。

| 任务 | 文件 | 说明 |
|------|------|------|
| 迁移 Runner | `src/runner.ts` | 扫描迁移文件、SemVer 排序、按阶段执行（preload → Schema sync → postload） |
| 迁移锁 | `src/lock.ts` | 数据库 advisory lock，防止并发迁移执行 |
| 迁移状态 | `src/status.ts` | 记录已执行迁移版本到 `_migrations` 表 |
| CLI 命令 | `src/cli.ts` | `up`/`down`/`status`/`generate` 命令入口 |
| 三阶段执行器 | `src/phases.ts` | preload（Schema 前）/ postsync（Schema 后，默认）/ postload（数据后） |
| 单元测试 | `src/__tests__/migration.test.ts` | 验证：SemVer 排序、阶段分组、锁机制、状态记录 |

**交付物**: `@accessbase/migration@0.1.0`，依赖 `drizzle-orm` + `drizzle-kit`

#### 2.1.5 `@accessbase/identity`（Week 4-6）

**依赖**: `shared-types`（类型）、`logging`（日志，可选）、`i18n`（错误消息国际化，可选）

**职责**: 认证（Authentication）+ 授权（Authorization）核心能力。这是最复杂、最核心的包。

**数据模型**（Drizzle Schema）:

| 表名 | 说明 | 核心字段 |
|------|------|---------|
| `users` | 用户 | id, username, email, password_hash, display_name, avatar, status, tenant_id, created_at, updated_at |
| `roles` | 角色 | id, name, description, is_system, tenant_id |
| `permissions` | 权限 | id, code, description, module, resource, action |
| `user_roles` | 用户-角色关联 | user_id, role_id |
| `role_permissions` | 角色-权限关联 | role_id, permission_id |
| `tenants` | 租户 | id, name, status, config |
| `refresh_tokens` | Refresh Token | id, user_id, token_hash, expires_at, revoked |
| `login_attempts` | 登录尝试记录 | id, username, ip, success, timestamp（限流和安全审计用） |

**模块拆分与任务**:

| 模块 | 文件 | 说明 | 预估 |
|------|------|------|------|
| 数据模型 | `src/schema.ts` | Drizzle 表定义（8 张表） | 1 天 |
| AuthService | `src/auth/service.ts` | 登录、登出、注册、密码重置、Token 签发/验证 | 3 天 |
| JWT 工具 | `src/auth/jwt.ts` | RS256 签发/验证、密钥管理、Access Token + Refresh Token | 2 天 |
| 密码工具 | `src/auth/password.ts` | bcrypt 哈希/验证、密码策略（最小长度、复杂度） | 0.5 天 |
| LDAP Provider | `src/auth/ldap.ts` | Admin Bind 模式、属性映射、自动用户供给、AES-256-GCM 加密连接密码 | 2 天 |
| SessionManager | `src/session/service.ts` | Redis Token 缓存、token_version 数据库追踪、Refresh Token 轮转 | 2 天 |
| UserManager | `src/user/service.ts` | 用户 CRUD、租户过滤、状态管理、密码变更 | 2 天 |
| RoleManager | `src/role/service.ts` | 角色 CRUD、RBAC1 继承链解析、租户级角色 | 1.5 天 |
| PermissionManager | `src/permission/service.ts` | 权限 CRUD、角色-权限关联、权限缓存（Redis） | 1 天 |
| ACLGuard | `src/auth/acl.ts` | RBAC 权限检查（角色继承展开 + 权限匹配）、Fastify preHandler 插件 | 1.5 天 |
| MfaManager | `src/mfa/service.ts` | TOTP 生成/验证、可信设备机制 | 1.5 天 |
| Fastify 插件 | `src/fastify-plugin.ts` | 注册路由、中间件链、preAuth/postAuth hooks | 2 天 |

**关键接口**:

```typescript
// AuthService
interface AuthService {
  login(credentials: LoginCredentials, tenantId: string): Promise<AuthResult>
  logout(refreshToken: string): Promise<void>
  register(data: RegisterData, tenantId: string): Promise<User>
  refreshAccessToken(refreshToken: string): Promise<TokenPair>
  resetPassword(userId: string, newPassword: string): Promise<void>
}

// PermissionEngine
interface PermissionEngine {
  check(userId: string, permission: string, tenantId: string): Promise<boolean>
  getRoles(userId: string, tenantId: string): Promise<Role[]>
  getPermissions(roleIds: string[]): Promise<Permission[]>
  invalidateUserCache(userId: string): Promise<void>
}

// ACLGuard（Fastify preHandler）
function aclGuard(...permissions: string[]): FastifyPreHandler
```

**测试**:
- AuthService: 登录成功/失败、Token 签发/过期、Refresh Token 轮转
- LDAP: Mock LDAP 服务器测试认证流
- ACLGuard: 角色继承、权限匹配、跨租户隔离
- MFA: TOTP 生成/验证、可信设备标记
- SessionManager: Token 缓存、版本失效、并发刷新

**交付物**: `@accessbase/identity@0.1.0`，最核心包，需最仔细的代码审查

#### 2.1.6 `@accessbase/audit`（Week 6-7）

**依赖**: `identity`（用户关联）、`logging`（日志写入）

**职责**: API 写操作自动审计、审计查询接口、审计管理页。

| 任务 | 文件 | 说明 |
|------|------|------|
| 审计数据模型 | `src/schema.ts` | `audit_logs` 表（userId, action, resourceType, resourceId, requestBody, timestamp, tenantId, requestId, success） |
| AuditService | `src/service.ts` | `log()`, `query()`, `export()` 方法 |
| 脱敏处理 | `src/sanitize.ts` | 审计记录中 password、token、secret 等字段自动脱敏 |
| Fastify 插件 | `src/fastify-plugin.ts` | `onResponse` hook：POST/PUT/PATCH/DELETE 请求自动记录 |
| 审计查询 API | `src/routes.ts` | GET /audit-logs（分页、时间范围、用户、操作类型筛选） |
| 单元测试 | `src/__tests__/audit.test.ts` | 验证：自动记录、脱敏生效、查询过滤、导出 |

**交付物**: `@accessbase/audit@0.1.0`

#### 2.1.7 `@accessbase/health-check`（Week 7）

**依赖**: `logging`（健康检查日志）

**职责**: 服务健康检查端点，检查数据库、Redis 等依赖连通性。

| 任务 | 文件 | 说明 |
|------|------|------|
| HealthChecker | `src/checker.ts` | 注册检查项（DB、Redis、自定义），汇总结果 |
| Fastify 插件 | `src/fastify-plugin.ts` | GET /health（200/503）、GET /health/ready（readiness）、GET /health/live（liveness） |
| 检查实现 | `src/checks/` | `database.ts`（SELECT 1）、`redis.ts`（PING） |
| 单元测试 | `src/__tests__/health.test.ts` | 验证：全健康返回 200、部分异常返回 503、liveness 始终 200 |

**交付物**: `@accessbase/health-check@0.1.0`

#### 2.1.8 `@accessbase/admin`（Week 7-8）

**依赖**: `identity`（登录/用户管理）、`audit`（审计管理页）、`i18n`（多语言 UI）、`shared-types`

**职责**: 企业级后台管理框架外壳，含登录页、布局、主题、CRUD 框架、IAM 管理页面。

**模块拆分**:

| 模块 | 目录 | 说明 |
|------|------|------|
| 布局组件 | `src/components/layout/` | ProLayout 外壳（侧边栏 + 顶部导航 + 面包屑 + 用户头像） |
| 主题系统 | `src/theme/` | ThemeProvider、ThemeContext、亮暗切换、持久化到 localStorage |
| BrandTokens | `src/theme/tokens.ts` | BrandTokens 接口（primaryColor, secondaryColor, logo, brandName, fontFamily） |
| 登录页 | `src/pages/login/` | 登录表单、记住密码、OAuth/SSO 入口（按配置显示） |
| 用户管理页 | `src/pages/users/` | ProTable 封装：用户列表（分页/搜索/筛选）、新建/编辑表单、批量操作 |
| 角色管理页 | `src/pages/roles/` | 角色列表、权限树形选择、角色继承配置 |
| 租户管理页 | `src/pages/tenants/` | 租户列表、租户配置 |
| 审计日志页 | `src/pages/audit/` | 审计日志列表（时间线/表格切换）、导出 |
| 状态管理 | `src/stores/` | Zustand stores: `authStore`（登录态）、`uiStore`（侧边栏折叠/主题）、`dataStore`（全局数据） |
| API 客户端 | `src/api/client.ts` | Axios 封装、自动 Token 刷新、请求/响应拦截、防重复提交 |
| 路由注册 | `src/routes.tsx` | React Router 配置、懒加载、权限守卫 |
| 错误边界 | `src/components/error-boundary.tsx` | 全局错误捕获、降级 UI、错误上报 |
| 前端权限 | `src/hooks/usePermission.ts` | `usePermission(code)` hook，基于 ACLGuard 前端版 |
| 空状态 | `src/components/empty-state.tsx` | 统一空状态组件 |

**关键组件接口**:

```typescript
// BrandTokens（L0 默认中性，由 L1/L2 注入覆盖）
interface BrandTokens {
  primaryColor: string       // 默认 '#1677ff'（AntD 默认蓝）
  secondaryColor: string     // 默认 '#f0f0f0'
  logo: string | ReactNode
  logoCollapsed?: string | ReactNode
  brandName: string          // 默认 'AccessBase'
  brandTagline?: string
  fontFamily?: string
}

// Admin 入口组件
interface AccessBaseAdminProps {
  brandTokens?: Partial<BrandTokens>
  loginComponent?: React.ComponentType
  routes?: RouteConfig[]
  beforeLogin?: (credentials: LoginCredentials) => Promise<void>
  afterLogin?: (result: AuthResult) => Promise<void>
}

// RouteConfig（页面注册）
interface RouteConfig {
  path: string
  component: React.LazyExoticComponent<any>
  label: string           // 菜单显示名（i18n key）
  icon?: string
  permission?: string     // 所需权限码
  children?: RouteConfig[]
}
```

**测试**:
- 主题切换：亮暗模式切换、持久化、BrandTokens 注入
- 登录流程：表单验证、成功跳转、错误提示、SSO 入口
- CRUD 框架：ProTable 分页、筛选、新建/编辑表单弹窗
- 权限守卫：无权限页面跳转、菜单权限过滤
- 响应式：移动端侧边栏折叠、断点适配

**交付物**: `@accessbase/admin@0.1.0`，完整的后台管理框架外壳

---

### Phase 2: 集成与 API（Week 9-10）

目标：将 8 个 L0 包集成为可运行的后端服务和前端应用。

#### 2.2.1 Fastify 服务搭建

| 任务 | 文件 | 说明 |
|------|------|------|
| 服务入口 | `packages/server/src/index.ts` | Fastify 实例创建，加载所有插件 |
| 插件注册 | `packages/server/src/plugins.ts` | 按顺序注册：logging → i18n → identity → audit → health-check → admin API |
| 配置管理 | `packages/server/src/config.ts` | 环境变量读取 + 验证（zod schema），缺失时启动报错 |
| 错误处理 | `packages/server/src/errors.ts` | 统一错误响应格式，错误码映射到 HTTP 状态码 |
| CORS/Security | `packages/server/src/security.ts` | CORS 配置、Helmet 头、Rate Limiting |

#### 2.2.2 API 路由实现

| 模块 | 前缀 | 端点 | 说明 |
|------|------|------|------|
| 认证 | `/api/v1/auth` | `POST /login`, `POST /logout`, `POST /refresh`, `POST /register` | 参见 `api.md` |
| 用户 | `/api/v1/users` | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` | RBAC 保护 |
| 角色 | `/api/v1/roles` | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` | 含权限树 |
| 权限 | `/api/v1/permissions` | `GET /`, `POST /` | RBAC 保护 |
| 租户 | `/api/v1/tenants` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` | 仅 superadmin |
| 审计 | `/api/v1/audit-logs` | `GET /` | 仅读取，admin 角色 |
| 健康检查 | `/health`, `/health/ready`, `/health/live` | GET | 无认证 |
| MFA | `/api/v1/mfa` | `POST /setup`, `POST /verify`, `POST /disable` | 需认证 |

**API 响应格式**（统一）:
```typescript
// 成功
{ success: true, data: T }

// 分页
{ success: true, data: { items: T[], total: number, page: number, limit: number } }

// 错误
{ success: false, error: { code: string, message: string, details?: object } }
```

#### 2.2.3 中间件链

请求处理顺序：
```
1. Helmet（安全头）
2. CORS（跨域）
3. Rate Limiting（限流）
4. Request ID 注入（logging）
5. i18n 初始化（Accept-Language）
6. JWT 验证（identity）
7. RBAC 权限检查（identity/ACLGuard）
8. 业务处理
9. 审计记录（audit onResponse hook）
```

#### 2.2.4 前端 Admin UI 搭建

| 任务 | 说明 |
|------|------|
| Vite 项目初始化 | `packages/admin-ui/` 独立 Vite 项目，引用 `@accessbase/admin` |
| 开发代理 | `vite.config.ts` 配置 proxy 到后端 `localhost:5101` |
| 路由打通 | 登录页 → Dashboard → 用户管理 → 角色管理 → 租户管理 → 审计日志 |
| API 联调 | 前端 API 客户端对接后端路由 |
| 开发模式启动 | `pnpm dev` 同时启动后端（5101）+ 前端（5173） |

---

### Phase 3: 测试与优化（Week 11-12）

目标：达到质量标准，确保生产可用。

#### 2.3.1 单元测试

| 范围 | 要求 |
|------|------|
| 每个 L0 包 | ≥ 80% 代码覆盖率 |
| identity 包 | ≥ 90% 覆盖率（安全核心） |
| 测试模式 | AAA 模式（Arrange-Act-Assert） |
| 测试命名 | `returns X when Y` / `throws error when Z` |
| Mock 策略 | 数据库用 in-memory 或测试 DB，外部服务（LDAP）用 Mock |

**重点测试场景**:

| 包 | 关键测试 |
|----|---------|
| identity | 密码哈希/验证、JWT 签发/过期/轮转、RBAC 继承链解析、租户隔离、LDAP Mock 认证、MFA TOTP |
| audit | 审计自动记录、脱敏正确性、查询过滤 |
| admin | 主题切换持久化、路由权限守卫、表单验证 |
| migration | SemVer 排序、阶段分组、迁移锁、回滚 |
| logging | 脱敏字段验证、requestId 注入 |

#### 2.3.2 集成测试

| 场景 | 说明 |
|------|------|
| 完整登录流程 | 注册 → 登录 → 获取 Token → 访问受保护接口 → 刷新 Token → 登出 |
| RBAC 权限链 | 创建角色 → 分配权限 → 创建用户 → 分配角色 → 验证权限 → 修改角色 → 验证即时生效 |
| 多租户隔离 | 两个租户创建数据 → 验证租户 A 看不到租户 B 数据 |
| 审计追踪 | 执行写操作 → 验证审计记录 → 验证脱敏 → 查询过滤 |
| 迁移执行 | 执行迁移 → 验证表创建 → 回滚 → 验证表删除 |

#### 2.3.3 E2E 测试（Playwright）

| 流程 | 操作 | 验证点 |
|------|------|--------|
| 登录 | 打开页面 → 输入凭证 → 点击登录 | 跳转到 Dashboard，控制台无应用错误 |
| 用户 CRUD | 导航到用户管理 → 创建用户 → 编辑 → 删除 | 表格数据更新，成功提示 |
| 角色管理 | 创建角色 → 分配权限 → 分配给用户 | 权限树选择正确，保存成功 |
| 主题切换 | 点击主题切换按钮 → 亮暗模式 | 样式即时切换，刷新后持久化 |
| 侧边栏导航 | 点击所有菜单项 | 每页正确渲染，URL 正确 |
| 响应式 | 调整浏览器宽度 | 侧边栏在移动端折叠 |
| 控制台检查 | 每个操作后检查 | 0 应用 error（过滤 findDOMNode/chrome-extension/ResizeObserver） |

**通过标准**:
- 所有测试 0 失败
- 控制台 0 应用错误
- DOM 完整性：`.ant-layout-sider` ≤ 1

#### 2.3.4 性能测试

| 指标 | 目标 | 测试方法 |
|------|------|---------|
| API 响应时间（P95） | < 200ms | k6 或 Artillery 压测 |
| 并发登录 | 100 并发无报错 | k6 并发测试 |
| 数据库查询 | 单次 < 50ms | pg_stat_statements 监控 |
| 前端首屏 | LCP < 2s | Lighthouse |
| 打包体积 | Admin UI < 500KB gzip | `npx vite build --report` |
| 内存占用 | 服务端 < 512MB（1000 连接） | 监控 |

#### 2.3.5 安全审计

| 检查项 | 说明 |
|--------|------|
| OWASP Top 10 | 逐项核查（SQL 注入、XSS、CSRF、认证绕过等） |
| JWT 安全 | RS256 密钥强度、Token 过期检查、轮转机制 |
| 密码安全 | bcrypt cost factor ≥ 12、密码策略执行 |
| 敏感数据 | 无硬编码密钥、日志无明文密码、审计脱敏 |
| 依赖审计 | `pnpm audit` 无高危漏洞 |
| RBAC | 权限校验无遗漏、跨租户隔离无漏洞 |

---

### Phase 4: 部署与文档（Week 13-14）

目标：生产就绪，可交付。

#### 2.4.1 Docker 镜像构建

| 任务 | 文件 | 说明 |
|------|------|------|
| 后端 Dockerfile | `Dockerfile.backend` | 多阶段构建（build → production），node:20-alpine 基础镜像 |
| 前端 Dockerfile | `Dockerfile.frontend` | 多阶段构建（build → nginx:alpine），静态文件部署 |
| docker-compose.prod.yml | 生产编排 | 后端 + 前端 + PostgreSQL + Redis |
| 镜像优化 | — | 层缓存、`.dockerignore`、依赖只装生产包 |

#### 2.4.2 Kubernetes 部署配置

| 文件 | 说明 |
|------|------|
| `k8s/namespace.yaml` | 命名空间定义 |
| `k8s/backend-deployment.yaml` | 后端 Deployment（replica=2, resources, probe） |
| `k8s/frontend-deployment.yaml` | 前端 Deployment |
| `k8s/service.yaml` | Service 配置（ClusterIP） |
| `k8s/ingress.yaml` | Ingress 规则 |
| `k8s/configmap.yaml` | 配置注入 |
| `k8s/secret.yaml` | 敏感配置模板（Secret） |

#### 2.4.3 文档

| 文档 | 说明 |
|------|------|
| README.md | 项目概述、快速开始、包列表 |
| 各包 README | `packages/*/README.md`：安装、使用示例、API 概览 |
| API 文档 | Fastify 自动生成 OpenAPI/Swagger（@fastify/swagger） |
| 部署指南 | `docs/deployment.md`：Docker / K8s / 裸机部署步骤 |
| 开发指南 | `docs/contributing.md`：开发环境搭建、贡献流程、编码规范 |
| 运维手册 | `docs/ops.md`：日志排查、监控告警、备份恢复 |

#### 2.4.4 发布准备

| 任务 | 说明 |
|------|------|
| npm 发布配置 | 每包 `package.json` 含 `files`、`main`、`types`、`exports` 字段 |
| 版本管理 | 统一使用 `changesets` 管理版本号 |
| CHANGELOG | 自动生成变更日志 |
| Release 流程 | GitHub Actions: push tag → build → test → publish to npm |

---

## 3. 包依赖关系图

依赖方向：箭头指向被依赖方（下方依赖上方）。

```
                    ┌─────────────────┐
                    │  shared-types   │  ← 纯类型，零运行时依赖
                    │  (types only)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────┐    ┌──────────────┐
│   logging    │   │     i18n     │    │  migration   │
│  (pino)      │   │  (i18next)   │    │  (drizzle)   │
└──────┬───────┘   └──────┬───────┘    └──────────────┘
       │                  │                (独立)
       │                  │
       ▼                  ▼
┌──────────────────────────────────┐
│           identity               │  ← 核心包，最复杂
│  (JWT + RBAC + LDAP + MFA)       │
│  依赖: shared-types, logging, i18n│
└──────────┬───────────┬───────────┘
           │           │
           ▼           │
    ┌──────────────┐   │     ┌──────────────────┐
    │    audit     │   │     │   health-check   │
    │ (审计钩子)   │◄──┘     │   (健康检查)     │
    │ 依赖: identity│        │ 依赖: logging    │
    └──────┬───────┘        └──────────────────┘
           │                    (独立于 audit)
           ▼
┌──────────────────────────────────┐
│             admin                │  ← 最大的包
│  (后台框架 + 页面 + 主题)        │
│  依赖: identity, audit, i18n,   │
│         shared-types             │
└──────────────────────────────────┘
```

**并行实施策略**: shared-types、logging、i18n、migration 四个无依赖包可在 Week 3 并行开发。

---

## 4. 里程碑与交付物

| 里程碑 | 时间 | 交付物 | 验收标准 |
|--------|------|--------|---------|
| **M0: 基础就绪** | Week 2 末 | Monorepo 骨架、Docker 环境、CI/CD、规范工具、测试框架 | `pnpm install` → `tsc --noEmit` → `vitest run` 全链路通过 |
| **M1: 无依赖包完成** | Week 4 末 | shared-types + logging + i18n + migration | 每包独立 `tsc --noEmit` 通过，单元测试 ≥ 80% |
| **M2: Identity 核心完成** | Week 6 末 | @accessbase/identity 完整版 | 登录/登出/Token 刷新通过，RBAC 权限检查通过，LDAP Mock 测试通过 |
| **M3: 全部 L0 包完成** | Week 8 末 | 8 个 L0 包全部 0.1.0 | 每包 `tsc --noEmit` + 单元测试 ≥ 80% |
| **M4: 集成运行** | Week 10 末 | Fastify 服务 + Admin UI 可联调 | `pnpm dev` 启动后登录 → 创建用户 → 分配角色 全流程通过 |
| **M5: 质量达标** | Week 12 末 | 测试覆盖 ≥ 80%、E2E 通过、安全审计通过 | Playwright 12/12 通过，k6 压测 P95 < 200ms |
| **M6: 生产就绪** | Week 14 末 | Docker 镜像 + K8s 配置 + 文档 + npm 发布 | `docker compose up` 全栈启动，API 文档完整，README 清晰 |

---

## 5. 风险评估

### 5.1 技术风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| identity 包复杂度超预期 | 高 | 高 | 预留 2 周缓冲；LDAP/MFA 放 Week 5-6；MVP 先做密码+JWT+RBAC |
| Drizzle ORM 迁移能力不足 | 中 | 中 | 提前 POC 三阶段迁移；备选：保留现有迁移工具做适配器 |
| 前后端联调耗时 | 中 | 中 | Phase 2 预留 2 周；提前约定 API 格式（OpenAPI spec 先行） |
| pnpm workspace 包间依赖解析 | 低 | 中 | Phase 0 先验证包间引用；使用 `workspace:*` 协议 |
| React 19 + Ant Design 5 兼容性 | 低 | 低 | 稳定版发布后再升级；Phase 0 先验证基础组件渲染 |

### 5.2 进度风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 设计文档细节不够实施 | 中 | 高 | 实施前逐包读 SDD；遇到歧义先记录再集中讨论 |
| 人员不足或变动 | 中 | 高 | 优先保证 identity + admin + audit 三包（最小可用） |
| Phase 3 测试耗时超预期 | 中 | 中 | 测试随开发同步进行（TDD），不集中到 Phase 3 |
| 外部依赖变更（Fastify/Drizzle 版本） | 低 | 中 | 锁定主要依赖版本；定期 `pnpm update` + 回归测试 |

### 5.3 质量风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 安全漏洞（认证/授权） | 中 | 极高 | identity 包 ≥ 90% 覆盖；发布前安全审计；静态扫描（ESLint security 插件） |
| 性能不达标 | 低 | 高 | Phase 1 中 benchmark 关键路径；identity 查询加 Redis 缓存 |
| 代码风格不一致 | 中 | 中 | ESLint + Prettier + pre-commit hook 强制执行 |
| 文档与实现脱节 | 高 | 中 | 实施完成后立即更新 SDD；PR review 检查文档同步 |

---

## 6. 成功标准

### 6.1 代码质量

| 指标 | 目标 | 检查方式 |
|------|------|---------|
| TypeScript 严格模式 | `strict: true`，零 `as any` | `tsc --noEmit` + ESLint no-explicit-any |
| ESLint | 零 error（warn 允许） | `eslint packages/` |
| Prettier | 100% 格式一致 | `prettier --check packages/` |
| 文件大小 | ≤ 800 行/文件 | CI 检查脚本 |
| 函数大小 | ≤ 50 行/函数 | 代码审查 |

### 6.2 测试覆盖率

| 范围 | 最低覆盖率 | 关键包提升 |
|------|-----------|-----------|
| 全局 | ≥ 80% | — |
| identity | ≥ 90% | 认证、RBAC、LDAP |
| audit | ≥ 85% | 脱敏、自动记录 |
| E2E（Playwright） | 核心流程 100% | 登录、CRUD、权限 |

### 6.3 性能基准

| 指标 | 目标值 |
|------|--------|
| API 响应时间（P50） | < 50ms |
| API 响应时间（P95） | < 200ms |
| API 响应时间（P99） | < 500ms |
| 并发登录 | 100 并发无报错 |
| 前端首屏（LCP） | < 2 秒 |
| Admin UI 包体积（gzip） | < 500KB |
| 后端 Docker 镜像 | < 200MB |
| 服务内存占用 | < 512MB（1000 连接） |
| 数据库查询 | 单次 < 50ms |

### 6.4 安全合规

| 项目 | 标准 |
|------|------|
| OWASP Top 10 | 逐项覆盖（SQL 注入防护、XSS 防护、CSRF 令牌、认证暴力破解防护） |
| JWT | RS256 签名，Access Token 15 分钟过期，Refresh Token 轮转 |
| 密码 | bcrypt cost factor ≥ 12，最小 8 字符，要求大小写+数字 |
| HTTPS | 生产环境强制 TLS 1.2+ |
| 依赖安全 | `pnpm audit` 无高危（critical/high）漏洞 |
| 日志脱敏 | authorization header、cookie、password、token 自动脱敏 |
| 审计完整性 | 所有写操作 100% 审计记录 |

---

## 7. 团队分工建议

### 7.1 角色定义

| 角色 | 人数 | 职责 |
|------|------|------|
| 后端工程师（Senior） | 2 | identity 核心、JWT/RBAC/LDAP、Fastify 集成 |
| 后端工程师（Mid） | 1 | audit、health-check、migration、日志 |
| 前端工程师（Senior） | 1 | admin 框架、主题系统、ProLayout 集成 |
| 前端工程师（Mid） | 1 | CRUD 页面、表单组件、管理页面 |
| 全栈/DevOps | 1 | CI/CD、Docker、K8s、数据库、部署 |
| 测试/QA | 1 | E2E 测试、性能测试、安全审计 |

**最小团队（3 人）**: 1 全栈后端 + 1 全栈前端 + 1 DevOps/测试

### 7.2 人员分配

| 阶段 | 后端 (Senior) | 后端 (Mid) | 前端 (Senior) | 前端 (Mid) | DevOps | QA |
|------|--------------|-----------|--------------|-----------|--------|----|
| Phase 0 (W1-2) | 骨架搭建 | 测试框架 | Vite 初始化 | — | Docker + CI | 测试环境 |
| Phase 1a (W3-4) | identity 前半 | logging + i18n + migration | admin 主题 + 布局 | — | — | — |
| Phase 1b (W5-6) | identity 后半 (LDAP/MFA) | audit | admin API 客户端 | 登录页 + CRUD 框架 | — | — |
| Phase 1c (W7-8) | identity 收尾 + review | health-check + audit 收尾 | admin 管理页面 | 管理页面 | npm 发布准备 | 集成测试 |
| Phase 2 (W9-10) | Fastify 集成 + API | API 路由实现 | 前后端联调 | 页面联调 | 部署脚本 | API 测试 |
| Phase 3 (W11-12) | 单元测试收尾 | 单元测试收尾 | E2E 测试 | E2E 测试 | 性能测试 | 安全审计 |
| Phase 4 (W13-14) | Bug 修复 | 文档 | 文档 | 文档 | K8s 部署 | 回归测试 |

### 7.3 协作约定

| 项目 | 规则 |
|------|------|
| 分支策略 | `main`（稳定） + `feat/*`（功能分支） + `fix/*`（修复分支） |
| PR 要求 | 至少 1 人 approve、CI 通过、`tsc --noEmit` 通过 |
| 每日站会 | 15 分钟，同步进度和阻塞 |
| 周 Review | 每周盘点里程碑进度，调整计划 |
| 代码审查 | identity 相关代码需 2 人 review |
| 文档同步 | 实施完立即更新 SDD，PR 检查文档同步 |
| 提交规范 | Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:` |
| 版本发布 | 使用 changesets 管理，统一发布 |

---

## 附录 A: 技术决策速查

以下关键决策影响实施（详见 `.agents/memorys/decisions.md` D1-D95）:

| 决策 | 编号 | 实施影响 |
|------|------|---------|
| AccessBase 命名 + `@accessbase/*` scope | D1 | 所有包名、npm scope |
| 8 项能力进入 L0 | D2 | 包边界定义 |
| auth + rbac 合并为 identity | D3 | identity 包最复杂 |
| L0 用配置点，不用插件 | D4 | admin 只提供扩展接口 |
| JWT: 15min Access + 7d Refresh + 轮转 | D5 | SessionManager 设计 |
| RBAC1 角色继承 | D6 | ACLGuard 继承链解析 |
| Drizzle ORM 统一迁移和数据访问 | D7 | migration + Schema 设计 |
| pino 结构化日志 | D8 | logging 包选型 |
| i18next 双命名空间 | D9 | 包名 + client 命名空间 |
| Refine + ProLayout 混合 UI | D26 | admin 布局方案 |

## 附录 B: 包发布配置模板

```json
{
  "name": "@accessbase/identity",
  "version": "0.1.0",
  "description": "AccessBase 身份与访问管理（认证+授权+RBAC+LDAP+MFA）",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./fastify": {
      "types": "./dist/fastify-plugin.d.ts",
      "import": "./dist/fastify-plugin.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

## 附录 C: 环境变量清单

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `DATABASE_URL` | 是 | — | PostgreSQL 连接串 |
| `REDIS_URL` | 是 | — | Redis 连接串 |
| `JWT_PRIVATE_KEY_PATH` | 是 | — | RS256 私钥路径 |
| `JWT_PUBLIC_KEY_PATH` | 是 | — | RS256 公钥路径 |
| `JWT_ACCESS_EXPIRY` | 否 | `15m` | Access Token 有效期 |
| `JWT_REFRESH_EXPIRY` | 否 | `7d` | Refresh Token 有效期 |
| `NODE_ENV` | 否 | `development` | 运行环境 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `PORT` | 否 | `5101` | 后端监听端口 |
| `CORS_ORIGIN` | 否 | `http://localhost:5173` | 允许的跨域来源 |
| `LDAP_URL` | 否 | — | LDAP 服务器地址 |
| `LDAP_BIND_DN` | 否 | — | LDAP 绑定 DN |
| `LDAP_BIND_PASSWORD` | 否 | — | LDAP 绑定密码（AES-256-GCM 加密存储） |
| `SMTP_HOST` | 否 | — | 邮件服务器（密码重置用） |
| `DEFAULT_LOCALE` | 否 | `zh-CN` | 默认语言 |
