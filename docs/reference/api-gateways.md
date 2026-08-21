# AI API 网关项目参考分析

**更新日期**: 2026-08-20
**用途**: AccessBase 架构设计参考

---

## 目录

1. [One API](#1-one-api)
2. [new-api](#2-new-api)
3. [LiteLLM](#3-litellm)
4. [对比分析](#4-对比分析)
5. [AccessBase 参考点](#5-accessbase-参考点)

---

## 1. One API

### 1.1 概述

One API 是由 songquanpeng 开发的 LLM API 管理与分发系统，是国内最早的 AI API 网关项目之一。它通过标准化的 OpenAI API 格式统一访问多种大语言模型，主要用于 API Key 管理与二次分发。

- **仓库**: https://github.com/songquanpeng/one-api
- **语言**: Go
- **许可证**: MIT
- **定位**: LLM API 统一网关、Key 管理与分发

### 1.2 技术栈

| 层级 | 技术选型 |
|------|----------|
| 后端框架 | Go + Gin |
| ORM | GORM v2 |
| 前端框架 | React (早期版本，Ant Design) |
| 数据库 | SQLite（默认）/ MySQL 8.0 / PostgreSQL |
| 缓存 | Redis（可选）+ 内存缓存 |
| 认证 | JWT、GitHub OAuth、微信公众号、邮箱 |
| 部署 | 单二进制文件 / Docker |

### 1.3 核心功能

**认证与权限**:
- 用户管理（邮箱注册登录、GitHub OAuth、微信公众号授权）
- Token 管理（过期时间、额度限制、IP 白名单、模型访问控制）
- 用户分组与渠道分组（不同组使用不同倍率）

**计费与配额**:
- Token 级别的使用量追踪
- 配额预扣费机制
- 兑换码充值系统
- 详细的请求日志

**路由与负载均衡**:
- 渠道管理（批量创建、自动测试、余额更新）
- 加权负载均衡（多渠道轮询）
- 指定渠道路由（Token 后附加 Channel ID）
- 失败自动重试

**API 格式支持**:
- OpenAI Chat Completions
- OpenAI Image
- OpenAI Audio
- OpenAI Embeddings
- Claude Messages
- Google Gemini

### 1.4 架构特点

```
客户端 → Nginx → One API
                   ├─ Controller（请求处理）
                   ├─ Relay（中继转发）
                   │   ├─ OpenAI Adapter
                   │   ├─ Claude Adapter
                   │   ├─ Gemini Adapter
                   │   └─ ...
                   ├─ Model（数据模型）
                   └─ Middleware（认证、限流）
```

- **Master/Slave 多机部署**: Master 负责写入，Slave 处理请求
- **批量更新**: 批量写入数据库减少负载
- **同步频率**: Slave 节点定期从数据库同步配置

### 1.5 优缺点

**优点**:
- ✅ 简单易用，单二进制部署
- ✅ MIT 许可，社区友好
- ✅ 社区庞大，中文生态好
- ✅ 基础计费功能完备
- ✅ 轻量级，资源占用少

**缺点**:
- ❌ 前端 UI 较为简单
- ❌ 无 WebAuthn/Passkey 支持
- ❌ 无 OIDC 统一认证
- ❌ 格式转换能力有限
- ❌ 多租户隔离不够完善
- ❌ 已逐渐被 new-api 等衍生项目超越

---

## 2. new-api

### 2.1 概述

new-api 是基于 One API 二次开发的下一代 LLM 网关，由 QuantumNous 团队维护。它在 One API 基础上大幅增强了 UI、认证、计费、格式转换等功能，是目前国内最活跃的 AI API 网关项目。

- **仓库**: https://github.com/QuantumNous/new-api
- **语言**: Go
- **许可证**: AGPLv3
- **定位**: 下一代 LLM 网关与 AI 资产管理系统

### 2.2 技术栈

| 层级 | 技术选型 |
|------|----------|
| 后端框架 | Go 1.22+ + Gin |
| ORM | GORM v2 |
| 前端框架 | React 19 + TypeScript + Rsbuild + Base UI + Tailwind CSS |
| 数据库 | SQLite / MySQL 5.7.8+ / PostgreSQL 9.6+ |
| 缓存 | Redis (go-redis) + 内存缓存 |
| 认证 | JWT、WebAuthn/Passkeys、OAuth（GitHub、Discord、OIDC 等） |
| i18n | 后端 go-i18n（en/zh），前端 i18next（en/zh/zh-TW/fr/ru/ja/vi） |
| 包管理 | Bun（前端） |
| 部署 | Docker / Docker Compose / 宝塔面板 |

### 2.3 核心功能

**认证与权限**:
- JWT 认证
- WebAuthn / Passkeys（无密码登录）
- OAuth：GitHub、Discord、Telegram、LinuxDO、OIDC
- 用户分组 + 渠道分组
- Token 管理（过期、额度、IP、模型限制）

**计费与配额**:
- **表达式计费系统**（`pkg/billingexpr/`）：支持分层/动态定价
- 配额预扣费 + 结算差额
- 缓存命中计费（OpenAI、Azure、DeepSeek、Claude、Qwen）
- EPay、Stripe 充值
- 组织级别按次/按量/缓存计费
- **计费安全不变量**：永不产生负数费用，饱和边界保护

**路由与负载均衡**:
- 渠道加权随机
- 失败自动重试
- 用户级别模型限流
- 渠道健康检查与自动禁用

**API 格式转换**:
- OpenAI Compatible ⇄ Claude Messages
- OpenAI Compatible → Google Gemini
- Google Gemini → OpenAI Compatible
- OpenAI Responses API
- OpenAI Realtime API（含 Azure）
- Rerank 模型（Cohere、Jina）

**智能功能**:
- Reasoning Effort 支持（o3-mini、gpt-5、Claude thinking、Gemini thinking）
- Thinking-to-content 转换
- Midjourney-Proxy 支持
- Suno API 支持
- Dify ChatFlow 支持

### 2.4 架构特点

```
分层架构: Router → Controller → Service → Model

router/           — HTTP 路由（API、relay、dashboard、web）
controller/       — 请求处理器
service/          — 业务逻辑
model/            — 数据模型与数据库访问（GORM）
relay/            — AI API 中继/代理
  relay/channel/  — 供应商适配器（openai/、claude/、gemini/、aws/ 等）
middleware/       — 认证、限流、CORS、日志
setting/          — 配置管理（ratio、model、operation、system、performance）
common/           — 共享工具（JSON、crypto、Redis、env、rate-limit）
dto/              — 数据传输对象
constant/         — 常量定义
types/            — 类型定义
i18n/             — 国际化
oauth/            — OAuth 提供商实现
pkg/              — 内部包（cachex、ionet）
web/              — 前端（React 19、Rsbuild、Base UI、Tailwind）
```

- **relaykit 模块独立**: 可独立构建，不依赖主模块
- **多数据库兼容**: SQLite/MySQL/PostgreSQL 统一代码
- **JSON 包封装**: 统一通过 `common.Marshal/Unmarshal`
- **Pyroscope 性能分析**: 生产环境性能监控

### 2.5 优缺点

**优点**:
- ✅ UI 现代化（React 19 + Base UI + Tailwind）
- ✅ 认证体系完善（WebAuthn、OIDC、多种 OAuth）
- ✅ 计费系统成熟（表达式计费、安全不变量）
- ✅ 格式转换能力强（OpenAI ⇄ Claude ⇄ Gemini）
- ✅ i18n 支持好（7 种语言）
- ✅ 与 One API 数据完全兼容
- ✅ 活跃开发，频繁更新
- ✅ 文档完善（docs.newapi.pro）

**缺点**:
- ❌ AGPLv3 许可，商业使用受限
- ❌ Go 代码，TypeScript 项目无法直接复用
- ❌ 复杂度高（156+ 行 AGENTS.md 规范）
- ❌ 仅面向 LLM API，不适用于通用 IAM

### 2.6 与 One API 的关系

new-api 是 One API 的直接衍生项目：
- 完全兼容 One API 数据库
- 继承了 One API 的渠道/令牌/中继架构
- 大幅增强了 UI、认证、计费、格式转换
- 从 MIT 转为 AGPLv3 许可

---

## 3. LiteLLM

### 3.1 概述

LiteLLM 是由 BerriAI 开发的开源 AI 网关，支持 100+ LLM 提供商，以 OpenAI 兼容格式统一调用。它同时提供 Python SDK 和代理服务器两种使用方式，是目前功能最全面的 LLM 网关之一。

- **仓库**: https://github.com/BerriAI/litellm
- **语言**: Python（核心 Rust 加速）
- **许可证**: MIT（开源版）
- **定位**: 生产级 AI 网关，企业团队 LLM 基础设施

### 3.2 技术栈

| 层级 | 技术选型 |
|------|----------|
| 核心语言 | Python 3.10+（Rust 加速关键路径） |
| Web 框架 | FastAPI + Uvicorn |
| ORM | Prisma（PostgreSQL） |
| 缓存 | Redis + 内存双重缓存（DualCache） |
| 数据库 | PostgreSQL（必需） |
| 认证 | API Key（Virtual Keys）、JWT、OAuth2 |
| 前端 | 独立 Admin Dashboard |
| 调度 | APScheduler（后台任务） |
| 部署 | Docker / Helm / Terraform（AWS、GCP） |

### 3.3 核心功能

**认证与权限**:
- Virtual Keys（虚拟 API Key）
- Key 级别预算限制
- 团队级别预算管理
- 用户级别预算管理
- 服务器级别全局限流
- JWT / OAuth2 认证

**计费与配额**:
- 逐请求费用追踪（token 用量 × 模型单价）
- Key/User/Team 多级预算
- 费用写入 Redis 队列，批量写入 PostgreSQL
- x-litellm-response-cost 响应头
- 费用回调（Langfuse、Datadog、MLflow 等）

**路由与负载均衡**:
- Router 策略：lowest_latency、simple_shuffle 等
- 模型组（Model Group）：共享 model_name 的部署集
- 失败重试（同组内）
- Fallback 机制（跨组降级）
- A/B 测试（流量镜像）
- 部署冷却（cooldown）

**API 格式支持**:
- OpenAI Chat Completions / Responses / Embeddings / Images / Audio / Batches
- Anthropic Messages API
- Google Gemini / Vertex AI
- AWS Bedrock
- Rerank
- A2A（Agent-to-Agent）协议
- MCP（Model Context Protocol）网关
- 100+ 提供商

**高级功能**:
- Guardrails（安全护栏）
- LLM 响应缓存（Redis / 内存）
- 异步后台日志（不阻塞请求）
- Prometheus 指标
- 多节点水平扩展
- Terraform 一键部署（AWS、GCP）

### 3.4 架构特点

```
请求流:
Client → Proxy Server (FastAPI)
  ├─ Auth（user_api_key_auth）
  │   ├─ Redis Cache（Key 缓存）
  │   └─ PostgreSQL（Key 存储）
  ├─ Hooks（budget_limiter、request_limiter）
  │   └─ Redis（限流计数器）
  ├─ Router（负载均衡、fallback、retry）
  │   └─ Model Group → Deployments
  ├─ LiteLLM SDK
  │   ├─ LLM HTTP Handler（中央 HTTP 编排）
  │   ├─ Provider Transform（请求/响应转换）
  │   └─ Provider API
  └─ 后台异步
      ├─ Cost Calculator（费用计算）
      ├─ DB Writer（批量写入 PostgreSQL）
      ├─ Logging Callbacks（Langfuse、Datadog）
      └─ Rate Limit Update（Redis 计数更新）
```

**关键架构决策**:
- **请求路径无 DB 写入**: 所有 DB 事务异步后台执行
- **DualCache**: 内存 + Redis 双层缓存
- **Prisma ORM**: PostgreSQL 专用
- **Provider Transform 隔离**: 每个供应商转换独立文件
- **Helm/Terraform 生产部署**: 独立 gateway/backend/UI 服务

### 3.5 优缺点

**优点**:
- ✅ 100+ 提供商支持，覆盖面最广
- ✅ 8ms P95 延迟（1k RPS），性能优异
- ✅ 完善的多租户（Key/User/Team/Server）
- ✅ 异步后台日志，不阻塞请求
- ✅ 企业级部署方案（Helm、Terraform）
- ✅ A2A 和 MCP 网关支持（前沿功能）
- ✅ 生态集成丰富（Langfuse、Datadog、MLflow）
- ✅ MIT 开源

**缺点**:
- ❌ Python 生态，与 Go/TypeScript 项目集成有障碍
- ❌ 强依赖 PostgreSQL（不支持 SQLite/MySQL）
- ❌ 前端独立部署，UI 定制门槛高
- ❌ 无用户自助注册界面（面向团队内部）
- ❌ 不支持 WebAuthn/Passkey
- ❌ i18n 支持有限
- ❌ 企业版功能（SSO、审计）需付费

---

## 4. 对比分析

### 4.1 技术栈对比

| 维度 | One API | new-api | LiteLLM |
|------|---------|---------|---------|
| **后端语言** | Go | Go | Python (+Rust) |
| **Web 框架** | Gin | Gin | FastAPI |
| **ORM** | GORM v2 | GORM v2 | Prisma |
| **前端框架** | React (早期) | React 19 + Base UI | 独立 Admin Dashboard |
| **数据库** | SQLite/MySQL/PG | SQLite/MySQL/PG | PostgreSQL |
| **缓存** | Redis + 内存 | Redis + 内存 | Redis + 内存 (DualCache) |
| **部署** | 单二进制/Docker | Docker/Docker Compose | Docker/Helm/Terraform |
| **许可证** | MIT | AGPLv3 | MIT |

### 4.2 功能对比

| 功能 | One API | new-api | LiteLLM |
|------|---------|---------|---------|
| **供应商数量** | 20+ | 20+ | 100+ |
| **格式转换** | 基础 | 中级（OpenAI⇄Claude⇄Gemini） | 高级（全格式） |
| **负载均衡** | ✅ | ✅ | ✅（多策略） |
| **失败重试** | ✅ | ✅ | ✅（同组+跨组） |
| **Token 管理** | ✅ | ✅ | ✅（Virtual Keys） |
| **用户分组** | ✅ | ✅ | ✅（Teams） |
| **配额管理** | ✅ | ✅（表达式计费） | ✅（多级预算） |
| **WebAuthn** | ❌ | ✅ | ❌ |
| **OIDC** | ❌ | ✅ | ❌（OAuth2） |
| **i18n** | 中英 | 7 种语言 | 英文为主 |
| **MCP 网关** | ❌ | ❌ | ✅ |
| **A2A 协议** | ❌ | ❌ | ✅ |
| **Guardrails** | ❌ | ❌ | ✅ |
| **Terraform 部署** | ❌ | ❌ | ✅ |

### 4.3 架构复杂度对比

| 维度 | One API | new-api | LiteLLM |
|------|---------|---------|---------|
| **代码规模** | 中等 | 大 | 大 |
| **分层清晰度** | 一般 | 高（Router→Controller→Service→Model） | 高（Proxy→Router→SDK→Provider） |
| **模块化程度** | 一般 | 高（relaykit 独立模块） | 高（Provider Transform 隔离） |
| **配置管理** | 环境变量 | 环境变量 + 设置系统 | YAML 配置 + 环境变量 |
| **测试要求** | 基础 | 严格（计费安全不变量） | 基础 |

---

## 5. AccessBase 参考点

### 5.1 可借鉴的架构模式

**来自 new-api**:
1. **分层架构**: Router → Controller → Service → Model，职责清晰
2. **中继适配器模式**: `relay/channel/{provider}/` 每个供应商独立适配器
3. **JSON 包封装**: 统一序列化入口，便于审计和调试
4. **计费安全不变量**: 永不产生负数费用，饱和边界保护，审计日志
5. **多数据库兼容**: 统一代码支持 SQLite/MySQL/PostgreSQL

**来自 LiteLLM**:
1. **DualCache**: 内存 + Redis 双层缓存策略
2. **异步后台日志**: 请求路径无 DB 写入，后台批量处理
3. **Provider Transform 隔离**: 每个供应商转换逻辑独立文件
4. **Router 多策略**: lowest_latency、simple_shuffle、加权随机
5. **Virtual Keys**: 虚拟 Key 抽象层，支持多级预算
6. **A2A + MCP 网关**: 前沿的 Agent 互操作协议支持

### 5.2 与 AccessBase 技术栈的差异

| 维度 | AccessBase | AI API 网关 |
|------|------------|-------------|
| **后端** | Fastify + Drizzle ORM | Gin + GORM / FastAPI + Prisma |
| **前端** | React + Ant Design + Zustand | React (各异) |
| **数据库** | PostgreSQL 16 | 多数据库兼容 |
| **认证** | JWT (RS256) + OAuth 2.0 + WebAuthn + LDAP | JWT + OAuth |
| **授权** | RBAC1 + 角色继承 + 租户隔离 | 用户分组 + 渠道分组 |
| **缓存** | Redis | Redis + 内存 |
| **定位** | 通用 IAM | LLM API 网关 |

### 5.3 可参考的设计决策

| 参考点 | 来源 | AccessBase 适用性 |
|--------|------|-------------------|
| 渠道/供应商适配器模式 | new-api | ⭐⭐⭐ 可用于认证提供商插件化 |
| 表达式计费系统 | new-api | ⭐⭐ 可参考计费安全不变量 |
| DualCache 双层缓存 | LiteLLM | ⭐⭐⭐ 可直接采用 |
| 异步后台日志 | LiteLLM | ⭐⭐⭐ 可用于审计日志异步写入 |
| Virtual Keys 抽象 | LiteLLM | ⭐⭐ 可参考 Token 抽象层 |
| Provider Transform 隔离 | LiteLLM | ⭐⭐⭐ 可用于认证/授权提供商转换 |
| 多策略负载均衡 | LiteLLM | ⭐⭐ 可用于多实例部署 |
| Guardrails 安全护栏 | LiteLLM | ⭐⭐ 可参考安全策略框架 |
| A2A/MCP 协议 | LiteLLM | ⭐ 前沿参考，AccessBase 暂不需要 |
| Terraform 一键部署 | LiteLLM | ⭐⭐ 可参考基础设施即代码 |

### 5.4 不适用的设计

以下设计是 AI API 网关特有，AccessBase 不需要：

- ❌ LLM 模型路由与负载均衡（AccessBase 不是 API 代理）
- ❌ Token 用量计费（AccessBase 不处理 LLM 请求）
- ❌ 格式转换（OpenAI ⇄ Claude ⇄ Gemini）
- ❌ Stream 模式与打字机效果
- ❌ 渠道健康检查与自动禁用
- ❌ Rerank / Embedding 等 AI 特定接口

### 5.5 建议

1. **认证提供商插件化**: 参考 new-api 的 `relay/channel/` 和 LiteLLM 的 Provider Transform，为 AccessBase 设计认证提供商插件架构
2. **缓存策略**: 直接参考 LiteLLM 的 DualCache 模式（内存 + Redis）
3. **审计日志**: 参考 LiteLLM 的异步后台日志，避免审计日志阻塞主请求
4. **计费安全**: 参考 new-api 的计费安全不变量，确保配额计算不会溢出
5. **多数据库兼容**: 如果需要支持多种数据库，参考 new-api 的统一 SQL 方案

---

## 参考链接

| 项目 | 链接 |
|------|------|
| One API | https://github.com/songquanpeng/one-api |
| new-api | https://github.com/QuantumNous/new-api |
| new-api 文档 | https://docs.newapi.pro |
| LiteLLM | https://github.com/BerriAI/litellm |
| LiteLLM 文档 | https://docs.litellm.ai |
| LiteLLM 架构 | https://docs.litellm.ai/docs/proxy/architecture |
