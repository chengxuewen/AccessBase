# 低代码 / Admin 平台技术调研报告

> **调研日期**: 2026-08-21
> **调研目的**: 为 AccessBase 企业 IAM 平台提供参考架构、可借鉴的设计模式和技术决策依据
> **覆盖平台**: Budibase, Appsmith, ToolJet, Directus, Strapi, Supabase, PocketBase, n8n

---

## 目录

1. [平台概览对比](#1-平台概览对比)
2. [Budibase](#2-budibase)
3. [Appsmith](#3-appsmith)
4. [ToolJet](#4-tooljet)
5. [Directus](#5-directus)
6. [Strapi](#6-strapi)
7. [Supabase](#7-supabase)
8. [PocketBase](#8-pocketbase)
9. [n8n](#9-n8n)
10. [综合对比与 AccessBase 借鉴](#10-综合对比与-accessbase-借鉴)

---

## 1. 平台概览对比

| 平台 | 定位 | GitHub Stars | 语言 | 数据库 | 许可证 | 首次发布 |
|------|------|-------------|------|--------|--------|---------|
| **Budibase** | 内部工具构建 | 28.2k | Node.js/Svelte | CouchDB | GPL v3 + BSL | 2020 |
| **Appsmith** | 内部工具构建 | 40.7k | Java(后端)/React(前端) | MongoDB | Apache 2.0 + 商业 | 2019 |
| **ToolJet** | 内部工具构建 | 40.6k | TypeScript(NestJS/React) | PostgreSQL | AGPL-3.0 + 商业 | 2021 |
| **Directus** | Headless CMS / 数据平台 | 37.5k | TypeScript(Node/Vue) | 多种 SQL | MSCL 1.0 | 2020 |
| **Strapi** | Headless CMS | 73.0k | TypeScript(Koa/React) | 多种 SQL | MIT + 商业 | 2015 |
| **Supabase** | BaaS (Firebase 替代) | 108.2k | 多语言(Go/Elixir/Haskell/TS) | PostgreSQL | Apache 2.0 | 2020 |
| **PocketBase** | 嵌入式 BaaS | 60.7k | Go | SQLite | MIT | 2022 |
| **n8n** | 工作流自动化 | 201.4k | TypeScript(Node/Vue) | SQLite/PostgreSQL | Sustainable Use License | 2019 |

---

## 2. Budibase

### 2.1 项目概述

Budibase 是一个开源低代码平台，用于构建内部工具、AI Agent 和工作流自动化。定位为"运营平台"，不仅仅是应用构建器，而是一个自动化业务流程、处理请求和连接业务系统的完整平台。

- **GitHub**: https://github.com/Budibase/budibase
- **Stars**: 28.2k | **Forks**: 2.2k | **Commits**: 59,329
- **许可证**: GPL v3 (社区版), MPL 2.0 (客户端库), BSL (商业版)
- **客户**: ARM, Saab, American Express, Bulgarian Government, Octopus Energy
- **认证**: ISO 27001, GDPR 合规

### 2.2 技术栈

| 层 | 技术 |
|----|------|
| 后端运行时 | Node.js >=22 |
| Web 框架 | **Koa.js 3.x** |
| 查询构建器 | **Knex.js 2.4** |
| 内部数据库 | **CouchDB** (PouchDB + nano) |
| 任务队列 | **Bull 4.10** (Redis) |
| 认证 | JWT, bcrypt, Passport, Azure MSAL |
| AI 集成 | Vercel AI SDK, OpenAI SDK |
| 沙箱执行 | `isolated-vm` |
| 实时通信 | Socket.IO 4.8 + Redis adapter |
| 前端框架 | **Svelte 5** (Runes) |
| 构建工具 | Vite 7.3, Routify |
| Monorepo | Lerna + Yarn + Nx |
| 部署 | Docker / Helm / DigitalOcean |

### 2.3 核心功能

- **可视化应用构建器**: 拖拽式 UI，JSON 定义应用，组件库 (bbui)
- **多数据源**: 20+ 数据库连接器 (PostgreSQL, MySQL, MongoDB, Oracle, Snowflake, Elasticsearch 等)
- **AI Agent**: 模型无关的 LLM 集成，支持 Slack/Teams/Discord 多渠道部署
- **自动化工作流**: 触发器 + 操作链，支持 JS 代码步骤 (isolated-vm 沙箱)
- **RBAC**: Public/Basic/Power/Admin 四级角色，自定义角色，用户组，SSO (SAML/OIDC)
- **企业功能**: 审计日志、SCIM、备份、白标、多租户 (Pro 版)

### 2.4 插件/扩展机制

- 自定义 Svelte 组件
- REST/OpenAPI 数据源插件
- Bull 队列自定义 worker
- `@budibase/sdk` 编程接口
- Marketplace 数据连接器
- **局限**: 无原生 backend plugin SDK，扩展需 PR 到主仓库

### 2.5 优点

1. 自托管友好 — Docker 单镜像，完整数据主权
2. 多数据源 — 无需迁移即可连接 20+ 数据库
3. AI 优先方向 — 模型无关 Agent 系统
4. 全栈 TypeScript，类型检查完备
5. 企业级客户验证 (政府/银行/大型企业)
6. Worker/Server 分离架构

### 2.6 缺点

1. CouchDB 依赖 — 小众，运维复杂度高于 PostgreSQL
2. Koa.js (非主流) — 生态小于 Express/Fastify
3. Svelte (非 React) — 人才池和社区组件少于 React
3. BSL 许可证 — 企业功能锁定在商业许可下
4. 无 WebAuthn/Passkey 支持
5. 社区版无审计日志
6. Lerna + Yarn (老旧 monorepo 工具)

### 2.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| `shared-core` 跨栈共享包 | 验证 schema、常量、类型定义的前后端共享 |
| 多数据源抽象层 | LDAP/AD/外部数据库的用户同步连接器 |
| Worker/Server 分离 | 认证 worker vs API server 分离部署 |
| Bull 队列 | 异步审计、通知、Webhook 处理 |
| OpenAPI-first 设计 | API 契约管理 |
| `isolated-vm` 沙箱 | 自定义策略评估脚本 |

---

## 3. Appsmith

### 3.1 项目概述

Appsmith 是一个开源低代码平台，用于快速构建内部工具 (admin panels, dashboards, CRUD apps)。

- **GitHub**: https://github.com/appsmithorg/appsmith
- **Stars**: 40.7k | **Forks**: 4.7k | **Commits**: 20,444
- **许可证**: Apache 2.0 (社区版) / 商业 (企业版)
- **融资**: Series B (~$41M, Accel, Insight Partners)
- **客户**: AWS, ByteDance, Dropbox, GSK

**版本体系**:
- Community Edition: 免费自托管
- Free (Cloud): 最多 5 用户
- Business: $15/user/month
- Enterprise: $2,500/month (100 用户起)

### 3.2 技术栈

| 层 | 技术 |
|----|------|
| 后端 | **Java 25+ / Spring Boot 3.5+** |
| JS 沙箱 | Node.js 24+ |
| 主数据库 | **MongoDB 7** |
| 缓存 | Redis |
| 嵌入式 DB | PostgreSQL (内置) |
| 前端框架 | **React 18** |
| 状态管理 | Redux + Redux-Saga |
| 代码编辑器 | Monaco Editor |
| UI 系统 | 自研 ADS (Appsmith Design System) |
| 反向代理 | Caddy (内置 TLS) |
| 部署 | Docker (单容器 6 进程) / K8s |

### 3.3 核心功能

- **数据源**: 25+ 数据库 + 30+ SaaS 集成 + AI 服务
- **AI Agent 平台**: 集成最新 AI 模型，支持私有数据，无需模型微调
- **Widget 系统**: 50+ 预构建组件，Mustache 绑定，自定义 Widget 沙箱
- **JS 引擎**: JSObject + Mustache 绑定，内置 lodash/moment
- **Git 版本控制**: GitHub/GitLab 集成，分支管理，branch protection
- **Workflows**: 事件触发器，串联多个 query/actions
- **Packages**: 可复用 UI 模块和代码模块
- **GAC (细粒度权限)**: Resource → Permission → Role → User/Group 矩阵
- **审计日志**: 30+ 事件类型 (Business+)

### 3.4 插件/扩展机制

- **数据源插件**: Java JAR 包，独立负责连接/查询/结果转换
- **Custom Widget**: HTML/JS/CSS 沙箱，postMessage 通信
- **限制**: 不支持自定义 server-side plugin，无 marketplace

### 3.5 优点

1. 极低入门门槛，Docker 一键部署
2. 强大的数据源支持 (25+ DB + 30+ SaaS)
3. Apache 2.0 开源，数据不出企业
4. Git 原生工作流 (编辑/预览/生产分支)
5. 企业级 GAC 权限模型
6. 审计日志完整 (30+ 事件类型)

### 3.6 缺点

1. 架构复杂 — 单容器 6 进程，8GB RAM 最低
2. MongoDB 做主存储 — 关系型数据不是最佳选择
3. 后端不可扩展 — 无 server-side plugin API
4. SSO/SAML 锁定在 Enterprise ($2,500+/月)
5. v2.0 升级路径危险 (破坏性变更多)
6. 4,400+ open issues

### 3.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| GAC 权限模型 (Resource → Permission → Role) | RBAC1 设计参考，per-resource 权限粒度 |
| 审计日志事件架构 | 30+ 事件类型分类 (workspace/app/page/datasource/user/instance) |
| Datasource Plugin 架构 | Auth provider 插件模式 (LDAP/OAuth/WebAuthn) |
| Environment Management | 多环境配置管理 (dev/staging/prod) |
| Custom Widget 沙箱 | 插件 UI 隔离执行 + postMessage 通信 |

---

## 4. ToolJet

### 4.1 项目概述

ToolJet 是开源企业级内部工具构建平台，用于快速构建 dashboard、业务应用、工作流和 AI Agent。

- **GitHub**: https://github.com/ToolJet/ToolJet
- **Stars**: 40.6k | **Forks**: 5.4k | **Commits**: 17,103
- **许可证**: AGPL-3.0 (社区版) / 商业 (企业版)

### 4.2 技术栈

| 层 | 技术 |
|----|------|
| 后端框架 | **NestJS 11** (Express) |
| ORM | **TypeORM 0.3** |
| 主数据库 | **PostgreSQL** |
| 内置 DB | PostgREST (PG → REST API) |
| 任务队列 | **BullMQ** (Redis) |
| 工作流引擎 | **Temporal.io** |
| 权限库 | **@casl/ability** |
| 日志 | **Pino** |
| 可观测性 | **OpenTelemetry** + Prometheus + Sentry |
| 前端框架 | **React 18** |
| 状态管理 | **Zustand** |
| UI 库 | **Radix UI** + **Tailwind CSS** |
| 协作 | **Yjs (CRDT)** — 多人实时编辑 |
| 代码编辑器 | CodeMirror 6 |
| 流程图 | ReactFlow |
| 构建 | Webpack 5 |
| 部署 | Docker / K8s / AWS / GCP / Azure |

### 4.3 核心功能

- **60+ 响应式组件**: Table, Chart, Form, Calendar, Maps, PDF Viewer 等
- **80+ 数据源**: 数据库 + API + SaaS + AI 服务 + 向量数据库
- **ToolJet Database**: 内置 no-code 数据库 (PG + PostgREST)
- **工作流**: Temporal.io 引擎，可视化节点编辑器，多种触发器
- **RBAC**: Super Admin / Admin / Builder / End-user + Custom Groups + 细粒度资源权限
- **SSO**: SAML, OIDC, OAuth, LDAP, SCIM
- **GitSync**: GitHub/GitLab 版本控制
- **多人协作**: Yjs CRDT 实时编辑
- **加密**: AES-256-GCM，Lockbox 密钥管理

### 4.4 插件/扩展机制

- **Marketplace 插件**: 独立 npm 包，CLI 脚手架 (`tooljet create-plugin`)
- **热重载**: `ENABLE_MARKETPLACE_DEV_MODE=true`
- **插件类别**: AI, 数据库, 向量数据库, 云服务, 监控, 业务应用, 通信, 物流, 支付
- **管理命令**: `plugins:install`, `plugins:uninstall`, `plugins:reload`

### 4.5 优点

1. AGPL-3.0 开源，数据不出域
2. 80+ 数据源 + Marketplace 扩展
3. Temporal.io 工作流引擎 (非简单 webhook)
4. Yjs CRDT 多人实时协作
5. OpenTelemetry + Prometheus + Sentry 全链路可观测
6. @casl/ability 细粒度权限控制

### 4.6 缺点

1. AGPL-3.0 限制商业使用
2. 前端技术栈混用 (Radix + Bootstrap + 多个 UI 库)
3. TypeORM (非 Drizzle)，类型安全不足
4. Webpack 5 (非 Vite)
5. 企业功能锁定 (AI/多环境/GitSync/审计/细粒度权限)
6. 610 open PRs

### 4.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| `@casl/ability` 权限矩阵 | 权限引擎参考：resource × action 矩阵 |
| Lockbox 密钥管理 | Master Key 加密 + 密钥轮换 |
| Workspace 多租户 | 租户隔离 + Super Admin 跨 Workspace 管理 |
| Personal Access Token | API 认证与 session token 分离 |
| Marketplace 插件架构 | 独立 npm 包 + CLI + 热重载 |
| Temporal.io 工作流 | 持久化工作流引擎 |

---

## 5. Directus

### 5.1 项目概述

Directus 是开源数据平台 / Headless CMS，将任何 SQL 数据库包装为即时 REST + GraphQL API，附带可视化管理面板。

- **GitHub**: https://github.com/directus/directus
- **Stars**: 37.5k | **Forks**: 4.9k | **Commits**: 13,878
- **下载量**: 45M+ | **部署项目**: 500K+
- **许可证**: MSCL 1.0 (收入 <$5M / <50 员工免费)

### 5.2 技术栈

| 层 | 技术 |
|----|------|
| 后端运行时 | Node.js >=22 |
| Web 框架 | **Express** |
| 查询构建器 | **Knex.js** |
| API | REST + **GraphQL** (graphql-compose) |
| 实时 | **WebSocket** (ws + graphql-ws) |
| 认证 | JWT, OIDC, SAML, LDAP, TOTP 2FA |
| 验证 | Zod, Joi |
| 日志 | **Pino** |
| 密码哈希 | **Argon2** |
| 图像处理 | Sharp |
| AI 集成 | Vercel AI SDK (Anthropic/OpenAI/Google) |
| MCP | 原生 MCP Server |
| 前端框架 | **Vue 3** + Pinia |
| UI 组件 | Reka UI (headless) |
| 富文本 | TipTap |
| 地图 | MapLibre GL |
| 图表 | ApexCharts |
| 3D | Three.js / TresJS |
| 构建 | **Vite** |
| 测试 | **Vitest** |
| Monorepo | **pnpm workspaces** |

### 5.3 核心功能

- **Database-first**: 包装任意现有 SQL 数据库，自动生成 API
- **REST + GraphQL API**: 零配置，强大的过滤/排序/聚合
- **Data Studio**: Vue 3 SPA 管理面板
- **Flows 自动化**: 事件驱动，触发器 + 操作链，数据链传递
- **RBAC**: Policy-based，可组合策略，字段级 + 行级权限，IP 白名单
- **AI & MCP**: 内置 AI 助手 + 原生 MCP Server
- **文件管理**: TUS 协议，多存储后端，图片实时转换
- **Insights**: 无代码分析仪表盘

### 5.4 插件/扩展机制

**前端扩展 (Vue 3)**:
| 类型 | 用途 |
|------|------|
| Interfaces | 自定义表单输入 |
| Displays | 自定义值展示 |
| Layouts | 自定义列表视图 |
| Panels | 仪表盘面板 |
| Modules | 顶级导航模块 |
| Themes | 主题定制 |

**后端扩展 (Node.js)**:
| 类型 | 用途 |
|------|------|
| Hooks | 事件钩子 (DB 操作/调度/生命周期) |
| Endpoints | 自定义 API 路由 |
| Operations | Flows 自定义步骤 |

- **Directus Marketplace**: 发布和安装扩展
- **Bundling**: 多个扩展打包
- **CLI**: `npx directus extension create`

### 5.5 优点

1. Database-first — 包装现有数据库，无厂商锁定
2. 即时 API — 零配置 REST + GraphQL
3. 细粒度 RBAC — 字段级 + 行级权限，可组合策略
4. 全面扩展性 — 6 种前端 + 3 种后端扩展类型
5. 原生 MCP Server — AI Agent 受相同 RBAC 管控
6. pnpm + Vite + Vitest — 现代工具链

### 5.6 缺点

1. MSCL 许可证 — 非传统开源，社区信任问题
2. 非 IAM 专用 — 无 OAuth 2.0 Provider，无 WebAuthn，无 RBAC 继承
3. Knex.js (非 ORM) — 无类型安全查询
4. Express (非 Fastify) — 性能较低
5. 单体部署 — API 与 Studio 紧耦合
6. Vue 3 (非 React) — 限制开发者池
7. Flows 无沙箱 — 任意代码执行，安全隐患

### 5.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| Policy-based RBAC (可组合策略) | 权限 = Policies → Roles → Users，可组合、可叠加 |
| 字段级 + 行级权限 | 不同角色可见不同用户属性 (HR 看薪资，经理看团队) |
| `$CURRENT_USER` 变量插值 | 动态过滤规则中的租户隔离 |
| IP 白名单 per policy | 网络级访问限制 |
| Token 类型多样性 | Standard JWT + Session Cookie + Static Token + External JWT |
| Environment Sync | Schema 变更在环境间传播 |
| MCP Server 原生集成 | AI Agent 受相同 RBAC 管控 |
| `$accountability` 上下文传播 | 所有操作携带身份上下文用于审计 |

---

## 6. Strapi

### 6.1 项目概述

Strapi 是领先的开源 Headless CMS，允许开发者通过 UI 或代码定义内容模型，自动生成 REST + GraphQL API。

- **GitHub**: https://github.com/strapi/strapi
- **Stars**: 73.0k | **Forks**: 9.8k | **Commits**: 37,749
- **许可证**: MIT (社区版) / 商业 (企业版)
- **融资**: Series B ($31M, 2022)
- **当前版本**: Strapi 5

### 6.2 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js >=20 |
| 语言 | TypeScript 5.9 |
| Web 框架 | **Koa.js** |
| 查询构建器 | **Knex.js** |
| 数据库 | PostgreSQL (>=14), MySQL (>=8), MariaDB (>=10.3), SQLite 3 |
| 前端 (Admin) | **React 18** + `@strapi/design-system` |
| Monorepo | **Nx 20.8** + Rollup + SWC |
| 包管理 | **Yarn 4.12** (Berry) |
| 测试 | Vitest (单元) + Jest (API) + Playwright (E2E) |
| 部署 | Docker / Strapi Cloud |

### 6.3 核心功能

- **Content-Type Builder**: 可视化定义 Collection Types, Single Types, Components
- **字段类型**: Text, Rich Text, Number, Date, Boolean, JSON, Media, Relations (6 种)
- **文档生命周期**: Draft/Publish/Archive，内容历史，发布工作流
- **API**: REST + GraphQL 自动生成，Document Service API，OpenAPI spec
- **RBAC**: 3 默认角色 + 完全自定义，per-content-type CRUD + publish 权限，per-field 权限，自定义条件
- **Users & Permissions**: 端用户独立权限系统
- **API Token**: 全生命周期管理 (CRUD + 重新生成 + 作用域)
- **i18n**: 内置 locale 管理
- **Media Library**: 文件上传/管理
- **MCP Server**: AI Agent 集成
- **Strapi AI**: 内容建模助手

### 6.4 插件/扩展机制

- **Plugin SDK**: `npx create-strapi-plugin` 脚手架
- **双 API**: Admin Panel API (React UI) + Server API (中间件/路由/控制器/服务/内容类型)
- **扩展点**: 中间件、策略、控制器、服务、生命周期钩子、Document Service 中间件、Admin 自定义路由/组件、MCP 工具
- **Marketplace**: https://market.strapi.io
- **Custom Fields**: 插件式字段类型扩展

### 6.5 优点

1. 快速原型 — Content-Type Builder + 自动生成 API
2. 完整 TypeScript 支持 (v5)
3. 成熟插件生态 — Marketplace
4. 细粒度 RBAC — per-content-type + per-field + 自定义条件
5. MIT 开源 (社区版)
6. 文档生命周期 — Draft/Publish/History/Review Workflow
7. i18n 内置
8. 73k Stars，最大社区

### 6.6 缺点

1. Koa.js (非主流) — 生态小于 Express/Fastify
2. Knex.js (非全 ORM) — 无类型安全查询
3. 不支持 MongoDB (v4+ 移除)
4. 企业功能付费墙 — SSO/审计/Review Workflows 需 Enterprise
5. Content-Type Builder 仅开发模式可用
6. 无角色继承 — RBAC 是扁平角色
7. 大版本迁移痛苦 (v3→v4→v5)

### 6.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| RBAC 权限模型 (per-resource + per-action + per-field + 自定义条件) | 权限 = resource + action + conditions，自定义条件是 ABAC 基础 |
| 双权限系统 (Admin RBAC vs 端用户权限) | Admin 控制台访问控制 vs API 资源访问控制 |
| 文档生命周期 (Draft → Review → Published) | 策略/配置变更审批流 |
| 中间件链 (Gateway → Middleware → Policy → Controller → Service) | 分层 auth/authz |
| API Token 全生命周期 | API 密钥管理 |
| Review Workflows | 权限/角色变更审批 |
| Plugin Marketplace 模式 | Auth Provider Marketplace |

---

## 7. Supabase

### 7.1 项目概述

Supabase 定位为"Postgres 开发平台"，用企业级开源工具构建 Firebase 替代品。

- **GitHub**: https://github.com/supabase/supabase
- **Stars**: 108.2k | **Forks**: 13.6k | **Commits**: 38,032
- **许可证**: Apache 2.0
- **融资**: ~$116M+ (Series B, 估值 $2B+, 2022)
- **定价**: Free → Pro ($25/mo) → Team ($599/mo) → Enterprise (定制)

### 7.2 技术栈

Supabase 是**多个独立服务的组合**，不是单一二进制：

| 组件 | 技术 | 说明 |
|------|------|------|
| 数据库 | **PostgreSQL 15+** | 专用实例，每项目一个 |
| 自动 API | **PostgREST** (Haskell) | DB schema → RESTful API |
| GraphQL | **pg_graphql** (PG 扩展) | DB 层 GraphQL |
| 认证 | **GoTrue** (Go) | JWT-based auth |
| 实时 | **Realtime** (Elixir) | WebSocket，PG replication |
| 存储 | **Storage API** (Node.js) | S3-compatible |
| Edge Functions | **Deno Runtime** | 全球分布边缘计算 |
| DB 管理 | **postgres-meta** (Node.js) | PG 管理 API |
| 代理 | **Envoy** | 反向代理/网关 |
| Dashboard | **Next.js + React** | 管理面板 |
| 客户端 SDK | supabase-js, Flutter, Swift, Python, Kotlin, C# | 多语言 |

### 7.3 核心功能

- **50+ PG 扩展预装**: pgvector, PostGIS, pg_cron, pg_graphql, pgTAP 等
- **认证**: Email/Password, Magic Link, OTP, Phone, 19+ Social OAuth, SAML 2.0, Anonymous, MFA (TOTP)
- **Auth Hooks**: 6 种钩子点 (Before User Created, Custom Access Token, Send SMS/Email, MFA Verification, Password Verification)
- **Row Level Security (RLS)**: PostgreSQL 原生功能深度集成，`anon`/`authenticated`/`service_role` 三角色
- **实时**: WebSocket 订阅 + 广播 + Presence
- **存储**: S3-compatible，与 RLS 集成
- **Edge Functions**: Deno Runtime，全球分布
- **AI & Vectors**: pgvector 预装，向量相似度搜索
- **JWT Claims**: `sub`, `aal`, `amr`, `app_metadata`, `user_metadata`

### 7.4 插件/扩展机制

**Postgres 扩展 (50+ 预装)**:
AI (pgvector), 地理 (PostGIS), 测试 (pgTAP), 定时 (pg_cron), GraphQL (pg_graphql), 安全 (pgcrypto)

**Auth Hooks (6 种)**:
- Before User Created, Custom Access Token, Send SMS/Email
- MFA Verification, Password Verification
- 实现方式: Postgres Function (SQL) 或 HTTP Endpoint (Edge Function)

**Edge Functions**: 本质是插件机制，可集成 Stripe, Sentry, Redis 等

### 7.5 优点

1. Postgres 优先 — 所有数据/逻辑/权限都在 PG 中
2. RLS 深度集成 — 数据库级权限控制，纵深防御
3. 开源 + 可自部署 — Apache 2.0
4. Auth 功能全面 — MFA, SSO, 19+ Social, Auth Hooks
5. DX 极好 — CLI + Dashboard + TypeScript SDK
6. AI 原生 — pgvector 内建
7. 108k Stars — 最大社区

### 7.6 缺点

1. 企业级 IAM 能力有限 — 无原生 RBAC 继承
2. MFA 不含 WebAuthn/FIDO2
3. 自部署功能受限 — 分支/高级指标/PITR/Analytics 不可用
4. RLS 性能风险 — 复杂策略可能降低查询性能
5. JWT 不能实时反映权限变更
6. 多租户需手写
7. 无原生审计日志

### 7.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| **Auth Hooks 生命周期** | 认证流程关键点提供 hook 扩展 |
| **RLS + Security Definer 函数** | 数据库层权限控制 + 特权函数绕过行级检查 |
| **AAL 分级 + RLS 强制** | `auth.jwt()->>'aal' = 'aal2'` 强制 MFA |
| **JWT Claims 设计** | `app_metadata` vs `user_metadata` 分离 + `amr` 数组 |
| **三角色基线** | `anon`/`authenticated`/`service_role` 模式 |
| **Auth 独立服务** | GoTrue 独立部署 + JWT + 专用 PG 角色 |
| **Auth 专用 Schema** | auth 数据在 `auth` schema，与业务数据分离 |
| **pgTAP 测试** | 数据库级策略测试 |

---

## 8. PocketBase

### 8.1 项目概述

PocketBase 是 Go 语言后端平台，核心理念：**单个可执行文件**包含数据库、认证、API、实时通信和管理后台。

- **GitHub**: https://github.com/pocketbase/pocketbase
- **Stars**: 60.7k | **Forks**: 3.7k | **Commits**: 2,453
- **许可证**: MIT
- **状态**: Pre-v1.0，个人志愿者项目

### 8.2 技术栈

| 层 | 技术 |
|----|------|
| 语言 | **Go** (1.23+) |
| 数据库 | **SQLite** (WAL 模式)，pure Go 驱动 |
| HTTP | 标准库自定义路由 |
| 实时 | **SSE** (Server-Sent Events) |
| 认证 | **JWT (HS256)**，完全无状态 |
| 管理面板 | 内嵌 React SPA |
| 文件存储 | 本地 + S3 兼容 |
| JS 扩展 | **goja** (ES5 JavaScript VM)，预热 15 runtime 池 |
| SDK | JavaScript (Browser/Node/React Native), Dart |
| 构建产物 | **单个静态可执行文件** (~12MB) |
| TLS | 内置 Let's Encrypt 自动证书 |

### 8.3 核心功能

- **Collection**: 数据表 + Schema + API 权限规则，一体配置
- **声明式 API Rules**: 每种 CRUD 操作独立权限规则，支持变量表达式
- **认证**: 密码, OAuth2 (15+), OTP, MFA (TOTP), 用户冒充
- **实时订阅**: SSE，支持 filter 条件
- **批量操作**: 单请求事务性批量 create/update/upsert/delete
- **管理面板**: Collection CRUD, Schema 编辑, 权限配置, OAuth 配置
- **内置邮件**: SMTP + sendmail，自定义模板
- **备份/恢复**: ZIP 归档，支持 S3
- **Rate Limiter**: 内置限流
- **设置加密**: AES 加密敏感设置

### 8.4 插件/扩展机制

**Go 扩展 (推荐)**:
- 事件钩子系统覆盖完整生命周期
- App 生命周期: `OnBootstrap`, `OnServe`, `OnTerminate`
- Record 钩子: Before → Execute → After 三层
- Collection 钩子, 请求级钩子, 邮件钩子, Realtime 钩子
- 自定义路由, 控制台命令, 定时任务

**JavaScript 扩展**:
- `pb_hooks/` 目录下 `*.pb.js` 文件
- goja ES5 引擎 (非 Node.js)
- 热重载 (UNIX)
- TypeScript 声明文件提供代码补全
- 限制: 无 setTimeout/setInterval, ES5 only

### 8.5 优点

1. 极致简单 — 单个二进制，零依赖，`./pocketbase serve` 即可
2. 零配置 SQLite — 嵌入式数据库
3. 开发速度极快 — 分钟级可用
4. 声明式 API Rules — 不写代码即可配置权限
5. Go 框架式扩展 — 事件钩子覆盖完整生命周期
6. 跨平台 — 14 个平台架构
7. 性能好 — SQLite WAL 读操作超过传统数据库
8. MIT 开源

### 8.6 缺点

1. SQLite 限制 — 写入受限于单机，不支持水平扩展
2. Pre-v1.0 — 无向后兼容保证
3. 无 RBAC — 只有基于规则的 ACL，无角色/权限层级
4. 无多租户
5. JS 引擎受限 — goja 仅 ES5
6. 无 WebSocket — 仅 SSE (单向)
7. 个人项目 — 维护可持续性存疑
8. FAQ 明确提示 "不推荐用于生产关键应用"

### 8.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| 声明式 API Rules | 管理员在 UI 上配置权限，变量表达式 (`@request.auth.id`) |
| 三层事件钩子 (Before → Execute → After) | L0 包的 hooks 模式 |
| Schema = API = Permission 三位一体 | 一体化配置体验 |
| 无状态 JWT 认证 | Token 不入库，authRefresh 验证 |
| 批量操作事务 | 批量导入/同步 |
| 设置加密 (AES) | 应用级加密 + 环境变量密钥 |
| 用户冒充 (Impersonate) | 调试/支持功能 |
| OTP + MFA 渐进式流程 | MFA 实现参考 |

---

## 9. n8n

### 9.1 项目概述

n8n 是 fair-code 许可的工作流自动化和 AI Agent 平台，提供可视化画布构建工作流。

- **GitHub**: https://github.com/n8n-io/n8n
- **Stars**: 201.4k | **Forks**: 60.3k | **Commits**: 23,303+
- **许可证**: Sustainable Use License + n8n Enterprise License
- **社区**: 45,000+ forum, Discord
- **当前版本**: 2.36.0
- **集成数**: 2,067 nodes

### 9.2 技术栈

| 层 | 技术 |
|----|------|
| Monorepo | **pnpm workspace + Turborepo** |
| 运行时 | Node.js >=24 |
| 包管理 | pnpm >=10.22 |
| 语言 | TypeScript 6.0.2 |
| 前端 | **Vue.js** + `@n8n/design-system` |
| 数据库 (默认) | SQLite |
| 数据库 (生产) | **PostgreSQL** (TypeORM) |
| 任务队列 | **Bull** (Redis) |
| 表达式引擎 | **V8 isolates** (isolated-vm) |
| AI 框架 | **LangChain** (`@n8n/n8n-nodes-langchain`) |
| 测试 | **Vitest + Playwright** |
| 构建 | Turborepo, esbuild |
| 可观测性 | **OpenTelemetry**, Prometheus, Grafana |

### 9.3 核心功能

- **可视化工作流构建器**: 拖拽节点编辑器，数据固定，调试，历史/版本
- **2,067 集成节点**: AI, 数据库, SaaS, 通信, 安全, 开发工具等
- **触发器**: Webhook, Cron, 应用触发器, MQTT, 手动, 错误触发器
- **代码节点**: JavaScript (V8 沙箱) + Python (Task Runner)
- **AI 能力**: AI Agent, Chain, RAG, Memory, Tools, MCP, Embeddings
- **AI 助手**: 自然语言构建工作流，AI 自动调试和修复，支持网页搜索
- **MCP 集成**: 原生 MCP 服务器，支持 Claude、Cursor、ChatGPT 等 MCP 客户端
- **新节点**: Databricks、Perplexity、Moonshot Kimi、阿里云模型等
- **企业功能**: RBAC (4 级), Projects, SSO (SAML/LDAP), 2FA, 审计日志, Git 版本控制, Environments, Queue Mode, 外部密钥

### 9.4 插件/扩展机制

**Community Nodes (npm 包)**:
- 命名规范: `n8n-nodes-*` 或 `@scope/n8n-nodes-*`
- CLI 脚手架: `@n8n/node-cli`
- GitHub 模板: `n8n-nodes-starter`
- 节点类型: Regular, Trigger, Root, Sub, Cluster
- Credential 系统: OAuth2, API Key, Username/Password
- Marketplace: Creator Portal 审核
- 要求: npm provenance, 无运行时依赖

**其他扩展点**:
- Public REST API
- External Hooks
- External Secrets (Vault, AWS SM)
- Custom Task Runners
- Log Streaming
- OEM Embedding

### 9.5 优点

1. 最大集成库 — 2,067+ nodes
2. 代码逃生舱 — JS/Python 代码节点，npm 包导入
3. 可自托管 — 社区版 ~90% 功能
4. AI 原生 — 深度 LangChain 集成 + AI 助手自然语言构建工作流
5. MCP 原生支持 — 与 Claude、Cursor 等 AI 工具无缝集成
5. 201k Stars — 最大社区
6. 执行定价 — 按工作流执行计费
7. 企业就绪 — Queue Mode, RBAC, SSO, 审计, Git, Environments
8. pnpm + Vitest + Playwright — 现代工具链

### 9.6 缺点

1. 许可证限制 — Sustainable Use License 非 OSI 批准的开源
2. 复杂工作流可读性差 — 100+ 节点时画布难以管理
3. SQLite 默认 — 生产需 PostgreSQL
4. 表达式语法学习曲线
5. 企业功能付费 (SSO/Environments/Git)
6. 社区节点质量参差

### 9.7 可借鉴点

| 模式 | AccessBase 应用 |
|------|----------------|
| **节点式工作流执行** | IAM 自动化: 用户创建 → 分配角色 → 发邮件 → 创建工单 |
| **触发器系统** | Webhook/Schedule/Event 触发器映射到 IAM 事件 |
| **加密 Credential 管理** | 加密存储 + 跨项目共享 + 外部密钥集成 |
| **执行历史审计** | 完整输入/输出/时间/状态记录 |
| **Project-based RBAC** | 团队隔离 (Project → Workflows/Credentials/Variables) |
| **V8 isolates 沙箱** | 策略表达式安全评估 |
| **npm-based 插件架构** | L0/L1/L2 包架构 + 标准 Credential 接口 |
| **Queue Mode** | Bull/Redis 异步处理 |
| **n8n Packages (.n8np)** | 策略模板打包/部署/共享 |
| **OEM Embedding** | iframe SSO + Token 交换 |
| **AI 助手自然语言构建** | 管理员用自然语言描述需求，自动生成 IAM 配置 |
| **MCP 服务器集成** | AI Agent 通过 MCP 协议访问 IAM 资源，统一权限控制 |
| **OpenTelemetry 追踪** | 工作流执行全链路可观测性 |

---

## 10. 综合对比与 AccessBase 借鉴

### 10.1 技术栈对比

| 维度 | AccessBase 设计 | Budibase | Appsmith | ToolJet | Directus | Strapi | Supabase | PocketBase | n8n |
|------|----------------|----------|----------|---------|----------|--------|----------|------------|-----|
| **后端框架** | **Fastify** | Koa | Spring Boot | NestJS | Express | Koa | 多服务 | 标准库 | Node.js |
| **ORM** | **Drizzle** | Knex | - | TypeORM | Knex | Knex | PostgREST | - | TypeORM |
| **数据库** | **PostgreSQL 16** | CouchDB | MongoDB | PostgreSQL | 多种 SQL | 多种 SQL | PostgreSQL | SQLite | SQLite/PG |
| **前端框架** | **React** | Svelte | React | React | Vue | React | React | React | Vue |
| **UI 库** | **Ant Design** | 自研 bbui | 自研 ADS | Radix+Tailwind | Reka UI | 自研 Design System | Next.js | 内嵌 | 自研 design-system |
| **Monorepo** | **pnpm** | Lerna+Yarn | Yarn | pnpm(推测) | pnpm | Yarn+Nx | 独立 repos | 单包 | pnpm+Turborepo |
| **测试** | **Vitest+Playwright** | - | Jest+Cypress | Jest+Cypress | Vitest | Vitest+Playwright | - | - | Vitest+Playwright |
| **日志** | **Pino** | - | - | Pino | Pino | - | - | - | - |
| **可观测性** | OpenTelemetry | - | - | OTel+Prometheus+Sentry | OTel | - | - | - | OTel+Prometheus |

### 10.2 RBAC 能力对比

| 维度 | AccessBase 设计 | Budibase | Appsmith | ToolJet | Directus | Strapi | Supabase | PocketBase | n8n |
|------|----------------|----------|----------|---------|----------|--------|----------|------------|-----|
| **角色继承** | **RBAC1** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **租户隔离** | ✅ | Pro 版 | ❌ | Workspace | ❌ | ❌ | 手写 RLS | ❌ | Projects |
| **字段级权限** | 规划中 | ❌ | ❌ | ❌ | ✅ | ✅ | RLS | ❌ | ❌ |
| **行级权限** | 规划中 | ❌ | ❌ | ❌ | ✅ | ✅ | RLS | Rules | ❌ |
| **自定义条件** | 规划中 | ❌ | ❌ | ❌ | IP 白名单 | ✅ | Auth Hooks | 表达式 | ❌ |
| **SSO** | JWT+OAuth+WebAuthn+LDAP | SAML/OIDC | OAuth/SAML/OIDC | SAML/OIDC/LDAP/SCIM | OIDC/SAML/LDAP | Enterprise | 19+ OAuth/SAML | OAuth2 | SAML/LDAP |
| **审计日志** | ✅ 核心功能 | Pro 版 | Business+ | Enterprise | ✅ Activity Log | Enterprise | ❌ (需 pg_audit) | ❌ | Enterprise |

**关键发现**: AccessBase 的 RBAC1 角色继承设计在所有 8 个平台中**独一无二**。这是一个重要的差异化优势。

### 10.3 高价值借鉴模式汇总

#### A. 认证/授权架构

| 来源 | 模式 | AccessBase 应用 |
|------|------|----------------|
| **Supabase** | Auth Hooks 生命周期 (6 种钩子) | 认证流程扩展点 |
| **Supabase** | AAL 分级 + 数据库层 MFA 强制 | 分级安全策略 |
| **Supabase** | JWT Claims (`app_metadata`/`user_metadata`/`amr`) | Token 设计 |
| **Supabase** | Auth 独立服务 + 专用 Schema | 认证服务架构 |
| **Directus** | Policy-based 可组合 RBAC | 权限 = Policies → Roles → Users |
| **Directus** | 字段级 + 行级权限 + IP 白名单 | 细粒度访问控制 |
| **ToolJet** | `@casl/ability` 权限矩阵 | 权限引擎实现参考 |
| **ToolJet** | Lockbox 密钥管理 | 加密存储 + 密钥轮换 |
| **PocketBase** | 声明式 API Rules + 变量表达式 | UI 权限配置 |

#### B. 可扩展性/插件

| 来源 | 模式 | AccessBase 应用 |
|------|------|----------------|
| **ToolJet** | Marketplace 插件 (npm 包 + CLI + 热重载) | Auth Provider Marketplace |
| **Directus** | 6 种前端 + 3 种后端扩展类型 | 插件分类体系 |
| **n8n** | npm-based Community Nodes + Credential 系统 | 标准化插件接口 |
| **PocketBase** | 三层事件钩子 (Before → Execute → After) | L0 包 hooks 模式 |
| **Budibase** | `isolated-vm` 沙箱 | 自定义策略脚本执行 |

#### C. 运维/部署

| 来源 | 模式 | AccessBase 应用 |
|------|------|----------------|
| **n8n** | Bull/Redis Queue Mode | 异步处理和扩展 |
| **n8n** | pnpm + Turborepo monorepo | 已选择 pnpm |
| **Directus** | pnpm + Vite + Vitest | 已选择相同工具链 |
| **Budibase** | Worker/Server 分离 | 认证 worker vs API server |
| **Supabase** | pgTAP 数据库级策略测试 | 数据库权限测试 |
| **ToolJet** | OpenTelemetry + Prometheus + Sentry | 全链路可观测性 |

#### D. 工作流/自动化

| 来源 | 模式 | AccessBase 应用 |
|------|------|----------------|
| **n8n** | 节点式工作流引擎 | IAM 自动化 (provisioning, 审批, 响应) |
| **n8n** | 执行历史 + 审计 | 完整操作追踪 |
| **Directus** | Flows 事件驱动自动化 | 审计钩子、通知、Webhook |
| **Strapi** | Review Workflows | 权限/角色变更审批 |

### 10.4 AccessBase 应避免的反模式

| 平台反模式 | 说明 | AccessBase 正确做法 |
|-----------|------|-------------------|
| CouchDB 做主存储 (Budibase) | 小众，运维复杂 | **PostgreSQL 16** (已决定) |
| MongoDB 做主存储 (Appsmith) | 关系型数据不是最佳选择 | **PostgreSQL 16** |
| Koa.js (Budibase/Strapi) | 生态小 | **Fastify** (已决定) |
| Express (Directus) | 性能较低 | **Fastify** |
| Knex.js (Directus/Strapi) | 无类型安全 | **Drizzle ORM** |
| TypeORM (ToolJet/n8n) | DX 不如 Drizzle | **Drizzle ORM** |
| Vue (Directus/n8n) | 人才池小 | **React** (已决定) |
| Svelte (Budibase) | 人才池更小 | **React** |
| 单容器多进程 (Appsmith) | 8GB RAM，复杂 | 独立服务部署 |
| SSO 作为付费功能 | 作为 IAM 平台这是核心能力 | **SSO 是核心功能** |
| 审计日志作为付费功能 | 安全基础需求 | **审计日志是核心功能** |
| 扁平 RBAC 无继承 | 8 个平台均无继承 | **RBAC1 角色继承** (差异化优势) |
| SQLite 唯一 (PocketBase) | 不支持水平扩展 | **PostgreSQL** |
| HS256 JWT (PocketBase) | 安全性较低 | **RS256** (已决定) |

### 10.5 建议优先研究的源码

基于调研结果，建议优先深入研究以下源码实现：

| 优先级 | 目标 | 源码位置 | 原因 |
|--------|------|---------|------|
| P0 | Supabase Auth Hooks | `supabase/auth` (GoTrue) | 6 种认证钩子实现 |
| P0 | Supabase RLS + AAL | Supabase 文档 + pgTAP | 数据库层权限控制 |
| P0 | ToolJet CASL 集成 | `ToolJet/server` | @casl/ability 在 NestJS 中的集成模式 |
| P1 | Directus Policy RBAC | `directus/api` | 可组合策略 + 字段/行级权限 |
| P1 | ToolJet Lockbox | `ToolJet/server` | 密钥加密 + 轮换机制 |
| P1 | n8n Community Nodes | `n8n/packages/nodes-base` | 标准化插件接口设计 |
| P2 | Strapi Plugin SDK | `strapi/packages/core` | 双 API (Admin + Server) 扩展架构 |
| P2 | n8n Workflow Engine | `n8n/packages/workflow` | 节点式执行引擎 |
| P3 | Directus Flows | `directus/api` | 事件驱动自动化引擎 |

---

*本报告为 AccessBase 设计阶段参考材料。各平台数据基于 2026-08-21 调研，GitHub 数据和版本信息可能随时间变化。*
