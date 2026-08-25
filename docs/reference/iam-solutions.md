# IAM（身份与访问管理）开源解决方案对比分析

> **生成日期**: 2026-08-21  
> **目的**: 为 AccessBase 项目提供 IAM 解决方案参考，评估 Keycloak、Casdoor、Authelia、Logto、Ory 五大方案的技术特点、优缺点及可借鉴之处。

---

## 目录

1. [Keycloak](#1-keycloak)
2. [Casdoor](#2-casdoor)
3. [Authelia](#3-authelia)
4. [Logto](#4-logto)
5. [Ory](#5-ory)
6. [对比总结](#6-对比总结)
7. [AccessBase 可借鉴点](#7-accessbase-可借鉴点)

---

## 1. Keycloak

### 1.1 项目概述

**Keycloak** 是 Red Hat 支持的开源身份与访问管理解决方案，是目前最成熟、功能最全面的 IAM 平台之一。

- **官网**: https://www.keycloak.org/
- **GitHub**: https://github.com/keycloak/keycloak
- **定位**: 企业级全功能 IAM 服务器
- **首次发布**: 2014 年
- **许可证**: Apache License 2.0

### 1.2 技术栈

| 层级         | 技术                                      |
| ------------ | ----------------------------------------- |
| **后端语言** | Java                                      |
| **Web 框架** | Quarkus（从 WildFly 迁移）                |
| **数据库**   | PostgreSQL, MySQL, MariaDB, Oracle, MSSQL |
| **缓存**     | Infinispan（内置分布式缓存）              |
| **协议实现** | OpenID Connect, OAuth 2.0, SAML 2.0       |
| **前端**     | React（管理控制台）                       |
| **部署**     | Docker, Kubernetes, OpenShift             |

### 1.3 认证特性

| 特性                    | 支持情况    | 说明                                                                                           |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| **OAuth 2.0 / OIDC**    | ✅ 完整支持 | 支持所有授权流程：Authorization Code, Implicit, Client Credentials, Device Authorization, CIBA |
| **SAML 2.0**            | ✅ 完整支持 | 企业级 SSO 集成                                                                                |
| **LDAP / AD**           | ✅ 内置支持 | 用户联邦，支持多个 LDAP 服务器                                                                 |
| **WebAuthn / Passkeys** | ✅ 原生支持 | FIDO2 认证，支持无密码登录                                                                     |
| **TOTP / MFA**          | ✅ 原生支持 | Google Authenticator, FreeOTP, 恢复码                                                          |
| **社交登录**            | ✅ 原生支持 | Google, GitHub, Facebook, Twitter 等                                                           |
| **身份代理**            | ✅ 原生支持 | 可连接其他 OIDC/SAML IdP                                                                       |
| **用户自助注册**        | ✅ 可配置   | 自定义注册流程，reCAPTCHA 支持                                                                 |
| **密码策略**            | ✅ 可配置   | 自定义密码策略（长度、复杂度、历史）                                                           |
| **细粒度授权**          | ✅ 内置     | 基于策略的授权服务（RBAC, ABAC）                                                               |
| **Kerberos**            | ✅ 桥接支持 | SSSD 集成，FreeIPA/IdM 支持                                                                    |
| **X.509 证书**          | ✅ 支持     | 客户端证书认证                                                                                 |
| **会话管理**            | ✅ 完整     | 管理员和用户都可查看/管理会话                                                                  |
| **审计日志**            | ✅ 支持     | 事件监听和日志记录                                                                             |

### 1.4 优点

1. **功能最全面**: 涵盖几乎所有 IAM 场景，从社交登录到企业 SSO
2. **企业级成熟度**: Red Hat 支持，大规模生产验证
3. **协议标准完整**: OIDC, OAuth 2.0, SAML 2.0 全部完整实现
4. **用户联邦强大**: LDAP/AD 集成成熟，支持 SSSD
5. **扩展性强**: SPI（Service Provider Interface）机制允许深度定制
6. **社区活跃**: 10k+ GitHub Stars，大量文档和社区资源
7. **Admin Console 完善**: Web 管理界面功能丰富
8. **支持多租户**: Realm 机制天然支持多租户
9. **集群支持**: 内置 Infinispan 缓存，支持高可用集群
10. **标准化输出**: Token Mappers 可自定义 Token 中的 Claims

### 1.5 缺点

1. **资源消耗大**: Java 应用，启动慢、内存占用高（最低 512MB，推荐 2GB+）
2. **部署复杂**: 需要数据库、缓存等外部依赖
3. **配置繁琐**: 管理控制台选项过多，学习曲线陡峭
4. **自定义 UI 困难**: 内置登录页面自定义有限，深度定制需要主题开发
5. **不适合微服务轻量化**: 对于简单场景过于重量级
6. **升级风险**: 版本间迁移可能有兼容性问题
7. **调试困难**: 日志信息有时不够清晰

### 1.6 AccessBase 可借鉴点

- **Realm 机制**: 多租户隔离设计，可参考其 Realm 概念
- **User Federation**: LDAP/AD 集成架构，用户同步策略
- **Identity Brokering**: 身份代理模式，连接外部 IdP 的设计
- **Authentication Flows**: 可自定义认证流程（Step-up Authentication）
- **Token Mapper**: Token Claims 自定义机制
- **SPI 扩展机制**: 插件化扩展架构

---

## 2. Casdoor

### 2.1 项目概述

**Casdoor** 是一个 UI-first 的开源 IAM/SSO 平台，强调易用性和快速集成。2025 年起增加了 AI Agent 支持（MCP Gateway）。

- **官网**: https://casdoor.ai/
- **GitHub**: https://github.com/casdoor/casdoor
- **定位**: UI-first IAM/SSO 平台，AI-First 设计
- **首次发布**: 2021 年
- **许可证**: Apache License 2.0

### 2.2 技术栈

| 层级         | 技术                                   |
| ------------ | -------------------------------------- |
| **后端语言** | Go                                     |
| **Web 框架** | Beego                                  |
| **前端框架** | React                                  |
| **数据库**   | MySQL, PostgreSQL, SQLite, 等          |
| **缓存**     | Redis（可选）                          |
| **协议实现** | OAuth 2.0, OIDC, SAML, CAS, LDAP, SCIM |
| **授权引擎** | Casbin（ACL, RBAC, ABAC）              |
| **部署**     | Docker, Kubernetes                     |

### 2.3 认证特性

| 特性                    | 支持情况       | 说明                                          |
| ----------------------- | -------------- | --------------------------------------------- |
| **OAuth 2.0 / OIDC**    | ✅ 完整支持    | OAuth 2.x 和 OpenID Connect                   |
| **SAML 2.0**            | ✅ 支持        | 企业 SSO 集成                                 |
| **CAS**                 | ✅ 支持        | 中央认证服务                                  |
| **LDAP**                | ✅ 支持        | 目录服务集成                                  |
| **SCIM 2.0**            | ✅ 支持        | 用户自动配置                                  |
| **WebAuthn / Passkeys** | ✅ 支持        | 无密码认证                                    |
| **TOTP / MFA**          | ✅ 支持        | 多因素认证                                    |
| **Face ID**             | ✅ 支持        | 生物识别认证                                  |
| **社交登录**            | ✅ 50+ 提供商  | Google, GitHub, Azure AD, WeChat, DingTalk 等 |
| **RBAC**                | ✅ 基于 Casbin | 角色访问控制                                  |
| **多租户**              | ✅ 组织支持    | 组织级 SSO、域名验证、自定义品牌              |
| **审计日志**            | ✅ 完整        | 可导出到 SIEM                                 |
| **Webhooks**            | ✅ 支持        | 事件驱动集成                                  |
| **MCP Gateway**         | ✅ 2025 新增   | AI Agent 管理，Model Context Protocol         |
| **A2A Protocol**        | ✅ 支持        | Agent-to-Agent 通信                           |

### 2.4 优点

1. **UI-first 设计**: Web 管理界面直观易用
2. **快速集成**: 提供多语言 SDK（Go, Java, Python, Node.js 等），几分钟集成
3. **Casbin 授权**: 灵活的策略引擎，支持 ACL/RBAC/ABAC
4. **AI-First 特色**: MCP Gateway 支持，适合 AI Agent 场景
5. **社交登录丰富**: 50+ 社交和企业身份提供商
6. **部署简单**: 单一 Go 二进制 + 数据库即可运行
7. **多语言 SDK**: 官方支持多种语言的 SDK
8. **社区活跃**: 10k+ Stars，中文社区活跃
9. **Webhook 支持**: 事件驱动架构，易于集成

### 2.5 缺点

1. **相对年轻**: 2021 年发布，生产验证时间较短
2. **Beego 框架**: 国内流行但国际社区较小
3. **文档质量不一**: 部分文档不够详细
4. **企业功能限制**: 部分高级功能需要付费版本
5. **性能基准缺乏**: 缺少大规模性能测试数据

### 2.6 AccessBase 可借鉴点

- **UI-first 理念**: 管理界面设计思路，用户体验优先
- **Casbin 集成**: 授权策略引擎的集成方式
- **MCP Gateway**: AI Agent 认证架构（适合未来 AI 功能）
- **Webhook 机制**: 事件驱动集成设计
- **社交登录配置**: 提供商配置界面设计
- **组织/多租户**: 组织级别的隔离和品牌定制

---

## 3. Authelia

### 3.1 项目概述

**Authelia** 是一个专注于反向代理集成的认证授权门户，提供 2FA 和 SSO 功能。它是反向代理的"伴侣"，而非独立的 IAM 服务器。

- **官网**: https://www.authelia.com/
- **GitHub**: https://github.com/authelia/authelia
- **定位**: 反向代理认证伴侣，SSO 门户
- **首次发布**: 2016 年
- **许可证**: Apache License 2.0
- **GitHub Stars**: 28,200+

### 3.2 技术栈

| 层级           | 技术                                           |
| -------------- | ---------------------------------------------- |
| **后端语言**   | Go (85.6%)                                     |
| **前端**       | TypeScript (12.1%)                             |
| **配置存储**   | SQLite, MySQL, PostgreSQL                      |
| **会话存储**   | Redis（推荐用于高可用）                        |
| **协议实现**   | OpenID Connect 1.0, OAuth 2.0                  |
| **部署**       | Docker, Kubernetes (Helm), 静态二进制          |
| **支持的代理** | nginx, Traefik, Caddy, HAProxy, Skipper, Envoy |

### 3.3 认证特性

| 特性                    | 支持情况             | 说明                                                          |
| ----------------------- | -------------------- | ------------------------------------------------------------- |
| **OpenID Connect 1.0**  | ✅ OpenID Certified™ | Basic OP / Implicit OP / Hybrid OP / Form Post OP / Config OP |
| **OAuth 2.0**           | ✅ 支持              | 完整的 OAuth 2.0 实现                                         |
| **SAML**                | ❌ 不支持            | 不支持 SAML（通过反向代理模式替代）                           |
| **LDAP**                | ✅ 支持              | 用户目录集成                                                  |
| **WebAuthn / Passkeys** | ✅ 支持              | FIDO2 安全密钥，无密码登录                                    |
| **TOTP**                | ✅ 支持              | 基于时间的一次性密码                                          |
| **Duo Push**            | ✅ 支持              | 移动推送通知 2FA                                              |
| **密码策略**            | ✅ 内置              | 密码复杂度策略                                                |
| **访问控制**            | ✅ 细粒度            | 基于子域、用户、组、URI、方法、网络的规则                     |
| **失败锁定**            | ✅ 内置              | 多次失败后锁定账户（Regulation）                              |
| **用户自助**            | ✅ 支持              | 密码重置、2FA 设备管理                                        |

### 3.4 优点

1. **反向代理集成深度**: 与 nginx/Traefik/Caddy 等深度集成，架构清晰
2. **OpenID Certified™**: OIDC 实现经过官方认证
3. **资源消耗低**: Go 单二进制，内存占用小
4. **配置简洁**: YAML 配置，规则清晰
5. **高可用设计**: Redis 会话存储，支持水平扩展
6. **社区活跃**: 28k+ Stars，文档完善
7. **安全聚焦**: 专注于认证安全，攻击防护强
8. **Kubernetes 原生**: Helm Charts 支持，K8s 集成好
9. **正向代理模式**: Trusted Header SSO 简化集成

### 3.5 缺点

1. **非独立 IAM**: 依赖反向代理，不能独立作为身份服务器
2. **不支持 SAML**: 无法与需要 SAML 的企业 IdP 集成
3. **用户管理简单**: 没有复杂的用户管理界面
4. **无社交登录内置**: 社交登录需要额外配置
5. **授权功能有限**: 主要面向访问控制，非细粒度授权
6. **UI 自定义有限**: 登录页面自定义选项较少

### 3.6 AccessBase 可借鉴点

- **反向代理集成模式**: ForwardAuth/Trusted Header SSO 设计
- **细粒度访问控制规则**: 基于多维度的访问控制策略
- **Regulation 机制**: 失败尝试锁定策略
- **OpenID Certified**: OIDC 实现的认证标准
- **低资源设计**: Go 语言的轻量级部署模式
- **配置简洁性**: YAML 配置的清晰结构

---

## 4. Logto

### 4.1 项目概述

**Logto** 是面向 SaaS 和 AI 应用的现代认证授权基础设施，基于 OIDC 和 OAuth 2.1 构建，强调开发者体验和快速集成。

- **官网**: https://logto.io/
- **文档**: https://docs.logto.io/
- **GitHub**: https://github.com/logto-io/logto
- **定位**: 现代 SaaS/AI 应用认证基础设施
- **首次发布**: 2022 年
- **许可证**: AGPL-3.0（开源版）

### 4.2 技术栈

| 层级         | 技术                                 |
| ------------ | ------------------------------------ |
| **后端语言** | TypeScript / Node.js                 |
| **核心库**   | node-oidc-provider（认证 OIDC 实现） |
| **前端框架** | React                                |
| **数据库**   | PostgreSQL                           |
| **包管理**   | pnpm monorepo                        |
| **协议实现** | OAuth 2.1, OIDC, SAML                |
| **部署**     | Docker Compose, Node.js              |

### 4.3 认证特性

| 特性               | 支持情况    | 说明                                    |
| ------------------ | ----------- | --------------------------------------- |
| **OAuth 2.1**      | ✅ 原生支持 | 最新 OAuth 2.1 规范                     |
| **OpenID Connect** | ✅ 完整支持 | 基于 node-oidc-provider                 |
| **SAML 2.0**       | ✅ 支持     | SP-initiated 流程，IdP-initiated 规划中 |
| **MFA**            | ✅ 支持     | Passkeys, TOTP, 备份码                  |
| **Passkeys**       | ✅ 支持     | WebAuthn 无密码登录                     |
| **社交登录**       | ✅ 支持     | Google, Facebook, Azure AD, Okta 等     |
| **企业 SSO**       | ✅ 支持     | Okta, Entra, SAML IdP                   |
| **多租户**         | ✅ 组织支持 | 组织级 RBAC、成员邀请、JIT 配置         |
| **M2M 认证**       | ✅ 支持     | Client Credentials 流程                 |
| **设备授权**       | ✅ 支持     | OAuth 2.0 Device Authorization Grant    |
| **PAT**            | ✅ 支持     | Personal Access Token                   |
| **账户接管**       | ✅ 支持     | 用户模拟功能                            |
| **MCP Server**     | ✅ 支持     | AI 工具集成                             |

### 4.4 优点

1. **TypeScript 原生**: 与 AccessBase 技术栈一致，易于参考
2. **现代协议**: OAuth 2.1 + OIDC，符合最新标准
3. **开发者体验优秀**: 30+ 框架的 SDK，快速集成
4. **UI 精美**: 预构建的登录页面设计现代
5. **多租户支持**: 组织级别的完整隔离
6. **M2M 认证**: 服务间认证支持
7. **pnpm monorepo**: 与 AccessBase 的包管理方式一致
8. **API 设计**: Management API, Experience API, Account API 分层清晰
9. **SOC 2 Type II**: 安全合规认证
10. **MCP 支持**: AI Agent 认证场景

### 4.5 缺点

1. **AGPL 许可**: 开源版使用 AGPL-3.0，有传染性
2. **相对年轻**: 2022 年发布，生产验证较少
3. **OIDC 实现依赖库**: 使用第三方 node-oidc-provider，非自研
4. **SAML 支持不完整**: IdP-initiated 流程尚未支持
5. **企业功能收费**: 部分高级功能需要付费
6. **数据库限制**: 仅支持 PostgreSQL

### 4.6 AccessBase 可借鉴点

- **TypeScript 技术栈**: 直接参考其实现模式
- **API 分层设计**: Management API / Experience API / Account API 的三层 API 架构
- **pnpm monorepo**: 包结构和依赖管理
- **登录体验设计**: 预构建 UI 组件和流程设计
- **多租户/组织**: 组织级别的隔离和 RBAC 设计
- **M2M 认证**: 服务间认证模式
- **MCP 集成**: AI Agent 认证方案

---

## 5. Ory

### 5.1 项目概述

**Ory** 是一个模块化的开源身份与访问管理平台，采用微服务架构，每个组件负责特定功能。开发者可以根据需求选择组合。

- **官网**: https://www.ory.com/
- **GitHub**: https://github.com/ory （多个仓库）
- **定位**: 模块化云原生 IAM 平台
- **许可证**: Apache License 2.0

### 5.2 技术栈

| 层级         | 技术                                        |
| ------------ | ------------------------------------------- |
| **后端语言** | Go                                          |
| **前端参考** | React (Next.js)                             |
| **数据库**   | PostgreSQL, MySQL, SQLite                   |
| **协议实现** | OAuth 2.0, OIDC, SAML (via Polis), WebAuthn |
| **部署**     | Docker, Kubernetes (Helm Charts)            |
| **架构模式** | 微服务/模块化                               |

### 5.3 核心组件

| 组件               | 职责                    | 说明                                    |
| ------------------ | ----------------------- | --------------------------------------- |
| **Ory Kratos**     | 身份管理与认证          | 用户注册、登录、MFA、账户恢复、会话管理 |
| **Ory Hydra**      | OAuth 2.0 / OIDC 服务器 | Token 发放、授权、SSO                   |
| **Ory Keto**       | 细粒度授权              | 基于 Google Zanzibar 的关系型授权       |
| **Ory Polis**      | 企业 SSO 桥接           | SAML → OIDC 桥接，SCIM 目录同步         |
| **Ory Oathkeeper** | 访问代理                | 请求级访问控制、Zero Trust 实施         |

### 5.4 认证特性（Ory Kratos）

| 特性                    | 支持情况           | 说明                 |
| ----------------------- | ------------------ | -------------------- |
| **OAuth 2.0 / OIDC**    | ✅ 通过 Hydra      | 授权和 Token 发放    |
| **WebAuthn / Passkeys** | ✅ 原生支持        | FIDO2 无密码登录     |
| **TOTP / MFA**          | ✅ 原生支持        | 多因素认证           |
| **社交登录**            | ✅ 支持            | 任意 OIDC 提供商     |
| **SAML**                | ✅ 通过 Polis      | SAML-OIDC 桥接       |
| **Magic Link**          | ✅ 支持            | 无密码邮件链接       |
| **SMS**                 | ✅ 支持            | 短信认证             |
| **会话管理**            | ✅ 原生支持        | Cookie 和 JWT 会话   |
| **账户恢复**            | ✅ 完整            | 密码重置、安全码     |
| **身份验证**            | ✅ 支持            | 邮箱、手机、地址验证 |
| **细粒度授权**          | ✅ 通过 Keto       | Google Zanzibar 模型 |
| **Zero Trust**          | ✅ 通过 Oathkeeper | 请求级访问控制       |

### 5.5 优点

1. **模块化架构**: 按需组合，不强制全家桶
2. **云原生设计**: 从零设计面向云原生，Kubernetes 友好
3. **Headless 设计**: 无内置 UI，完全 API 驱动，前端自由度最高
4. **Zanzibar 授权**: Keto 实现了 Google Zanzibar 的关系型授权
5. **部署灵活**: 开源 → 企业许可证 → Ory Network 三种模式
6. **Go 语言**: 高性能、低资源消耗
7. **标准化 API**: OpenAPI 规范，自动生成 SDK
8. **Zero Trust 支持**: Oathkeeper 实现 BeyondCorp 模式
9. **文档质量高**: 技术文档详尽
10. **社区活跃**: Kratos 13k+ Stars

### 5.6 缺点

1. **组件分散**: 需要部署多个服务，运维复杂
2. **学习曲线陡**: 概念多（Kratos/Hydra/Keto/Polis/Oathkeeper），入门门槛高
3. **无内置 UI**: 需要自建前端，开发成本高
4. **配置复杂**: YAML 配置项繁多
5. **企业功能收费**: SAML、多租户等需要 OEL
6. **社区支持有限**: 相比 Keycloak 社区资源较少
7. **调试困难**: 多服务间的交互排查复杂

### 5.7 AccessBase 可借鉴点

- **模块化架构**: 按职责拆分服务的设计理念
- **Headless API 设计**: 纯 API 驱动的认证系统
- **Zanzibar 授权模型**: Keto 的关系型授权设计
- **Zero Trust 模式**: Oathkeeper 的访问代理设计
- **Identity Schema**: 可自定义的用户身份模式
- **Session 管理**: Cookie/JWT 双模会话管理
- **Self-service 流程**: 用户自助服务流程设计（注册、登录、恢复、验证）

---

## 6. 对比总结

### 6.1 技术栈对比

| 方案         | 后端语言             | 前端       | 数据库            | 部署复杂度   |
| ------------ | -------------------- | ---------- | ----------------- | ------------ |
| **Keycloak** | Java (Quarkus)       | React      | PostgreSQL/MySQL  | 高           |
| **Casdoor**  | Go (Beego)           | React      | MySQL/PostgreSQL  | 中           |
| **Authelia** | Go                   | TypeScript | SQLite/PostgreSQL | 低           |
| **Logto**    | TypeScript (Node.js) | React      | PostgreSQL        | 中           |
| **Ory**      | Go                   | 自建       | PostgreSQL/MySQL  | 高（多组件） |

### 6.2 功能对比

| 功能            | Keycloak   | Casdoor     | Authelia      | Logto | Ory        |
| --------------- | ---------- | ----------- | ------------- | ----- | ---------- |
| **OAuth 2.0**   | ✅         | ✅          | ✅            | ✅    | ✅         |
| **OIDC**        | ✅         | ✅          | ✅ Certified™ | ✅    | ✅         |
| **SAML 2.0**    | ✅         | ✅          | ❌            | ✅    | ✅ (Polis) |
| **LDAP**        | ✅         | ✅          | ✅            | ❌    | ❌         |
| **WebAuthn**    | ✅         | ✅          | ✅            | ✅    | ✅         |
| **MFA**         | ✅         | ✅          | ✅            | ✅    | ✅         |
| **社交登录**    | ✅         | ✅ 50+      | ❌            | ✅    | ✅         |
| **RBAC**        | ✅         | ✅ (Casbin) | ❌            | ✅    | ✅ (Keto)  |
| **多租户**      | ✅ (Realm) | ✅          | ❌            | ✅    | ✅ (OEL)   |
| **用户管理 UI** | ✅         | ✅          | 简单          | ✅    | ❌         |
| **AI/MCP 支持** | ❌         | ✅          | ❌            | ✅    | ❌         |
| **Zero Trust**  | ❌         | ❌          | ❌            | ❌    | ✅         |

### 6.3 定位对比

| 方案         | 最佳场景                      | 不适合场景               |
| ------------ | ----------------------------- | ------------------------ |
| **Keycloak** | 企业级全功能 IAM              | 轻量级应用、资源受限环境 |
| **Casdoor**  | 快速集成、UI-first、AI Agent  | 极高并发、需要深度定制   |
| **Authelia** | 反向代理认证、K8s 环境        | 需要 SAML、社交登录      |
| **Logto**    | SaaS/AI 应用、TypeScript 团队 | 需要 LDAP、极低资源      |
| **Ory**      | 微服务、云原生、Zero Trust    | 快速启动、不想自建 UI    |

---

## 7. AccessBase 可借鉴点

基于 AccessBase 的技术栈（TypeScript / Fastify / React / Ant Design / Drizzle ORM / PostgreSQL / Redis）和设计目标（企业 IAM），以下是最值得借鉴的方面：

### 7.1 架构设计

| 来源         | 借鉴点                                        | AccessBase 适用性     |
| ------------ | --------------------------------------------- | --------------------- |
| **Logto**    | API 分层（Management / Experience / Account） | ⭐⭐⭐ 直接参考       |
| **Ory**      | 模块化服务设计                                | ⭐⭐⭐ 可参考拆分策略 |
| **Keycloak** | Realm 多租户机制                              | ⭐⭐⭐ 多租户核心参考 |
| **Casdoor**  | UI-first 管理界面                             | ⭐⭐ 管理控制台设计   |

### 7.2 认证流程

| 来源           | 借鉴点                      | AccessBase 适用性   |
| -------------- | --------------------------- | ------------------- |
| **Keycloak**   | Authentication Flows 可定制 | ⭐⭐⭐ 认证流程引擎 |
| **Ory Kratos** | Self-service 流程设计       | ⭐⭐⭐ 用户自助服务 |
| **Authelia**   | 失败尝试锁定（Regulation）  | ⭐⭐ 安全防护       |
| **Logto**      | 登录体验 UI 设计            | ⭐⭐ 前端参考       |

### 7.3 授权模型

| 来源         | 借鉴点                   | AccessBase 适用性 |
| ------------ | ------------------------ | ----------------- |
| **Ory Keto** | Zanzibar 关系型授权      | ⭐⭐⭐ 细粒度授权 |
| **Casdoor**  | Casbin 集成（RBAC/ABAC） | ⭐⭐⭐ 策略引擎   |
| **Keycloak** | 细粒度授权服务           | ⭐⭐ 策略评估     |

### 7.4 技术实现

| 来源         | 借鉴点                     | AccessBase 适用性       |
| ------------ | -------------------------- | ----------------------- |
| **Logto**    | TypeScript + pnpm monorepo | ⭐⭐⭐ 直接参考代码结构 |
| **Ory**      | Headless API + 身份模式    | ⭐⭐⭐ API 设计         |
| **Authelia** | Go 轻量级部署              | ⭐⭐ 部署策略           |
| **Casdoor**  | Webhook 事件驱动           | ⭐⭐ 集成机制           |

### 7.5 优先参考顺序

基于与 AccessBase 技术栈和目标的匹配度：

1. **Logto** — TypeScript 原生、pnpm monorepo、OAuth 2.1、多租户，技术栈最匹配
2. **Ory** — 模块化架构、Headless API、Zanzibar 授权，设计理念最先进
3. **Keycloak** — 功能最全面，多租户和用户联邦成熟度最高
4. **Casdoor** — UI-first、Casbin 授权、AI Agent 支持，快速参考
5. **Authelia** — 反向代理集成模式、访问控制规则，补充参考

---

_本文档基于 2026-08-21 的网络搜索和 GitHub 信息整理，各方案的版本和特性可能随时间更新。_
