# 概述

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§1-§7 概述/需求/参考/定义/功能/架构/迁移映射

---

## 1. 概述

**AccessBase** 是面向"任何需要后台管理与安全治理的平台"的可复用基石层，提供**认证、授权、审计、日志、迁移、主题机制、国际化、基础 CRUD** 八项能力。

对标关系：

- **品类定位**：类似 NocoBase 的命名模式（特性 + Base 后缀），但作为**中立技术品牌**（如 TanStack/Radix），不绑定任何产品品牌
- **复用方**：MediaServo（视频服务平台）、MES（制造执行系统）、企业应用平台（全功能版）等

一句话定义：

> AccessBase = 访问控制底座——为任何平台提供"谁能进来（认证）、能干什么（授权）、干了什么（审计）"的基础，附带后台框架、日志、迁移、国际化等横切能力。

---

## 2. 需求

### 2.1 背景与动机

- AccessBase 现有 15 包 + admin-ui 一体化，平台能力（Schema 驱动、插件体系）与基础能力（认证/后台/审计）耦合在同一代码库
- MediaServo（视频平台）等复用方**只需要基础能力**（登录、权限、后台、审计），不需要 Schema 驱动动态建模与插件热插拔
- 拆分后：基础能力独立成 L0 基石层，平台能力留在 L1，业务应用在 L2

### 2.2 业务需求

| 编号 | 需求           | 说明                                         |
| ---- | -------------- | -------------------------------------------- |
| R1   | 任何平台可复用 | 视频、MES、企业应用平台均可独立依赖 L0       |
| R2   | 零平台概念     | L0 不依赖 Schema 引擎、插件体系等 L1 特性    |
| R3   | 可独立发布     | 独立 npm scope `@accessbase/*`，独立版本管理 |
| R4   | 命名中立       | 复用方使用无品牌负担（不叫"XX 平台的后台"）  |
| R5   | 安全治理完整   | 认证 + 授权 + 审计三件套，作为 L0 灵魂       |
| R6   | 主题可注入     | 主题机制进 L0，品牌内容由上层注入            |

### 2.3 非功能需求

| 编号 | 需求         | 验收标准                                                   |
| ---- | ------------ | ---------------------------------------------------------- |
| N1   | 依赖最小化   | 仅框架级依赖（Fastify/antd/react），零业务依赖             |
| N2   | 零 AUDE 残留 | `grep -ri audebase` 在 L0 包内 0 命中（除文档历史引用）    |
| N3   | 品牌中立     | 无内置品牌色/Logo/产品名，默认中性设计令牌                 |
| N4   | 命名零占用   | npm scope / GitHub org 无产品级占用（2026-08-20 核查通过） |
| N5   | 独立可测     | 每包独立测试，不依赖 L1/L2 运行环境                        |

---

## 3. 参考

### 3.1 外部参考

| 参考对象                         | 借鉴点                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| NocoBase                         | 命名模式（特性 + Base）、双命名空间 i18n、插件命名空间隔离 |
| Budibase / Supabase              | `-Base` 后缀的品类识别                                     |
| TanStack / Radix                 | 中立技术品牌模式——任何业务产品可复用其组件库               |
| Odoo                             | 模块化 + 迁移按版本排序                                    |
| SmartAdmin / Soybean / PureAdmin | admin 后台 UX 参考（L0 admin 的打磨方向）                  |

### 3.2 项目内参考

- `docs/architecture.md` — D26 Refine+ProLayout 混合架构
- `docs/superpowers/specs/2026-07-23-refine-hybrid-architecture-design.md` — D26 设计
- `docs/superpowers/specs/2026-07-30-audebase-audedeck-integration-design.md` — D30 AUDEDeck（未来 L2 容器）
- `.agents/memorys/decisions.md` — D26/D29/D30/D31 决策记录
- `packages/*` — 现有 15 包实现（迁移来源）

---

## 4. 定义

### 4.1 层级模型

```
L2 应用层       MES / MediaServo（视频）/ AUDEDeck（容器壳，规划中）
                  ↑ 依赖
L1 平台层       插件热插拔 + Schema 驱动的企业应用平台（品牌待定：Weave 候选）
                  ↑ 依赖
L0 基石层       AccessBase（本文档）—— 任何平台必需的基础能力
```

依赖方向：L0 ← L1 ← L2，单向依赖，禁止反向。

### 4.2 命名定义

| 项        | 定义                                                  | 说明                                                               |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| 项目名    | **AccessBase**                                        | 访问控制底座——认证+授权+审计为灵魂                                 |
| npm scope | `@accessbase/*`                                       | 2026-08-20 核查：npm scope 404、GitHub org 404、user 404、npm 0 包 |
| 中文名    | 访问底座 / 基石套件                                   | 中文语境称呼                                                       |
| 包名      | identity / admin / audit / logging / i18n / migration | 见 §5 功能定义                                                     |
| 命名原则  | 前缀 = 特性描述词，后缀 = -Base                       | 对标 NocoBase（No-Code + Base）                                    |

**命名决策历史**（2026-08-20，供追溯）：

- 否决：Keel（teamkeel 竞品）、Keelson（6+ 活跃开发/AI 项目）、Rivet（★6000+ 云平台）、Kelson（语义不满意）、SecureBase（"安全"有攻防歧义）、SaxBase（前缀为意象词非特性词）、AuthBase（语义过窄 + npm 5 包）
- 采纳：AccessBase（特性描述准确、零占用、无歧义）

### 4.3 边界定义

**进入 L0**（任何平台必需）：

| 能力        | 来源                                            | 理由                 |
| ----------- | ----------------------------------------------- | -------------------- |
| 认证 + 授权 | `packages/auth` + `packages/rbac`               | 任何平台必需         |
| 后台框架    | `packages/admin-ui`（layout/theme/登录/管理页） | 任何平台必需         |
| 审计        | `packages/audit`                                | 安全合规横切基础     |
| 日志        | `packages/logging-infra`                        | 任何平台必需         |
| 迁移        | `packages/migration`                            | 任何数据库平台必需   |
| 国际化      | `packages/i18n`                                 | 任何平台必需         |
| 基础 CRUD   | `packages/admin-ui`（ProTable 封装）            | 任何平台管理数据必需 |

**不进入 L0**（L1 平台特性 / 上层品牌）：

| 能力                                             | 归属     | 理由                              |
| ------------------------------------------------ | -------- | --------------------------------- |
| Schema 驱动动态建模（schema-engine + schema-ui） | L1       | 平台特性，MediaServo 不需要       |
| 插件热插拔体系                                   | L1       | 平台特性                          |
| 品牌色/Logo/品牌字体                             | L1+ 注入 | L0 保持中性，BrandTokens 接口注入 |
| 业务页面（MES 等）                               | L2       | 业务归应用层                      |

**主题分层**（机制进 L0，品牌留上层）：

- L0：ThemeProvider/ThemeContext、亮暗切换、持久化、默认中性令牌、BrandTokens 注入接口
- L1：注入平台品牌令牌（品牌色/字体/Logo）
- L2：继承或覆盖

### 4.4 术语表

| 术语        | 含义                                                         |
| ----------- | ------------------------------------------------------------ |
| L0 基石层   | 可被任何平台复用的基础能力集合（AccessBase）                 |
| L1 平台层   | 插件热插拔 + Schema 驱动的企业应用平台                       |
| L2 应用层   | 具体业务产品（MES / MediaServo / AUDEDeck）                  |
| BrandTokens | L0 admin 暴露的品牌令牌注入接口                              |
| 访问控制    | 认证（Authentication）+ 授权（Authorization）+ 审计（Audit） |

---

## 5. 功能定义

### 5.1 `@accessbase/identity` — 身份与访问（IAM）

- **内容**：JWT 认证（签发/验证/token_version）、Refresh Token、LDAP SSO（AES-256-GCM 加密）、RBAC 权限引擎、用户/角色/租户模型、ACL
- **来源**：`packages/auth` + `packages/rbac` + 用户/角色管理页（admin-ui 迁出）
- **接口要点**：`AuthService`（认证）、`PermissionEngine`（授权）、`LdapProvider`（SSO）、`ACLGuard`（前端权限）、`UserService`/`RoleService`（身份模型）
- **边界**：不含攻防安全（WAF/漏洞扫描/加密体系——那是安全产品的范畴）

### 5.2 `@accessbase/admin` — 后台框架

- **内容**：登录页、ProLayout 外壳、主题机制（ThemeProvider/ThemeContext/亮暗切换/持久化/BrandTokens）、菜单/面包屑/用户头像、基础 CRUD 框架（ProTable 封装：分页/筛选/表格/表单）、用户/角色/租户管理页
- **来源**：`packages/admin-ui`（业务页面迁出后）
- **边界**：不含任何具体品牌样式；不含业务页面

### 5.3 `@accessbase/audit` — 审计日志

- **内容**：API 写操作自动记录（onResponse hook）、审计查询接口、审计管理页
- **来源**：`packages/audit` + AuditLogPage

### 5.4 `@accessbase/logging` — 结构化日志

- **内容**：pino 结构化日志、redaction（敏感字段脱敏）、X-Request-ID、日志级别管理
- **来源**：`packages/logging-infra`

### 5.5 `@accessbase/i18n` — 国际化

- **内容**：I18nEngine、Accept-Language、双命名空间（包名 + client）、zh/en 语言包
- **来源**：`packages/i18n`

### 5.6 `@accessbase/migration` — 数据库迁移

- **内容**：Scanner→Resolver→Executor→Runner、SemVer 排序、三阶段迁移（preload→postsync→postload）
- **来源**：`packages/migration`

---

## 6. 架构

### 6.1 包间依赖

```
@accessbase/migration  ← 无依赖（最底层）
@accessbase/logging    ← 无依赖
@accessbase/i18n       ← 无依赖
@accessbase/identity   ← 依赖 logging/i18n（可选）
@accessbase/audit      ← 依赖 identity（身份关联）
@accessbase/admin      ← 依赖 identity/audit/i18n（宿主）
```

### 6.2 与上层关系

- L1 平台层依赖全部 L0 包 + 自有能力（schema-engine/schema-ui/plugin-*）
- L2 应用层依赖 L0（或 L1），禁止绕过 L1 反向引用
- MediaServo 典型依赖：`@accessbase/identity` + `@accessbase/admin` + `@accessbase/audit` + `@accessbase/logging`（+ i18n/migration 按需）

---

## 7. 迁移映射

| 现有包                                                          | 去向                    | 操作                                                                                                       |
| --------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/auth` + `packages/rbac`                               | `@accessbase/identity`  | 合并迁移（IAM 一体：认证+授权+身份模型）                                                                   |
| `packages/rbac` 用户/角色管理页                                 | `@accessbase/identity`  | admin-ui 管理页迁入 identity 或保留 admin，实施时定                                                        |
| `packages/audit`                                                | `@accessbase/audit`     | 迁移                                                                                                       |
| `packages/logging-infra`                                        | `@accessbase/logging`   | 迁移                                                                                                       |
| `packages/i18n`                                                 | `@accessbase/i18n`      | 迁移                                                                                                       |
| `packages/migration`                                            | `@accessbase/migration` | 迁移                                                                                                       |
| `packages/admin-ui`                                             | `@accessbase/admin`     | layout/theme/登录/CRUD 框架/管理页迁入；业务页面迁出                                                       |
| `packages/core`                                                 | L1                      | 平台层保留（后端引擎 + 组合装配）                                                                          |
| `packages/schema-engine`                                        | L1                      | 平台层保留                                                                                                 |
| `packages/plugin-framework` / `manifest-engine` 等              | L1                      | 平台层保留                                                                                                 |
| `packages/health-check` / `rate-limit` / `cli` / `shared-types` | L0 基石层               | 迁移为 `@accessbase/health-check`、`@accessbase/rate-limit`、`@accessbase/cli`、`@accessbase/shared-types` |

**迁移顺序建议**：

1. 抽出 `@accessbase/identity`（auth + rbac 合并，依赖最少）
2. 抽出 `@accessbase/logging` / `@accessbase/i18n` / `@accessbase/migration`（无依赖，可并行）
3. 抽出 `@accessbase/audit`
4. 抽出 `@accessbase/admin`（最大，依赖前三步）
5. L0 包全部独立后，L1 平台层改为依赖 `@accessbase/*`

---
