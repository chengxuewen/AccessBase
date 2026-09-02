# AccessBase 设计决策

**更新日期**: 2026-08-21

## D1: AccessBase 命名决策 (2026-08-20)

**决策**: 采用 **AccessBase** 作为项目名，npm scope `@accessbase/*`

**理由**:

- 特性描述准确：访问控制底座（认证+授权+审计）
- 命名零占用：npm scope / GitHub org / npm 包均无冲突
- 品牌中立：任何平台可复用，无品牌负担

**否决方案**:

- Keel: teamkeel 竞品
- Keelson: 6+ 活跃开发/AI 项目
- Rivet: ★6000+ 云平台
- SecureBase: "安全"有攻防歧义
- AuthBase: 语义过窄 + npm 5 包

**参考**: `docs/architecture.md` §4.2

---

## D2: L0 基石层边界 (2026-08-20)

**决策**: 8 项能力进入 L0，其余保留 L1

**L0 能力**:

- 认证+授权（`@accessbase/identity`）
- 后台框架（`@accessbase/admin`）
- 审计（`@accessbase/audit`）
- 日志（`@accessbase/logging`）
- 迁移（`@accessbase/migration`）
- 国际化（`@accessbase/i18n`）
- 基础 CRUD（`@accessbase/admin`）

**不进入 L0**:

- Schema 驱动动态建模 → L1
- 插件热插拔体系 → L1
- 品牌色/Logo → L1+ 注入

**参考**: `docs/architecture.md` §4.3

---

## D3: RBAC 并入 Identity (2026-08-20)

**决策**: `@accessbase/auth` 与 `@accessbase/rbac` 合并为 `@accessbase/identity`（IAM 一体）

**理由**:

- 认证与授权强耦合，分离增加接口复杂度
- 用户/角色/权限模型天然一体
- 参考业界 IAM 产品（Auth0、Okta）均为统一身份管理

**参考**: `docs/architecture.md` §5.1

---

## D4: 扩展机制 (2026-08-20)

**决策**: L0 提供配置点+扩展接口，不引入插件机制

**理由**:

- L0 = 基础设施，不是平台框架
- 基础设施需要稳定、可预测、零不确定性
- 插件机制增加版本兼容性、安全风险、维护成本
- 复用方（MediaServo）只需配置，无需理解插件体系

**插件机制留给 L1 平台层**:

- L0 = 配置点 + 扩展接口（稳定、可预测）
- L1 = 完整插件体系（灵活、可扩展）
- L2 = 业务插件（功能、UI）

**参考**: `docs/architecture.md` §10.2

---

## D5: JWT 策略 (2026-08-20)

**决策**: 短生命周期（Access Token 15分钟 + Refresh Token 7天）

**理由**:

- 安全性高：泄露窗口小（15分钟）
- 用户体验好：7天内无需重新登录
- 可配置：生产环境可调整

**Token 存储**:

- 后端：Redis（快速验证）+ 数据库（token_version）
- 前端：httpOnly cookie（防 XSS）

**参考**: `docs/architecture.md` §10.1

---

## D6: RBAC 模型 (2026-08-20)

**决策**: RBAC1（角色继承）

**理由**:

- 够用但不过度：满足 90% 企业场景
- 角色继承减少权限重复（admin 自动拥有 user 的所有权限）
- L0 定位匹配：L0 = 基础能力，不是完整安全产品
- 未来可升级：如需 RBAC2 约束，可在 L1 层扩展

**租户隔离**:

- `tenant_roles`：租户级角色
- `tenant_permissions`：租户级权限
- `user_tenant_roles`：用户在租户下的角色

**参考**: `docs/architecture.md` §10.1

---

## D7: LDAP SSO 策略 (2026-08-20)

**决策**: Admin Bind + 自动创建+同步

**理由**:

- Admin Bind：属性可控、支持自动供给
- 自动创建：用户体验最佳，首次登录即可使用
- 属性同步：数据一致性强，每次登录同步属性
- 可配置：支持关闭自动供给（合规要求高场景）

**加密方案**: AES-256-GCM（企业级安全标准）

**参考**: `docs/architecture.md` §10.1

---

## D8: 配置管理 (2026-08-20)

**决策**: 环境变量 + 数据库

**理由**:

- 敏感信息（密码、密钥）必须环境变量，不能存数据库
- 业务配置存数据库，支持 UI 修改
- 避免引入外部依赖（配置中心），保持 L0 轻量

**配置分类**:

- 基础设施：环境变量（数据库连接、Redis URL）
- 业务配置：数据库 + UI（LDAP 设置、邮件配置）
- 功能开关：数据库 + UI（启用/禁用模块）
- 主题配置：数据库 + UI（品牌色、Logo）

**参考**: `docs/architecture.md` §10.2

---

## D9: 主题机制 (2026-08-20)

**决策**: 令牌注入+继承（BrandTokens）

**理由**:

- L0 保持中性，无内置品牌色/Logo
- L1/L2 可通过 BrandTokens 接口注入品牌令牌
- 主题继承：L0 默认主题 → L1 平台品牌 → L2 业务定制

**BrandTokens 接口**:

- primaryColor / secondaryColor：品牌色
- logo / logoCollapsed：Logo
- brandName / brandTagline：品牌语
- fontFamily：字体

**参考**: `docs/architecture.md` §10.2

---

## D10: 审计日志 (2026-08-20)

**决策**: 写操作+认证事件审计

**理由**:

- 平衡审计完整性与性能
- 写操作（POST/PUT/PATCH/DELETE）必须审计
- 认证事件（登录/登出/登录失败）必须审计
- 读操作可选（敏感数据查询）

**审计钩子**: Fastify onResponse hook 自动记录（零侵入）

**审计存储**: 独立审计表（与业务数据隔离，防止误删）

**参考**: `docs/architecture.md` §10.3

---

## D11: 日志框架 (2026-08-20)

**决策**: pino

**理由**:

- Fastify 内置使用 pino，零适配成本
- 性能最优：比 winston 快 3-4 倍
- 结构化日志原生支持
- 内置日志脱敏（redact 选项）
- npm 周下载 ~35M，生态活跃

**参考**: `docs/architecture.md` §10.4

---

## D12: i18n 框架 (2026-08-20)

**决策**: i18next + react-i18next

**理由**:

- 生态最丰富：插件、工具、社区支持
- React 集成成熟：`useTranslation` Hook
- 命名空间支持：原生支持模块化翻译
- 动态加载：支持按需加载语言包
- TypeScript 支持：类型安全的翻译键

**命名空间设计**:

- 包名命名空间：L0 内部翻译（identity:login, admin:menu）
- client 命名空间：复用方翻译（client:welcome）
- 优先级：client > 包名（复用方可覆盖 L0 翻译）

**参考**: `docs/architecture.md` §10.5

---

## D13: 迁移框架 (2026-08-20)

**决策**: Drizzle ORM

**理由**:

- TypeScript 原生：类型安全的 Schema 定义
- 轻量级：依赖最小化（N1）
- SQL-like：接近 SQL 的语法，易于理解
- 性能优秀：比 Prisma/TypeORM 更快
- 统一迁移和数据访问

**三阶段迁移**:

- preload：数据库初始化前执行（如创建扩展、设置参数）
- postsync：Schema 同步后执行（默认阶段，大多数迁移）
- postload：数据加载后执行（如种子数据、索引优化）

**参考**: `docs/architecture.md` §10.6

---

## D14: 技术栈选型 (2026-08-20)

**决策**: Fastify + Drizzle ORM + React + Ant Design + Vite + pnpm

**后端**:

- Web 框架：Fastify（性能最优、TypeScript 原生、内置日志）
- ORM：Drizzle ORM（轻量、类型安全、SQL-like）
- 数据库：PostgreSQL 16（企业级、JSONB 支持）
- 缓存：Redis（高性能、会话存储、分布式锁）

**前端**:

- 框架：React（生态最丰富、TypeScript 成熟）
- UI 组件库：Ant Design（企业级设计、组件丰富）
- 构建工具：Vite（开发体验最佳、快速 HMR）
- 状态管理：Zustand（轻量、TypeScript 友好）

**包管理**: pnpm（性能最优、Monorepo 支持好）

**参考**: `docs/architecture.md` §9

---

## D15: 分布式架构 (2026-08-20)

**决策**: 全场景部署支持（单机/主公司+分公司/分布式/K8s）

**理由**:

- 企业级需求：不同规模企业需要不同部署方案
- 渐进式扩展：从单机开始，逐步扩展到分布式
- 灵活部署：支持云、本地、混合部署

**参考**: `docs/architecture.md` §11.1

---

## D16: 数据同步 (2026-08-20)

**决策**: 主从复制（主公司→分公司单向同步）

**理由**:

- 简单可靠：单向同步，冲突解决简单
- 数据一致性：主公司数据为权威来源
- 易于维护：故障恢复简单，从主公司重新同步

**同步策略**:

- 用户/权限数据：实时同步
- 业务数据：定时同步
- 配置数据：实时同步
- 审计日志：定时上传（分→主）

**参考**: `docs/architecture.md` §11.2

---

## D17: 高可用 (2026-08-20)

**决策**: 主备热备（秒级切换）

**理由**:

- 切换时间短：秒级切换，业务影响小
- 实现简单：心跳检测+自动切换
- 数据零丢失：同步复制，主备数据一致

**组件高可用**:

- PostgreSQL：主从流复制 + 自动故障转移
- Redis：Redis Sentinel
- 应用层：负载均衡 + 多实例

**参考**: `docs/architecture.md` §11.3

---

## D18: 网络架构 (2026-08-20)

**决策**: 混合网络（专线+VPN+公网）

**理由**:

- 分级安全：重要分公司专线，一般分公司 VPN
- 成本平衡：不必所有分公司都用专线
- 灵活扩展：新增分公司可灵活选择接入方式

**分级策略**:

- 重要分公司（财务/研发）：专线（最高安全）
- 一般分公司（销售/客服）：VPN（高安全）
- 临时办事处（项目组）：公网+SSL（中安全）

**参考**: `docs/architecture.md` §11.4

---

## D19: 容器编排 (2026-08-20)

**决策**: 支持 Docker Compose / Docker Swarm / Kubernetes

**理由**:

- 渐进式：从单机 Docker Compose 开始
- 灵活扩展：可升级到 Docker Swarm 或 K8s
- 云原生：支持 K8s 部署，适应云环境

**部署方案**:

- 单机/开发：Docker Compose
- 多实例：Docker Swarm
- 云原生：Kubernetes

**参考**: `docs/architecture.md` §11.6

---

## D20: 分公司部署 (2026-08-20)

**决策**: 中心化架构（主公司为主，分公司为从）

**理由**:

- 数据一致性：主公司数据为权威来源
- 管理简单：统一管理，降低运维成本
- 安全可控：分公司只读，降低安全风险

**架构特点**:

- 主公司：完整部署（数据库+应用+文件）
- 分公司：轻量部署（应用+缓存+从数据库）
- 数据流：主公司→分公司（单向同步）

**参考**: `docs/architecture.md` §11.7

---

## D21: 认证提供商架构 (2026-08-20)

**决策**: 配置驱动 + 可插拔提供商（Provider）

**理由**:

- 配置文件声明启用的认证方式，易于管理
- 代码实现可插拔的 Provider 接口，易于扩展
- 支持内置 + OAuth + 外部服务，满足各种场景
- 参考 one-api 的实现方式，但更现代化

**支持的认证方式**:

- **内置**: 密码认证（邮箱验证、域名限制、别名阻止）
- **OAuth**: GitHub、Discord、OIDC、Telegram、LinuxDO、微信
- **WebAuthn**: 通行密钥认证（Passkey）
- **外部服务**: Auth0、Keycloak 等

**配置示例**:

```yaml
auth:
  password:
    enabled: true
    config:
      minLength: 8
      requireEmailVerification: true
      allowedDomains: [gmail.com, 163.com, qq.com]

  github:
    enabled: true
    config:
      clientId: ${GITHUB_CLIENT_ID}
      clientSecret: ${GITHUB_CLIENT_SECRET}

  webauthn:
    enabled: true
    config:
      rpName: AccessBase
      rpId: example.com
```

**参考**: `docs/architecture.md` §12

---

## D22: OAuth 提供商支持 (2026-08-20)

**决策**: 支持 6 种 OAuth 提供商 + 通用 OIDC

**提供商列表**:

- GitHub（开发者常用）
- Discord（社区平台）
- OIDC（标准协议，支持任意 OIDC 提供商）
- Telegram（即时通讯）
- LinuxDO（中文社区）
- 微信（国内常用）

**通用 OIDC**: 支持任意符合 OpenID Connect 标准的提供商

**参考**: `docs/architecture.md` §12.3.2

---

## D23: WebAuthn/Passkey 支持 (2026-08-20)

**决策**: 支持通行密钥认证（WebAuthn/Passkey）

**理由**:

- 现代化认证方式，无密码、更安全
- 支持生物识别（指纹、面部识别）
- 支持跨平台（手机、电脑、安全密钥）

**配置项**:

- rpName: 人类可读名称
- rpId: 有效域
- origin: 允许的来源
- userVerification: 用户验证策略（required/preferred/discouraged）
- allowInsecureOrigins: 允许非 HTTPS 源（仅开发环境）

**参考**: `docs/architecture.md` §12.3.3

---

## D24: 外部服务集成 (2026-08-20)

**决策**: 支持 Auth0 和 Keycloak 外部认证服务

**理由**:

- 企业级认证需求，已有 Auth0/Keycloak 基础设施
- 通过 Provider 接口集成，无需修改核心代码
- 配置驱动，启用/禁用灵活

**支持的外部服务**:

- Auth0: 企业级身份平台
- Keycloak: 开源身份和访问管理

**参考**: `docs/architecture.md` §12.4

---

## D25: 监控方案 (2026-08-20)

**决策**: Prometheus + Grafana

**理由**:

- 成熟、生态丰富、可视化强大
- 与 Kubernetes/Docker 集成良好
- 社区活跃、文档完善
- 支持多种数据源

**监控指标**:

- 应用层：QPS、延迟、错误率、认证指标
- 数据库：连接池、查询性能、存储
- 系统资源：CPU、内存、磁盘、网络

**参考**: `docs/architecture.md` §13.2

---

## D26: 告警级别 (2026-08-20)

**决策**: 四级告警（P0紧急+P1严重+P2警告+P3信息）

**级别定义**:

- P0（紧急）：服务不可用、数据丢失 → 电话+短信+邮件，5分钟响应
- P1（严重）：性能严重下降、错误率飙升 → 短信+邮件，15分钟响应
- P2（警告）：资源使用率高、慢查询增多 → 邮件，1小时响应
- P3（信息）：配置变更、计划任务完成 → 邮件，24小时响应

**理由**:

- 分级明确，响应优先级清晰
- 避免告警疲劳（P3 不紧急）
- 符合企业运维标准

**参考**: `docs/architecture.md` §13.3.1

---

## D27: 通知渠道 (2026-08-20)

**决策**: 邮件通知（必须）

**理由**:

- 企业级标准通知方式
- 可靠、异步、可追溯
- 支持富文本（HTML 模板）

**可选渠道**:

- Webhook：灵活、可集成任意系统
- 企业微信/钉钉：国内企业常用、即时通知
- 短信：紧急情况使用、确保通知到达

**参考**: `docs/architecture.md` §13.4

---

## D28: 日志聚合 (2026-08-20)

**决策**: Loki + Grafana

**理由**:

- 轻量级、标签查询、成本低
- 与 Prometheus/Grafana 集成
- 适合结构化日志（pino JSON）
- 无需 Elasticsearch 集群

**架构**:

- Promtail：日志收集器
- Loki：日志存储（标签索引 + 压缩日志）
- Grafana：日志查询 + 仪表盘

**查询示例**:

```logql
# 查询所有错误日志
{job="accessbase"} |= "error"

# 查询特定用户的日志
{job="accessbase"} | json | userId="user123"
```

**参考**: `docs/architecture.md` §13.5

---

## D29: 链路追踪 (2026-08-20)

**决策**: Jaeger

**理由**:

- 云原生、OpenTelemetry 兼容
- 性能优秀、低开销
- 与 Grafana 集成
- 支持多种存储后端

**架构**:

- OpenTelemetry Collector：采集、处理、导出追踪数据
- Jaeger Agent/Collector/Query：追踪后端
- 存储：Elasticsearch / Cassandra / Badger

**集成**:

- Fastify 自动探针
- PostgreSQL 查询追踪
- Redis 操作追踪

**参考**: `docs/architecture.md` §13.6

---

## D30: 资源监控 (2026-08-20)

**决策**: 内置资源监控 + Prometheus 指标导出

**监控指标**:

- CPU：使用率、负载、核心数
- 内存：使用率、可用内存、交换区
- 磁盘：使用率、IOPS、读写速度
- 网络：带宽、连接数、错误包

**阈值配置**:

- CPU：警告 70%，严重 90%
- 内存：警告 70%，严重 90%
- 磁盘：警告 80%，严重 95%

**参考**: `docs/architecture.md` §13.7

---

## D31: UI 风格 (2026-08-20)

**决策**: 企业级风格（Ant Design）

**理由**:

- 专业、稳重、企业后台标准
- 完整的设计系统，覆盖颜色、字体、间距、组件
- 可配置的主题机制，支持品牌定制
- 社区活跃、文档完善

**参考**: `docs/architecture.md` §14.1

---

## D32: 设计系统 (2026-08-20)

**决策**: Ant Design 设计系统

**理由**:

- 完整、成熟、企业级
- 设计令牌（Design Tokens）支持
- 组件库丰富、覆盖各种场景
- 主题定制能力强

**设计令牌**:

- 颜色：主色、次色、成功色、警告色、错误色、信息色
- 字体：字体族、字号、字重、行高
- 间距：xs、sm、md、lg、xl
- 圆角：none、sm、md、lg、full
- 阴影：none、sm、md、lg

**参考**: `docs/architecture.md` §14.2

---

## D33: 布局方案 (2026-08-20)

**决策**: 经典后台布局（左侧菜单+顶部导航+内容区）

**理由**:

- 企业后台标准布局
- 多级菜单支持、面包屑导航
- 标签页导航、多页面管理
- 侧边栏可折叠、响应式设计

**布局结构**:

- 顶部导航栏：Logo、面包屑、搜索、通知、主题切换、用户头像
- 侧边栏：多级菜单、可折叠
- 内容区：标签页导航、页面内容

**参考**: `docs/architecture.md` §14.4

---

## D34: 主题机制 (2026-08-20)

**决策**: 亮暗主题切换

**理由**:

- 用户偏好持久化（localStorage）
- 系统偏好检测（prefers-color-scheme）
- 手动切换按钮
- 品牌令牌注入（L1/L2 可定制）

**主题配置**:

```yaml
theme:
  default_mode: light
  allow_toggle: true
  persist_preference: true
  brand:
    primary_color: '#1890ff'
    logo: '/logo.svg'
    brand_name: AccessBase
```

**参考**: `docs/architecture.md` §14.3

---

## D35: 导航结构 (2026-08-20)

**决策**: 完整导航（多级菜单、面包屑、标签页）

**理由**:

- 多级菜单：支持无限层级、权限控制
- 面包屑：清晰的路径导航
- 标签页：多页面管理、快速切换

**菜单配置**:

- 支持无限层级
- 权限控制（permission 字段）
- 角标（badge 字段）
- 图标（icon 字段）

**参考**: `docs/architecture.md` §14.5

---

## D36: 响应式设计 (2026-08-20)

**决策**: 响应式断点 + 移动端适配

**断点**:

- xs: 480px
- sm: 576px
- md: 768px
- lg: 992px
- xl: 1200px
- xxl: 1600px

**移动端适配**:

- 侧边栏隐藏、显示移动端菜单按钮
- 表格转卡片布局
- 响应式工具 mixin

**参考**: `docs/architecture.md` §14.8

---

## D37: AI 功能 (2026-08-20)

**决策**: 暂不集成，后期扩展

**理由**:

- 初期聚焦核心功能（认证、授权、审计）
- AI 功能可作为 L1/L2 层扩展
- 避免过度设计、保持 L0 轻量

**未来扩展方向**:

- AI 助手对话
- 智能表单填写
- 智能数据分析

**参考**: `docs/architecture.md` §14.1

---

## D38: 集成架构 (2026-08-20)

**决策**: 认证层标准化 + UI 层可选

**理由**:

- 认证层：AccessBase 作为标准 OAuth 2.0 / OIDC Provider
- UI 层：提供多框架 UI 组件（React/Vue/原生），但不强制使用
- 集成方式：支持多种集成方式，适应不同技术栈
- 无技术栈限制：任何应用都可以集成

**认证层标准化**:

- 标准 OAuth 2.0 端点：authorization、token、userinfo、revocation
- OIDC 发现端点：/.well-known/openid-configuration
- JWKS 端点：/.well-known/jwks.json

**UI 层可选**:

- `@accessbase/react`：React 组件库（登录组件、权限守卫）
- `@accessbase/vue`：Vue 组件库（登录组件、权限守卫）
- `@accessbase/sdk`：原生 SDK（OAuth 客户端、JWT 处理）
- `@accessbase/jwt`：后端 JWT 验证

**集成方式**:

- React 应用：使用 `@accessbase/react` 组件库
- Vue 应用：使用 `@accessbase/vue` 组件库
- 原生应用：使用 `@accessbase/sdk` 或标准 OAuth 2.0
- 后端应用：使用 JWT 验证

**参考**: `docs/architecture.md` §15

---

## D39: OAuth 2.0 客户端配置 (2026-08-20)

**决策**: 配置驱动的 OAuth 2.0 客户端管理

**理由**:

- 配置文件声明客户端信息（client_id、client_secret、redirect_uris）
- 支持多客户端（MediaServo、MES、其他应用）
- 灵活的授权类型配置（authorization_code、refresh_token）

**客户端配置示例**:

```yaml
integration:
  oauth:
    clients:
      mediaservo:
        client_id: mediaservo
        client_secret: ${MEDIASERVO_CLIENT_SECRET}
        redirect_uris:
          - https://mediaservo.example.com/callback
        grant_types:
          - authorization_code
          - refresh_token
```

**参考**: `docs/architecture.md` §15.7

---

## D40: 品牌定制机制 (2026-08-20)

**决策**: 多种方式（配置文件+组件注入+环境变量）

**理由**:

- 配置文件：静态配置、部署时确定
- 组件注入：动态配置、运行时切换
- 环境变量：12-Factor、容器化部署

**BrandTokens 接口**:

- 品牌色：primaryColor、secondaryColor
- Logo：logo、logoCollapsed、logoDark
- 品牌语：brandName、brandTagline
- 字体：fontFamily
- 设计令牌：spacing、borderRadius、shadows

**主题继承**:

- L0 默认中性主题
- L1 继承+覆盖平台品牌
- L2 继承+覆盖应用品牌

**参考**: `docs/architecture.md` §16

---

## D41: 健康检查机制 (2026-08-20)

**决策**: 三探针方案（存活+就绪+启动）

**理由**:

- 存活探针：检查服务是否存活（进程、死锁）
- 就绪探针：检查服务是否就绪（依赖服务、配置）
- 启动探针：检查服务是否启动完成（初始化、依赖）

**端点**:

- `/health/live`：存活探针
- `/health/ready`：就绪探针
- `/health/startup`：启动探针

**参考**: `docs/architecture.md` §17.1

---

## D42: 限流与容错 (2026-08-20)

**决策**: 完整方案（限流+熔断+降级）

**限流策略**:

- 全局限流：每分钟 100 次
- 用户限流：每分钟 1000 次
- IP 限流：每分钟 100 次

**熔断器**:

- 失败阈值：5 次
- 重置超时：30 秒
- 监控周期：60 秒

**降级策略**:

- 缓存降级：返回缓存数据
- 默认值降级：返回默认值

**参考**: `docs/architecture.md` §17.2

---

## D43: 缓存策略 (2026-08-20)

**决策**: 完整方案（Cache-Aside+事件失效+穿透防护）

**缓存层次**:

- L1 缓存：进程内存（热点数据、配置）
- L2 缓存：Redis（会话、临时数据）
- L3 缓存：数据库（持久化数据）

**缓存策略**:

- Cache-Aside：应用先查缓存，未命中查数据库
- 事件失效：数据变更时自动失效相关缓存
- 穿透防护：空值缓存、布隆过滤器

**TTL 配置**:

- 默认：300 秒（5 分钟）
- 用户：600 秒（10 分钟）
- 配置：3600 秒（1 小时）

**参考**: `docs/architecture.md` §17.3

---

## D44: 消息队列 (2026-08-20)

**决策**: Redis Streams

**理由**:

- 与现有 Redis 集成，无需额外组件
- 支持消费者组、消息持久化
- 性能优秀，延迟低
- 配置简单

**事件驱动架构**:

- EventBus：事件总线，发布/订阅事件
- 事件类型：user.created、user.updated、user.deleted 等
- 消费者组：支持多消费者并行消费

**参考**: `docs/architecture.md` §17.4

---

## D45: 品牌预设 (2026-08-20)

**决策**: 支持品牌预设

**预设示例**:

- MediaServo：紫色主色（#722ed1）、视频服务平台
- MES：橙色主色（#fa541c）、制造执行系统
- 企业应用平台：蓝色主色（#1890ff）、一站式企业解决方案

**配置方式**:

```yaml
brand:
  presets:
    mediaservo:
      primary_color: '#722ed1'
      logo: '/mediaservo-logo.svg'
      brand_name: MediaServo
```

**参考**: `docs/architecture.md` §16.4

---

## D46: 并发处理 (2026-08-20)

**决策**: 完整方案（乐观锁+悲观锁+分布式锁+事务）

**锁机制**:

- 乐观锁：假设冲突很少发生，只在提交时检查冲突（版本号）
- 悲观锁：假设冲突经常发生，先加锁再操作（Redis 实现）
- 分布式锁：在分布式系统中实现锁机制（Redlock 算法）

**事务处理**:

- 隔离级别：REPEATABLE READ（平衡一致性与性能）
- 事务超时：30 秒

**连接池**:

- 最小连接数：5
- 最大连接数：20
- 空闲超时：30 秒
- 连接超时：5 秒

**异步处理**:

- 异步任务队列：支持任务入队、处理、重试
- 最大并发：10
- 重试次数：3

**并发安全**:

- 竞态条件防护：分布式锁防止重复操作
- 死锁防护：按固定顺序获取锁

**参考**: `docs/architecture.md` §18

---

## D47: 锁机制选择 (2026-08-20)

**决策**: 三种锁机制并存

**适用场景**:

- 乐观锁：读多写少、冲突概率低
- 悲观锁：写多读少、冲突概率高
- 分布式锁：分布式系统、多节点并发

**实现方式**:

- 乐观锁：数据库版本号字段
- 悲观锁：Redis SET NX EX
- 分布式锁：Redlock 算法（Redis 多节点）

**参考**: `docs/architecture.md` §18.2

---

## D48: 事务隔离级别 (2026-08-20)

**决策**: REPEATABLE READ

**理由**:

- 防止脏读和不可重复读
- 平衡一致性与性能
- PostgreSQL 默认隔离级别

**隔离级别对比**:

- READ UNCOMMITTED：允许脏读，性能最高
- READ COMMITTED：防止脏读，允许不可重复读
- REPEATABLE READ：防止脏读和不可重复读
- SERIALIZABLE：最高隔离，性能最低

**参考**: `docs/architecture.md` §18.3.2

---

## D49: 组件归属 (2026-08-20)

**决策**: health-check/rate-limit/cli/shared-types 全部归入 L0 基石层

**组件归属**:

- health-check → `@accessbase/health-check` 或集成到 `@accessbase/admin`
- rate-limit → `@accessbase/rate-limit` 或集成到 `@accessbase/admin`
- cli → `@accessbase/cli`
- shared-types → `@accessbase/shared-types`

**理由**:

- 健康检查是基础设施，任何平台必需
- 限流是安全基础设施，防止 DDoS、暴力破解
- CLI 提供开发和运维工具
- 共享类型提供类型安全，统一接口定义

**参考**: `docs/architecture.md` §7

---

## D50: 网络信息安全 (2026-08-20)

**决策**: 完整方案（XSS+CSRF+SQL注入+DDoS+暴力破解+加密）

**安全防护**:

- 传输安全：HTTPS + HSTS（TLSv1.2+）
- 防 XSS：输入验证 + 输出编码 + CSP
- 防 CSRF：CSRF Token + SameSite Cookie
- 防 SQL 注入：参数化查询 + Drizzle ORM
- 防 DDoS：限流 + IP 黑名单
- 防暴力破解：账户锁定 + 验证码

**数据加密**:

- 敏感数据：AES-256-GCM 加密
- 密码：bcrypt 哈希（salt rounds 12）
- LDAP 密码：AES-256-GCM 加密

**安全头配置**:

- XSS 防护：xssFilter
- MIME 类型嗅探：noSniff
- 点击劫持防护：frameguard
- HSTS：maxAge 1 年
- CSP：defaultSrc 'self'
- 引用策略：strict-origin-when-cross-origin
- 权限策略：geolocation/camera/microphone/payment 'none'

**配置示例**:

```yaml
security:
  https:
    enabled: true
    min_version: TLSv1.2
  hsts:
    enabled: true
    max_age: 31536000
  csp:
    enabled: true
  csrf:
    enabled: true
    same_site: strict
  xss:
    enabled: true
  ddos:
    enabled: true
    rate_limit:
      max: 100
      window: 60
  brute_force:
    enabled: true
    max_attempts: 5
  encryption:
    enabled: true
    algorithm: aes-256-gcm
  password:
    min_length: 8
    require_uppercase: true
```

**参考**: `docs/architecture.md` §19

---

## D51: 授权许可证 (2026-08-20)

**决策**: 完整方案（服务器+用户+租户+功能+时间授权）

**许可证类型**:

- 服务器授权：绑定服务器硬件/ID，私有化部署
- 用户授权：绑定用户数量，SaaS/私有化
- 租户授权：绑定租户数量，多租户 SaaS
- 功能授权：绑定功能模块，增值服务
- 时间授权：绑定使用时间，订阅模式

**许可证管理**:

- 生成：LicenseGenerator（RSA 签名）
- 验证：LicenseValidator（公钥验证）
- 管理：LicenseManager（生命周期管理）

**许可证验证**:

- 在线验证：定期向许可证服务器验证
- 离线验证：本地验证+宽限期（7 天）

**许可证功能分层**:

- 基础功能（免费）：authentication、authorization、audit、logging、i18n、migration
- 高级功能（付费）：sso、mfa、advanced-audit、custom-branding、api-rate-limit
- 企业功能：multi-tenant、high-availability、dedicated-support

**许可证验证中间件**:

- 检查许可证是否有效
- 检查许可证是否即将过期（30 天警告）
- 检查功能是否授权
- 检查资源限制

**参考**: `docs/architecture.md` §20

---

## D52: 错误处理策略 (2026-08-20)

**决策**: 统一错误响应格式 + 错误码体系

**错误响应格式**:

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string; // 错误码（如 AUTH_001）
    message: string; // 用户友好消息
    details?: unknown; // 详细信息（仅开发环境）
    timestamp: string;
    requestId: string;
    path: string;
  };
}
```

**错误码范围**:

- AUTH_001~099: 认证错误
- AUTH_100~199: 授权错误
- USER_001~099: 用户错误
- SYS_001~099: 系统错误
- RATE_001~099: 限流错误

**参考**: `docs/architecture.md` §21

---

## D53: 数据库 Schema (2026-08-20)

**决策**: 核心表结构定义（users/roles/permissions/tenants/audit_logs/sessions/oauth_accounts/mfa_recovery_codes）

**核心表**:

- users: 用户表（含 MFA 字段）
- roles: 角色表（支持继承 parent_id）
- permissions: 权限表（resource+action）
- tenants: 租户表
- audit_logs: 审计日志表
- sessions: 会话表（Refresh Token 持久化）
- oauth_accounts: OAuth 账户关联表
- mfa_recovery_codes: MFA 恢复码表

**索引策略**: 按查询模式创建索引（email/tenant/resource/created_at）

**参考**: `docs/architecture.md` §22

---

## D54: API 设计规范 (2026-08-20)

**决策**: RESTful + URL 路径版本控制 + OpenAPI 文档

**API 标准**:

- RESTful: GET/POST/PUT/PATCH/DELETE
- 版本控制: /api/v1/{resource}
- 分页: page/pageSize/sortBy/sortOrder
- 文档: @fastify/swagger + Swagger UI

**核心端点**:

- 认证: /api/v1/auth/login, /logout, /refresh, /oauth/:provider
- 用户: /api/v1/users (CRUD), /users/me
- 角色: /api/v1/roles (CRUD), /roles/:id/permissions
- 审计: /api/v1/audit-logs, /audit-logs/export

**参考**: `docs/architecture.md` §23

---

## D55: 前端架构补充 (2026-08-20)

**决策**: 路由架构 + 表单设计 + 错误处理 UI + 加载状态

**路由架构**:

- 路由表配置（path/component/guard/permissions）
- 路由守卫（auth/guest/admin）
- 路由懒加载

**表单设计**:

- useForm Hook（Zod 验证 + 错误处理）
- 字段级错误显示

**错误处理 UI**:

- Error Boundary（组件级错误捕获）
- 全局错误处理器

**加载状态**:

- 骨架屏组件
- useLoading Hook

**参考**: `docs/architecture.md` §24

---

## D56: 安全加固 (2026-08-20)

**决策**: CSP 修复 + OAuth state/PKCE + MFA + Refresh Token 持久化 + 会话管理

**安全加固项**:

- CSP: 使用 nonce 替代 unsafe-inline/eval
- OAuth: state 参数（防 CSRF）+ PKCE（防授权码拦截）
- MFA: TOTP 框架 + 恢复码
- Refresh Token: 持久化到数据库（非仅 Redis）
- 会话管理: 密码重置时撤销所有会话
- JWT: 明确指定 RS256 算法

**参考**: `docs/architecture.md` §25

---

## D57: CI/CD 与部署 (2026-08-20)

**决策**: GitHub Actions + 多阶段 Dockerfile + 滚动更新

**CI/CD 流水线**:

- lint: 代码检查
- test: 单元测试 + E2E 测试
- build: 构建产物
- deploy: 生产部署

**Dockerfile**:

- 多阶段构建（deps → build → production）
- 非 root 用户
- 健康检查

**部署策略**:

- 蓝绿部署（零停机）
- 金丝雀部署（新版本验证）
- 滚动更新（K8s 默认）

**参考**: `docs/architecture.md` §26

---

## D58: 备份与灾难恢复 (2026-08-20)

**决策**: 全量备份（每日）+ 增量备份（每小时）

**备份策略**:

- 全量备份: 每日，保留 30 天
- 增量备份: 每小时，保留 7 天
- 配置备份: Git 版本控制

**RTO/RPO**:

- RPO（恢复点目标）: ≤ 1 小时
- RTO（恢复时间目标）: ≤ 30 分钟

**参考**: `docs/architecture.md` §27

---

## D59: Secret 管理 (2026-08-20)

**决策**: K8s Secrets + 环境变量 + 轮转策略

**Secret 清单**:

- JWT_PRIVATE_KEY / JWT_PUBLIC_KEY: JWT 签名/验证
- DB_PASSWORD: 数据库密码
- REDIS_PASSWORD: Redis 密码
- ENCRYPTION_SECRET: 数据加密
- OAuth_CLIENT_SECRET: OAuth 提供商

**轮转周期**: 90 天

**参考**: `docs/architecture.md` §28

---

## D60: 账户锁定持久化 (2026-08-20)

**决策**: 账户锁定状态持久化到 Redis（而非内存）

**理由**:

- 内存存储：重启后丢失，暴力破解防护失效
- Redis 持久化：重启后保留，防护持续有效

**实现**:

- key: `lockout:{email}`
- TTL: 15 分钟
- 阈值: 5 次失败

**参考**: `docs/architecture.md` §29.1

---

## D61: 测试策略 (2026-08-20)

**决策**: 单元测试 + 集成测试 + E2E 测试 + 性能测试

**测试分层**:

- 单元测试: Vitest, ≥ 80% 覆盖率
- 集成测试: Vitest + Supertest, ≥ 60% 覆盖率
- E2E 测试: Playwright, 关键流程
- 性能测试: k6 / Artillery, 基线

**参考**: `docs/architecture.md` §30

---

## D62: SLO/SLA 定义 (2026-08-20)

**决策**: SLO 99.9% 可用性, SLA 99.5% 可用性

**指标**:

- 可用性: SLO 99.9% / SLA 99.5%
- 响应时间 P50: ≤ 100ms / ≤ 200ms
- 响应时间 P99: ≤ 500ms / ≤ 1000ms
- 错误率: ≤ 0.1% / ≤ 1%
- RPO: ≤ 1 小时 / ≤ 4 小时
- RTO: ≤ 30 分钟 / ≤ 2 小时

**参考**: `docs/architecture.md` §31.3

---

## D63: 用户自助服务 (2026-08-20)

**决策**: 用户个人中心 + 密码重置流程

**功能**:

- 查看/修改个人信息
- 修改密码
- 查看登录历史
- 管理会话
- 管理 API 密钥
- 管理 MFA

**密码重置流程**:

1. 用户请求重置（POST /api/v1/auth/forgot-password）
2. 发送重置邮件（1 小时过期）
3. 用户重置密码（POST /api/v1/auth/reset-password）
4. 撤销所有会话（强制重新登录）

**参考**: `docs/architecture.md` §32

---

## D64: Webhook 系统 (2026-08-20)

**决策**: 事件驱动 Webhook + 签名验证 + 重试机制

**事件类型**:

- user.created / user.updated / user.deleted
- role.created / role.updated
- auth.login / auth.logout / auth.failed
- license.expiring / license.expired

**安全机制**:

- HMAC-SHA256 签名
- X-Webhook-Signature 头
- 指数退避重试

**参考**: `docs/architecture.md` §33

---

## D65: 通知中心 (2026-08-20)

**决策**: 应用内通知 + 邮件通知 + WebSocket 实时推送

**通知类型**:

- 系统通知（应用内）
- 安全通知（应用内+邮件）
- 审计通知（应用内）
- 许可证通知（应用+邮件）

**功能**:

- 通知列表（分页）
- 未读通知
- 标记已读
- 通知偏好设置
- WebSocket 实时推送

**参考**: `docs/architecture.md` §34

---

## D66: 日志脱敏增强 (2026-08-20)

**决策**: 结构化日志全面脱敏（请求头/请求体/响应体/用户信息）

**脱敏字段**:

- 请求头: authorization, cookie, x-csrf-token
- 请求体: password, token, secret, credit_card, api_key
- 响应体: token, refresh_token
- 用户信息: mfa_secret, password_hash

**参考**: `docs/architecture.md` §36.1

---

## D67: 密钥轮转策略 (2026-08-20)

**决策**: JWT/加密/OAuth 密钥定期轮转

**轮转周期**:

- JWT 密钥: 90 天
- 加密密钥: 90 天
- OAuth Secret: 180 天

**参考**: `docs/architecture.md` §36.2

---

## D68: CORS 配置 (2026-08-20)

**决策**: 白名单模式 + 凭证支持

**配置**:

- origin: 白名单验证
- credentials: true
- methods: GET/POST/PUT/PATCH/DELETE/OPTIONS
- maxAge: 24 小时

**参考**: `docs/architecture.md` §36.3

---

## D69: 测试策略 (2026-08-20)

**决策**: 单元测试 + 集成测试 + E2E 测试 + 性能测试

**测试分层**:

- 单元测试: Vitest, ≥ 80% 覆盖率
- 集成测试: Vitest + Supertest, ≥ 60% 覆盖率
- E2E 测试: Playwright, 关键流程
- 性能测试: k6 / Artillery, 基线

**参考**: `docs/architecture.md` §30

---

## D70: SLO/SLA 定义 (2026-08-20)

**决策**: SLO 99.9% 可用性, SLA 99.5% 可用性

**指标**:

- 可用性: SLO 99.9% / SLA 99.5%
- 响应时间 P50: ≤ 100ms / ≤ 200ms
- 响应时间 P99: ≤ 500ms / ≤ 1000ms
- 错误率: ≤ 0.1% / ≤ 1%
- RPO: ≤ 1 小时 / ≤ 4 小时
- RTO: ≤ 30 分钟 / ≤ 2 小时

**参考**: `docs/architecture.md` §31.3

---

## D71: 用户自助服务 (2026-08-20)

**决策**: 用户个人中心 + 密码重置流程

**功能**:

- 查看/修改个人信息
- 修改密码
- 查看登录历史
- 管理会话
- 管理 API 密钥
- 管理 MFA

**密码重置流程**:

1. 用户请求重置（POST /api/v1/auth/forgot-password）
2. 发送重置邮件（1 小时过期）
3. 用户重置密码（POST /api/v1/auth/reset-password）
4. 撤销所有会话（强制重新登录）

**参考**: `docs/architecture.md` §32

---

## D72: Webhook 系统 (2026-08-20)

**决策**: 事件驱动 Webhook + 签名验证 + 重试机制

**事件类型**:

- user.created / user.updated / user.deleted
- role.created / role.updated
- auth.login / auth.logout / auth.failed
- license.expiring / license.expired

**安全机制**:

- HMAC-SHA256 签名
- X-Webhook-Signature 头
- 指数退避重试

**参考**: `docs/architecture.md` §33

---

## D73: 通知中心 (2026-08-20)

**决策**: 应用内通知 + 邮件通知 + WebSocket 实时推送

**通知类型**:

- 系统通知（应用内）
- 安全通知（应用内+邮件）
- 审计通知（应用内）
- 许可证通知（应用+邮件）

**功能**:

- 通知列表（分页）
- 未读通知
- 标记已读
- 通知偏好设置
- WebSocket 实时推送

**参考**: `docs/architecture.md` §34

---

## D74: GDPR 合规 (2026-08-20)

**决策**: 数据保留策略 + 用户数据导出/删除 + 隐私同意管理

**数据保留**:

- 用户数据: 账户活跃期间
- 审计日志: 1 年
- 会话数据: 7 天
- 登录历史: 90 天

**用户权利**:

- 数据导出: GET /api/v1/users/me/data-export
- 数据删除: DELETE /api/v1/users/me（30 天后正式删除）
- 隐私同意: POST /api/v1/privacy/consent

**参考**: `docs/architecture.md` §39

---

## D75: 邮件/短信服务 (2026-08-20)

**决策**: 邮件服务 + 短信验证码

**邮件服务**:

- 模板引擎
- 附件支持
- 异步发送

**短信服务**:

- 验证码发送
- 5 分钟过期
- Redis 存储

**参考**: `docs/architecture.md` §40

---

## D76: 文件存储管理 (2026-08-20)

**决策**: 文件上传/下载/删除 + 权限控制 + 配额管理

**API**:

- POST /api/v1/files: 上传文件
- GET /api/v1/files/:id: 下载文件
- DELETE /api/v1/files/:id: 删除文件

**安全机制**:

- 文件类型验证
- 文件大小限制
- 权限控制（所有者/共享）
- 配额管理

**参考**: `docs/architecture.md` §41

---

## D77: APM 集成 (2026-08-20)

**决策**: OpenTelemetry 集成（追踪+指标+日志）

**指标**:

- http_requests_total: HTTP 请求计数
- http_request_duration_ms: 请求延迟
- active_connections: 活跃连接

**追踪**:

- 自动追踪 HTTP/数据库/Redis 操作
- 手动追踪业务操作

**参考**: `docs/architecture.md` §42.1

---

## D78: 版本策略 (2026-08-20)

**决策**: 语义化版本 + 向后兼容 + 弃用通知

**版本格式**: MAJOR.MINOR.PATCH

- MAJOR: 不兼容的 API 变更
- MINOR: 向后兼容的功能新增
- PATCH: 向后兼容的问题修复

**弃用策略**:

- 弃用通知头: Sunset, Deprecation, Link
- 迁移指南: 文档链接

**参考**: `docs/architecture.md` §42.2

---

## D79: 性能基线 (2026-08-20)

**决策**: API 响应时间目标 + 负载测试配置

**目标**:

- 登录 API: P50 ≤ 100ms, P95 ≤ 300ms, P99 ≤ 500ms
- 用户列表: P50 ≤ 50ms, P95 ≤ 150ms, P99 ≤ 300ms
- 用户详情: P50 ≤ 30ms, P95 ≤ 100ms, P99 ≤ 200ms

**负载测试**:

- 并发用户: 100
- 持续时间: 60s
- 爬坡时间: 10s

**参考**: `docs/architecture.md` §42.3

---

## D80: 报表与分析 (2026-08-20)

**决策**: 用户活跃度报表 + 导出功能

**报表类型**:

- 用户活跃度报表
- 审计日志报表
- 系统性能报表

**导出格式**:

- CSV
- Excel
- PDF

**参考**: `docs/architecture.md` §42.6

---

## D81: 多租户逻辑隔离 + 域名路由 (2026-08-21)

**决策**: 采用逻辑隔离（共享 PostgreSQL，tenant_id 列隔离）+ 域名路由（org.accessbase.example.com）的混合多租户架构

**理由**:

- 参考 Zitadel 域名发现 + Auth0 逻辑隔离的最佳实践
- PostgreSQL 已选定，逻辑隔离 + 索引优化可满足企业级性能需求
- 域名路由提供用户友好体验，支持自定义域名映射（CNAME 记录）
- 避免 Schema 隔离（Authentik 模式）的运维复杂度
- 组织级 RBAC + 项目级角色，天然支持 B2B 多组织管理

**实现要点**:

- 所有核心表添加 `tenant_id` 列，建立复合索引
- 中间件层自动注入 tenant_id，防止跨租户数据泄露
- 支持自定义域名映射（CNAME 记录）
- 组织管理 API 支持邀请、成员管理、角色定义

**参考**: docs/reference/synthesis-iam.md §1.3

---

## D82: 认证提供商 Connectors + Actions 混合模式 (2026-08-21)

**决策**: 采用 Connectors（标准化连接器）+ Actions（认证流程扩展）的两层认证提供商架构

**理由**:

- 参考 Logto Connector 模式标准化社交/企业/通知连接器
- 参考 Auth0 Actions 模式在认证流程节点注入自定义函数
- Connector 接口统一：SocialConnector、EnterpriseConnector、NotificationConnector
- Actions 覆盖 PreAuthentication、PostAuthentication、TokenGeneration 扩展点
- 支持 50+ 社交登录提供商，与企业 SSO（SAML/LDAP）统一接口

**实现要点**:

- Connector 接口定义标准生命周期：initialize → authenticate → callback
- Actions 存储为 TypeScript 函数，通过事件系统触发
- 提供可视化 Flow 编辑器（参考 Authentik），降低配置门槛
- 支持 Actions 版本控制和回滚

**参考**: docs/reference/synthesis-iam.md §2.3

---

## D83: 会话管理 JWT + HttpOnly Cookie + 旋转刷新 (2026-08-21)

**决策**: Access Token 15 分钟（内存存储）+ Refresh Token 7 天（HttpOnly Cookie）+ 旋转刷新 + Redis 会话存储

**理由**:

- 参考 SuperTokens 的 JWT + HttpOnly Cookie 安全模型
- 参考 Clerk 60 秒超短期 Token 的安全理念，15 分钟平衡安全性与性能
- HttpOnly Secure SameSite=Strict Cookie 防止 XSS 窃取 Refresh Token
- 旋转刷新 Token 防止 Token 重放攻击，旧 Token 立即失效
- Redis 会话存储支持强制登出、会话管理和 SSO 单点登出广播

**实现要点**:

- Access Token 存储在 JavaScript 变量中，不写入 Cookie/LocalStorage
- Refresh Token 通过 HttpOnly Secure SameSite=Strict Cookie 传输
- Token 刷新使用幂等请求，防止并发刷新冲突
- 会话管理 API 支持：查询活跃会话、强制登出、会话续期
- 单点登出（SSO Logout）通过 Redis Pub/Sub 广播

**参考**: docs/reference/synthesis-iam.md §3.3

---

## D84: 智能 MFA + Step-up Authentication (2026-08-21)

**决策**: 三层 MFA 策略——基础 MFA（TOTP + WebAuthn + 恢复码）+ 智能 MFA（风险评分引擎）+ Step-up Authentication（敏感操作二次验证）

**理由**:

- TOTP + WebAuthn 覆盖主流 MFA 场景，WebAuthn 支持平台认证器和漫游认证器
- 智能 MFA 参考 Auth0 Security Center，基于 IP 信誉、设备指纹、地理位置、登录时间动态触发
- 风险阈值可配置：低风险（0-30）跳过，中风险（31-70）可选，高风险（71-100）强制
- Step-up Authentication 参考 Keycloak，敏感操作（修改密码/MFA/查看审计日志/导出数据）要求 5 分钟内 MFA 验证

**实现要点**:

- MFA 注册流程：引导用户设置至少一种 MFA 方式
- 恢复码生成：加密存储，使用后标记为已用
- 风险评分：基于 IP 信誉库、设备指纹库、地理位置数据库
- 学习模式：前 N 次登录记录基线，后续对比异常

**参考**: docs/reference/synthesis-iam.md §4.3

---

## D85: OAuth 2.1 + OIDC + SAML 桥接 (2026-08-21)

**决策**: 核心协议采用 OAuth 2.1（强制 PKCE）+ OpenID Connect 1.0（目标 OpenID Certified™）+ SAML 2.0 桥接器

**理由**:

- OAuth 2.1 强制 PKCE 防止授权码拦截攻击，废弃 Implicit 流程
- OIDC 提供标准化身份层，兼容所有主流客户端库
- SAML 桥接器参考 Ory Polis，将 SAML 断言转换为 OIDC Claims，满足企业遗留系统集成
- 参考 Authelia 的 OpenID Certified™ 实现作为合规目标

**授权流程**:

- Authorization Code + PKCE：主要流程（SPA、移动应用）
- Client Credentials：M2M 服务间认证
- Device Authorization：IoT/CLI 设备认证

**Token 策略**:

- Access Token：JWT 格式（RS256），15 分钟有效期
- Refresh Token：旋转刷新，7 天有效期
- ID Token：OIDC 标准 Claims，自定义 Claims 支持
- Token 格式：JWT（RS256 签名），支持 JWE 加密

**参考**: docs/reference/synthesis-iam.md §5.3

---

## D86: 设计令牌三层架构 + 业务语义层 (2026-08-21)

**决策**: 保持 Ant Design 5 三层令牌架构（种子→映射→别名），补充 AccessBase 业务语义令牌层

**理由**:

- Ant Design 5 三层架构（种子令牌→映射令牌→别名令牌）已采用，迁移成本为零
- 在 Ant Design 别名令牌之上增加业务语义令牌（如 `colorAuthSuccess`、`colorAuditWarning`）
- 参考 Carbon 上下文令牌，为多层嵌套 UI 引入上下文感知令牌
- 启用 Ant Design 5.12+ CSS 变量模式（`cssVar: true`），获得零运行时主题切换能力

**令牌层次**:

- L0：种子令牌（seedColor、seedRadius、seedFontSize）
- L1：映射令牌（colorPrimary、colorBgContainer）
- L2：别名令牌（colorSuccess、colorWarning）
- L3：业务语义令牌（colorAuthSuccess、colorAuditWarning、colorMfaRequired）

**参考**: docs/reference/synthesis-ui.md §1.4

---

## D87: 主题定制 ConfigProvider + CSS 变量模式 (2026-08-21)

**决策**: ConfigProvider 注入 + CSS 变量模式 + 三种算法（defaultAlgorithm + darkAlgorithm + compactAlgorithm）+ 主题预设

**理由**:

- ConfigProvider 是 Ant Design 原生 Provider 模式，已有实践
- CSS 变量模式实现零闪烁（FOUC）主题切换
- 紧凑算法为数据密集页面（审计日志、用户列表）提供更优信息密度
- 参考 Ant Design Pro 的 Default/Dark/Glass 预设，为 AccessBase 创建 3-4 套内置主题

**主题预设**:

- Default：标准亮色主题
- Dark：暗色主题（darkAlgorithm）
- Compact：紧凑模式（compactAlgorithm）
- HighContrast：高对比度主题（无障碍）

**参考**: docs/reference/synthesis-ui.md §2.4

---

## D88: 暗色模式系统偏好检测 + 层级模型 (2026-08-21)

**决策**: 首次访问读取 `prefers-color-scheme` + `<meta name="color-scheme">` 防闪烁 + 暗色模式层级模型（参考 Carbon layer-01/02/03）

**理由**:

- 系统偏好检测提供无感知的首次体验，无 localStorage 记录时跟随系统
- `<meta name="color-scheme" content="light dark">` 消除暗色模式闪烁
- 参考 Carbon 层级模型，在暗色模式下使用颜色层级替代阴影表达界面深度
- CI/CD 集成 WCAG 对比度验证，确保暗色模式下文字可读性

**实现要点**:

- 添加系统偏好检测：`window.matchMedia('(prefers-color-scheme: dark)')`
- 图片/媒体暗色适配：CSS `filter: brightness()` 或暗色版本资源
- 第三方组件适配：CSS 变量统一覆盖

**参考**: docs/reference/synthesis-ui.md §3.4

---

## D89: 多租户品牌定制动态加载 (2026-08-21)

**决策**: 定义 AccessBase 品牌色种子令牌 + 多租户品牌令牌动态加载 + 品牌资源统一管理

**理由**:

- 参考 M3 Theme Builder 从品牌标识提取核心色，算法自动生成完整色板
- 参考 Fluent 多主题机制，通过 tenantId 动态加载品牌令牌
- 品牌资源统一管理：logo（亮/暗版本）、favicon、邮件模板品牌元素
- CI/CD 验证所有 UI 组件颜色均来自令牌系统，禁止硬编码色值

**品牌令牌层**:

```typescript
// theme/brand-tokens.ts
const brandTokens = {
  colorBrandPrimary: '#0052CC', // AccessBase 主色
  colorBrandSecondary: '#00875A', // 辅助色
  colorBrandAccent: '#FF991F', // 强调色
  brandFontFamily: '"PingFang SC", "Noto Sans SC", sans-serif',
};
```

**参考**: docs/reference/synthesis-ui.md §4.4

---

## D90: 插件架构分类扩展 + 三层钩子 + Provider 隔离 (2026-08-21)

**决策**: 采用分类扩展体系（Directus 6 类前端 + 3 类后端）+ 三层生命周期钩子（PocketBase Before→Execute→After）+ Provider 隔离（new-api/LiteLLM 适配器模式）的组合插件架构

**理由**:

- 分类扩展参考 Directus，按用途定义扩展类型（Interface/Display/Layout/Panel/Module/Theme + Hook/Endpoint/Operation）
- 三层钩子参考 PocketBase，覆盖完整生命周期（beforeAuth→onAuth→afterAuth）
- Provider 隔离参考 new-api `relay/channel/` 和 LiteLLM Provider Transform，新增提供商零侵入
- CLI 脚手架 + 模板降低插件开发门槛

**扩展类型**:

- Auth Provider 插件：`@accessbase/auth-providers/{ldap,oauth,webauthn}` 独立目录
- 前端扩展（6 类）：Interface/Display/Layout/Panel/Module/Theme
- 后端钩子（3 层）：beforeAuth / onAuth / afterAuth
- 工作流节点：`@accessbase/workflow-nodes/` npm 包 + CLI 脚手架
- UI Widget 沙箱：isolated-vm 隔离执行，postMessage 通信

**参考**: docs/reference/synthesis-platforms.md §1.3

---

## D91: 数据模型 Auth Schema 隔离 + Drizzle Migration (2026-08-21)

**决策**: 认证数据在独立 `auth` PostgreSQL Schema（参考 Supabase），业务数据在 `public` Schema，Schema 变更通过 Drizzle Migration 管理（Database-first 理念）

**理由**:

- 参考 Supabase `auth` schema 实现认证数据与业务数据物理隔离，安全边界清晰
- Database-first 理念（参考 Directus），Schema 变更通过 Drizzle Migration 管理，不允许运行时动态改表
- 参考 Directus Policy-based RBAC，`policies` → `roles` → `users` 可组合模型，支持字段级 + 行级权限
- 所有核心表包含 `tenant_id`，查询自动注入租户过滤（参考 ToolJet Workspace + Supabase RLS）

**Schema 分离**:

- `auth` Schema：users、roles、permissions、oauth_accounts、sessions、mfa_recovery_codes
- `public` Schema：业务数据、审计日志、配置数据
- PG RLS 作为纵深防御层（非唯一控制），复杂行级权限参考 Supabase RLS

**参考**: docs/reference/synthesis-platforms.md §2.3

---

## D92: 工作流异步后台 + 生命周期钩子 + 事件驱动 (2026-08-21)

**决策**: 请求路径零 DB 写入（审计事件→Redis Stream→后台 Worker 批量写入 PG）+ 认证生命周期三层钩子 + 事件驱动操作链（IAM 自动化）

**理由**:

- 异步后台参考 LiteLLM，请求路径零 DB 写入，审计/用量事件通过 Redis Stream 缓冲，后台批量写入 PG
- 生命周期钩子参考 PocketBase，`beforeAuth`（校验/限流）→ `onAuth`（认证执行）→ `afterAuth`（审计/通知）
- 事件驱动操作链参考 n8n + Directus Flows，支持用户创建→分配角色→发通知→创建工单的自动化流程
- 权限变更审批参考 Strapi Review Workflows，Draft → Review → Published 状态机

**实现要点**:

- 审计事件 → Redis Stream → 后台 Worker 批量写入 PG，不影响请求延迟
- Webhook 通知：事件 → 条件过滤 → HTTP Webhook 调用，失败重试 + 死信队列
- 用量事件异步写入，Redis 缓冲，批量持久化

**参考**: docs/reference/synthesis-platforms.md §3.3

---

## D93: API 多 Token 类型 + Key 生命周期管理 (2026-08-21)

**决策**: 支持四种 Token 类型（参考 Directus）+ API Key 全生命周期管理（参考 Strapi）+ 统一信封响应格式 + 多级限流

**理由**:

- 参考 Directus 四种 Token 类型覆盖全场景：access_token（JWT RS256, 15min）、refresh_token（7d）、api_key（长期，可撤销）、session_cookie（Web 场景）
- 参考 Strapi API Token 全生命周期：创建/查询/更新/删除/重新生成/作用域分配/过期时间
- 统一响应格式 `{ success, data, error, meta }` 参考 LiteLLM，所有端点一致
- 多级限流参考 PocketBase + LiteLLM：全局限流 + 用户级限流 + 端点级限流，Redis 滑动窗口

**Token 类型**:

- `access_token`：JWT RS256，15 分钟有效期，内存存储
- `refresh_token`：7 天有效期，HttpOnly Cookie
- `api_key`：长期有效，可撤销，作用域控制
- `session_cookie`：Web 场景，Session 会话

**参考**: docs/reference/synthesis-platforms.md §4.3

---

## D94: 计费按用户分层 + 多级配额 (2026-08-21)

**决策**: 定价模型采用按用户数分层（参考 Appsmith/Odoo）+ API 配额采用 Tenant→User→API Key 三级配额（参考 LiteLLM）+ 计费安全不变量（参考 new-api）

**理由**:

- 按用户数分层定价简单，用户易理解：Free (5 用户) → Pro → Team → Enterprise，功能渐进解锁
- 多级配额参考 LiteLLM Key→User→Team→Server 四级预算，Redis 实时计数，异步批量写入 PG
- 计费安全不变量参考 new-api：配额扣减永不溢出，饱和边界保护，所有扣减写审计日志
- 功能模块通过许可证控制（SSO/LDAP/Audit/Workflow 等），参考 ToolJet + Appsmith

**配额层次**:

- Tenant 级：租户总配额（用户数、API 调用量、存储空间）
- User 级：用户个人配额（API Key 数量、登录频率）
- API Key 级：单个 Key 配额（调用频率、作用域限制）
- Redis 实时计数，不影响请求延迟

**注意**: AccessBase 是 IAM 平台而非 API 网关，计费系统主要面向平台订阅而非请求计费。API 配额管理用于防止滥用，而非精确计费。

**参考**: docs/reference/synthesis-platforms.md §5.3

---

## D95: 组件架构无头业务层 + Registry 分发 (2026-08-21)

**决策**: UI 层采用 Ant Design 5 + ProComponents，业务层参考 Refine 无头架构解耦，组件分 L0-L3 四层，插件通过 Registry 注册自定义页面/组件

**理由**:

- Ant Design 5 + ProComponents（ProTable、ProForm、ProLayout）构建 IAM 管理界面，组件充足、企业级验证完善
- 参考 Refine 无头架构，业务逻辑与 UI 解耦，通过数据提供者模式抽象 API 层
- 组件分层：L0（Ant Design 原生）→ L1（ProComponents 高级）→ L2（@accessbase/ui 业务）→ L3（页面级）
- 参考 Shadcn/ui Registry 系统设计插件 UI 分发机制，插件可注册自定义页面/组件，核心组件不可覆盖

**组件分层**:

- L0：Ant Design 原生组件（Button, Input, Table...）
- L1：ProComponents 高级组件（ProTable, ProForm...）
- L2：@accessbase/ui 业务组件（PermissionGuard, AuditLog...）
- L3：页面级组件（UserManagement, RoleConfig...）

**性能优化**:

- Ant Design 5 CSS-in-JS 启用 CSS 变量模式减少运行时开销
- Tree Shaking：按需引入组件，ProComponents 按模块引入
- 参考 Mantine CSS Modules 零运行时方案优化高频渲染组件

**参考**: docs/reference/synthesis-ui.md §5.4

---

**更新日期**: 2026-08-21（D81-D95 补充完成）

---

## D96: 包命名简化 (2026-08-21)

**决策**: `shared-types` → `types`, `health-check` → `health`

**理由**:

- 简洁：单音节包名更易引用
- 主流：参考 NestJS `@nestjs/common`, Prisma `@prisma/client`
- 语义足够：`@accessbase/types` 和 `@accessbase/health` 语义清晰

**参考**: 社区调研

---

## D97: Fastify 类型增强隔离 (2026-08-21)

**决策**: Fastify 类型增强放在单独的 `fastify.d.ts` 文件

**理由**:

- 避免多插件文件中 `declare module 'fastify'` 冲突
- TypeScript 模块增强在同一编译单元中多次声明会冲突
- 单独文件便于维护和查找

**参考**: PIT-002

---

## D98: Docker 单容器 all-in-one 模式 (2026-08-21)

**决策**: 生产环境支持单容器运行 PostgreSQL + Redis + Server + UI

**理由**:

- 简化部署：无需 docker-compose
- 适合小规模部署：单机即可运行完整系统
- 数据持久化：通过 Docker volume 持久化

**权衡**:

- 单容器不适合高可用场景
- 高可用应使用分离的 PostgreSQL 和 Redis

**参考**: MediaServo Dockerfile

---

## D99: pnpm + nvm 替代 pixi (2026-08-21)

**决策**: 使用 pnpm + nvm 管理 Node.js 依赖，不使用 pixi

**理由**:

- AccessBase 是纯 TypeScript 项目，无原生依赖
- pnpm 已满足 monorepo 需求
- nvm 管理 Node.js 版本
- pixi 适合有 Rust/GStreamer 等原生依赖的项目（如 MediaServo）

**参考**: pixi vs mise 调研

---

## D100: CLI 脚本架构 (2026-08-21)

**决策**: 参考 MediaServo 创建 `bootstrap.sh` + `accessbase.sh` CLI

**理由**:

- 统一入口：`./accessbase.sh <command>`
- 首次安装：`source bootstrap.sh`
- 命令覆盖：dev/build/test/docker/db

**参考**: MediaServo mediaservo.sh + bootstrap.sh

---

## D101: 四种构建模式架构 (2026-08-27)

**背景**: AccessBase 需要支持不同场景的开发/部署方式。

**决策**: 支持四种独立构建模式：

| 模式 | 依赖 | 场景 |
|------|------|------|
| Native (pixi) | pixi + conda-forge | 开发、CI、无 Docker |
| Single Container | Docker | 快速体验 |
| Compose | Docker Compose | 团队开发、生产 |
| Deploy | Node.js only | 构建到 out/，单端口部署 |

**命令规范**: `<操作>:<模式>`，无后缀默认 native。

**数据目录**: Native=`.pixi/data/`，Deploy=`data/`，Docker=volumes。

---

## D102: Deploy 模式单端口服务 (2026-08-27)

**决策**: Deploy 模式通过 `@fastify/static` 在同一端口 (5101) 服务 API + 前端静态资源。

**关键约束**:
- `@fastify/static` v6（Fastify v4 兼容）
- `setupGuard` 的 `ALLOWED_PATHS` 必须包含 `/`, `/assets/` 等静态路径
- `out/server/node_modules` 需 symlink 到 `apps/server/node_modules`（pnpm 幽灵依赖）

---

## D103: Admin 自动创建策略 (2026-08-27)

**决策**: `initializeAdmin()` 在 server 启动时自动创建 admin，并标记 `setupState.isInitialized=true`。

**规则**:
- 设置 `ADMIN_EMAIL` + `ADMIN_PASSWORD` → 使用指定凭据
- 未设置 → 使用默认邮箱 + 随机密码
- 只要 admin 创建成功或已存在 → 标记 setup 完成 → 不显示 wizard

---

## D104: E2E 测试不覆盖跨 session 状态 (2026-08-27)

**教训**: Playwright 每个 test() 创建新浏览器上下文（fresh localStorage），无法测试「完成 setup → reset 后端 → 同一浏览器刷新」场景。

**新增测试**: `setup-real-reset.spec.ts` — 注入 `currentStep:3` 到 localStorage，mock status 返回 `isInitialized: false`，验证回到 WelcomeStep。

---

## D105: 用户 CRUD API 类型约束 (2026-08-27)

**决策**: User 实体无 `status` 字段（使用 `isActive: boolean`），无 `roles` 字段。

**约束**:
- 后端返回 `isActive: boolean`，前端映射为 Tag 颜色
- `PATCH /users/:id/status` 独立端点调用 `UserManager.changeStatus()`
- `roles` 不在 User 列表/表单中展示

---

## D106: E2E 测试 Mock vs 真后端策略 (2026-08-27)

**决策**: CRUD E2E 测试使用 mock API（`page.route`），setup E2E 测试使用真后端。

**理由**:
- CRUD 测试关注 UI 交互逻辑，mock 更稳定、更快
- Setup 测试关注完整初始化流程，需要真后端验证
- 真后端 E2E 受 bash timeout / Vite 进程生命周期影响，不适合 CI

**规则**: 新 E2E 测试默认用 mock API，只有 setup/init 类测试用真后端。

**新增测试**: `setup-real-reset.spec.ts` — 注入 `currentStep:3` 到 localStorage，mock status 返回 `isInitialized: false`，验证回到 WelcomeStep。

## D110: 安全基座架构（RS256 回退 + DB 权威会话 + 可注入审计存储） (2026-08-31)

- **决策**: 1) JWT 支持 RS256（JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH），未配置时回退 HMAC（开发友好，生产必须配密钥）。2) Refresh token 为不透明随机串，DB sessions 表权威（bcrypt 哈希存储、rotation、reuse 检测→吊销全部会话），access token 仍由 @fastify/jwt 签发。3) AuditLogger 通过 AuditStorage 接口注入存储实现，server 默认用 drizzle 写 audit_logs 表，测试注入内存实现。4) 错误 envelope 补全 timestamp/requestId/path（Sec 19.13/D52）。
- **理由**: 兼顾开发体验（零配置启动）与生产安全（非对称签名+可吊销会话+完整审计）；DB 权威使多设备/吊销语义清晰；接口注入避免 audit 包依赖 drizzle。
- **参考**: security.md 19.13/19.18/25.4/25.5, database.md 22.1, PIT-020/021
## D111: FlowTokenService 单次用途 token 作为多步认证主干 (2026-08-31)

- **决策**: FlowTokenService（单次消费、purpose 限定、短 TTL、Redis+内存双后备）作为多步认证流的通用 token 层：MFA step-up（purpose=mfa_verify）现已接入，password_reset（6a）复用同一服务，6d WebAuthn/OAuth 交换将复用同一机制。
- **理由**: 单次消费 + purpose 绑定 + 短 TTL 三重防护使 flow token 不能重放/跨流滥用；服务端存储意味着颁发后的授权状态变化即时生效；统一层避免每种认证流各造一套 token 语义。
- **参考**: 6b Task 2/3（FlowTokenService、/auth/mfa/*），security.md 19.x，D110


## D109: GitHub OAuth 豁免 PKCE（经典 OAuth App 限制） (2026-08-31)

- **决策**: GitHub 走经典 OAuth App（不支持 PKCE），仅用 state cookie（httpOnly/SameSite=Lax/10min）做 CSRF 防护；Google 走 arctic 完整 PKCE（state+code_verifier 双 cookie）。记录于 oauth 回调设计。
- **理由**: D85 要求全流程 PKCE，但 GitHub OAuth App 机制不支持 code_challenge；state cookie 已覆盖 CSRF 面。换 GitHub App（支持 PKCE）留 L1。
- **参考**: docs/superpowers/plans/2026-08-28-phase-6d-login-extensions.md Task 1 AUDIT FIX, security.md 19.16

## D112: 用户名无发现 WebAuthn Passkey 作为主登录因子 (2026-08-31)

- **决策**: Passkey 登录用 resident/discoverable credential（不含 username 的 allowCredentials）实现用户名无发现登录，作为主认证因子之一；challenge 经 FlowTokenService 单次消费（purpose=webauthn），防重放/并发复用；认证器 counter 只增校验防克隆（counter 回退即拒绝并吊销）。
- **理由**: discoverable credential 让用户免输用户名即可登录，UX 优于传统 MFA 第二因子；challenge 单次消费堵住 token 重放窗口；counter 回退检测是 WebAuthn 规范内唯一的服务端克隆信号。
- **参考**: 6d Task 3（webauthn 路由 + counter 回归保护），D111（FlowTokenService），security.md 19.x

## D113: Setup 状态以 DB 为准 + env 双变量旁路 (2026-09-01)

- **决策**: setup 状态（isInitialized/adminExists/configComplete）不再内存化，每次从 users 表推导；env 旁路收紧为 ADMIN_EMAIL+ADMIN_PASSWORD 双变量齐备才触发，未设则首次访问进入 Setup Wizard
- **理由**: DB-as-truth 使 reset/新环境天然回向导，无状态漂移；双变量设计防半配置意外旁路；随机密码进日志的隐患一并消除
- **参考**: docs/superpowers/plans/2026-09-01-setup-wizard-unification.md
