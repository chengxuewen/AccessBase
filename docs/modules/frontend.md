# 前端架构补充

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§24 前端架构补充

---

## 24. 前端架构补充

### 24.1 路由架构

```typescript
// 路由配置
interface RouteConfig {
  path: string
  component: React.ComponentType
  layout?: React.ComponentType
  guard?: 'auth' | 'guest' | 'admin'
  permissions?: string[]
  meta?: {
    title: string
    icon?: React.ReactNode
    breadcrumb?: string[]
  }
  children?: RouteConfig[]
}

// 路由表
const routes: RouteConfig[] = [
  {
    path: '/login',
    component: LoginPage,
    layout: EmptyLayout,
    guard: 'guest',
    meta: { title: '登录' }
  },
  {
    path: '/',
    component: DashboardPage,
    guard: 'auth',
    meta: { title: '仪表盘', icon: <DashboardIcon /> }
  },
  {
    path: '/users',
    component: UsersPage,
    guard: 'auth',
    permissions: ['users:read'],
    meta: { title: '用户管理', icon: <UserIcon /> },
    children: [
      { path: '/users/create', component: CreateUserPage, permissions: ['users:write'] },
      { path: '/users/:id', component: UserDetailPage },
      { path: '/users/:id/edit', component: EditUserPage, permissions: ['users:write'] }
    ]
  },
  {
    path: '/roles',
    component: RolesPage,
    guard: 'auth',
    permissions: ['roles:read'],
    meta: { title: '角色管理', icon: <RoleIcon /> }
  },
  {
    path: '/audit',
    component: AuditLogPage,
    guard: 'auth',
    permissions: ['audit:read'],
    meta: { title: '审计日志', icon: <AuditIcon /> }
  },
  {
    path: '/settings',
    component: SettingsPage,
    guard: 'auth',
    permissions: ['settings:read'],
    meta: { title: '系统设置', icon: <SettingsIcon /> }
  }
]

// 路由守卫
function RouteGuard({ guard, permissions, children }: RouteGuardProps) {
  const { user, isAuthenticated } = useAuth()
  
  if (guard === 'auth' && !isAuthenticated) {
    return <Navigate to="/login" />
  }
  
  if (guard === 'guest' && isAuthenticated) {
    return <Navigate to="/" />
  }
  
  if (permissions && !hasPermission(user, permissions)) {
    return <Navigate to="/403" />
  }
  
  return children
}

// 路由懒加载
const LazyRoute = React.lazy(() => import('./pages/UsersPage'))
```

### 24.2 表单设计规范

```typescript
// 表单 Hook
function useForm<T extends FieldValues>(options: UseFormOptions<T>) {
  const form = useReactHookForm<T>({
    mode: 'onBlur',
    resolver: zodResolver(options.schema),
    defaultValues: options.defaultValues
  })
  
  const onSubmit = async (data: T) => {
    try {
      await options.onSubmit(data)
      message.success(options.successMessage || '操作成功')
    } catch (error) {
      if (error instanceof AppError) {
        // 字段级错误
        if (error.fieldErrors) {
          Object.entries(error.fieldErrors).forEach(([field, message]) => {
            form.setError(field as any, { message })
          })
        } else {
          message.error(error.message)
        }
      }
    }
  }
  
  return { ...form, onSubmit: form.handleSubmit(onSubmit) }
}

// 表单组件示例
function CreateUserForm() {
  const form = useForm({
    schema: createUserSchema,
    onSubmit: async (data) => await api.post('/users', data),
    successMessage: '用户创建成功'
  })
  
  return (
    <Form form={form}>
      <Form.Item label="邮箱" name="email">
        <Input />
      </Form.Item>
      <Form.Item label="姓名" name="name">
        <Input />
      </Form.Item>
      <Form.Item label="角色" name="roles">
        <Select mode="multiple" options={roleOptions} />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit">创建用户</Button>
      </Form.Item>
    </Form>
  )
}
```

### 24.3 错误处理 UI

```typescript
// Error Boundary
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error({ error: error.message, componentStack: errorInfo.componentStack })
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onReset={() => this.setState({ hasError: false })} />
    }
    return this.props.children
  }
}

// 全局错误处理
function GlobalErrorHandler() {
  const { notification } = App.useApp()
  
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      notification.error({
        message: '系统错误',
        description: '发生未知错误，请刷新页面重试'
      })
    }
    
    window.addEventListener('error', handleError)
    return () => window.removeEventListener('error', handleError)
  }, [])
  
  return null
}
```

### 24.4 加载状态设计

```typescript
// 骨架屏组件
function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="table-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton.Input key={j} active size="small" />
          ))}
        </div>
      ))}
    </div>
  )
}

// 加载状态 Hook
function useLoading() {
  const [loading, setLoading] = useState(false)
  
  const withLoading = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true)
    try {
      return await fn()
    } finally {
      setLoading(false)
    }
  }, [])
  
  return { loading, withLoading }
}

// 页面加载状态
function PageLoading() {
  return (
    <div className="page-loading">
      <Spin size="large" />
      <p>加载中...</p>
    </div>
  )
}
```

---
