# API 设计规范

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§23 API 设计规范

---

## 23. API 设计规范

### 23.1 RESTful API 标准

| 方法 | 路径 | 说明 | 示例 |
|------|------|------|------|
| GET | `/api/v1/{resource}` | 列表查询 | GET /api/v1/users |
| GET | `/api/v1/{resource}/:id` | 单个查询 | GET /api/v1/users/123 |
| POST | `/api/v1/{resource}` | 创建 | POST /api/v1/users |
| PUT | `/api/v1/{resource}/:id` | 全量更新 | PUT /api/v1/users/123 |
| PATCH | `/api/v1/{resource}/:id` | 部分更新 | PATCH /api/v1/users/123 |
| DELETE | `/api/v1/{resource}/:id` | 删除 | DELETE /api/v1/users/123 |

### 23.2 API 版本控制

```typescript
// URL 路径版本控制
// /api/v1/users
// /api/v2/users

fastify.register(async (v1) => {
  v1.get('/users', getUsersV1)
  v1.post('/users', createUserV1)
}, { prefix: '/api/v1' })

fastify.register(async (v2) => {
  v2.get('/users', getUsersV2)
  v2.post('/users', createUserV2)
}, { prefix: '/api/v2' })
```

### 23.3 分页标准

```typescript
// 请求参数
interface PaginationParams {
  page?: number       // 页码（默认 1）
  pageSize?: number   // 每页数量（默认 20，最大 100）
  sortBy?: string     // 排序字段
  sortOrder?: 'asc' | 'desc'  // 排序方向
}

// 响应格式
interface PaginatedResponse<T> {
  success: true
  data: T[]
  meta: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
```

### 23.4 OpenAPI/Swagger 文档

```typescript
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'

fastify.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'AccessBase API',
      description: 'AccessBase 基石层 API 文档',
      version: '1.0.0'
    },
    servers: [
      { url: 'http://localhost:5101', description: '开发环境' },
      { url: 'https://api.example.com', description: '生产环境' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  }
})

fastify.register(fastifySwaggerUi, {
  routePrefix: '/docs'
})
```

### 23.5 核心 API 端点

| 模块 | 端点 | 方法 | 说明 |
|------|------|------|------|
| 认证 | `/api/v1/auth/login` | POST | 密码登录 |
| 认证 | `/api/v1/auth/logout` | POST | 登出 |
| 认证 | `/api/v1/auth/refresh` | POST | 刷新令牌 |
| 认证 | `/api/v1/auth/oauth/:provider` | GET | OAuth 授权 |
| 认证 | `/api/v1/auth/oauth/:provider/callback` | GET | OAuth 回调 |
| 认证 | `/api/v1/auth/mfa/enable` | POST | 启用 MFA |
| 认证 | `/api/v1/auth/mfa/verify` | POST | 验证 MFA |
| 用户 | `/api/v1/users` | GET/POST | 用户列表/创建 |
| 用户 | `/api/v1/users/:id` | GET/PUT/DELETE | 用户 CRUD |
| 用户 | `/api/v1/users/me` | GET | 当前用户信息 |
| 角色 | `/api/v1/roles` | GET/POST | 角色列表/创建 |
| 角色 | `/api/v1/roles/:id` | GET/PUT/DELETE | 角色 CRUD |
| 角色 | `/api/v1/roles/:id/permissions` | PUT | 角色权限 |
| 权限 | `/api/v1/permissions` | GET | 权限列表 |
| 审计 | `/api/v1/audit-logs` | GET | 审计日志查询 |
| 审计 | `/api/v1/audit-logs/export` | GET | 审计日志导出 |
| 租户 | `/api/v1/tenants` | GET/POST | 租户列表/创建 |
| 租户 | `/api/v1/tenants/:id` | GET/PUT/DELETE | 租户 CRUD |
| 许可证 | `/api/v1/license` | GET | 许可证信息 |
| 许可证 | `/api/v1/license/install` | POST | 安装许可证 |
| 健康 | `/health/live` | GET | 存活探针 |
| 健康 | `/health/ready` | GET | 就绪探针 |
| 文档 | `/docs` | GET | Swagger UI |

---
