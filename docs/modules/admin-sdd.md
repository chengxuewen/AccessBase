# @accessbase/admin 软件设计文档（SDD）

> 本文档为 `@accessbase/admin` 包的详细软件设计文档。
> 基于 [`core-packages.md`](./core-packages.md) §10.2 和 [`ui.md`](./ui.md) §14 生成。

---

## 1. 包概述

### 1.1 定位

`@accessbase/admin` 是 AccessBase L0 基石层的**后台管理框架包**，提供企业级管理后台的完整外壳（Shell），包括布局、导航、主题、品牌定制、页面注册、基础 CRUD 框架等能力。

**一句话定义**：任何基于 AccessBase 构建的平台，通过依赖 `@accessbase/admin` 即可获得开箱即用的管理后台框架，无需从零搭建布局和基础设施。

### 1.2 核心能力

| 能力 | 说明 | 来源 |
|------|------|------|
| 后台外壳（Shell） | 经典后台布局：侧边栏 + 顶部导航 + 内容区 | `ui.md` §14.4 |
| 主题机制 | ThemeProvider、亮暗切换、持久化、BrandTokens 注入 | `core-packages.md` §10.2 |
| 品牌定制 | Logo、品牌色、品牌语、字体，三层继承 | `core-packages.md` §10.2 |
| 菜单管理 | 多级菜单、权限过滤、动态注册 | `ui.md` §14.5 |
| 页面注册 | 路由注册、懒加载、权限守卫 | `ui.md` §14.10 |
| 基础 CRUD 框架 | ProTable 封装、表单验证、批量操作 | `ui.md` §14.7, §14.11 |
| 全局状态管理 | Zustand Store 分片（auth/UI/data） | `ui.md` §14.14 |
| API 客户端 | Axios 封装、Token 刷新、防重复提交 | `ui.md` §14.15 |
| 错误处理 | 全局错误边界、API 错误拦截、Toast 规范 | `ui.md` §14.12 |
| 加载状态 | 骨架屏、Loading 规范 | `ui.md` §14.13 |
| 无障碍 | ARIA 角色、键盘导航、对比度规范 | `ui.md` §14.16 |
| 响应式 | 断点定义、移动端适配 | `ui.md` §14.8 |
| 通知中心 | 系统通知、未读计数、轮询 | `ui.md` §14.18 |
| 全局搜索 | Cmd+K 搜索、防抖、分类结果 | `ui.md` §14.17 |

### 1.3 边界

**包含**：
- 登录页、ProLayout 外壳、主题机制、菜单/面包屑/用户头像
- 基础 CRUD 框架（ProTable 封装：分页/筛选/表格/表单）
- 用户/角色/租户管理页（IAM 管理界面）
- 状态管理、API 客户端、错误处理、加载状态

**不包含**：
- 任何具体品牌样式（品牌由 BrandTokens 注入）
- 业务页面（MES/MediaServo 等业务归 L2）
- Schema 驱动动态建模（归 L1 平台层）
- 插件热插拔体系（归 L1 平台层）
- 认证/授权核心逻辑（归 `@accessbase/identity`）
- 审计记录逻辑（归 `@accessbase/audit`）

### 1.4 设计原则

1. **机制进 L0，品牌留上层**：提供 ThemeProvider/BrandTokens 注入接口，不内置任何品牌色/Logo
2. **配置驱动**：通过配置点和扩展接口定制行为，不引入插件机制
3. **组件分层**：L0（Ant Design）→ L1（ProComponents）→ L2（@accessbase/ui 业务）→ L3（页面级）（D95）
4. **无头业务层**：业务逻辑与 UI 解耦，通过数据提供者模式抽象 API 层（D95）
5. **品牌中立**：默认中性设计令牌，零品牌负担

---

## 2. 核心接口

### 2.1 AdminApp — 应用入口

`AdminApp` 是整个后台框架的根组件和配置入口，负责组装所有子系统。

```typescript
interface AdminAppProps {
  /** 品牌令牌注入（L1/L2 层注入品牌色、Logo 等） */
  brandTokens?: BrandTokens

  /** 自定义登录页组件（覆盖默认 LoginPage） */
  loginComponent?: React.ComponentType<LoginPageProps>

  /** 路由配置（页面注册表） */
  routes?: RouteConfig[]

  /** 菜单配置（初始菜单项，可被 MenuManager 动态修改） */
  menuItems?: MenuItem[]

  /** 全局配置 */
  config?: AdminConfig

  /** 生命周期钩子 */
  hooks?: AdminHooks

  /** 子元素（L1/L2 注入的额外 Provider 或全局组件） */
  children?: React.ReactNode
}

interface AdminAppInstance {
  /** 获取当前应用配置 */
  getConfig(): AdminConfig

  /** 获取菜单管理器 */
  getMenuManager(): MenuManager

  /** 获取页面注册器 */
  getPageRegistry(): PageRegistry

  /** 获取主题管理器 */
  getThemeManager(): ThemeManager

  /** 获取品牌管理器 */
  getBrandManager(): BrandManager

  /** 获取 API 客户端 */
  getApiClient(): ApiClient

  /** 获取认证 Store */
  getAuthStore(): AuthStore

  /** 获取 UI Store */
  getUIStore(): UIStore
}

/**
 * 应用根组件
 *
 * 组件树：
 * <AdminApp>
 *   <ErrorBoundary>
 *     <I18nProvider>
 *       <ThemeProvider>
 *         <AuthProvider>
 *           <Router>
 *             <MainLayout> / <LoginPage>
 *           </Router>
 *         </AuthProvider>
 *       </ThemeProvider>
 *     </I18nProvider>
 *   </ErrorBoundary>
 * </AdminApp>
 */
function AdminApp(props: AdminAppProps): React.ReactElement
```

**使用示例**：

```typescript
// L1 平台层使用
<AdminApp
  brandTokens={{
    primaryColor: '#1890ff',
    logo: '/logo.svg',
    brandName: 'Weave'
  }}
  routes={platformRoutes}
  menuItems={platformMenuItems}
  hooks={{
    beforeLogin: async (credentials) => {
      await customValidation(credentials)
    }
  }}
/>
```

### 2.2 MenuManager — 菜单管理器

`MenuManager` 负责管理后台侧边栏菜单的注册、过滤、排序和状态。

```typescript
interface MenuItem {
  /** 唯一标识 */
  key: string

  /** 显示文本（支持 i18n key） */
  label: string

  /** 图标 */
  icon?: React.ReactNode

  /** 路由路径 */
  path?: string

  /** 子菜单 */
  children?: MenuItem[]

  /** 所需权限（无权限则隐藏） */
  permission?: string

  /** 角标数字 */
  badge?: number

  /** 是否隐藏（不在菜单中显示，但路由仍生效） */
  hidden?: boolean

  /** 排序权重（越小越靠前） */
  order?: number

  /** 分组标识 */
  group?: string
}

interface MenuState {
  /** 当前菜单项列表（已过滤 + 已排序） */
  items: MenuItem[]

  /** 当前选中的菜单 key */
  selectedKeys: string[]

  /** 当前展开的子菜单 keys */
  openKeys: string[]

  /** 侧边栏是否折叠 */
  collapsed: boolean
}

interface MenuManager {
  /** 注册菜单项（支持增量注册） */
  register(items: MenuItem[]): void

  /** 移除菜单项（按 key） */
  unregister(keys: string[]): void

  /** 更新菜单项（合并更新） */
  update(key: string, patch: Partial<MenuItem>): void

  /** 获取过滤后的菜单（基于当前用户权限） */
  getFilteredItems(): MenuItem[]

  /** 设置选中的菜单项 */
  setSelectedKeys(keys: string[]): void

  /** 设置展开的子菜单 */
  setOpenKeys(keys: string[]): void

  /** 切换侧边栏折叠状态 */
  toggleCollapsed(): void

  /** 订阅菜单状态变化 */
  subscribe(listener: (state: MenuState) => void): () => void

  /** 获取当前菜单状态快照 */
  getState(): MenuState
}
```

**权限过滤规则**：
- 遍历菜单树，检查当前用户的 `permissions` 列表
- 无 `permission` 字段的菜单项始终显示
- 有 `permission` 字段且用户无对应权限时隐藏该菜单项及其所有子项
- 过滤在运行时执行，权限变更后自动刷新

### 2.3 PageRegistry — 页面注册器

`PageRegistry` 负责管理路由和页面组件的注册，支持懒加载、权限守卫和动态注册。

```typescript
interface RouteConfig {
  /** 路由路径 */
  path: string

  /** 页面组件（支持懒加载） */
  component: React.LazyExoticComponent<React.ComponentType>

  /** 路由元信息 */
  meta: RouteMeta

  /** 子路由 */
  children?: RouteConfig[]
}

interface RouteMeta {
  /** 页面标题（i18n key） */
  title: string

  /** 所需权限 */
  permission?: string

  /** 菜单图标 */
  icon?: React.ReactNode

  /** 是否在菜单中隐藏 */
  hideInMenu?: boolean

  /** 是否显示在面包屑中，默认 true */
  breadcrumb?: boolean

  /** 是否缓存页面，默认 false */
  keepAlive?: boolean

  /** 布局类型，默认 'default' */
  layout?: 'default' | 'blank' | 'fullscreen'
}

interface PageRegistry {
  /** 注册路由配置（支持批量） */
  registerRoutes(routes: RouteConfig[]): void

  /** 注册单个路由 */
  registerRoute(route: RouteConfig): void

  /** 移除路由（按路径） */
  unregisterRoute(path: string): void

  /** 获取所有已注册路由（扁平化） */
  getFlatRoutes(): RouteConfig[]

  /** 获取路由树（保留层级） */
  getRouteTree(): RouteConfig[]

  /** 根据路径查找路由配置 */
  findRoute(path: string): RouteConfig | undefined

  /** 生成面包屑（基于当前路径） */
  getBreadcrumbs(pathname: string): BreadcrumbItem[]

  /** 订阅路由变化 */
  subscribe(listener: (routes: RouteConfig[]) => void): () => void
}

interface BreadcrumbItem {
  title: string
  path: string
}

/** 路由守卫组件 */
interface ProtectedRouteProps {
  children: React.ReactNode
  permission?: string
  fallback?: React.ReactNode  // 无权限时展示，默认跳转 403
}
```

**默认路由表**：

| 路径 | 组件 | 权限 | 说明 |
|------|------|------|------|
| `/login` | LoginPage | — | 登录页，hideInMenu |
| `/dashboard` | DashboardPage | — | 仪表盘 |
| `/users` | UserListPage | `users:read` | 用户列表 |
| `/users/create` | UserCreatePage | `users:write` | 创建用户 |
| `/users/:id` | UserDetailPage | `users:read` | 用户详情 |
| `/users/:id/edit` | UserEditPage | `users:write` | 编辑用户 |
| `/roles` | RoleListPage | `roles:read` | 角色列表 |
| `/roles/create` | RoleCreatePage | `roles:write` | 创建角色 |
| `/roles/:id` | RoleDetailPage | `roles:read` | 角色详情 |
| `/roles/:id/edit` | RoleEditPage | `roles:write` | 编辑角色 |
| `/audit` | AuditLogPage | `audit:read` | 审计日志 |
| `/settings/general` | GeneralSettingsPage | `settings:read` | 通用设置 |
| `/settings/security` | SecuritySettingsPage | `settings:read` | 安全设置 |
| `/settings/integrations` | IntegrationSettingsPage | `settings:read` | 集成配置 |
| `/403` | ForbiddenPage | — | 无权限页 |
| `/404` | NotFoundPage | — | 404 页 |

### 2.4 ThemeManager — 主题管理器

`ThemeManager` 负责亮暗主题切换、设计令牌管理、持久化和与 Ant Design ConfigProvider 的桥接。

```typescript
type ThemeMode = 'light' | 'dark'

interface DesignTokens {
  colors: {
    primary: string
    secondary: string
    success: string
    warning: string
    error: string
    info: string
    text: {
      primary: string
      secondary: string
      disabled: string
    }
    background: {
      default: string
      paper: string
      elevated: string
    }
    border: {
      default: string
      strong: string
    }
  }
  typography: {
    fontFamily: string
    fontSize: { xs: string; sm: string; md: string; lg: string; xl: string }
    fontWeight: { light: number; regular: number; medium: number; bold: number }
    lineHeight: { tight: number; normal: number; relaxed: number }
  }
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string }
  borderRadius: { none: string; sm: string; md: string; lg: string; full: string }
  shadows: { none: string; sm: string; md: string; lg: string }
  transitions: {
    duration: { fast: string; normal: string; slow: string }
    easing: { easeIn: string; easeOut: string; easeInOut: string }
  }
}

interface ThemeConfig {
  /** 主题模式 */
  mode: ThemeMode

  /** 品牌令牌（L1/L2 注入） */
  brand?: BrandTokens

  /** 自定义令牌覆盖 */
  custom?: Partial<DesignTokens>
}

interface ThemeManager {
  /** 获取当前主题模式 */
  getMode(): ThemeMode

  /** 设置主题模式 */
  setMode(mode: ThemeMode): void

  /** 切换亮暗主题 */
  toggleMode(): void

  /** 获取当前合并后的设计令牌 */
  getDesignTokens(): DesignTokens

  /** 合并自定义令牌覆盖 */
  mergeCustomTokens(tokens: Partial<DesignTokens>): void

  /** 持久化偏好到 localStorage */
  persistPreference(): void

  /** 从 localStorage 恢复偏好 */
  restorePreference(): ThemeConfig

  /** 检测系统主题偏好 */
  detectSystemPreference(): ThemeMode

  /** 订阅主题变化 */
  subscribe(listener: (config: ThemeConfig) => void): () => void

  /** 生成 Ant Design 主题配置 */
  toAntdTheme(): AntdThemeConfig
}
```

**持久化策略**：
- Key: `accessbase:theme`
- 存储: `localStorage`（跨会话保留）
- 检测顺序: localStorage → `prefers-color-scheme` 媒体查询 → 默认 `light`

**主题继承链**：
```
L2 应用层    品牌定制（Logo、品牌语、业务主题覆盖）
               ↑ 继承/覆盖
L1 平台层    平台品牌令牌（品牌色、品牌字体）
               ↑ 继承/覆盖
L0 基石层    默认中性主题 + BrandTokens 注入接口
```

### 2.5 BrandManager — 品牌管理器

`BrandManager` 负责品牌令牌的注入、合并和运行时更新。

```typescript
interface BrandTokens {
  /** 主品牌色 */
  primaryColor: string

  /** 次品牌色 */
  secondaryColor: string

  /** Logo（URL 字符串或 ReactNode） */
  logo: string | React.ReactNode

  /** 折叠状态 Logo */
  logoCollapsed: string | React.ReactNode

  /** 品牌名称 */
  brandName: string

  /** 品牌标语（可选） */
  brandTagline?: string

  /** 品牌字体（可选） */
  fontFamily?: string
}

interface BrandState {
  /** 当前生效的品牌令牌 */
  tokens: BrandTokens

  /** 是否已注入自定义品牌 */
  isCustomized: boolean
}

interface BrandManager {
  /** 注入品牌令牌（L1/L2 层调用） */
  inject(tokens: Partial<BrandTokens>): void

  /** 获取当前品牌令牌（已合并默认值） */
  getTokens(): BrandTokens

  /** 获取品牌状态 */
  getState(): BrandState

  /** 重置为默认中性品牌 */
  reset(): void

  /** 订阅品牌变化 */
  subscribe(listener: (tokens: BrandTokens) => void): () => void
}
```

**默认品牌令牌（中性设计）**：

```typescript
const DEFAULT_BRAND_TOKENS: BrandTokens = {
  primaryColor: '#1677ff',      // Ant Design 默认主色
  secondaryColor: '#52c41a',
  logo: null,                    // 无默认 Logo
  logoCollapsed: null,
  brandName: 'AccessBase',
  brandTagline: undefined,
  fontFamily: undefined          // 使用系统默认字体
}
```

---

## 3. 生命周期钩子

### 3.1 钩子定义

```typescript
interface AdminHooks {
  /** 应用初始化前（异步，阻塞渲染） */
  onInit?: () => Promise<void>

  /** 应用初始化完成后 */
  onReady?: () => void

  /** 登录前（自定义验证逻辑） */
  beforeLogin?: (credentials: LoginCredentials) => Promise<void>

  /** 登录后 */
  afterLogin?: (user: User, response: LoginResponse) => Promise<void>

  /** 登出前 */
  beforeLogout?: () => Promise<void>

  /** 登出后 */
  afterLogout?: () => void

  /** 路由变更前（返回 false 阻止导航） */
  beforeRouteChange?: (to: string, from: string) => Promise<boolean | void>

  /** 路由变更后 */
  afterRouteChange?: (to: string, from: string) => void

  /** 全局错误处理 */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void

  /** 主题变更 */
  onThemeChange?: (mode: ThemeMode) => void

  /** 品牌变更 */
  onBrandChange?: (tokens: BrandTokens) => void
}
```

### 3.2 生命周期执行顺序

```
应用启动
  │
  ├─ 1. onInit()              ← 阻塞渲染，等待完成
  │     ├─ 恢复认证状态（Token 验证）
  │     ├─ 恢复主题偏好
  │     └─ 恢复 UI 状态（侧边栏、标签页）
  │
  ├─ 2. 渲染路由树
  │     ├─ 路由守卫检查（ProtectedRoute）
  │     └─ 页面懒加载
  │
  ├─ 3. onReady()             ← 首次渲染完成后
  │
  ├─ 运行时：
  │     ├─ beforeLogin → afterLogin
  │     ├─ beforeLogout → afterLogout
  │     ├─ beforeRouteChange → afterRouteChange
  │     ├─ onError（全局错误）
  │     ├─ onThemeChange
  │     └─ onBrandChange
  │
  └─ 应用卸载（浏览器关闭/刷新）
```

### 3.3 钩子使用示例

```typescript
<AdminApp
  hooks={{
    onInit: async () => {
      // 初始化自定义认证逻辑
      await loadCustomAuthConfig()
    },
    beforeLogin: async (credentials) => {
      // 企业 SSO 前置检查
      if (credentials.email.endsWith('@enterprise.com')) {
        await redirectToSSO(credentials)
      }
    },
    afterLogin: async (user) => {
      // 登录后加载用户偏好
      await loadUserPreferences(user.id)
    },
    onError: (error) => {
      // 上报错误到监控系统
      reportToSentry(error)
    }
  }}
/>
```

---

## 4. 依赖关系

### 4.1 包间依赖

```
@accessbase/admin
  ├── @accessbase/identity    ← 认证状态、权限检查、用户信息
  ├── @accessbase/audit       ← 审计事件记录（写操作）
  ├── @accessbase/i18n        ← 国际化翻译（useTranslation）
  ├── @accessbase/logging     ← 结构化日志（可选，前端日志上报）
  ├── @accessbase/migration   ← 无直接依赖（数据库层）
  └── @accessbase/shared-types ← 共享类型定义
```

**依赖说明**：

| 依赖包 | 依赖方式 | 说明 |
|--------|---------|------|
| `@accessbase/identity` | **强依赖** | 认证状态（useAuthStore）、权限检查（ACLGuard）、用户/角色管理 API |
| `@accessbase/audit` | **弱依赖** | 审计事件上报（写操作后调用 auditService.log） |
| `@accessbase/i18n` | **强依赖** | 翻译 Hook（useTranslation）、语言检测、双命名空间 |
| `@accessbase/logging` | **可选** | 前端日志上报到后端（pino 格式） |
| `@accessbase/shared-types` | **强依赖** | User、Role、Permission 等共享类型 |

### 4.2 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `react` | ^18 | UI 框架 |
| `react-dom` | ^18 | DOM 渲染 |
| `react-router-dom` | ^6 | 路由管理 |
| `antd` | ^5 | UI 组件库 |
| `@ant-design/pro-components` | ^2 | ProTable、ProForm、ProLayout |
| `@ant-design/icons` | ^5 | 图标库 |
| `zustand` | ^5 | 状态管理 |
| `axios` | ^1 | HTTP 客户端 |
| `zod` | ^3 | 表单验证 Schema |
| `@hookform/resolvers` | ^3 | Zod + react-hook-form 桥接 |
| `react-hook-form` | ^7 | 表单状态管理 |
| `i18next` | ^23 | 国际化引擎 |
| `react-i18next` | ^14 | React i18n Hook |
| `dayjs` | ^1 | 日期处理（Ant Design 依赖） |

### 4.3 被上层依赖

```
L1 平台层（Weave 等）
  └── @accessbase/admin     ← 作为后台外壳

L2 应用层（MediaServo/MES 等）
  └── @accessbase/admin     ← 作为后台外壳 + 注入品牌/路由/菜单
```

### 4.4 依赖方向约束

- **单向依赖**：`@accessbase/admin` → L0 其他包，禁止反向依赖
- **不依赖 L1**：admin 不依赖任何 L1 平台层包（schema-engine/plugin-framework 等）
- **不依赖 L2**：admin 不依赖任何 L2 应用层包
- **接口抽象**：通过 `AdminAppProps` 接口接收上层注入，不硬编码上层实现

---

## 5. 错误码体系

### 5.1 错误码范围

`@accessbase/admin` 使用 `ADMIN_001` ~ `ADMIN_099` 错误码范围。

### 5.2 错误码表

| 错误码 | HTTP 状态 | 名称 | 说明 | 前端处理 |
|--------|----------|------|------|---------|
| `ADMIN_001` | 400 | INVALID_INPUT | 表单输入验证失败 | 高亮对应字段，显示校验错误 |
| `ADMIN_002` | 401 | AUTH_EXPIRED | 登录已过期 | 跳转登录页，提示重新登录 |
| `ADMIN_003` | 403 | PERMISSION_DENIED | 无权限执行此操作 | 跳转 403 页面 |
| `ADMIN_004` | 404 | RESOURCE_NOT_FOUND | 资源不存在 | 跳转 404 页面或列表页 |
| `ADMIN_005` | 409 | CONFLICT | 数据冲突（他人已修改） | 提示刷新后重试 |
| `ADMIN_006` | 429 | RATE_LIMITED | 请求过于频繁 | 倒计时提示，冷却后重试 |
| `ADMIN_007` | 500 | INTERNAL_ERROR | 服务器内部错误 | 通用错误提示，建议联系管理员 |
| `ADMIN_008` | 401 | INVALID_CREDENTIALS | 用户名或密码错误 | 表单字段高亮，清除密码 |
| `ADMIN_009` | 400 | INVALID_EMAIL | 邮箱格式不正确 | 高亮邮箱字段 |
| `ADMIN_010` | 400 | WEAK_PASSWORD | 密码强度不足 | 显示密码强度要求 |
| `ADMIN_011` | 409 | EMAIL_ALREADY_EXISTS | 邮箱已被注册 | 提示登录或找回密码 |
| `ADMIN_012` | 503 | NETWORK_ERROR | 网络连接失败 | 重试按钮，检查网络提示 |
| `ADMIN_013` | 500 | AUTH_CONFIG_MISSING | 认证配置未找到 | 提示联系管理员 |
| `ADMIN_014` | 400 | MENU_REGISTRATION_FAILED | 菜单注册失败（key 冲突） | 控制台警告（开发模式） |
| `ADMIN_015` | 400 | ROUTE_CONFLICT | 路由路径冲突 | 控制台警告（开发模式） |
| `ADMIN_016` | 400 | THEME_INVALID_TOKENS | 主题令牌格式无效 | 回退到默认主题，控制台警告 |
| `ADMIN_017` | 400 | BRAND_INJECTION_FAILED | 品牌令牌注入失败 | 使用默认品牌，控制台警告 |
| `ADMIN_018` | 400 | PAGE_COMPONENT_MISSING | 页面组件未注册 | 显示 404 页面 |
| `ADMIN_019` | 403 | ROUTE_FORBIDDEN | 路由权限不足 | 显示 403 页面 |
| `ADMIN_020` | 500 | STATE_PERSISTENCE_FAILED | 状态持久化失败 | 降级到内存状态，控制台警告 |
| `ADMIN_021` | 400 | FORM_VALIDATION_FAILED | 表单 Schema 验证失败 | 显示字段级错误 |
| `ADMIN_022` | 409 | DUPLICATE_SUBMIT | 重复提交（防抖拦截） | 静默忽略或提示等待 |
| `ADMIN_023` | 500 | I18N_LOAD_FAILED | 语言包加载失败 | 回退到默认语言 |
| `ADMIN_024` | 500 | COMPONENT_RENDER_ERROR | 组件渲染异常 | 显示错误边界 Fallback |
| `ADMIN_025` | 400 | BATCH_OPERATION_FAILED | 批量操作部分失败 | 显示成功/失败数量及详情 |

### 5.3 错误响应格式

```typescript
interface AdminErrorResponse {
  success: false
  error: {
    /** 错误码（ADMIN_XXX） */
    code: string

    /** 用户友好的错误信息（i18n key 或直接文案） */
    message: string

    /** 字段级错误详情（表单验证场景） */
    details?: Record<string, string>

    /** 请求追踪 ID */
    requestId?: string

    /** 错误发生时间戳 */
    timestamp?: string
  }
}
```

### 5.4 错误处理策略

```
错误发生
  │
  ├─ 开发模式（NODE_ENV=development）
  │     ├─ 控制台输出完整错误栈
  │     ├─ 错误边界显示详细信息
  │     └─ 错误码 + 错误信息 + 请求上下文
  │
  └─ 生产模式（NODE_ENV=production）
        ├─ 控制台仅输出错误码（脱敏）
        ├─ 错误边界显示用户友好信息
        ├─ 错误上报到监控系统（Sentry 等）
        └─ 敏感信息不暴露给前端
```

---

## 6. 配置项

### 6.1 AdminConfig — 全局配置

```typescript
interface AdminConfig {
  /** UI 配置 */
  ui: UIConfig

  /** 主题配置 */
  theme: ThemeConfigOptions

  /** 布局配置 */
  layout: LayoutConfig

  /** 导航配置 */
  navigation: NavigationConfig

  /** 响应式配置 */
  responsive: ResponsiveConfig

  /** API 配置 */
  api: ApiConfig

  /** 开发配置 */
  dev: DevConfig
}
```

### 6.2 UI 配置

```typescript
interface UIConfig {
  /** 设计系统（默认 'antd'） */
  designSystem: 'antd'

  /** 空状态文案 */
  emptyText: string

  /** 加载文案 */
  loadingText: string

  /** 确认对话框默认文案 */
  confirmText: {
    ok: string
    cancel: string
    delete: string
  }

  /** Toast 消息配置 */
  toast: {
    /** 默认显示时长（秒），默认 3 */
    duration: number

    /** 最大同时显示数量，默认 3 */
    maxCount: number
  }

  /** 表格默认配置 */
  table: {
    /** 默认每页条数，默认 20 */
    defaultPageSize: number

    /** 可选每页条数 */
    pageSizeOptions: number[]

    /** 默认排序 */
    defaultSortOrder: 'asc' | 'desc'
  }
}
```

### 6.3 主题配置

```typescript
interface ThemeConfigOptions {
  /** 默认主题模式，默认 'light' */
  defaultMode: ThemeMode

  /** 是否允许用户切换主题，默认 true */
  allowToggle: boolean

  /** 是否持久化用户偏好，默认 true */
  persistPreference: boolean

  /** 持久化存储 Key，默认 'accessbase:theme' */
  storageKey: string
}
```

### 6.4 布局配置

```typescript
interface LayoutConfig {
  /** 布局类型，默认 'classic' */
  type: 'classic' | 'modern' | 'fullscreen'

  /** 侧边栏配置 */
  sidebar: {
    /** 是否可折叠，默认 true */
    collapsible: boolean

    /** 默认是否折叠，默认 false */
    defaultCollapsed: boolean

    /** 展开宽度（px），默认 256 */
    width: number

    /** 折叠宽度（px），默认 80 */
    collapsedWidth: number
  }

  /** 顶部导航栏配置 */
  header: {
    /** 是否固定顶部，默认 true */
    fixed: boolean

    /** 高度（px），默认 64 */
    height: number

    /** 是否显示面包屑，默认 true */
    showBreadcrumbs: boolean

    /** 是否显示全局搜索，默认 true */
    showSearch: boolean

    /** 是否显示通知中心，默认 true */
    showNotification: boolean

    /** 是否显示主题切换，默认 true */
    showThemeToggle: boolean
  }

  /** 页脚配置 */
  footer: {
    /** 是否显示页脚，默认 false */
    show: boolean

    /** 页脚文案 */
    text?: string
  }
}
```

### 6.5 导航配置

```typescript
interface NavigationConfig {
  /** 菜单配置 */
  menu: {
    /** 菜单模式，默认 'inline' */
    mode: 'inline' | 'vertical' | 'horizontal'

    /** 菜单主题，默认 'light' */
    theme: 'light' | 'dark'

    /** 是否支持多级菜单，默认 true */
    multipleLevels: boolean

    /** 手风琴模式（同时只展开一个子菜单），默认 true */
    accordion: boolean
  }

  /** 面包屑配置 */
  breadcrumbs: {
    /** 是否启用，默认 true */
    enabled: boolean

    /** 分隔符，默认 '/' */
    separator: string

    /** 是否显示首页，默认 true */
    showHome: boolean
  }

  /** 标签页配置 */
  tabs: {
    /** 是否启用标签页导航，默认 true */
    enabled: boolean

    /** 是否可关闭，默认 true */
    closable: boolean

    /** 最大标签数，默认 10 */
    maxTabs: number

    /** 是否持久化标签页状态，默认 true */
    persistState: boolean

    /** 持久化存储 Key，默认 'accessbase:tabs' */
    storageKey: string
  }
}
```

### 6.6 响应式配置

```typescript
interface ResponsiveConfig {
  /** 是否启用响应式，默认 true */
  enabled: boolean

  /** 断点定义（px） */
  breakpoints: {
    xs: number  // 默认 480
    sm: number  // 默认 576
    md: number  // 默认 768
    lg: number  // 默认 992
    xl: number  // 默认 1200
    xxl: number // 默认 1600
  }

  /** 移动端侧边栏行为 */
  mobileSidebar: {
    /** 默认 'overlay' */
    mode: 'overlay' | 'push' | 'hidden'
  }
}
```

### 6.7 API 配置

```typescript
interface ApiConfig {
  /** API 基础 URL，默认 '/api' */
  baseURL: string

  /** 请求超时（ms），默认 30000 */
  timeout: number

  /** Token 刷新路径，默认 '/auth/refresh' */
  refreshEndpoint: string

  /** Token 存储 Key */
  tokenStorageKey: string

  /** 是否启用防重复提交，默认 true */
  deduplicateRequests: boolean

  /** 自定义请求头 */
  customHeaders?: Record<string, string>
}
```

### 6.8 开发配置

```typescript
interface DevConfig {
  /** 是否启用开发模式日志，默认 NODE_ENV=development */
  debug: boolean

  /** 是否显示组件边界（调试用），默认 false */
  showComponentBoundaries: boolean

  /** 是否启用 React StrictMode，默认 true */
  strictMode: boolean
}
```

### 6.9 YAML 配置示例

```yaml
# config.yaml
ui:
  design_system: antd

  theme:
    default_mode: light
    allow_toggle: true
    persist_preference: true

  layout:
    type: classic
    sidebar:
      collapsible: true
      default_collapsed: false
      width: 256
      collapsed_width: 80
    header:
      fixed: true
      height: 64
      show_breadcrumbs: true
      show_search: true

  navigation:
    menu:
      mode: inline
      theme: light
      multiple_levels: true
    breadcrumbs:
      enabled: true
      separator: /
    tabs:
      enabled: true
      closable: true
      max_tabs: 10

  responsive:
    enabled: true
    breakpoints:
      xs: 480
      sm: 576
      md: 768
      lg: 992
      xl: 1200

  api:
    base_url: /api
    timeout: 30000
```

---

## 附录 A：状态管理 Store 接口

### AuthStore（来自 `@accessbase/identity`，admin 消费）

```typescript
interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  permissions: string[]
  isAuthenticated: boolean
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => void
  refreshAuth: () => Promise<void>
  updateUser: (user: Partial<User>) => void
}
```

### UIStore（admin 管理）

```typescript
interface UIState {
  theme: ThemeMode
  locale: string
  sidebarCollapsed: boolean
  tabs: TabItem[]
  activeTab: string
  setTheme: (theme: ThemeMode) => void
  setLocale: (locale: string) => void
  toggleSidebar: () => void
  addTab: (tab: TabItem) => void
  closeTab: (key: string) => void
  setActiveTab: (key: string) => void
}
```

**持久化策略**：
- `localStorage`: theme, locale, sidebarCollapsed, tabs, activeTab
- `sessionStorage`: searchHistory, formDraft
- `memory only`: users, roles, permissions, loading, error

---

## 附录 B：组件分层（D95）

| 层级 | 包 | 组件示例 | 说明 |
|------|-----|---------|------|
| L0 | antd | Button, Input, Table, Form | Ant Design 原生组件 |
| L1 | @ant-design/pro-components | ProTable, ProForm, ProLayout | 高级业务组件 |
| L2 | @accessbase/ui | PermissionGuard, AuditLogViewer, UserAvatar | AccessBase 业务组件 |
| L3 | 页面级 | UserListPage, RoleConfigPage, DashboardPage | 具体页面组件 |

**设计约束**：
- L2/L3 组件可使用 L0/L1 组件
- L0/L1 组件不可依赖 L2/L3
- 插件通过 Registry 注册 L3 组件，核心组件不可覆盖
