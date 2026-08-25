# 平台技术综合分析报告

> **调研日期**: 2026-08-21
> **来源文档**: admin-platforms.md, nocobase.md, odoo.md, api-gateways.md
> **目的**: 从 12 个参考平台中提取 5 大技术维度的共性模式，为 AccessBase 提供架构决策依据
> **覆盖平台**: Budibase, Appsmith, ToolJet, Directus, Strapi, Supabase, PocketBase, n8n, NocoBase, Odoo, One API/new-api, LiteLLM

---

## 目录

1. [插件架构](#1-插件架构)
2. [数据模型模式](#2-数据模型模式)
3. [工作流引擎](#3-工作流引擎)
4. [API 模式](#4-api-模式)
5. [计费/配额系统](#5-计费配额系统)
6. [AccessBase 综合建议](#6-accessbase-综合建议)

---

## 1. 插件架构

### 1.1 各平台插件架构对比

| 平台           | 架构类型           | 插件粒度                          | 扩展点数量                                                            | 热重载     | Marketplace       |
| -------------- | ------------------ | --------------------------------- | --------------------------------------------------------------------- | ---------- | ----------------- |
| **NocoBase**   | 微内核插件         | 功能级（所有功能即插件）          | 核心 + 事件系统                                                       | ✅         | ❌                |
| **ToolJet**    | npm 包 + CLI       | 数据源/组件级                     | 数据源 + UI                                                           | ✅         | ✅ Creator Portal |
| **Directus**   | 分类扩展           | 前端 6 类 + 后端 3 类             | Interface/Display/Layout/Panel/Module/Theme + Hook/Endpoint/Operation | ✅         | ✅                |
| **Strapi**     | Plugin SDK         | 双 API（Admin + Server）          | 中间件/策略/控制器/服务/生命周期/自定义字段                           | ✅         | ✅                |
| **n8n**        | Community Nodes    | 节点级（Regular/Trigger/Cluster） | 节点 + Credential + External Hooks + Task Runner                      | ✅         | ✅ Creator Portal |
| **PocketBase** | Go 扩展 + JS 钩子  | 事件级                            | App/Record/Collection/Request/Realtime/Mail 生命周期                  | ✅（Unix） | ❌                |
| **Budibase**   | 仓库 PR            | 组件级                            | Svelte 组件 + REST 数据源                                             | ❌         | ❌                |
| **Appsmith**   | Java JAR           | 数据源级                          | 数据源插件 + Custom Widget 沙箱                                       | ❌         | ❌                |
| **Odoo**       | Python 模块        | 模块级（每个业务功能独立）        | 模块 + ORM + 视图 + 工作流                                            | ❌         | ✅ Odoo Apps      |
| **new-api**    | 适配器目录         | 供应商级                          | `relay/channel/{provider}/`                                           | ❌         | ❌                |
| **LiteLLM**    | Provider Transform | 供应商级                          | 独立转换文件 + Hooks + Callbacks                                      | ❌         | ❌                |

### 1.2 共性模式

**模式 A：微内核 + 插件（NocoBase, Odoo, WordPress 模式）**

- 核心内核提供基础能力（路由、数据模型、权限）
- 所有业务功能以插件形式实现
- 插件生命周期：安装 → 激活 → 停用 → 卸载
- 优势：极致模块化，按需加载
- 劣势：核心与插件边界定义困难，过度插件化导致碎片化

**模式 B：分类扩展体系（Directus, n8n 模式）**

- 按用途分类定义扩展类型
- 每种类型有明确的接口规范
- CLI 脚手架 + 模板降低开发门槛
- 优势：扩展点清晰，开发者体验好
- 劣势：类型体系维护成本高

**模式 C：适配器/Provider 隔离（new-api, LiteLLM 模式）**

- 每个外部系统对应一个独立适配器目录
- 统一接口，独立实现
- 优势：新增提供商零侵入，测试隔离
- 劣势：仅适用于同质化接口（如 API 中继）

**模式 D：事件钩子三层（PocketBase 模式）**

- Before → Execute → After 三层钩子
- 覆盖完整生命周期（App/Record/Collection/Request）
- 优势：细粒度拦截，无侵入扩展
- 劣势：钩子链过长时调试困难

### 1.3 AccessBase 建议

**推荐：模式 B（分类扩展） + 模式 D（三层钩子） + 模式 C（Provider 隔离）的组合**

| 扩展类型           | 参考来源                                              | AccessBase 应用                                                                       |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Auth Provider 插件 | new-api `relay/channel/` + LiteLLM Provider Transform | `@accessbase/auth-providers/{ldap,oauth,webauthn}` 独立目录，统一 `AuthProvider` 接口 |
| 前端扩展（6 类）   | Directus                                              | Interface/Display/Layout/Panel/Module/Theme 分类                                      |
| 后端钩子（3 层）   | PocketBase Before→Execute→After                       | L0 包 `lifecycle-hooks`：`beforeAuth`, `onAuth`, `afterAuth`                          |
| 工作流节点         | n8n Community Nodes                                   | `@accessbase/workflow-nodes/` npm 包 + CLI 脚手架                                     |
| UI Widget 沙箱     | Appsmith Custom Widget + `isolated-vm`                | 插件 UI 隔离执行，postMessage 通信                                                    |

---

## 2. 数据模型模式

### 2.1 各平台数据模型对比

| 平台           | 核心理念             | 数据库          | ORM/查询层 | 动态 Schema        | 权限粒度                     |
| -------------- | -------------------- | --------------- | ---------- | ------------------ | ---------------------------- |
| **NocoBase**   | 数据模型驱动         | PostgreSQL 16+  | Sequelize  | ✅ 可视化定义      | 字段级                       |
| **Directus**   | Database-first       | 多种 SQL        | Knex.js    | ✅ 自动包装        | 字段级 + 行级                |
| **Supabase**   | PostgreSQL 原生      | PostgreSQL 15+  | PostgREST  | ❌ 手动 Migration  | RLS 行级                     |
| **PocketBase** | Collection 一体      | SQLite (WAL)    | 内置       | ✅ Collection 定义 | 规则级                       |
| **Odoo**       | ORM 模型映射         | PostgreSQL 16+  | 自研 ORM   | ✅ 字段动态添加    | 记录级                       |
| **Strapi**     | Content-Type Builder | 多种 SQL        | Knex.js    | ✅ 可视化定义      | per-content-type + per-field |
| **new-api**    | 多 DB 兼容           | SQLite/MySQL/PG | GORM v2    | ❌ 固定 Schema     | 用户分组 + 渠道分组          |
| **LiteLLM**    | PostgreSQL 专用      | PostgreSQL      | Prisma     | ❌ 固定 Schema     | Key/User/Team 多级           |

### 2.2 共性模式

**模式 A：Database-first（Directus, Supabase）**

- 数据库 Schema 是唯一真相来源
- API 从 Schema 自动生成
- 优势：无厂商锁定，已有数据库零迁移
- 劣势：Schema 变更需手动管理

**模式 B：数据模型驱动（NocoBase, Odoo, Strapi）**

- 先在 UI/代码中定义数据模型
- 框架自动生成数据库表和 API
- 优势：开发效率高，Schema 与代码同步
- 劣势：动态 Schema 可能导致数据库结构混乱

**模式 C：Auth Schema 隔离（Supabase）**

- 认证数据在独立 `auth` Schema
- 业务数据与认证数据物理隔离
- 优势：安全边界清晰，权限最小化
- 劣势：跨 Schema 查询复杂

**模式 D：Collection 一体（PocketBase）**

- Collection = 数据表 + Schema + API + 权限规则
- 一次定义，四维生效
- 优势：配置极简，概念统一
- 劣势：灵活性受限

### 2.3 AccessBase 建议

**推荐：模式 C（Auth Schema 隔离）+ 模式 A（Database-first 用于业务表）**

| 决策                   | 参考来源                         | AccessBase 设计                                                      |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------- |
| Auth 独立 Schema       | Supabase `auth` schema           | `auth` Schema 存储用户/角色/权限/token，`public` Schema 存储业务数据 |
| Drizzle Migration 优先 | Database-first 理念              | Schema 变更通过 Drizzle Migration 管理，不允许运行时动态改表         |
| 权限表设计             | Directus Policy-based RBAC       | `policies` → `roles` → `users` 可组合模型，支持字段级 + 行级         |
| RLS 参考               | Supabase RLS                     | 复杂行级权限可考虑 PG RLS 作为纵深防御层（非唯一控制）               |
| 多租户字段             | ToolJet Workspace + Supabase RLS | 所有核心表包含 `tenant_id`，查询自动注入租户过滤                     |

---

## 3. 工作流引擎

### 3.1 各平台工作流对比

| 平台         | 引擎类型         | 触发器                                   | 节点类型                                    | 可视化        | 沙箱                      | 审计        |
| ------------ | ---------------- | ---------------------------------------- | ------------------------------------------- | ------------- | ------------------------- | ----------- |
| **n8n**      | Temporal.io      | Webhook/Cron/App/Event/MQTT/Manual/Error | Regular/Trigger/Code(JS+Python)/AI          | ✅ 拖拽画布   | V8 isolates + Task Runner | ✅ 执行历史 |
| **Directus** | Flows 事件驱动   | 操作触发/调度/手动                       | 操作链（API/DB/Email/Webhook/自定义）       | ✅ 节点编辑器 | ❌ 无沙箱                 | ✅          |
| **NocoBase** | 内置引擎         | 事件/调度/手动                           | 业务流程节点                                | ✅            | ❌                        | ✅          |
| **Odoo**     | 工作流引擎       | 状态变更/事件                            | 条件/动作/审批                              | ✅ XML 定义   | ❌                        | ✅          |
| **Strapi**   | Review Workflows | 内容变更                                 | 审批/发布/拒绝                              | ❌            | ❌                        | ✅          |
| **Budibase** | 触发器 + 操作链  | 事件/定时/Cron                           | JS 代码步骤 + 内置操作                      | ✅            | isolated-vm               | ❌          |
| **LiteLLM**  | 异步后台         | 请求完成                                 | Cost Calculator/DB Writer/Logging Callbacks | ❌            | ❌                        | ✅          |

### 3.2 共性模式

**模式 A：节点式可视化工作流（n8n 模式）**

- 拖拽画布构建工作流
- 数据在节点间流转
- 支持条件分支、循环、错误处理
- 优势：非技术人员可参与，灵活度极高
- 劣势：复杂工作流可读性差，100+ 节点难以管理

**模式 B：事件驱动操作链（Directus Flows 模式）**

- 事件触发 → 操作链执行
- 操作间通过数据链传递上下文
- 优势：简单直观，IAM 场景够用
- 劣势：无循环/并行，复杂流程能力有限

**模式 C：异步后台处理（LiteLLM 模式）**

- 请求路径零 DB 写入
- 所有持久化操作异步后台执行
- Redis 队列缓冲，批量写入数据库
- 优势：请求延迟极低，吞吐量高
- 劣势：最终一致性，调试链路长

**模式 D：生命周期钩子（PocketBase Before→Execute→After）**

- 每个操作都有三层钩子
- 钩子可取消操作、修改数据、触发副作用
- 优势：无侵入扩展，细粒度控制
- 劣势：钩子链过长时调试困难

### 3.3 AccessBase 建议

**推荐：模式 C（异步后台）+ 模式 D（生命周期钩子）+ 模式 B（事件驱动操作链）的组合**

| 场景              | 参考来源                    | AccessBase 设计                                                           |
| ----------------- | --------------------------- | ------------------------------------------------------------------------- |
| 审计日志写入      | LiteLLM 异步后台            | 请求路径零 DB 写入，审计事件 → Redis Stream → 后台 Worker 批量写入 PG     |
| 认证生命周期钩子  | PocketBase 三层钩子         | `beforeAuth`（校验/限流）→ `onAuth`（认证执行）→ `afterAuth`（审计/通知） |
| IAM 自动化（Pro） | n8n 节点式 + Directus Flows | 用户创建 → 分配角色 → 发通知 → 创建工单，事件驱动操作链                   |
| 权限变更审批      | Strapi Review Workflows     | 策略/角色变更需审批流，Draft → Review → Published 状态机                  |
| Webhook 通知      | Directus Flows + n8n 触发器 | 事件 → 条件过滤 → HTTP Webhook 调用，失败重试 + 死信队列                  |

---

## 4. API 模式

### 4.1 各平台 API 对比

| 平台           | API 类型                                | 自动生成           | 认证方式                                           | 限流          | 版本管理 |
| -------------- | --------------------------------------- | ------------------ | -------------------------------------------------- | ------------- | -------- |
| **Supabase**   | REST (PostgREST) + GraphQL (pg_graphql) | ✅ 从 DB Schema    | JWT (GoTrue) + RLS                                 | ❌            | ❌       |
| **Directus**   | REST + GraphQL                          | ✅ 从数据模型      | JWT + Session Cookie + Static Token + External JWT | ✅ IP 白名单  | ❌       |
| **Strapi**     | REST + GraphQL + Document Service       | ✅ 从 Content-Type | JWT + API Token（全生命周期）                      | ❌            | ❌       |
| **NocoBase**   | REST                                    | ✅ 从数据模型      | JWT + Session                                      | ❌            | ❌       |
| **n8n**        | REST (Public API)                       | ❌ 手动定义        | JWT + API Key                                      | ✅            | ❌       |
| **PocketBase** | REST (内置)                             | ✅ 从 Collection   | JWT (HS256) + OAuth2 + OTP                         | ✅ 内置限流器 | ❌       |
| **Odoo**       | REST + RPC                              | ❌ 手动定义        | Session + API Key                                  | ❌            | ✅       |
| **LiteLLM**    | OpenAI Compatible 统一格式              | ❌ 适配器转换      | API Key (Virtual Keys) + JWT                       | ✅ 多级限流   | ❌       |
| **new-api**    | OpenAI Compatible 统一格式              | ❌ 适配器转换      | JWT + WebAuthn + OAuth + API Token                 | ✅ 用户级限流 | ❌       |

### 4.2 共性模式

**模式 A：Schema → API 自动生成（Supabase, Directus, Strapi, NocoBase）**

- 数据模型定义后自动生成 REST + GraphQL API
- 零配置即可使用，降低开发成本
- 优势：开发效率极高
- 劣势：API 表面积不可控，安全需额外配置

**模式 B：统一 API 格式 + 适配器转换（LiteLLM, new-api）**

- 对外暴露统一格式（如 OpenAI Compatible）
- 内部通过适配器转换为各供应商格式
- 优势：客户端只需对接一种格式
- 劣势：格式转换可能丢失语义

**模式 C：多 Token 类型（Directus）**

- Standard JWT（短期）
- Session Cookie（长期）
- Static Token（API 集成）
- External JWT（第三方系统）
- 优势：场景覆盖全
- 劣势：Token 管理复杂

**模式 D：API Token 全生命周期（Strapi）**

- CRUD + 重新生成 + 作用域 + 过期时间
- 优势：API Key 管理完善
- 劣势：无

### 4.3 AccessBase 建议

**推荐：模式 A（自动生成）用于管理 API + 模式 C（多 Token 类型）+ 模式 D（Token 生命周期）**

| 决策              | 参考来源                      | AccessBase 设计                                                                                                    |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 管理 API 自动生成 | Supabase PostgREST + Directus | Drizzle Schema → OpenAPI Spec → Fastify Route 自动生成（内测阶段手写，稳定后自动生成）                             |
| 多 Token 类型     | Directus 4 种 Token           | `access_token`（JWT RS256, 15min）+ `refresh_token`（7d）+ `api_key`（长期，可撤销）+ `session_cookie`（Web 场景） |
| API Key 生命周期  | Strapi API Token              | 创建/查询/更新/删除/重新生成/作用域分配/过期时间                                                                   |
| 统一响应格式      | LiteLLM 统一格式              | `{ success, data, error, meta }` 信封格式，所有端点一致                                                            |
| 限流策略          | PocketBase + LiteLLM          | 全局限流 + 用户级限流 + 端点级限流，Redis 滑动窗口                                                                 |
| OpenAPI Spec      | Strapi + Directus             | 自动生成 OpenAPI 3.1 Spec，支持代码生成和文档                                                                      |

---

## 5. 计费/配额系统

### 5.1 各平台计费对比

| 平台         | 计费模型                    | 配额粒度                        | 支付集成                     | 安全机制                    |
| ------------ | --------------------------- | ------------------------------- | ---------------------------- | --------------------------- |
| **new-api**  | 表达式计费（分层/动态定价） | Token 级 + 用户/组织级          | EPay, Stripe                 | 饱和边界保护 + 永不产生负数 |
| **LiteLLM**  | 逐请求费用追踪              | Key/User/Team/Server 多级预算   | 费用回调（Langfuse/Datadog） | 异步写入 + Redis 缓冲       |
| **n8n**      | 按执行次数                  | Project 级                      | Stripe                       | 执行历史审计                |
| **Appsmith** | 按用户数分层                | 用户数 + 功能                   | 内置                         | 角色锁                      |
| **Supabase** | 按资源用量                  | 数据库/存储/带宽/Edge Functions | Stripe                       | 用量告警                    |
| **ToolJet**  | 按用户数 + 功能             | Workspace 级                    | 内置                         | 细粒度功能锁                |
| **Odoo**     | 按用户数 + 模块             | 用户数 + 模块数                 | 内置                         | 许可证管理                  |

### 5.2 共性模式

**模式 A：表达式计费（new-api）**

- 灵活的定价表达式引擎
- 支持分层定价、动态定价、缓存命中计费
- 计费安全不变量：永不产生负数费用，饱和边界保护
- 优势：极度灵活，可覆盖复杂定价场景
- 劣势：表达式复杂度高，调试困难

**模式 B：多级预算（LiteLLM）**

- Key → User → Team → Server 四级预算
- 每级独立限额，上级包含下级
- Redis 实时计数，异步批量写入 PG
- 优势：预算控制精确，性能好
- 劣势：预算层级过深时管理复杂

**模式 C：按用户数分层（Appsmith, Odoo）**

- Free → Pro → Enterprise 按用户数/功能分层
- 功能锁通过角色/许可证控制
- 优势：定价简单，用户易理解
- 劣势：大客户可能觉得不公平

### 5.3 AccessBase 建议

**推荐：模式 C（按用户数分层）为主 + 模式 B（多级预算）用于 API 配额**

| 决策         | 参考来源            | AccessBase 设计                                                       |
| ------------ | ------------------- | --------------------------------------------------------------------- |
| 定价模型     | Appsmith + Supabase | Free (5 用户) → Pro ($X/user/month) → Team → Enterprise，功能渐进解锁 |
| API 配额管理 | LiteLLM 多级预算    | Tenant → User → API Key 三级配额，Redis 实时计数                      |
| 计费安全     | new-api 不变量      | 配额扣减永不溢出，饱和边界保护，所有扣减写审计日志                    |
| 用量追踪     | LiteLLM 异步后台    | 用量事件 → Redis Stream → 后台批量写入 PG，不影响请求延迟             |
| 功能锁       | ToolJet + Appsmith  | 功能模块通过许可证控制（SSO/LDAP/Audit/Workflow 等）                  |

> **注意**：AccessBase 是 IAM 平台而非 API 网关，计费系统主要面向平台订阅而非请求计费。API 配额管理用于防止滥用，而非精确计费。

---

## 6. AccessBase 综合建议

### 6.1 架构决策矩阵

| 维度         | 推荐方案                             | 主要参考              | 次要参考          |
| ------------ | ------------------------------------ | --------------------- | ----------------- |
| **插件架构** | 分类扩展 + 三层钩子 + Provider 隔离  | Directus + PocketBase | new-api + LiteLLM |
| **数据模型** | Auth Schema 隔离 + Drizzle Migration | Supabase              | Directus          |
| **工作流**   | 异步后台 + 生命周期钩子 + 事件驱动   | LiteLLM + PocketBase  | n8n + Directus    |
| **API**      | 自动生成 + 多 Token 类型 + 统一响应  | Supabase + Directus   | Strapi + LiteLLM  |
| **计费**     | 按用户分层 + 多级配额                | Appsmith + LiteLLM    | new-api           |

### 6.2 差异化优势确认

综合 12 个平台调研，AccessBase 的以下设计决策具备**独特竞争力**：

| 特性                                     | 竞争格局                  | AccessBase 优势                    |
| ---------------------------------------- | ------------------------- | ---------------------------------- |
| **RBAC1 角色继承**                       | 8/8 管理平台均无角色继承  | 唯一支持角色继承的 IAM 平台        |
| **WebAuthn + OAuth + LDAP + JWT 全覆盖** | 多数平台仅支持 2-3 种     | 认证方式最全面                     |
| **审计日志为核心功能**                   | 5/8 平台将审计锁在付费版  | 社区版即包含完整审计               |
| **SSO 为核心功能**                       | 6/8 平台将 SSO 锁在付费版 | 社区版即包含 SSO                   |
| **Fastify + Drizzle + React + AntD**     | 无平台使用此组合          | 现代工具链 + 类型安全 + 最大人才池 |

### 6.3 应避免的反模式（跨平台汇总）

| 反模式                 | 出现平台                   | AccessBase 正确做法  |
| ---------------------- | -------------------------- | -------------------- |
| CouchDB 做主存储       | Budibase                   | PostgreSQL 16        |
| MongoDB 做关系型数据   | Appsmith                   | PostgreSQL 16        |
| Koa.js（生态小）       | Budibase, Strapi, NocoBase | Fastify              |
| Express（性能低）      | Directus                   | Fastify              |
| Knex.js（无类型安全）  | Directus, Strapi           | Drizzle ORM          |
| TypeORM（DX 差）       | ToolJet, n8n               | Drizzle ORM          |
| SQLite 唯一            | PocketBase, n8n(默认)      | PostgreSQL           |
| HS256 JWT              | PocketBase                 | RS256                |
| 单容器 6 进程          | Appsmith (8GB RAM)         | 独立服务部署         |
| SSO/审计锁付费         | 5+ 平台                    | 核心功能免费         |
| 扁平 RBAC 无继承       | 所有 8 个平台              | RBAC1 角色继承       |
| Flows 无沙箱           | Directus                   | isolated-vm 沙箱执行 |
| Vue/Svelte（人才池小） | Directus, n8n, Budibase    | React                |

### 6.4 实施优先级

| 优先级 | 内容                                      | 参考来源              | 预计工期  |
| ------ | ----------------------------------------- | --------------------- | --------- |
| **P0** | Auth Schema 隔离 + Drizzle Migration 设计 | Supabase              | 设计阶段  |
| **P0** | 三层生命周期钩子（L0 包）                 | PocketBase            | 设计阶段  |
| **P0** | 审计日志异步写入架构                      | LiteLLM               | 设计阶段  |
| **P1** | Auth Provider 插件接口                    | new-api + LiteLLM     | L0 包实施 |
| **P1** | 多 Token 类型 + API Key 生命周期          | Directus + Strapi     | L0 包实施 |
| **P1** | 统一响应格式 + 限流                       | LiteLLM + PocketBase  | L0 包实施 |
| **P2** | 事件驱动操作链（IAM 自动化）              | n8n + Directus        | L1 包     |
| **P2** | 配额管理系统                              | LiteLLM + Appsmith    | L1 包     |
| **P3** | 前端插件扩展体系                          | Directus 6 类前端扩展 | L2 包     |
| **P3** | 工作流可视化编辑器                        | n8n                   | Pro 版    |

---

_本报告综合分析了 12 个参考平台在 5 大技术维度的架构模式，为 AccessBase 提供架构决策依据。各平台数据基于 2026-08-21 调研。_
