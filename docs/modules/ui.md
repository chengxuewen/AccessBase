# UI 设计

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§14 UI 设计 + §37 前端补充 P2

---

## 14. UI 设计

### 14.1 设计原则

**企业级风格 + Ant Design 设计系统**：

- 专业、稳重、企业后台标准
- 完整的设计系统，覆盖颜色、字体、间距、组件
- 可配置的主题机制，支持品牌定制

### 14.2 设计令牌（Design Tokens）

```typescript
// 设计令牌接口
interface DesignTokens {
  // 颜色
  colors: {
    primary: string; // 主色
    secondary: string; // 次色
    success: string; // 成功色
    warning: string; // 警告色
    error: string; // 错误色
    info: string; // 信息色
    text: {
      primary: string; // 主文本
      secondary: string; // 次文本
      disabled: string; // 禁用文本
    };
    background: {
      default: string; // 默认背景
      paper: string; // 纸张背景
      elevated: string; // 提升背景
    };
    border: {
      default: string; // 默认边框
      strong: string; // 强边框
    };
  };

  // 字体
  typography: {
    fontFamily: string; // 字体族
    fontSize: {
      xs: string; // 超小
      sm: string; // 小
      md: string; // 中
      lg: string; // 大
      xl: string; // 超大
    };
    fontWeight: {
      light: number; // 细体
      regular: number; // 常规
      medium: number; // 中等
      bold: number; // 粗体
    };
    lineHeight: {
      tight: number; // 紧凑
      normal: number; // 常规
      relaxed: number; // 宽松
    };
  };

  // 间距
  spacing: {
    xs: string; // 超小间距
    sm: string; // 小间距
    md: string; // 中间距
    lg: string; // 大间距
    xl: string; // 超大间距
  };

  // 圆角
  borderRadius: {
    none: string; // 无圆角
    sm: string; // 小圆角
    md: string; // 中圆角
    lg: string; // 大圆角
    full: string; // 全圆角
  };

  // 阴影
  shadows: {
    none: string; // 无阴影
    sm: string; // 小阴影
    md: string; // 中阴影
    lg: string; // 大阴影
  };

  // 动画
  transitions: {
    duration: {
      fast: string; // 快速
      normal: string; // 常规
      slow: string; // 慢速
    };
    easing: {
      easeIn: string; // 缓入
      easeOut: string; // 缓出
      easeInOut: string; // 缓入缓出
    };
  };
}
```

### 14.3 主题机制

> **Phase 7+ (deferred).** Dark theme not implemented in Phase 6 — light mode only.
#### 14.3.1 亮暗主题

```typescript
// 主题配置
interface ThemeConfig {
  // 主题模式
  mode: 'light' | 'dark';

  // 品牌令牌（L1/L2 注入）
  brand?: BrandTokens;

  // 自定义令牌
  custom?: Partial<DesignTokens>;
}

// 主题上下文
const ThemeContext = React.createContext<ThemeConfig>({
  mode: 'light',
});

// 主题 Hook
function useTheme() {
  const context = React.useContext(ThemeContext);
  return context;
}

// 主题切换 Hook
function useThemeToggle() {
  const [theme, setTheme] = React.useState<ThemeConfig>(() => {
    // 从 localStorage 读取用户偏好
    const saved = localStorage.getItem('theme');
    if (saved) return JSON.parse(saved);

    // 检测系统偏好
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return { mode: 'dark' };
    }

    return { mode: 'light' };
  });

  // 持久化到 localStorage
  React.useEffect(() => {
    localStorage.setItem('theme', JSON.stringify(theme));
  }, [theme]);

  const toggleTheme = React.useCallback(() => {
    setTheme((prev) => ({
      ...prev,
      mode: prev.mode === 'light' ? 'dark' : 'light',
    }));
  }, []);

  return { theme, toggleTheme };
}
```

#### 14.3.2 品牌令牌注入

```typescript
// 品牌令牌接口
interface BrandTokens {
  // 品牌色
  primaryColor: string
  secondaryColor: string

  // Logo
  logo: string | React.ReactNode
  logoCollapsed: string | React.ReactNode

  // 品牌语
  brandName: string
  brandTagline?: string

  // 字体
  fontFamily?: string
}

// 主题提供者
function ThemeProvider({ children, brand }: ThemeProviderProps) {
  const { theme } = useThemeToggle()

  // 合并品牌令牌
  const mergedTheme = React.useMemo(() => {
    return mergeTheme(defaultTheme, theme, brand)
  }, [theme, brand])

  return (
    <ThemeContext.Provider value={mergedTheme}>
      <AntdConfigProvider theme={mergedTheme}>
        {children}
      </AntdConfigProvider>
    </ThemeContext.Provider>
  )
}
```

### 14.4 布局设计

#### 14.4.1 经典后台布局

```
┌─────────────────────────────────────────────────────────┐
│                    顶部导航栏                            │
│  ┌─────────┐  ┌─────────────────────────────────────┐    │
│  │  Logo   │  │  面包屑  │  搜索  │  通知  │  用户  │    │
│  └─────────┘  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
┌─────────┐  ┌─────────────────────────────────────────────┐
│         │  │                    内容区                    │
│  侧边栏 │  │  ┌─────────────────────────────────────┐    │
│         │  │  │  标签页导航                          │    │
│  ┌───┐  │  │  ├─────────────────────────────────────┤    │
│  │菜单│  │  │  │                                     │    │
│  │   │  │  │  │  页面内容                            │    │
│  │   │  │  │  │                                     │    │
│  │   │  │  │  │                                     │    │
│  └───┘  │  │  └─────────────────────────────────────┘    │
│         │  │                                             │
└─────────┘  └─────────────────────────────────────────────┘
```

#### 14.4.2 布局组件

```typescript
// 主布局组件
function MainLayout({ children }: MainLayoutProps) {
  const { theme } = useTheme()
  const { brand } = useBrand()
  const { menuItems } = useMenu()
  const { breadcrumbs } = useBreadcrumbs()

  return (
    <Layout className="main-layout">
      {/* 顶部导航栏 */}
      <Header className="header">
        <div className="header-left">
          {/* Logo */}
          <Logo src={brand?.logo} collapsed={collapsed} />
        </div>
        <div className="header-center">
          {/* 面包屑 */}
          <Breadcrumb items={breadcrumbs} />
        </div>
        <div className="header-right">
          {/* 搜索 */}
          <Search />
          {/* 通知 */}
          <Notification />
          {/* 主题切换 */}
          <ThemeToggle />
          {/* 用户头像 */}
          <UserAvatar />
        </div>
      </Header>

      <Layout>
        {/* 侧边栏 */}
        <Sider
          className="sider"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
        >
          <Menu
            items={menuItems}
            selectedKeys={selectedKeys}
            onClick={handleMenuClick}
          />
        </Sider>

        {/* 内容区 */}
        <Content className="content">
          {/* 标签页导航 */}
          <Tabs
            items={tabs}
            activeKey={activeTab}
            onChange={handleTabChange}
          />

          {/* 页面内容 */}
          <div className="page-content">
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
```

### 14.5 导航设计

#### 14.5.1 多级菜单

```typescript
// 菜单项接口
interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  path?: string
  children?: MenuItem[]
  permission?: string  // 所需权限
  badge?: number       // 角标
}

// 菜单配置
const menuItems: MenuItem[] = [
  {
    key: 'dashboard',
    label: '仪表盘',
    icon: <DashboardIcon />,
    path: '/dashboard'
  },
  {
    key: 'users',
    label: '用户管理',
    icon: <UserIcon />,
    permission: 'users:read',
    children: [
      { key: 'users-list', label: '用户列表', path: '/users' },
      { key: 'users-create', label: '创建用户', path: '/users/create', permission: 'users:write' }
    ]
  },
  {
    key: 'roles',
    label: '角色管理',
    icon: <RoleIcon />,
    permission: 'roles:read',
    children: [
      { key: 'roles-list', label: '角色列表', path: '/roles' },
      { key: 'roles-create', label: '创建角色', path: '/roles/create', permission: 'roles:write' }
    ]
  },
  {
    key: 'audit',
    label: '审计日志',
    icon: <AuditIcon />,
    path: '/audit',
    permission: 'audit:read'
  },
  {
    key: 'settings',
    label: '系统设置',
    icon: <SettingsIcon />,
    permission: 'settings:read',
    children: [
      { key: 'settings-general', label: '通用设置', path: '/settings/general' },
      { key: 'settings-security', label: '安全设置', path: '/settings/security' },
> **L1-deferred (Phase 7+):** Integrations tab. OAuth account linking lives in Profile page (6d Task 2).
      { key: 'settings-integrations', label: '集成配置', path: '/settings/integrations' }
    ]
  }
]
```

#### 14.5.2 面包屑导航

```typescript
// 面包屑 Hook
function useBreadcrumbs() {
  const location = useLocation();
  const { menuItems } = useMenu();

  const breadcrumbs = React.useMemo(() => {
    const pathSegments = location.pathname.split('/').filter(Boolean);

    return pathSegments.map((segment, index) => {
      const path = '/' + pathSegments.slice(0, index + 1).join('/');
      const menuItem = findMenuItemByPath(menuItems, path);

      return {
        title: menuItem?.label || segment,
        path: path,
      };
    });
  }, [location.pathname, menuItems]);

  return { breadcrumbs };
}
```

> **Phase 7+ (deferred).** Tab navigation not implemented in Phase 6.
#### 14.5.3 标签页导航

```typescript
// 标签页 Hook
function useTabs() {
  const [tabs, setTabs] = React.useState<TabItem[]>([]);
  const [activeTab, setActiveTab] = React.useState<string>('');

  // 添加标签页
  const addTab = React.useCallback((tab: TabItem) => {
    setTabs((prev) => {
      const exists = prev.find((t) => t.key === tab.key);
      if (exists) return prev;
      return [...prev, tab];
    });
    setActiveTab(tab.key);
  }, []);

  // 关闭标签页
  const closeTab = React.useCallback(
    (key: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((t) => t.key === key);
        if (index === -1) return prev;

        const newTabs = prev.filter((t) => t.key !== key);

        // 如果关闭的是当前标签，切换到相邻标签
        if (activeTab === key && newTabs.length > 0) {
          const newIndex = Math.min(index, newTabs.length - 1);
          setActiveTab(newTabs[newIndex].key);
        }

        return newTabs;
      });
    },
    [activeTab],
  );

  return { tabs, activeTab, addTab, closeTab, setActiveTab };
}
```

### 14.6 页面设计

#### 14.6.1 登录页

```typescript
// 登录页组件
> **Phase 6 modification:** After 6b, login response may be `{ mfaRequired: true, flowToken }` (TOTP users) instead of tokens; after 6d, adds OAuth exchange-code handling + passkey button. This spec is the pre-6b baseline.
function LoginPage() {
  const { providers } = useAuth()
  const { theme } = useTheme()
  const { brand } = useBrand()

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Logo 和品牌语 */}
        <div className="login-header">
          <Logo src={brand?.logo} size="large" />
          <h1>{brand?.brandName || 'AccessBase'}</h1>
          {brand?.brandTagline && (
            <p className="brand-tagline">{brand.brandTagline}</p>
          )}
        </div>

        {/* 登录表单 */}
        <div className="login-form">
          {/* 密码登录 */}
          {providers.password?.enabled && (
            <PasswordLoginForm onSubmit={handlePasswordLogin} />
          )}

          {/* 分隔线 */}
          <Divider>或</Divider>

          {/* OAuth 登录按钮 */}
          <div className="oauth-buttons">
            {providers.github?.enabled && (
              <OAuthButton
                provider="github"
                icon={<GitHubIcon />}
                onClick={handleGitHubLogin}
              >
                GitHub 登录
              </OAuthButton>
            )}

            {providers.wechat?.enabled && (
              <OAuthButton
                provider="wechat"
> **Phase 6 scope:** WeChat OAuth deferred. Phase 6 implements GitHub + Google via arctic.
                icon={<WeChatIcon />}
                onClick={handleWeChatLogin}
              >
                微信登录
              </OAuthButton>
            )}
          </div>

          {/* 通行密钥登录 */}
          {providers.webauthn?.enabled && (
            <WebAuthnButton onClick={handleWebAuthnLogin}>
              Passkey 登录
            </WebAuthnButton>
          )}
        </div>

        {/* 注册链接 */}
        <div className="login-footer">
          <span>还没有账号？</span>
> **Deferred:** /register route not implemented (backend POST /register is a 501 stub). Hide this link until register endpoint ships.
          <Link to="/register">立即注册</Link>
        </div>
      </div>
    </div>
  )
}
```

#### 14.6.2 仪表盘页

```typescript
// 仪表盘页组件
function DashboardPage() {
  const { user } = useAuth()
  const { stats } = useDashboardStats()

  return (
    <div className="dashboard-page">
      {/* 欢迎信息 */}
      <div className="welcome-section">
        <h1>欢迎回来，{user.name}</h1>
        <p>今天是 {formatDate(new Date())}</p>
      </div>

      {/* 统计卡片 */}
      <div className="stats-cards">
        <StatisticCard
          title="用户总数"
          value={stats.totalUsers}
          icon={<UserIcon />}
          trend={stats.userTrend}
        />
        <StatisticCard
          title="今日活跃"
          value={stats.activeUsers}
          icon={<ActivityIcon />}
          trend={stats.activeTrend}
        />
        <StatisticCard
          title="审计事件"
          value={stats.auditEvents}
          icon={<AuditIcon />}
          trend={stats.auditTrend}
        />
        <StatisticCard
          title="系统状态"
          value={stats.systemStatus}
          icon={<SystemIcon />}
          status={stats.systemHealthy ? 'success' : 'error'}
        />
      </div>

      {/* 快捷操作 */}
      <div className="quick-actions">
        <h2>快捷操作</h2>
        <div className="action-cards">
          <ActionCard
            title="创建用户"
            icon={<UserAddIcon />}
            onClick={() => navigate('/users/create')}
          />
          <ActionCard
            title="查看审计日志"
            icon={<AuditIcon />}
            onClick={() => navigate('/audit')}
          />
          <ActionCard
            title="系统设置"
            icon={<SettingsIcon />}
            onClick={() => navigate('/settings')}
          />
        </div>
      </div>

      {/* 最近活动 */}
      <div className="recent-activity">
        <h2>最近活动</h2>
        <ActivityList activities={stats.recentActivities} />
      </div>
    </div>
  )
}
```

### 14.7 组件设计

#### 14.7.1 基础组件

```typescript
// 统计卡片组件
interface StatisticCardProps {
  title: string
  value: number | string
  icon: React.ReactNode
  trend?: number
  status?: 'success' | 'error' | 'warning'
}

function StatisticCard({ title, value, icon, trend, status }: StatisticCardProps) {
  return (
    <Card className="statistic-card">
      <div className="card-header">
        <div className="card-icon">{icon}</div>
        <div className="card-title">{title}</div>
      </div>
      <div className="card-value">{value}</div>
      {trend !== undefined && (
        <div className={`card-trend ${trend >= 0 ? 'positive' : 'negative'}`}>
          {trend >= 0 ? <TrendUpIcon /> : <TrendDownIcon />}
          <span>{Math.abs(trend)}%</span>
        </div>
      )}
      {status && (
        <div className={`card-status ${status}`}>
          {status === 'success' ? '正常' : status === 'error' ? '异常' : '警告'}
        </div>
      )}
    </Card>
  )
}

// 操作卡片组件
interface ActionCardProps {
  title: string
  icon: React.ReactNode
  onClick: () => void
}

function ActionCard({ title, icon, onClick }: ActionCardProps) {
  return (
    <Card className="action-card" hoverable onClick={onClick}>
      <div className="action-icon">{icon}</div>
      <div className="action-title">{title}</div>
    </Card>
  )
}
```

#### 14.7.2 表格组件

```typescript
// 通用表格组件
interface DataTableProps<T> {
  columns: ColumnType<T>[]
  dataSource: T[]
  loading?: boolean
  pagination?: TablePaginationConfig
  onRowClick?: (record: T) => void
  actions?: TableAction<T>[]
}

function DataTable<T extends { id: string }>({
  columns,
  dataSource,
  loading,
  pagination,
  onRowClick,
  actions
}: DataTableProps<T>) {
  // 添加操作列
  const mergedColumns = React.useMemo(() => {
    if (!actions || actions.length === 0) return columns

    return [
      ...columns,
      {
        title: '操作',
        key: 'actions',
        render: (_, record) => (
          <Space>
            {actions.map(action => (
              <Button
                key={action.key}
                type={action.type || 'link'}
                icon={action.icon}
                onClick={() => action.onClick(record)}
                disabled={action.disabled?.(record)}
              >
                {action.label}
              </Button>
            ))}
          </Space>
        )
      }
    ]
  }, [columns, actions])

  return (
    <Table
      columns={mergedColumns}
      dataSource={dataSource}
      loading={loading}
      pagination={pagination}
      rowKey="id"
      onRow={record => ({
        onClick: () => onRowClick?.(record)
      })}
    />
  )
}
```

> **Phase 7+ (deferred).** Responsive/mobile layout not implemented in Phase 6.
### 14.8 响应式设计

```scss
// 响应式断点
$breakpoints: (
  'xs': 480px,
  'sm': 576px,
  'md': 768px,
  'lg': 992px,
  'xl': 1200px,
  'xxl': 1600px,
);

// 响应式工具
@mixin respond-to($breakpoint) {
  @media (max-width: map-get($breakpoints, $breakpoint)) {
    @content;
  }
}

// 布局响应式
.main-layout {
  @include respond-to('md') {
    // 移动端：侧边栏隐藏
    .sider {
      display: none;
    }

    // 显示移动端菜单按钮
    .mobile-menu-button {
      display: block;
    }
  }
}

// 表格响应式
.data-table {
  @include respond-to('md') {
    // 移动端：表格转卡片
    .ant-table {
      display: block;
    }

    .ant-table-row {
      display: flex;
      flex-direction: column;
      margin-bottom: 16px;
      border: 1px solid #f0f0f0;
      border-radius: 8px;
    }
  }
}
```

### 14.9 配置示例

```yaml
# config.yaml
ui:
  # 设计系统
  design_system: antd

  # 主题
  theme:
    default_mode: light
    allow_toggle: true
    persist_preference: true

    # 品牌令牌
    brand:
      primary_color: '#1890ff'
      secondary_color: '#52c41a'
      logo: '/logo.svg'
      logo_collapsed: '/logo-collapsed.svg'
      brand_name: AccessBase
      brand_tagline: 访问控制底座

  # 布局
  layout:
    type: classic # classic | modern | fullscreen
    sidebar:
      collapsible: true
      default_collapsed: false
      width: 256
      collapsed_width: 80
    header:
      fixed: true
      height: 64

  # 导航
  navigation:
    menu:
      mode: inline
      theme: light
      multiple_levels: true
    breadcrumbs:
      enabled: true
      separator: '/'
    tabs:
      enabled: true
      closable: true
      max_tabs: 10

  # 响应式
  responsive:
    enabled: true
    breakpoints:
      xs: 480
      sm: 576
      md: 768
      lg: 992
      xl: 1200
```

### 14.10 路由架构

#### 14.10.1 路由表结构

```typescript
// 路由配置接口
interface RouteConfig {
  path: string
  component: React.LazyExoticComponent<React.ComponentType>
  meta: {
    title: string           // 页面标题（i18n key）
    permission?: string     // 所需权限
    icon?: React.ReactNode  // 菜单图标
    hideInMenu?: boolean    // 是否在菜单中隐藏
    breadcrumb?: boolean    // 是否显示在面包屑中，默认 true
    keepAlive?: boolean     // 是否缓存页面，默认 false
  }
  children?: RouteConfig[]
}

// 路由表定义
const routes: RouteConfig[] = [
  {
    path: '/login',
    component: lazy(() => import('./pages/LoginPage')),
    meta: { title: 'route.login', hideInMenu: true, breadcrumb: false }
  },
  {
    path: '/dashboard',
    component: lazy(() => import('./pages/DashboardPage')),
    meta: { title: 'route.dashboard', icon: <DashboardIcon /> }
  },
  {
    path: '/users',
    component: lazy(() => import('./pages/UsersLayout')),
    meta: { title: 'route.users', icon: <UserIcon />, permission: 'users:read' },
    children: [
      {
        path: '',
        component: lazy(() => import('./pages/UserListPage')),
        meta: { title: 'route.users.list' }
      },
      {
        path: 'create',
        component: lazy(() => import('./pages/UserCreatePage')),
        meta: { title: 'route.users.create', permission: 'users:write' }
      },
      {
        path: ':id',
        component: lazy(() => import('./pages/UserDetailPage')),
        meta: { title: 'route.users.detail', hideInMenu: true }
      },
      {
        path: ':id/edit',
        component: lazy(() => import('./pages/UserEditPage')),
        meta: { title: 'route.users.edit', permission: 'users:write', hideInMenu: true }
      }
    ]
  },
  {
    path: '/roles',
> **Phase 6 simplification:** Roles uses modal-based create/edit in a single flat component; nested routes reserved for future full-page forms.
    component: lazy(() => import('./pages/RolesLayout')),
    meta: { title: 'route.roles', icon: <RoleIcon />, permission: 'roles:read' },
    children: [
      { path: '', component: lazy(() => import('./pages/RoleListPage')), meta: { title: 'route.roles.list' } },
      { path: 'create', component: lazy(() => import('./pages/RoleCreatePage')), meta: { title: 'route.roles.create', permission: 'roles:write' } },
      { path: ':id', component: lazy(() => import('./pages/RoleDetailPage')), meta: { title: 'route.roles.detail', hideInMenu: true } },
      { path: ':id/edit', component: lazy(() => import('./pages/RoleEditPage')), meta: { title: 'route.roles.edit', permission: 'roles:write', hideInMenu: true } }
    ]
  },
  {
    path: '/audit',
    component: lazy(() => import('./pages/AuditLogPage')),
    meta: { title: 'route.audit', icon: <AuditIcon />, permission: 'audit:read' }
  },
  {
    path: '/settings',
    component: lazy(() => import('./pages/SettingsLayout')),
    meta: { title: 'route.settings', icon: <SettingsIcon />, permission: 'settings:read' },
    children: [
      { path: 'general', component: lazy(() => import('./pages/GeneralSettingsPage')), meta: { title: 'route.settings.general' } },
> **Phase 6 scope (6d Task 4):** SecuritySettings hosts three blocks: active sessions list + revoke, Passkey management, 2FA/TOTP enrollment (QR + verify + recovery codes via /mfa/* from 6b).
      { path: 'security', component: lazy(() => import('./pages/SecuritySettingsPage')), meta: { title: 'route.settings.security' } },
      { path: 'integrations', component: lazy(() => import('./pages/IntegrationSettingsPage')), meta: { title: 'route.settings.integrations' } }
    ]
  },
  {
    path: '/403',
    component: lazy(() => import('./pages/ForbiddenPage')),
    meta: { title: 'route.forbidden', hideInMenu: true, breadcrumb: false }
  },
  {
    path: '/404',
    component: lazy(() => import('./pages/NotFoundPage')),
    meta: { title: 'route.notFound', hideInMenu: true, breadcrumb: false }
  },
  {
    path: '*',
    component: lazy(() => import('./pages/NotFoundPage')),
    meta: { title: 'route.notFound', hideInMenu: true, breadcrumb: false }
  }
]
```

#### 14.10.2 路由守卫

```typescript
// 权限路由守卫组件
interface ProtectedRouteProps {
  children: React.ReactNode
  permission?: string
  fallback?: React.ReactNode  // 无权限时展示，默认跳转 403
}

function ProtectedRoute({ children, permission, fallback }: ProtectedRouteProps) {
  const { user, isAuthenticated } = useAuth()
  const location = useLocation()

  // 未登录 → 跳转登录页
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // 有权限要求 → 检查权限
  if (permission && !user.permissions.includes(permission)) {
    if (fallback) return <>{fallback}</>
    return <Navigate to="/403" replace />
  }

  return <>{children}</>
}

// 路由渲染器（自动应用守卫）
function renderRoutes(routes: RouteConfig[]): React.ReactNode {
  return routes.map(route => {
    const Component = route.component
    const element = (
      <ProtectedRoute permission={route.meta.permission}>
        <Suspense fallback={<PageSkeleton />}>
          <Component />
        </Suspense>
      </ProtectedRoute>
    )

    return (
      <Route key={route.path} path={route.path} element={element}>
        {route.children && renderRoutes(route.children)}
      </Route>
    )
  })
}
```

#### 14.10.3 面包屑路由映射

```typescript
// 从路由配置自动生成面包屑
function useBreadcrumbs(): BreadcrumbItem[] {
  const location = useLocation();
  const { t } = useTranslation();

  return React.useMemo(() => {
    const pathSegments = location.pathname.split('/').filter(Boolean);
    const breadcrumbs: BreadcrumbItem[] = [];

    // 始终包含首页
    breadcrumbs.push({ title: t('route.home'), path: '/dashboard' });

    // 逐级匹配路由
    let currentRoutes = routes;
    let currentPath = '';

    for (const segment of pathSegments) {
      currentPath += `/${segment}`;
      const matched = currentRoutes.find((r) => {
        const routePath = r.path.startsWith('/') ? r.path : `${currentPath}/${r.path}`;
        return routePath === currentPath || r.path === segment;
      });

      if (matched && matched.meta.breadcrumb !== false) {
        breadcrumbs.push({
          title: t(matched.meta.title),
          path: currentPath,
        });
        currentRoutes = matched.children || [];
      }
    }

    return breadcrumbs;
  }, [location.pathname, t]);
}
```

#### 14.10.4 403/404 页面

```typescript
// 403 无权限页面
function ForbiddenPage() {
  const navigate = useNavigate()
  return (
    <Result
      status="403"
      title="403"
      subTitle="抱歉，您没有权限访问此页面"
      extra={<Button type="primary" onClick={() => navigate('/dashboard')}>返回首页</Button>}
    />
  )
}

// 404 页面不存在
function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <Result
      status="404"
      title="404"
      subTitle="抱歉，您访问的页面不存在"
      extra={<Button type="primary" onClick={() => navigate('/dashboard')}>返回首页</Button>}
    />
  )
}
```

### 14.11 表单设计规范

#### 14.11.1 表单验证策略

```typescript
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

// 用户创建表单 Schema
const createUserSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少 3 个字符')
    .max(50, '用户名最多 50 个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '用户名只能包含字母、数字、下划线和连字符'),
  email: z.string().email('请输入有效的邮箱地址'),
  displayName: z.string().min(1, '显示名称不能为空').max(100),
  password: z
    .string()
    .min(8, '密码至少 8 个字符')
    .regex(/[A-Z]/, '密码需包含至少一个大写字母')
    .regex(/[a-z]/, '密码需包含至少一个小写字母')
    .regex(/[0-9]/, '密码需包含至少一个数字'),
  roleIds: z.array(z.string()).min(1, '请至少选择一个角色'),
  department: z.string().optional(),
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, '请输入有效的手机号')
    .optional(),
});

type CreateUserFormData = z.infer<typeof createUserSchema>;

// 表单 Hook
function useUserForm(defaultValues?: Partial<CreateUserFormData>) {
  return useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: '',
      email: '',
      displayName: '',
      password: '',
      roleIds: [],
      department: '',
      phone: '',
      ...defaultValues,
    },
  });
}
```

#### 14.11.2 表单布局规范

```typescript
// 标准表单布局
function StandardForm({ title, children, onSubmit, loading }: StandardFormProps) {
  return (
    <div className="standard-form-page">
      {/* 页面标题 */}
      <div className="form-header">
        <h2>{title}</h2>
      </div>

      {/* 表单卡片 */}
      <Card className="form-card">
        <Form
          layout="vertical"
          onFinish={onSubmit}
          requiredMark="optional"
          validateTrigger={['onChange', 'onBlur']}
        >
          {children}

          {/* 固定底部操作栏 */}
          <div className="form-actions">
            <Button onClick={() => navigate(-1)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  )
}

// 表单布局规则
// - 垂直布局（label 在上）
// - 必填标记用红色星号，选填标记用（选填）
// - 错误提示在字段下方显示
// - 表单操作栏固定在卡片底部
// - 表单宽度最大 800px，超宽屏居中
```

#### 14.11.3 批量操作规范

```typescript
// 批量操作工具栏
> **Phase 7+ (deferred).** Batch operations not implemented in Phase 6.
interface BatchActionsProps<T> {
  selectedRows: T[]
  actions: BatchAction<T>[]
  onClearSelection: () => void
}

interface BatchAction<T> {
  key: string
  label: string
  icon?: React.ReactNode
  danger?: boolean           // 危险操作（红色）
  confirmTitle?: string      // 确认对话框标题
  confirmContent?: string    // 确认对话框内容
  requiresConfirm?: boolean  // 是否需要二次确认
  onClick: (rows: T[]) => Promise<void>
}

function BatchActions<T>({ selectedRows, actions, onClearSelection }: BatchActionsProps<T>) {
  const [loading, setLoading] = useState<string | null>(null)

  const handleAction = async (action: BatchAction<T>) => {
    // 危险操作需二次确认
    if (action.requiresConfirm) {
      const confirmed = await Modal.confirm({
        title: action.confirmTitle || `确认${action.label}？`,
        content: action.confirmContent || `将对 ${selectedRows.length} 条记录执行${action.label}操作`,
        okText: '确认',
        cancelText: '取消',
        okButtonProps: { danger: action.danger }
      })
      if (!confirmed) return
    }

    setLoading(action.key)
    try {
      await action.onClick(selectedRows)
      message.success(`${action.label}成功`)
      onClearSelection()
    } catch (error) {
      message.error(`${action.label}失败`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="batch-actions-bar">
      <span>已选择 {selectedRows.length} 项</span>
      <Space>
        {actions.map(action => (
          <Button
            key={action.key}
            danger={action.danger}
            icon={action.icon}
            loading={loading === action.key}
            onClick={() => handleAction(action)}
          >
            {action.label}
          </Button>
        ))}
        <Button type="link" onClick={onClearSelection}>取消选择</Button>
      </Space>
    </div>
  )
}
```

#### 14.11.4 确认对话框规范

```typescript
// 确认对话框级别
type ConfirmLevel = 'info' | 'warning' | 'danger'

interface ConfirmOptions {
  title: string
  content: string
  level: ConfirmLevel
  requireTyping?: string   // 需要输入的文本（如 "DELETE"）
  onConfirm: () => Promise<void>
}

async function showConfirm(options: ConfirmOptions): Promise<void> {
  const { title, content, level, requireTyping, onConfirm } = options

  if (requireTyping) {
    // 高危操作：要求输入确认文本
    const modal = Modal.confirm({
      title,
      content: (
        <>
          <p>{content}</p>
          <p>请输入 <strong>{requireTyping}</strong> 以确认操作：</p>
          <Input id="confirm-input" />
        </>
      ),
      okText: '确认删除',
      okButtonProps: { danger: true, disabled: true },
      onOk: onConfirm
    })
    // 监听输入框变化，匹配后启用确认按钮
  } else {
    // 普通确认
    Modal.confirm({
      title,
      content,
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger: level === 'danger' }
    })
  }
}

// 使用场景
// info: 保存确认、退出确认
// warning: 批量操作、状态变更
// danger: 删除用户、删除角色、重置密码
```

### 14.12 错误处理 UI

#### 14.12.1 全局错误边界

```typescript
interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class GlobalErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 上报错误到监控系统
    console.error('Uncaught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle="抱歉，页面发生了意外错误"
          extra={[
            <Button key="home" onClick={() => window.location.href = '/dashboard'}>返回首页</Button>,
            <Button key="retry" type="primary" onClick={() => this.setState({ hasError: false, error: null })}>
              重试
            </Button>
          ]}
        />
      )
    }
    return this.props.children
  }
}
```

#### 14.12.2 API 错误拦截器

```typescript
// API 错误码映射
const ERROR_MESSAGES: Record<string, { message: string; action?: string }> = {
  ERR_001: { message: '输入有误，请检查后重试', action: 'highlight' },
  ERR_002: { message: '登录已过期，请重新登录', action: 'redirect_login' },
  ERR_003: { message: '没有权限执行此操作' },
  ERR_004: { message: '资源不存在', action: 'redirect_list' },
  ERR_005: { message: '数据已被他人修改，请刷新后重试', action: 'refresh' },
  ERR_006: { message: '操作太频繁，请稍后再试', action: 'cooldown' },
  ERR_007: { message: '服务器错误，请联系管理员', action: 'retry' },
  ERR_008: { message: '密码错误' },
  ERR_009: { message: '邮箱格式不正确', action: 'highlight' },
  ERR_010: { message: '密码强度不足', action: 'highlight' },
  ERR_011: { message: '该邮箱已被注册', action: 'redirect_login' },
  ERR_012: { message: '网络错误，请检查网络连接', action: 'retry' },
  ERR_013: { message: '认证配置未找到' },
};

// API 响应拦截器
api.interceptors.response.use(
  (response) => response,
> **6b modification:** Actual error envelope uses `error: { code, message, timestamp?, requestId?, path? }` — not top-level `message`.
  (error: AxiosError<ApiErrorResponse>) => {
    const status = error.response?.status;
    const errorData = error.response?.data?.error;

    // 401 → 跳转登录
    if (status === 401) {
      authStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // 429 → 限流提示（带倒计时）
    if (status === 429) {
      const retryAfter = error.response?.headers['retry-after'];
      message.error(`操作太频繁，请 ${retryAfter || 60} 秒后重试`);
      return Promise.reject(error);
    }

    // 统一错误提示
    if (errorData?.code) {
      const errorInfo = ERROR_MESSAGES[errorData.code];
      if (errorInfo) {
        message.error(errorInfo.message);
      } else {
        message.error(errorData.message || '操作失败');
      }

      // 字段级错误 → 返回给表单处理
      if (errorData.details) {
        return Promise.reject({ ...error, fieldErrors: errorData.details });
      }
    } else {
      message.error('网络错误，请稍后重试');
    }

    return Promise.reject(error);
  },
);
```

#### 14.12.3 Toast 消息规范

```typescript
// 消息类型规范
const messageConfig = {
  duration: 3,        // 默认显示 3 秒
  maxCount: 3,        // 最多同时显示 3 条
  rtl: false
}

// 成功消息
message.success('操作成功')

// 错误消息（带重试）
message.error({
  content: '保存失败',
  btn: <Button size="small" onClick={retry}>重试</Button>,
  duration: 5
})

// 加载消息
const hide = message.loading('正在保存...', 0)
// 操作完成后
hide()
message.success('保存成功')
```

### 14.13 加载状态设计

#### 14.13.1 骨架屏组件

```typescript
// 页面骨架屏
function PageSkeleton() {
  return (
    <div className="page-skeleton">
      {/* 标题骨架 */}
      <Skeleton.Input active size="large" style={{ width: 200, marginBottom: 24 }} />

      {/* 统计卡片骨架 */}
      <Row gutter={16}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Col key={i} span={6}>
            <Card>
              <Skeleton active paragraph={{ rows: 2 }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 表格骨架 */}
      <Card style={{ marginTop: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    </div>
  )
}

// 表格骨架屏
function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="table-skeleton">
      {/* 搜索栏骨架 */}
      <Skeleton.Input active style={{ width: 300, marginBottom: 16 }} />

      {/* 表格骨架 */}
      <Card>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} active paragraph={false} title={{ width: '100%' }} />
        ))}
      </Card>
    </div>
  )
}
```

#### 14.13.2 Loading 状态规范

```typescript
// 全局 Loading（页面级）
function PageLoading() {
  return (
    <div className="page-loading">
      <Spin size="large" />
    </div>
  )
}

// 局部 Loading（组件级）
// 使用 Ant Design 的 Spin 包裹
<Spin spinning={loading}>
  <Table ... />
</Spin>

// 按钮 Loading
// 使用 Ant Design Button 的 loading 属性
<Button type="primary" loading={submitting} onClick={handleSubmit}>
  保存
</Button>

// Loading 规范
// - 页面首次加载：骨架屏（Skeleton）
// - 数据刷新：Spin 覆盖层（不遮挡页面）
// - 按钮提交：Button loading 属性
// - 长时间操作（>3s）：进度条 + 取消按钮
// - 避免全屏 Loading 遮罩（影响用户体验）
```

### 14.14 全局状态管理

#### 14.14.1 Store 分片设计

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// 认证状态 Store
interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  refreshAuth: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
}

const useAuthStore = create<AuthState>()(
  immer((set, get) => ({
    user: null,
    token: null,
    refreshToken: null,
    permissions: [],
    isAuthenticated: false,

    login: async (credentials) => {
      const response = await api.post('/auth/login', credentials);
      const { user, token, refreshToken, permissions } = response.data;
      set((state) => {
        state.user = user;
        state.token = token;
        state.refreshToken = refreshToken;
        state.permissions = permissions;
        state.isAuthenticated = true;
      });
    },

    logout: () => {
      set((state) => {
        state.user = null;
        state.token = null;
        state.refreshToken = null;
        state.permissions = [];
        state.isAuthenticated = false;
      });
      window.location.href = '/login';
    },

    refreshAuth: async () => {
      const refreshToken = get().refreshToken;
      if (!refreshToken) return get().logout();

      try {
        const response = await api.post('/auth/refresh', { refreshToken });
        const { token, refreshToken: newRefreshToken } = response.data;
        set((state) => {
          state.token = token;
          state.refreshToken = newRefreshToken;
        });
      } catch {
        get().logout();
      }
    },

    updateUser: (updates) => {
      set((state) => {
        if (state.user) {
          Object.assign(state.user, updates);
        }
      });
    },
  })),
);

// UI 状态 Store（持久化）
interface UIState {
  theme: 'light' | 'dark';
  locale: string;
  sidebarCollapsed: boolean;
  tabs: TabItem[];
  activeTab: string;

  // Actions
  setTheme: (theme: 'light' | 'dark') => void;
  setLocale: (locale: string) => void;
  toggleSidebar: () => void;
  addTab: (tab: TabItem) => void;
  closeTab: (key: string) => void;
  setActiveTab: (key: string) => void;
}

const useUIStore = create<UIState>()(
  persist(
    immer((set) => ({
      theme: 'light',
      locale: 'zh-CN',
      sidebarCollapsed: false,
      tabs: [],
      activeTab: '',

      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      toggleSidebar: () =>
        set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed;
        }),
      addTab: (tab) =>
        set((state) => {
          if (!state.tabs.find((t) => t.key === tab.key)) {
            state.tabs.push(tab);
          }
          state.activeTab = tab.key;
        }),
      closeTab: (key) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => t.key === key);
          state.tabs = state.tabs.filter((t) => t.key !== key);
          if (state.activeTab === key && state.tabs.length > 0) {
            state.activeTab = state.tabs[Math.min(index, state.tabs.length - 1)].key;
          }
        }),
      setActiveTab: (key) => set({ activeTab: key }),
    })),
    {
      name: 'ui-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        sidebarCollapsed: state.sidebarCollapsed,
        tabs: state.tabs,
        activeTab: state.activeTab,
      }),
    },
  ),
);

// 数据状态 Store（不持久化，按需加载）
interface DataState {
  users: User[];
  roles: Role[];
  loading: Record<string, boolean>;
  error: Record<string, string | null>;

  // Actions
  fetchUsers: (params?: ListQueryParams) => Promise<void>;
  fetchRoles: () => Promise<void>;
}
```

#### 14.14.2 状态持久化策略

```typescript
// 持久化策略
const PERSIST_CONFIG = {
  // 持久化到 localStorage（跨会话保留）
  localStorage: ['theme', 'locale', 'sidebarCollapsed', 'tabs', 'activeTab'],

  // 持久化到 sessionStorage（会话内保留）
  sessionStorage: ['searchHistory', 'formDraft'],

  // 不持久化（每次重新获取）
  memory: ['users', 'roles', 'permissions', 'loading', 'error'],
};
```

### 14.15 API 层前端抽象

#### 14.15.1 API 客户端设计

```typescript
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// API 客户端配置
const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：附加 Token
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // 添加请求 ID（用于追踪）
    config.headers['X-Request-ID'] = crypto.randomUUID();
    return config;
  },
  (error) => Promise.reject(error),
);

// Token 刷新队列
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}> = [];

// 响应拦截器：Token 自动刷新
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 401 且非刷新请求 → 尝试刷新 Token
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // 排队等待刷新完成
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await useAuthStore.getState().refreshAuth();
        const newToken = useAuthStore.getState().token;

        // 重试队列中的请求
        failedQueue.forEach(({ resolve }) => resolve(newToken!));
        failedQueue = [];

        // 重试原始请求
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // 刷新失败 → 登出
        failedQueue.forEach(({ reject }) => reject(refreshError as Error));
        failedQueue = [];
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// 防重复提交
const pendingRequests = new Map<string, AbortController>();

function getRequestId(config: AxiosRequestConfig): string {
  return `${config.method}-${config.url}-${JSON.stringify(config.params || {})}-${JSON.stringify(config.data || {})}`;
}

apiClient.interceptors.request.use((config) => {
  const requestId = getRequestId(config);

  // 取消重复请求
  if (pendingRequests.has(requestId)) {
    pendingRequests.get(requestId)!.abort();
  }

  const controller = new AbortController();
  config.signal = controller.signal;
  pendingRequests.set(requestId, controller);

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    const requestId = getRequestId(response.config);
    pendingRequests.delete(requestId);
    return response;
  },
  (error) => {
    if (error.config) {
      const requestId = getRequestId(error.config);
      pendingRequests.delete(requestId);
    }
    return Promise.reject(error);
  },
);
```

#### 14.15.2 API 请求封装

```typescript
// 统一 API 响应类型
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
}

// API 请求封装
const api = {
  async get<T>(url: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
    const response = await apiClient.get<ApiResponse<T>>(url, { params });
    return response.data;
  },

  async post<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
    const response = await apiClient.post<ApiResponse<T>>(url, data);
    return response.data;
  },

  async put<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
    const response = await apiClient.put<ApiResponse<T>>(url, data);
    return response.data;
  },

  async delete<T>(url: string): Promise<ApiResponse<T>> {
    const response = await apiClient.delete<ApiResponse<T>>(url);
    return response.data;
  },

  async list<T>(url: string, params?: ListQueryParams): Promise<PaginatedResponse<T>> {
    const response = await apiClient.get<PaginatedResponse<T>>(url, { params });
    return response.data;
  },
};

// 列表查询参数（标准化）
interface ListQueryParams {
  page?: number; // 页码，从 1 开始，默认 1
  pageSize?: number; // 每页条数，默认 20，最大 100
  sortBy?: string; // 排序字段名
  sortOrder?: 'asc' | 'desc'; // 排序方向
  search?: string; // 全局搜索关键词
  filters?: Record<string, unknown>; // 字段级筛选
}
```

### 14.16 无障碍设计（Accessibility）

#### 14.16.1 ARIA 角色规范

```typescript
// 主布局 ARIA
function MainLayout({ children }: MainLayoutProps) {
  return (
    <Layout className="main-layout" role="application">
      <Header role="banner">
        <nav role="navigation" aria-label="主导航">
          <Menu ... />
        </nav>
      </Header>
      <Layout>
        <Sider role="complementary" aria-label="侧边导航">
          <Menu ... />
        </Sider>
        <Content role="main" aria-label="主要内容">
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}

// 表格 ARIA
function DataTable<T>(props: DataTableProps<T>) {
  return (
    <Table
      {...props}
      aria-label="数据表格"
      role="grid"
      // 表头添加排序状态
      columns={props.columns.map(col => ({
        ...col,
        title: (
          <span aria-sort={getSortAriaValue(col.key)}>
            {col.title}
          </span>
        )
      }))}
    />
  )
}

// 表单 ARIA
function FormField({ label, error, required, children }: FormFieldProps) {
  const id = useId()
  return (
    <div className="form-field" role="group" aria-labelledby={`${id}-label`}>
      <label id={`${id}-label`} htmlFor={id}>
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      {React.cloneElement(children, {
        id,
        'aria-invalid': !!error,
        'aria-describedby': error ? `${id}-error` : undefined,
        'aria-required': required
      })}
      {error && (
        <div id={`${id}-error`} role="alert" className="field-error">
          {error}
        </div>
      )}
    </div>
  )
}
```

#### 14.16.2 键盘导航规范

```typescript
// 全局键盘快捷键
const KEYBOARD_SHORTCUTS = {
  'mod+k': '打开全局搜索',
  'mod+b': '切换侧边栏',
  'mod+/': '显示快捷键帮助',
  'escape': '关闭弹窗/取消操作',
  'mod+enter': '提交表单',
  'mod+s': '保存当前编辑',
  'mod+shift+n': '创建新记录',
  'mod+shift+f': '全屏切换'
}

// 快捷键 Hook
function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = [
        e.metaKey || e.ctrlKey ? 'mod' : '',
        e.shiftKey ? 'shift' : '',
        e.altKey ? 'alt' : '',
        e.key.toLowerCase()
      ].filter(Boolean).join('+')

      if (shortcuts[key]) {
        e.preventDefault()
        shortcuts[key]()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts])
}

// 焦点管理
function FocusTrap({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const firstElement = focusableElements[0] as HTMLElement
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    container.addEventListener('keydown', handleTabKey)
    firstElement?.focus()

    return () => container.removeEventListener('keydown', handleTabKey)
  }, [])

  return <div ref={containerRef}>{children}</div>
}
```

#### 14.16.3 对比度与颜色规范

```scss
// WCAG 2.1 AA 标准
// - 正常文本对比度 ≥ 4.5:1
// - 大文本（18px+）对比度 ≥ 3:1
// - UI 组件对比度 ≥ 3:1

// 亮色主题对比度检查
$text-primary: #262626; // 对比度 15.3:1 (vs #ffffff)
$text-secondary: #595959; // 对比度 7.1:1 (vs #ffffff)
$text-disabled: #bfbfbf; // 对比度 2.1:1 (vs #ffffff) — 需注意
$link-color: #1890ff; // 对比度 4.5:1 (vs #ffffff)

// 暗色主题对比度检查
$dark-text-primary: #ffffff; // 对比度 15.3:1 (vs #141414)
$dark-text-secondary: #a6a6a6; // 对比度 7.4:1 (vs #141414)
$dark-link-color: #40a9ff; // 对比度 5.2:1 (vs #141414)

// 状态颜色对比度
// success: #52c41a → 3.5:1 (仅用于图标/装饰，不用于纯文本)
// warning: #faad14 → 2.1:1 (仅用于图标/装饰，不用于纯文本)
// error: #ff4d4f → 4.0:1 (可用于文本)
```

> **Phase 7+ (deferred).** Global search not implemented in Phase 6.
### 14.17 全局搜索

```typescript
// 全局搜索组件
function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  // 快捷键打开
  useKeyboardShortcuts({
    'mod+k': () => setOpen(true)
  })

  // 搜索结果类型
  interface SearchResult {
    id: string
    type: 'user' | 'role' | 'audit' | 'setting'
    title: string
    description: string
    path: string
    icon: React.ReactNode
  }

  // 防抖搜索
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await api.get('/search', { q: query })
        setResults(response.data)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      width={640}
      className="global-search-modal"
    >
      <Input.Search
        placeholder="搜索用户、角色、审计日志..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        loading={loading}
        autoFocus
        size="large"
      />

      {results.length > 0 && (
        <div className="search-results">
          {results.map(result => (
            <div
              key={result.id}
              className="search-result-item"
              onClick={() => {
                navigate(result.path)
                setOpen(false)
              }}
            >
              <div className="result-icon">{result.icon}</div>
              <div className="result-content">
                <div className="result-title">{result.title}</div>
                <div className="result-description">{result.description}</div>
              </div>
              <div className="result-type">{result.type}</div>
            </div>
          ))}
        </div>
      )}

      {query && !loading && results.length === 0 && (
        <div className="search-empty">未找到相关结果</div>
      )}
    </Modal>
  )
}
```

> **Phase 7+ (deferred).** Notification center not implemented in Phase 6.
### 14.18 通知中心

```typescript
// 通知数据模型
interface Notification {
  id: string
  type: 'system' | 'audit' | 'security' | 'update'
  title: string
  content: string
  read: boolean
  createdAt: string
  actionUrl?: string   // 点击跳转链接
  actionLabel?: string // 操作按钮文案
}

// 通知中心组件
function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  // 加载通知
  useEffect(() => {
    loadNotifications()
    // 轮询新通知（每 30 秒）
    const timer = setInterval(loadNotifications, 30000)
    return () => clearInterval(timer)
  }, [])

  const loadNotifications = async () => {
    const response = await api.get('/notifications')
    setNotifications(response.data)
    setUnreadCount(response.data.filter(n => !n.read).length)
  }

  const markAsRead = async (id: string) => {
    await api.put(`/notifications/${id}/read`)
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    )
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  const markAllAsRead = async () => {
    await api.put('/notifications/read-all')
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  return (
    <Popover
      content={
        <div className="notification-panel">
          <div className="notification-header">
            <span>通知</span>
            {unreadCount > 0 && (
              <Button type="link" size="small" onClick={markAllAsRead}>
                全部已读
              </Button>
            )}
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <Empty description="暂无通知" />
            ) : (
              notifications.map(notification => (
                <div
                  key={notification.id}
                  className={`notification-item ${notification.read ? 'read' : 'unread'}`}
                  onClick={() => {
                    markAsRead(notification.id)
                    if (notification.actionUrl) navigate(notification.actionUrl)
                  }}
                >
                  <div className="notification-title">{notification.title}</div>
                  <div className="notification-content">{notification.content}</div>
                  <div className="notification-time">
                    {formatRelativeTime(notification.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="notification-footer">
            <Link to="/notifications">查看全部通知</Link>
          </div>
        </div>
      }
      trigger="click"
      placement="bottomRight"
    >
      <Badge count={unreadCount} offset={[-5, 5]}>
        <BellOutlined className="notification-bell" />
      </Badge>
    </Popover>
  )
}
```

> **Gap note:** ui.md has no Profile page spec. 6c Task 4 builds /profile (name edit, change password, revoke sessions); 6d Task 2 adds OAuth linked-accounts card.
### 14.19 用户个人中心

```typescript
// 用户头像下拉菜单
function UserDropdown() {
  const { user, logout } = useAuth()

  const items: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人信息',
      onClick: () => navigate('/profile')
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '偏好设置',
      onClick: () => navigate('/settings')
    },
    {
      key: 'password',
      icon: <LockOutlined />,
      label: '修改密码',
      onClick: () => navigate('/profile/password')
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: () => {
        Modal.confirm({
          title: '确认退出？',
          content: '退出后需要重新登录',
          onOk: logout
        })
      }
    }
  ]

  return (
    <Dropdown menu={{ items }} placement="bottomRight">
      <div className="user-dropdown-trigger">
        <Avatar src={user?.avatar} icon={<UserOutlined />} />
        <span className="user-name">{user?.displayName}</span>
      </div>
    </Dropdown>
  )
}
```

### 14.20 空状态设计

```typescript
// 空状态组件
interface EmptyStateProps {
  type: 'no-data' | 'no-result' | 'first-use' | 'error'
  title?: string
  description?: string
  action?: { label: string; onClick: () => void }
  image?: React.ReactNode
}

function EmptyState({ type, title, description, action, image }: EmptyStateProps) {
  const defaults = {
    'no-data': { title: '暂无数据', description: '当前没有数据', image: <EmptyImage /> },
    'no-result': { title: '未找到结果', description: '尝试调整搜索条件', image: <SearchEmptyImage /> },
    'first-use': { title: '欢迎使用', description: '开始创建您的第一个资源', image: <WelcomeImage /> },
    'error': { title: '加载失败', description: '请稍后重试', image: <ErrorImage /> }
  }

  const config = defaults[type]

  return (
    <div className="empty-state">
      {image || config.image}
      <h3>{title || config.title}</h3>
      <p>{description || config.description}</p>
      {action && (
        <Button type="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

// 使用示例
// <EmptyState type="no-data" action={{ label: '创建用户', onClick: () => navigate('/users/create') }} />
// <EmptyState type="no-result" description="未找到包含 'test' 的用户" />
// <EmptyState type="first-use" action={{ label: '创建第一个角色', onClick: () => navigate('/roles/create') }} />
```

### 14.21 数据导出/导入

```typescript
// 导出组件
> **Phase 7+ (deferred).** Full export/import not implemented in Phase 6. Phase 6 provides client-side CSV only (Audit page).
interface ExportButtonProps {
  endpoint: string           // 导出 API 地址
  filename: string           // 导出文件名
  format: 'csv' | 'xlsx'    // 导出格式
  params?: Record<string, unknown>  // 筛选参数
  columns?: string[]         // 导出列（可选，默认全部）
}

function ExportButton({ endpoint, filename, format, params, columns }: ExportButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get(endpoint, {
        params: { ...params, format, columns: columns?.join(',') },
        responseType: 'blob'
      })

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `${filename}.${format}`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      message.error('导出失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      icon={<DownloadOutlined />}
      loading={loading}
      onClick={handleExport}
    >
      导出 {format.toUpperCase()}
    </Button>
  )
}

// 导入组件
interface ImportButtonProps {
  endpoint: string           // 导入 API 地址
  template: string           // 模板下载地址
  accept: string             // 文件类型限制
  onSuccess?: (result: ImportResult) => void
}

interface ImportResult {
  total: number
  success: number
  failed: number
  errors: Array<{ row: number; message: string }>
}

function ImportButton({ endpoint, template, accept, onSuccess }: ImportButtonProps) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleImport = async (file: File) => {
    setLoading(true)
    setProgress(0)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await apiClient.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total!)
          setProgress(percent)
        }
      })

      const result = response.data as ImportResult

      if (result.failed > 0) {
        Modal.warning({
          title: '导入完成（部分失败）',
          content: (
            <>
              <p>成功：{result.success} 条，失败：{result.failed} 条</p>
              <p>失败原因：</p>
              <ul>
                {result.errors.slice(0, 5).map((err, i) => (
                  <li key={i}>第 {err.row} 行：{err.message}</li>
                ))}
                {result.errors.length > 5 && <li>...共 {result.errors.length} 条错误</li>}
              </ul>
            </>
          )
        })
      } else {
        message.success(`导入成功，共 ${result.success} 条`)
      }

      onSuccess?.(result)
    } catch {
      message.error('导入失败')
    } finally {
      setLoading(false)
      setProgress(0)
    }
  }

  return (
    <Space>
      <Button type="link" href={template} target="_blank">
        下载模板
      </Button>
      <Upload
        accept={accept}
        showUploadList={false}
        beforeUpload={(file) => {
          handleImport(file)
          return false
        }}
      >
        <Button icon={<UploadOutlined />} loading={loading}>
          导入
        </Button>
      </Upload>
      {loading && <Progress percent={progress} size="small" style={{ width: 100 }} />}
    </Space>
  )
}
```

---

## 37. 前端补充 P2

### 37.1 数据导出/导入

```typescript
// 数据导出 Hook
function useDataExport<T>(options: ExportOptions) {
  const [exporting, setExporting] = useState(false)

  const exportData = useCallback(async (data: T[], format: 'csv' | 'excel' | 'json') => {
    setExporting(true)
    try {
      const blob = await generateExport(data, format)
      downloadBlob(blob, `${options.filename}.${format}`)
    } finally {
      setExporting(false)
    }
  }, [options])

  return { exportData, exporting }
}

// 数据导入组件
function DataImport<T>({ onImport, schema }: DataImportProps<T>) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<T[]>([])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFile(file)

    // 解析文件
    const data = await parseFile(file)

    // 验证数据
    const validated = schema.array().parse(data)
    setPreview(validated)
  }

  return (
    <div>
      <Upload onChange={handleFileChange} />
      {preview.length > 0 && (
        <>
          <Table dataSource={preview.slice(0, 5)} />
          <Button onClick={() => onImport(preview)}>导入 {preview.length} 条</Button>
        </>
      )}
    </div>
  )
}
```

### 37.2 空状态设计

```typescript
// 空状态组件
function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

// 使用示例
function UserList({ users }: UserListProps) {
  if (users.length === 0) {
    return (
      <EmptyState
        icon={<UserIcon />}
        title="暂无用户"
        description="点击下方按钮创建第一个用户"
        action={<Button onClick={handleCreate}>创建用户</Button>}
      />
    )
  }

  return <Table dataSource={users} />
}
```

### 37.3 确认对话框规范

```typescript
// 确认对话框 Hook
function useConfirm() {
  const [modal, contextHolder] = Modal.useModal()

  const confirm = useCallback(async (options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      modal.confirm({
        title: options.title,
        content: options.content,
        okText: options.okText || '确认',
        cancelText: options.cancelText || '取消',
        okType: options.danger ? 'primary' : 'default',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }, [modal])

  return { confirm, contextHolder }
}

// 使用示例
function UserActions({ user }: UserActionsProps) {
  const { confirm } = useConfirm()

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: '确认删除用户',
      content: `确定要删除用户 ${user.name} 吗？此操作不可撤销。`,
      danger: true,
      okText: '删除'
    })

    if (confirmed) {
      await deleteUser(user.id)
    }
  }

  return <Button danger onClick={handleDelete}>删除</Button>
}
```

### 37.4 面包屑 i18n 支持

```typescript
// 面包屑 i18n Hook
function useBreadcrumbs() {
  const { t } = useTranslation('common')
  const location = useLocation()

  const breadcrumbs = useMemo(() => {
    const pathSegments = location.pathname.split('/').filter(Boolean)

    return pathSegments.map((segment, index) => {
      const path = '/' + pathSegments.slice(0, index + 1).join('/')

      return {
        title: t(`breadcrumbs.${segment}`, segment),  // 支持 i18n，回退到原始值
        path
        icon: getBreadcrumbIcon(segment)
      }
    })
  }, [location.pathname, t])

  return breadcrumbs
}
```

### 37.5 标签页状态持久化

```typescript
// 标签页状态持久化
function usePersistedTabs() {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = localStorage.getItem('accessbase:tabs');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeTab, setActiveTab] = useState<string>(() => {
    const saved = localStorage.getItem('accessbase:activeTab');
    return saved || '/';
  });

  // 持久化到 localStorage
  useEffect(() => {
    localStorage.setItem('accessbase:tabs', JSON.stringify(tabs));
    localStorage.setItem('accessbase:activeTab', activeTab);
  }, [tabs, activeTab]);

  return { tabs, setTabs, activeTab, setActiveTab };
}
```

### 37.6 移动端适配增强

```scss
// 移动端适配
@media (max-width: 768px) {
  // 侧边栏
  .sidebar {
    position: fixed;
    z-index: 1000;
    transform: translateX(-100%);

    &.open {
      transform: translateX(0);
    }
  }

  // 遮罩层
  .sidebar-overlay {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
  }

  // 表格转卡片
  .ant-table {
    .ant-table-thead {
      display: none;
    }

    .ant-table-row {
      display: flex;
      flex-direction: column;
      padding: 16px;
      margin-bottom: 8px;
      border: 1px solid #f0f0f0;
      border-radius: 8px;

      td {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;

        &::before {
          content: attr(data-label);
          font-weight: 500;
          color: rgba(0, 0, 0, 0.45);
        }
      }
    }
  }

  // 表单
  .ant-form {
    .ant-form-item {
      flex-direction: column;

      .ant-form-item-label {
        text-align: left;
        padding-bottom: 4px;
      }
    }
  }
}
```

---
