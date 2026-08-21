# 错误处理策略

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§21 错误处理策略

---

## 21. 错误处理策略

### 21.1 统一错误响应格式

```typescript
// 统一错误响应
interface ErrorResponse {
  success: false
  error: {
    code: string           // 错误码（如 AUTH_001）
    message: string        // 用户友好消息
    details?: unknown      // 详细信息（仅开发环境）
    timestamp: string      // ISO 时间戳
    requestId: string      // 请求追踪 ID
    path: string           // 请求路径
  }
}

// 统一成功响应
interface SuccessResponse<T> {
  success: true
  data: T
  meta?: {
    page?: number
    pageSize?: number
    total?: number
    totalPages?: number
  }
}
```

### 21.2 错误码体系

| 范围 | 模块 | 示例 |
|------|------|------|
| `AUTH_001` ~ `AUTH_099` | 认证 | AUTH_001: 无效凭证, AUTH_002: 令牌过期 |
| `AUTH_100` ~ `AUTH_199` | 授权 | AUTH_100: 权限不足, AUTH_101: 角色不存在 |
| `USER_001` ~ `USER_099` | 用户 | USER_001: 用户不存在, USER_002: 邮箱已注册 |
| `ROLE_001` ~ `ROLE_099` | 角色 | ROLE_001: 角色不存在, ROLE_002: 权限冲突 |
| `AUDIT_001` ~ `AUDIT_099` | 审计 | AUDIT_001: 查询失败, AUDIT_002: 导出失败 |
| `SYS_001` ~ `SYS_099` | 系统 | SYS_001: 内部错误, SYS_002: 服务不可用 |
| `RATE_001` ~ `RATE_099` | 限流 | RATE_001: 请求过于频繁, RATE_002: 超过配额 |
| `LIC_001` ~ `LIC_099` | 许可证 | LIC_001: 许可证无效, LIC_002: 功能未授权 |

### 21.3 全局错误处理器

```typescript
// Fastify 全局错误处理器
fastify.setErrorHandler((error, request, reply) => {
  const requestId = request.id
  
  // 已知业务错误
  if (error instanceof AppError) {
    logger.warn({ requestId, code: error.code, message: error.message })
    return reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
        requestId,
        path: request.url
      }
    })
  }
  
  // Zod 验证错误
  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_001',
        message: '请求参数验证失败',
        details: error.errors,
        timestamp: new Date().toISOString(),
        requestId,
        path: request.url
      }
    })
  }
  
  // 未知错误
  logger.error({ requestId, error: error.message, stack: error.stack })
  return reply.status(500).send({
    success: false,
    error: {
      code: 'SYS_001',
      message: '服务器内部错误',
      timestamp: new Date().toISOString(),
      requestId,
      path: request.url
    }
  })
})
```

### 21.4 HTTP 状态码映射

| 状态码 | 场景 | 错误码前缀 |
|--------|------|-----------|
| 400 | 请求参数错误 | VALIDATION_ |
| 401 | 未认证 | AUTH_001 ~ AUTH_049 |
| 403 | 无权限 | AUTH_100 ~ AUTH_149 |
| 404 | 资源不存在 | *_001 |
| 409 | 资源冲突 | *_002 |
| 422 | 业务逻辑错误 | *_003 ~ *_049 |
| 429 | 请求限流 | RATE_ |
| 500 | 服务器内部错误 | SYS_001 |
| 503 | 服务不可用 | SYS_002 |

---
