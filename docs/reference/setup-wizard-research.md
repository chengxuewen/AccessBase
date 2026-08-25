# 主流项目初始设置向导模式调研

> 调研日期：2026-08-25
> 调研范围：GitLab、Strapi、WordPress、Supabase、Keycloak、NocoBase、Directus
> 目的：为 AccessBase 初始设置向导设计提供参考

---

## 1. GitLab

### 1.1 设置流程

GitLab 的设置分为**安装阶段**和**首次登录配置**两个阶段：

1. **环境准备**：安装依赖包（Ruby、Go、Node、PostgreSQL、Redis、Nginx）
2. **配置文件**：编辑 `gitlab.yml`、`database.yml`、`unicorn.rb`、`secrets.yml` 等
3. **初始化数据库**：运行 `gitlab:setup` 创建表结构和默认管理员账户
4. **启动服务**：通过 systemctl 或 init script 启动
5. **首次登录**：浏览器访问实例 URL，使用 `root` 账户登录
6. **强制改密**：首次登录时强制要求修改默认密码
7. **后续配置**：通过 Admin Area UI 配置 SMTP、LDAP、2FA 等

### 1.2 收集的信息

| 阶段     | 收集/配置内容                             |
| -------- | ----------------------------------------- |
| 安装时   | EXTERNAL_URL（外部访问地址）              |
| 安装时   | GITLAB_ROOT_EMAIL（管理员邮箱，可选）     |
| 安装时   | GITLAB_ROOT_PASSWORD（管理员密码，可选）  |
| 安装时   | 数据库连接信息（host/port/user/password） |
| 安装时   | SMTP 邮件配置                             |
| 首次登录 | 新密码（强制要求修改）                    |
| 首次登录 | 管理员邮箱（确认/修改）                   |

### 1.3 安全考虑

- **默认密码 24h 自动过期**：`/etc/gitlab/initial_root_password` 文件 24 小时后自动删除
- **禁用明文密码配置**：不建议在 `gitlab.rb` 中明文配置密码
- **随机化默认管理员邮箱**：新版 GitLab 为默认管理员生成随机邮箱，防止 `admin@example.com` 被猜解
- **强制首次改密**：未设置密码时，首次登录强制跳转到密码重置页面
- **HTTPS 默认支持**：安装时自动申请 Let's Encrypt 证书
- **secrets.yml 权限**：必须设为 `0600`，仅 owner 可读

### 1.4 UX 最佳实践

- ✅ 安装向导简洁，环境变量方式传参
- ✅ 首次登录强制改密，避免默认凭据风险
- ✅ 自动 HTTPS 证书申请
- ✅ 初始密码文件自动过期删除
- ⚠️ 没有浏览器端安装向导（纯 CLI + 配置文件）
- ⚠️ 配置文件众多，新手学习成本高

---

## 2. Strapi

### 2.1 设置流程

Strapi 采用 **CLI 创建项目 + 浏览器注册管理员** 两阶段模式：

**阶段一：CLI 创建项目**

1. 运行 `npx create-strapi@latest`
2. 选择登录/注册或跳过（跳过则使用 Free 计划）
3. 选择数据库类型（默认 SQLite，或自定义 PostgreSQL/MySQL）
4. 如选自定义数据库，输入 host、port、database name、username、password、SSL 选项
5. 自动安装依赖并启动服务

**阶段二：浏览器注册管理员**

1. 访问 `http://localhost:1337/admin`
2. 填写第一个管理员账户信息：
   - First name、Last name
   - Email
   - Password + Password confirmation
3. 点击"Let's start"进入管理面板
4. 引导式教程（Guided Tour）自动展示核心功能

### 2.2 收集的信息

| 阶段       | 收集/配置内容                |
| ---------- | ---------------------------- |
| CLI        | 数据库类型、连接信息（可选） |
| CLI        | 是否登录 Strapi Cloud 账户   |
| 浏览器注册 | 管理员姓名（名、姓）         |
| 浏览器注册 | 管理员邮箱                   |
| 浏览器注册 | 管理员密码（含确认）         |
| 后续配置   | 界面语言、深色/浅色模式      |

### 2.3 安全考虑

- **JWT Secret**：`ADMIN_JWT_SECRET` 环境变量用于编码 JWT 令牌
- **API Token Salt**：`API_TOKEN_SALT` 用于 API 令牌的盐值
- **Transfer Token Salt**：`TRANSFER_TOKEN_SALT` 用于数据传输令牌
- **密码要求**：注册时要求密码确认，防止输入错误
- **SSO 支持**：支持通过 SSO 提供商认证，可在配置文件中启用
- **RBAC**：内置角色权限系统，管理员可创建自定义角色

### 2.4 UX 最佳实践

- ✅ **CLI + 浏览器分离**：CLI 处理技术配置，浏览器处理用户信息
- ✅ **引导式教程**（Guided Tour）：首次登录自动展示内容类型构建器、内容管理器、API 令牌等核心功能
- ✅ **渐进式信息收集**：先让系统跑起来，再收集管理员信息
- ✅ **SQLite 默认**：零配置即可启动，降低入门门槛
- ✅ **SSO 登录支持**：GitHub、Google、GitLab 等一键登录
- ✅ **非交互模式**：`--non-interactive` 支持 CI/CD 自动化部署

---

## 3. WordPress

### 3.1 设置流程

WordPress 著名的"5 分钟安装"是最经典的 Web 安装向导：

**阶段一：环境准备（CLI/手动）**

1. 下载并解压 WordPress 包
2. 创建数据库和数据库用户（通过 phpMyAdmin 或 CLI）
3. 配置 `wp-config.php`（可选，安装脚本可自动创建）
4. 上传文件到 Web 服务器

**阶段二：Web 安装向导**

1. 访问 `http://example.com/wp-admin/install.php`
2. **语言选择**：选择站点语言（Step 0）
3. **数据库配置**（如未创建 wp-config.php）：
   - Database Name
   - Username
   - Password
   - Database Host（默认 localhost）
   - Table Prefix（默认 wp_）
4. 点击"Run the installation"
5. **站点信息配置**：
   - Site Title（站点标题）
   - Username（管理员用户名）
   - Password（强密码，自动生成）
   - Email（管理员邮箱）
   - Search engine visibility（搜索引擎可见性）
6. 点击"Install WordPress"
7. 登录页面：使用刚创建的管理员账户登录

### 3.2 收集的信息

| 阶段       | 收集/配置内容                                         |
| ---------- | ----------------------------------------------------- |
| 数据库配置 | Database Name、Username、Password、Host、Table Prefix |
| 站点设置   | Site Title（站点标题）                                |
| 管理员账户 | Username（用户名，不建议用 admin）                    |
| 管理员账户 | Password（强密码）                                    |
| 管理员账户 | Email（管理员邮箱）                                   |
| 站点设置   | Search engine visibility（搜索引擎索引）              |

### 3.3 安全考虑

- **install.php 暴露风险**：数据库故障时，`install.php` 会重新变为可用的安装向导，可能被攻击者利用
- **Table Prefix**：默认 `wp_` 是 SQL 注入攻击的已知目标，建议修改
- **禁用 admin 用户名**：`admin` 是暴力破解的首选用户名
- **强制 HTTPS**：`FORCE_SSL_ADMIN` 常量强制管理后台使用 HTTPS
- **禁用文件编辑器**：`DISALLOW_FILE_EDIT` 防止攻击者通过后台编辑器执行代码
- **文件权限**：目录 755、文件 644、`wp-config.php` 440/400
- **Secret Keys**：`wp-config.php` 中的认证唯一密钥和盐值
- **保护 install.php**：通过 `.htaccess` 或 Nginx 规则禁止直接访问

### 3.4 UX 最佳实践

- ✅ **经典两步向导**：数据库 → 站点信息，极其简洁
- ✅ **自动生成密码**：自动生成强密码并显示，用户可自行修改
- ✅ **语言选择前置**：第一步选择语言，后续界面本地化
- ✅ **自动创建 wp-config.php**：无需手动编辑配置文件
- ✅ **即时反馈**：数据库连接失败时立即提示
- ⚠️ **Table Prefix 安全性依赖用户意识**：默认值不安全但无法强制修改
- ⚠️ **install.php 重入风险**：需额外配置防止重新安装

---

## 4. Supabase

### 4.1 设置流程

Supabase 采用**云端 Dashboard 向导**模式：

1. **注册/登录**：通过 GitHub、Google 或邮箱注册 Supabase 账户
2. **创建项目**：点击"New Project"按钮
3. **配置项目**：
   - 选择 Organization（组织）
   - 输入 Project Name（项目名称）
   - 设置 Database Password（数据库密码）
   - 选择 Region（地理区域）
   - 选择 Pricing Plan（定价方案）
4. **等待创建**：约 2 分钟的资源分配过程
5. **获取凭据**：Project URL、API Keys（anon key、service_role key）
6. **后续配置**：Row Level Security（RLS）、Authentication providers、Email templates

### 4.2 收集的信息

| 阶段     | 收集/配置内容                            |
| -------- | ---------------------------------------- |
| 注册     | GitHub/Google OAuth 或邮箱+密码          |
| 项目创建 | Organization（组织选择/创建）            |
| 项目创建 | Project Name（项目名称）                 |
| 项目创建 | Database Password（数据库密码）          |
| 项目创建 | Region（地理区域）                       |
| 项目创建 | Pricing Plan（免费/付费）                |
| 后续配置 | Authentication providers（OAuth 提供商） |
| 后续配置 | Site URL、Redirect URLs                  |
| 后续配置 | Email templates                          |

### 4.3 安全考虑

- **数据库密码一次性设置**：创建后不可更改，必须安全保存
- **API Key 分层**：anon key（客户端安全）vs service_role key（服务端，必须保密）
- **Row Level Security（RLS）**：数据库级别的访问控制，防止未授权数据访问
- **自托管时的 HTTP Basic Auth**：Studio 访问受 HTTP Basic 认证保护
- **JWT 签名密钥**：自托管时自动生成非对称 JWT 密钥对
- **DASHBOARD_PASSWORD**：自托管时随机生成的管理面板密码

### 4.4 UX 最佳实践

- ✅ **最少配置即可启动**：仅需 4 个字段（组织、名称、密码、区域）
- ✅ **自动资源分配**：用户无需管理基础设施
- ✅ **即时 API 可用**：创建表后立即获得可用的 REST API 端点
- ✅ **可视化表编辑器**：类似电子表格的界面，降低数据库操作门槛
- ✅ **OAuth 一键登录**：GitHub/Google 快速注册
- ⚠️ **密码不可更改**：数据库密码设置后无法修改
- ⚠️ **免费层限制**：需要付费才能使用生产环境功能

---

## 5. Keycloak

### 5.1 设置流程

Keycloak 采用**启动后在 Admin Console 中逐步配置**的模式：

**阶段一：安装与启动**

1. 下载或通过 Docker 拉取 Keycloak
2. 设置初始管理员账户（环境变量 `KEYCLOAK_ADMIN` + `KEYCLOAK_ADMIN_PASSWORD`）
3. 启动 Keycloak 服务器（`start-dev` 开发模式或生产模式）

**阶段二：Admin Console 配置**

1. 访问 `http://localhost:8080/admin/` 登录 Admin Console
2. **创建 Realm**（租户）：
   - 点击"Create realm"
   - 输入 Realm name（如 `my-app`）
   - 保持 Enabled 状态
3. **配置 Realm 设置**：
   - Login：启用用户注册、忘记密码、邮箱验证
   - Tokens：设置令牌过期时间
4. **创建 Client**（应用）：
   - Client type：OpenID Connect
   - Client ID：应用标识
   - Client authentication：公共/机密
   - Valid redirect URIs：回调地址
   - Web origins：允许的源
5. **创建 User**：
   - Username、First name、Last name、Email
   - 设置密码（临时/永久）
   - 分配角色
6. **配置 Identity Providers**（可选）：Google、GitHub、SAML 等
7. **配置 User Federation**（可选）：LDAP、Active Directory

### 5.2 收集的信息

| 阶段        | 收集/配置内容                         |
| ----------- | ------------------------------------- |
| 安装时      | KEYCLOAK_ADMIN（管理员用户名）        |
| 安装时      | KEYCLOAK_ADMIN_PASSWORD（管理员密码） |
| Realm 配置  | Realm name                            |
| Realm 配置  | 登录设置（注册、忘记密码、邮箱验证）  |
| Realm 配置  | Token 过期时间                        |
| Client 配置 | Client ID、Client type                |
| Client 配置 | Redirect URIs、Web origins            |
| User 配置   | Username、Email、Password             |
| User 配置   | Roles、Groups                         |

### 5.3 安全考虑

- **Master Realm 隔离**：`master` realm 仅用于管理 Keycloak 本身，不应用于应用
- **环境变量设置管理员**：避免在配置文件中存储明文密码
- **HTTPS 强制**：生产环境必须启用 HTTPS
- **Token 过期策略**：默认 5 分钟 Access Token、10 小时 SSO Session
- **邮箱验证**：生产环境应启用邮箱验证
- **密码策略**：可配置密码复杂度、长度、历史记录等
- **事件审计**：支持记录登录事件和管理事件
- **多因素认证**：内置 TOTP、WebAuthn 支持

### 5.4 UX 最佳实践

- ✅ **分层隔离设计**：Realm → Client → User 三层结构，逻辑清晰
- ✅ **Admin Console 可视化**：所有配置通过 Web UI 完成
- ✅ **Account Console**：用户可自行管理个人资料和会话
- ✅ **环境变量初始化**：首次启动即可通过环境变量设置管理员
- ✅ **CLI 批量配置**：`kcadm.sh` 支持脚本化批量创建 Realm、Client、User
- ⚠️ **配置步骤较多**：Realm → Client → User 多步操作
- ⚠️ **学习曲线较陡**：概念（Realm、Client、Scope、Mapper）较多

---

## 6. NocoBase

### 6.1 设置流程

NocoBase 提供 **CLI UI 向导**和**终端交互**两种模式：

**模式一：UI 向导（推荐）**

1. 安装 CLI：`npm install -g @nocobase/cli`
2. 运行 `nb init --ui` 启动浏览器向导
3. **Step 1 - Getting started**：
   - 设置 env 标识符
   - 选择安装新应用 / 管理本地应用 / 连接远程应用
4. **Step 2 - App environment**：
   - 设置应用基础信息
   - 存储位置
   - 运行端口
5. **Step 3 - App source and version**：
   - 选择安装来源（Docker / npm / Git）
   - 选择版本
6. **Step 4 - Configure the database**：
   - 使用内置数据库或自定义数据库
   - 数据库类型（PostgreSQL / MySQL / MariaDB）
   - 连接信息（host/port/database/user/password）
7. **Step 5 - Create an admin account**：
   - Username、Email、Password、Nickname
8. **Step 6 - Connection & authentication**：
   - 输入应用访问 URL
   - 选择认证方式（OAuth / Basic / Token）

**模式二：Docker Compose**

1. 创建 `docker-compose.yml`
2. 配置环境变量（APP_KEY、DB_*、端口映射）
3. `docker compose up -d`
4. 访问 `http://localhost:13000` 完成初始化

### 6.2 收集的信息

| 阶段       | 收集/配置内容                                    |
| ---------- | ------------------------------------------------ |
| CLI 向导   | env 标识符、安装来源、版本                       |
| CLI 向导   | 应用路径、端口、语言                             |
| 数据库配置 | 数据库类型、host、port、database、user、password |
| 管理员账户 | Username、Email、Password、Nickname              |
| 连接配置   | API Base URL、认证方式（OAuth/Basic/Token）      |
| Docker     | APP_KEY、DB_* 环境变量                           |

### 6.3 安全考虑

- **APP_KEY 必须修改**：默认 APP_KEY 是公开的，必须替换为随机字符串
- **默认管理员密码**：默认 `admin123`，首次登录必须修改
- **生产环境 HTTPS**：强烈建议通过 Nginx/Caddy 反向代理并启用 HTTPS
- **数据库密码**：Docker Compose 中的数据库密码需修改
- **端口暴露风险**：开发模式直接暴露端口，生产环境应使用反向代理

### 6.4 UX 最佳实践

- ✅ **浏览器 UI 向导**：`nb init --ui` 提供可视化配置，降低 CLI 门槛
- ✅ **6 步渐进式流程**：Getting started → Environment → Source → Database → Admin → Connection
- ✅ **多安装来源**：Docker / npm / Git 三种方式可选
- ✅ **内置数据库**：可选择内置数据库，零配置启动
- ✅ **非交互模式**：`--yes` 支持 CI/CD 自动化
- ✅ **会话隔离**：`nb session setup` 支持多终端并行操作
- ✅ **AI Agent 友好**：专为 AI Agent 集成设计的 CLI 和 Skills 系统
- ⚠️ **默认密码安全性低**：`admin123` 需要用户自觉修改
- ⚠️ **端口配置需注意远程访问**：默认 host 需手动改为服务器 IP

---

## 7. Directus

### 7.1 设置流程

Directus 提供 **CLI 初始化 + 浏览器引导**两种模式：

**模式一：CLI 初始化**

1. 创建项目目录
2. 运行 `npx directus init` 或 `npx create-directus-project <name>`
3. **数据库选择**：PostgreSQL / MySQL / SQLite / MS SQL / Oracle
4. **数据库连接信息**：host、port、database、user、password（SQLite 仅需文件路径）
5. **创建管理员用户**：Email + Password
6. 自动生成 `.env` 配置文件
7. 运行 `npx directus start` 启动服务

**模式二：Docker + 浏览器引导**

1. 创建 `docker-compose.yml`，配置环境变量
2. `docker compose up`
3. 访问 `http://localhost:8055` 看到**浏览器引导页面**
4. 配置第一个 Admin 账户（Email + Password + Project Owner 信息）

**模式三：环境变量预配置**

1. 设置 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_TOKEN` 环境变量
2. 启动时自动创建管理员账户
3. 跳过浏览器引导

### 7.2 收集的信息

| 阶段       | 收集/配置内容                                      |
| ---------- | -------------------------------------------------- |
| CLI        | 数据库类型（Database client）                      |
| CLI        | 数据库连接信息（host/port/database/user/password） |
| CLI        | 管理员 Email、Password                             |
| 浏览器引导 | 管理员 Email、Password                             |
| 浏览器引导 | Project Owner 信息（姓名、邮箱）                   |
| 环境变量   | SECRET（安全密钥）                                 |
| 环境变量   | DB_CLIENT、DB_HOST、DB_PORT 等                     |
| 环境变量   | ADMIN_EMAIL、ADMIN_PASSWORD（可选预配置）          |

### 7.3 安全考虑

- **SECRET 必须随机**：`SECRET` 环境变量用于加密，必须替换为随机值
- **管理员密码**：未预配置时，首次启动会在日志中打印随机密码
- **install.php 保护**（类似 WordPress）：需防止引导页面被重复访问
- **环境变量优先**：敏感信息应通过环境变量注入，不写入代码
- **数据库隔离**：生产环境应使用独立数据库用户
- **HTTPS**：通过 `PUBLIC_URL` 配置 HTTPS 地址

### 7.4 UX 最佳实践

- ✅ **SQLite 默认零配置**：开箱即用，无需安装数据库
- ✅ **浏览器引导页面**：首次访问自动展示配置向导
- ✅ **环境变量预配置**：支持 CI/CD 场景预设管理员
- ✅ **多数据库支持**：6 种数据库引擎可选
- ✅ **Docker 一键启动**：`docker compose up` 即可运行
- ✅ **bootstrap 命令**：`npx directus bootstrap` 自动完成数据库迁移和管理员创建
- ⚠️ **随机密码打印在日志**：未预配置管理员时，密码在容器日志中
- ⚠️ **引导页一次性**：首次配置完成后无法重新访问

---

## 横向对比总结

### 向导模式分类

| 模式                       | 代表项目         | 特点                                     |
| -------------------------- | ---------------- | ---------------------------------------- |
| **纯 CLI 配置**            | GitLab           | 通过配置文件和环境变量完成，无浏览器向导 |
| **CLI + 浏览器分离**       | Strapi、Directus | CLI 处理技术配置，浏览器处理用户信息     |
| **纯浏览器向导**           | WordPress        | 经典 Web 安装向导，全部在浏览器完成      |
| **Dashboard 云向导**       | Supabase         | 云端 Dashboard 创建项目，无需本地安装    |
| **Admin Console 逐步配置** | Keycloak         | 安装后在 Admin Console 中逐步创建资源    |
| **CLI UI 向导**            | NocoBase         | CLI 启动浏览器向导，6 步完成全部配置     |

### 信息收集对比

| 项目      | 数据库配置   | 管理员账户          | 站点信息   | OAuth 提供商  | 认证配置      |
| --------- | ------------ | ------------------- | ---------- | ------------- | ------------- |
| GitLab    | 安装时       | 安装时+首次登录     | 无         | 后续配置      | 后续配置      |
| Strapi    | CLI          | 浏览器注册          | 无         | 配置文件      | 配置文件      |
| WordPress | 安装向导     | 安装向导            | 站点标题   | 插件          | 插件          |
| Supabase  | 自动管理     | OAuth 注册          | 项目名称   | Dashboard     | Dashboard     |
| Keycloak  | 环境变量     | 环境变量            | Realm 名称 | Admin Console | Admin Console |
| NocoBase  | CLI 向导     | CLI 向导            | 应用名称   | 后续配置      | CLI 向导      |
| Directus  | CLI/环境变量 | CLI/浏览器/环境变量 | 无         | 配置文件      | 配置文件      |

### 安全实践对比

| 项目      | 默认密码处理    | HTTPS              | 强制改密    | 二次验证           | 审计日志  |
| --------- | --------------- | ------------------ | ----------- | ------------------ | --------- |
| GitLab    | 24h 过期文件    | 自动 Let's Encrypt | ✅ 首次强制 | 支持               | 支持      |
| Strapi    | 用户注册时设置  | 手动配置           | ❌          | 插件支持           | 企业版    |
| WordPress | 自动生成强密码  | 手动配置           | ❌          | 插件支持           | 插件      |
| Supabase  | OAuth/随机      | 云平台默认         | ❌          | OAuth 2FA          | Dashboard |
| Keycloak  | 环境变量设置    | 手动配置           | 可配置      | 内置 TOTP/WebAuthn | 内置      |
| NocoBase  | `admin123` 默认 | 手动配置           | ❌          | 后续配置           | 后续配置  |
| Directus  | 随机/环境变量   | 手动配置           | ❌          | 后续配置           | 内置      |

### UX 最佳实践提炼

1. **渐进式信息收集**：先让系统跑起来，再逐步收集更多信息（Strapi、NocoBase）
2. **技术与用户分离**：CLI 处理技术配置，浏览器处理用户信息（Strapi、Directus）
3. **最少必要字段**：首次启动只收集最少信息，高级配置可后续进行（WordPress、Supabase）
4. **默认安全**：自动生成强密码、自动 HTTPS、默认启用安全选项（GitLab、WordPress）
5. **引导式教程**：首次登录后提供功能引导（Strapi Guided Tour）
6. **多模式支持**：UI 向导 + CLI 交互 + 非交互模式，满足不同用户需求（NocoBase）
7. **环境变量预配置**：支持 CI/CD 和自动化部署场景（Directus、Keycloak）
8. **即时反馈**：配置错误时立即提示，不等到最后一步（WordPress 数据库连接测试）
9. **OAuth 一键注册**：降低注册门槛（Supabase、Strapi）

---

## 对 AccessBase 的设计建议

基于以上调研，AccessBase 初始设置向导应考虑：

### 推荐模式：CLI + 浏览器分离 + 引导式教程

1. **CLI 初始化**：`accessbase init` 启动服务，自动打开浏览器向导
2. **浏览器向导**（6-7 步）：
   - 站点语言选择
   - 数据库连接配置（含连接测试）
   - 管理员账户创建
   - 站点基本信息（名称、URL）
   - 安全配置（JWT Secret 自动生成、HTTPS 选项）
   - 认证方式选择（本地/LDAP/OAuth）
   - 完成确认
3. **首次登录引导**：Guided Tour 展示核心功能
4. **环境变量预配置**：支持 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 等环境变量跳过浏览器向导

### 安全设计要点

- 自动生成并显示强密码，允许用户修改
- JWT Secret 和加密盐值自动生成，存储在安全位置
- 首次登录强制修改默认密码（如使用默认密码）
- 安装完成后禁用/删除 setup 端点
- 数据库连接测试即时反馈
- HTTPS 推荐但不强制（开发环境兼容）

### UX 设计要点

- SQLite 默认零配置启动，降低开发门槛
- 最少必要字段原则，高级配置可后续进行
- 每步提供上下文帮助和示例
- 支持非交互模式（`--yes` 或环境变量）
- 错误信息友好、可操作
- 进度指示器显示当前步骤
