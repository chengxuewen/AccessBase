# @accessbase/shared-types 软件设计文档 (SDD)

> 本文档基于 [`error-handling.md`](./error-handling.md) §21 和 [`core-packages.md`](./core-packages.md) §10 生成。

---

## 1. 包概述

`@accessbase/shared-types` 是 AccessBase 的共享类型定义包，提供整个系统通用的类型定义、接口和错误码体系。

### 1.1 核心职责

- 定义系统通用类型和接口
- 提供统一的错误码体系
- 定义 API 响应格式
- 提供数据模型类型定义
- 确保类型安全和一致性

### 1.2 技术选型

| 技术 | 选择 | 理由 |
|------|------|------|
| 类型系统 | TypeScript | 类型安全、IDE 支持 |
| 验证 | Zod | 运行时验证、类型推断 |
| 序列化 | JSON | 标准格式、广泛支持 |

---

## 2. 核心接口

### 2.1 API 响应类型

```typescript
/**
 * 统一成功响应
 */
export interface SuccessResponse<T> {
  /** 成功标识 */
  success: true
  /** 响应数据 */
  data: T
  /** 分页信息 */
  meta?: PaginationMeta
  /** 请求 ID */
  requestId?: string
}

/**
 * 统一错误响应
 */
export interface ErrorResponse {
  /** 错误标识 */
  success: false
  /** 错误信息 */
  error: {
    /** 错误码 */
    code: string
    /** 用户友好消息 */
    message: string
    /** 详细信息（仅开发环境） */
    details?: unknown
    /** 时间戳 */
    timestamp: string
    /** 请求 ID */
    requestId: string
    /** 请求路径 */
    path: string
  }
}

/**
 * 分页元数据
 */
export interface PaginationMeta {
  /** 当前页码 */
  page: number
  /** 每页数量 */
  pageSize: number
  /** 总记录数 */
  total: number
  /** 总页数 */
  totalPages: number
}

/**
 * API 响应类型
 */
export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse
```

### 2.2 错误码类型

```typescript
/**
 * 错误码枚举
 */
export enum ErrorCode {
  // 认证错误 (AUTH_001 ~ AUTH_099)
  AUTH_001 = 'AUTH_001', // 无效凭证
  AUTH_002 = 'AUTH_002', // 令牌过期
  AUTH_003 = 'AUTH_003', // 令牌无效
  AUTH_004 = 'AUTH_004', // 刷新令牌无效
  AUTH_005 = 'AUTH_005', // 账户已锁定
  AUTH_006 = 'AUTH_006', // 账户已禁用
  AUTH_007 = 'AUTH_007', // 密码已过期
  AUTH_008 = 'AUTH_008', // MFA 验证失败
  AUTH_009 = 'AUTH_009', // 会话不存在
  AUTH_010 = 'AUTH_010', // 会话已过期

  // 授权错误 (AUTH_100 ~ AUTH_199)
  AUTH_100 = 'AUTH_100', // 权限不足
  AUTH_101 = 'AUTH_101', // 角色不存在
  AUTH_102 = 'AUTH_102', // 权限冲突
  AUTH_103 = 'AUTH_103', // 租户权限不足
  AUTH_104 = 'AUTH_104', // 资源权限不足

  // 用户错误 (USER_001 ~ USER_099)
  USER_001 = 'USER_001', // 用户不存在
  USER_002 = 'USER_002', // 邮箱已注册
  USER_003 = 'USER_003', // 用户名已存在
  USER_004 = 'USER_004', // 用户已禁用
  USER_005 = 'USER_005', // 用户已锁定
  USER_006 = 'USER_006', // 密码强度不足
  USER_007 = 'USER_007', // 密码历史重复
  USER_008 = 'USER_008', // 邮箱未验证
  USER_009 = 'USER_009', // MFA 已启用
  USER_010 = 'USER_010', // MFA 未启用

  // 角色错误 (ROLE_001 ~ ROLE_099)
  ROLE_001 = 'ROLE_001', // 角色不存在
  ROLE_002 = 'ROLE_002', // 权限冲突
  ROLE_003 = 'ROLE_003', // 系统角色不可删除
  ROLE_004 = 'ROLE_004', // 角色已分配用户
  ROLE_005 = 'ROLE_005', // 角色继承循环

  // 审计错误 (AUDIT_001 ~ AUDIT_099)
  AUDIT_001 = 'AUDIT_001', // 查询失败
  AUDIT_002 = 'AUDIT_002', // 导出失败
  AUDIT_003 = 'AUDIT_003', // 清理失败
  AUDIT_004 = 'AUDIT_004', // 归档失败

  // 系统错误 (SYS_001 ~ SYS_099)
  SYS_001 = 'SYS_001', // 内部错误
  SYS_002 = 'SYS_002', // 服务不可用
  SYS_003 = 'SYS_003', // 数据库错误
  SYS_004 = 'SYS_004', // 缓存错误
  SYS_005 = 'SYS_005', // 外部服务错误
  SYS_006 = 'SYS_006', // 配置错误
  SYS_007 = 'SYS_007', // 资源不足
  SYS_008 = 'SYS_008', // 超时
  SYS_009 = 'SYS_009', // 限流
  SYS_010 = 'SYS_010', // 维护模式

  // 许可证错误 (LIC_001 ~ LIC_099)
  LIC_001 = 'LIC_001', // 许可证无效
  LIC_002 = 'LIC_002', // 功能未授权
  LIC_003 = 'LIC_003', // 许可证已过期
  LIC_004 = 'LIC_004', // 用户数超限
  LIC_005 = 'LIC_005', // 租户数超限

  // 验证错误 (VALIDATION_001 ~ VALIDATION_099)
  VALIDATION_001 = 'VALIDATION_001', // 请求参数验证失败
  VALIDATION_002 = 'VALIDATION_002', // 缺少必需字段
  VALIDATION_003 = 'VALIDATION_003', // 字段格式错误
  VALIDATION_004 = 'VALIDATION_004', // 字段值超出范围
  VALIDATION_005 = 'VALIDATION_005', // 唯一性约束冲突

  // 迁移错误 (MIG_001 ~ MIG_099)
  MIG_001 = 'MIG_001', // 迁移文件不存在
  MIG_002 = 'MIG_002', // 迁移文件格式错误
  MIG_003 = 'MIG_003', // 迁移执行失败
  MIG_004 = 'MIG_004', // 回滚失败
  MIG_005 = 'MIG_005', // 迁移锁获取失败

  // i18n 错误 (I18N_001 ~ I18N_099)
  I18N_001 = 'I18N_001', // 语言包加载失败
  I18N_002 = 'I18N_002', // 翻译键不存在
  I18N_003 = 'I18N_003', // 语言切换失败
  I18N_004 = 'I18N_004', // 命名空间加载失败

  // 健康检查错误 (HC_001 ~ HC_099)
  HC_001 = 'HC_001', // 数据库连接失败
  HC_002 = 'HC_002', // 缓存连接失败
  HC_003 = 'HC_003', // 外部服务不可达
  HC_004 = 'HC_004', // 检查超时
  HC_005 = 'HC_005', // 检查器未找到
}

/**
 * 错误码映射
 */
export const ErrorCodeMap: Record<ErrorCode, { message: string; statusCode: number }> = {
  [ErrorCode.AUTH_001]: { message: '无效凭证', statusCode: 401 },
  [ErrorCode.AUTH_002]: { message: '令牌过期', statusCode: 401 },
  [ErrorCode.AUTH_003]: { message: '令牌无效', statusCode: 401 },
  [ErrorCode.AUTH_004]: { message: '刷新令牌无效', statusCode: 401 },
  [ErrorCode.AUTH_005]: { message: '账户已锁定', statusCode: 423 },
  [ErrorCode.AUTH_006]: { message: '账户已禁用', statusCode: 403 },
  [ErrorCode.AUTH_007]: { message: '密码已过期', statusCode: 401 },
  [ErrorCode.AUTH_008]: { message: 'MFA 验证失败', statusCode: 401 },
  [ErrorCode.AUTH_009]: { message: '会话不存在', statusCode: 401 },
  [ErrorCode.AUTH_010]: { message: '会话已过期', statusCode: 401 },
  // ... 其他错误码映射
}
```

### 2.3 数据模型类型

```typescript
/**
 * 用户模型
 */
export interface User {
  /** 用户 ID */
  id: string
  /** 邮箱 */
  email: string
  /** 姓名 */
  name: string
  /** 头像 URL */
  avatarUrl?: string
  /** 邮箱是否已验证 */
  emailVerified: boolean
  /** MFA 是否启用 */
  mfaEnabled: boolean
  /** 状态 */
  status: 'active' | 'inactive' | 'locked' | 'disabled'
  /** 租户 ID */
  tenantId: string
  /** 创建时间 */
  createdAt: Date
  /** 更新时间 */
  updatedAt: Date
  /** 版本号 */
  version: number
}

/**
 * 角色模型
 */
export interface Role {
  /** 角色 ID */
  id: string
  /** 角色名称 */
  name: string
  /** 描述 */
  description?: string
  /** 租户 ID */
  tenantId: string
  /** 父角色 ID（用于角色继承） */
  parentId?: string
  /** 是否为系统角色 */
  isSystem: boolean
  /** 创建时间 */
  createdAt: Date
  /** 更新时间 */
  updatedAt: Date
}

/**
 * 权限模型
 */
export interface Permission {
  /** 权限 ID */
  id: string
  /** 权限名称 */
  name: string
  /** 资源 */
  resource: string
  /** 操作 */
  action: string
  /** 描述 */
  description?: string
}

/**
 * 租户模型
 */
export interface Tenant {
  /** 租户 ID */
  id: string
  /** 租户名称 */
  name: string
  /** 租户标识 */
  slug: string
  /** 状态 */
  status: 'active' | 'inactive' | 'suspended'
  /** 设置 */
  settings: Record<string, unknown>
  /** 创建时间 */
  createdAt: Date
  /** 更新时间 */
  updatedAt: Date
}

/**
 * 审计日志模型
 */
export interface AuditLog {
  /** 日志 ID */
  id: string
  /** 用户 ID */
  userId?: string
  /** 操作 */
  action: string
  /** 资源类型 */
  resourceType: string
  /** 资源 ID */
  resourceId?: string
  /** 请求体 */
  requestBody?: Record<string, unknown>
  /** 响应状态码 */
  responseStatus?: number
  /** IP 地址 */
  ipAddress?: string
  /** 用户代理 */
  userAgent?: string
  /** 租户 ID */
  tenantId?: string
  /** 请求 ID */
  requestId?: string
  /** 创建时间 */
  createdAt: Date
}

/**
 * 会话模型
 */
export interface Session {
  /** 会话 ID */
  id: string
  /** 用户 ID */
  userId: string
  /** 刷新令牌哈希 */
  refreshTokenHash: string
  /** 设备信息 */
  deviceInfo?: Record<string, unknown>
  /** IP 地址 */
  ipAddress?: string
  /** 过期时间 */
  expiresAt: Date
  /** 撤销时间 */
  revokedAt?: Date
  /** 创建时间 */
  createdAt: Date
}
```

---

## 3. 生命周期钩子

### 3.1 类型验证生命周期

```typescript
/**
 * 类型验证生命周期钩子
 */
export interface ValidationLifecycle {
  /** 验证开始前 */
  onBeforeValidate?: (data: unknown, schema: ZodSchema) => Promise<void>
  /** 验证完成后 */
  onAfterValidate?: (result: ValidationResult) => Promise<void>
  /** 验证失败时 */
  onValidationFailed?: (errors: ZodError) => Promise<void>
  /** 类型转换前 */
  onBeforeTransform?: (data: unknown) => Promise<unknown>
  /** 类型转换后 */
  onAfterTransform?: (data: unknown) => Promise<unknown>
}
```

### 3.2 类型初始化流程

```
1. 类型定义阶段
   ├── 定义基础类型
   ├── 定义接口
   ├── 定义枚举
   └── 定义错误码

2. 验证阶段
   ├── 定义 Zod Schema
   ├── 运行时验证
   ├── 类型推断
   └── 错误处理

3. 导出阶段
   ├── 导出类型定义
   ├── 导出验证函数
   ├── 导出错误码
   └── 导出工具函数
```

---

## 4. 依赖关系

### 4.1 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| zod | ^3.22.0 | 运行时验证、类型推断 |
| typescript | ^5.3.0 | 类型系统 |

### 4.2 内部依赖

| 包 | 用途 |
|------|------|
| 无 | 此包为最底层包，无内部依赖 |

### 4.3 依赖图

```
@accessbase/shared-types
├── zod
└── typescript
```

---

## 5. 错误码

### 5.1 错误码分类

| 错误码范围 | 模块 | 说明 |
|------------|------|------|
| AUTH_001 ~ AUTH_099 | 认证 | 认证相关错误 |
| AUTH_100 ~ AUTH_199 | 授权 | 授权相关错误 |
| USER_001 ~ USER_099 | 用户 | 用户相关错误 |
| ROLE_001 ~ ROLE_099 | 角色 | 角色相关错误 |
| AUDIT_001 ~ AUDIT_099 | 审计 | 审计相关错误 |
| SYS_001 ~ SYS_099 | 系统 | 系统相关错误 |
| LIC_001 ~ LIC_099 | 许可证 | 许可证相关错误 |
| VALIDATION_001 ~ VALIDATION_099 | 验证 | 验证相关错误 |
| MIG_001 ~ MIG_099 | 迁移 | 迁移相关错误 |
| I18N_001 ~ I18N_099 | i18n | i18n 相关错误 |
| HC_001 ~ HC_099 | 健康检查 | 健康检查相关错误 |

### 5.2 错误处理工具

```typescript
/**
 * 创建错误响应
 */
export function createErrorResponse(
  code: ErrorCode,
  requestId: string,
  path: string,
  details?: unknown
): ErrorResponse {
  const errorInfo = ErrorCodeMap[code]
  return {
    success: false,
    error: {
      code,
      message: errorInfo.message,
      details,
      timestamp: new Date().toISOString(),
      requestId,
      path
    }
  }
}

/**
 * 创建成功响应
 */
export function createSuccessResponse<T>(
  data: T,
  meta?: PaginationMeta
): SuccessResponse<T> {
  return {
    success: true,
    data,
    meta
  }
}

/**
 * 验证请求数据
 */
export function validateRequest<T>(
  data: unknown,
  schema: ZodSchema<T>
): { success: true; data: T } | { success: false; error: ZodError } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}
```

---

## 6. 配置项

### 6.1 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| NODE_ENV | 否 | development | 运行环境 |
| API_VERSION | 否 | v1 | API 版本 |
| ERROR_DETAILS_ENABLED | 否 | false | 是否返回错误详情 |
| VALIDATION_STRIP_UNKNOWN | 否 | true | 是否剥离未知字段 |

### 6.2 配置文件

```typescript
// shared-types.config.ts
export interface SharedTypesConfig {
  /** 运行环境 */
  environment: 'development' | 'production' | 'test'
  /** API 配置 */
  api: {
    /** API 版本 */
    version: string
    /** 响应格式 */
    responseFormat: 'standard' | 'minimal'
  }
  /** 错误配置 */
  error: {
    /** 是否返回错误详情 */
    detailsEnabled: boolean
    /** 是否记录错误堆栈 */
    stackEnabled: boolean
    /** 错误码映射 */
    codeMap: Record<string, { message: string; statusCode: number }>
  }
  /** 验证配置 */
  validation: {
    /** 是否剥离未知字段 */
    stripUnknown: boolean
    /** 是否中止早期验证 */
    abortEarly: boolean
    /** 自定义错误消息 */
    customMessages: Record<string, string>
  }
}
```

### 6.3 TypeScript 配置

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 附录

### A. 类型导出示例

```typescript
// index.ts
export * from './types/api'
export * from './types/models'
export * from './types/errors'
export * from './utils/validation'
export * from './utils/response'
export * from './constants/error-codes'
```

### B. Zod Schema 示例

```typescript
// schemas/user.ts
import { z } from 'zod'

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  avatarUrl: z.string().url().optional(),
  emailVerified: z.boolean().default(false),
  mfaEnabled: z.boolean().default(false),
  status: z.enum(['active', 'inactive', 'locked', 'disabled']),
  tenantId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
  version: z.number().int().positive()
})

export type User = z.infer<typeof UserSchema>

export const CreateUserSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  version: true
})

export type CreateUser = z.infer<typeof CreateUserSchema>

export const UpdateUserSchema = CreateUserSchema.partial()

export type UpdateUser = z.infer<typeof UpdateUserSchema>
```

### C. API 响应示例

```typescript
// 成功响应示例
const successResponse: SuccessResponse<User> = {
  success: true,
  data: {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'user@example.com',
    name: '张三',
    emailVerified: true,
    mfaEnabled: false,
    status: 'active',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1
  }
}

// 分页响应示例
const paginatedResponse: SuccessResponse<User[]> = {
  success: true,
  data: [/* 用户列表 */],
  meta: {
    page: 1,
    pageSize: 10,
    total: 100,
    totalPages: 10
  }
}

// 错误响应示例
const errorResponse: ErrorResponse = {
  success: false,
  error: {
    code: 'AUTH_001',
    message: '无效凭证',
    timestamp: '2026-08-21T10:30:00Z',
    requestId: 'req-123e4567-e89b-12d3-a456-426614174000',
    path: '/api/v1/auth/login'
  }
}
```

### D. 工具函数示例

```typescript
// utils/validation.ts
import { z } from 'zod'

/**
 * 验证请求体
 */
export function validateBody<T>(body: unknown, schema: z.ZodSchema<T>): T {
  return schema.parse(body)
}

/**
 * 验证查询参数
 */
export function validateQuery<T>(query: unknown, schema: z.ZodSchema<T>): T {
  return schema.parse(query)
}

/**
 * 验证路径参数
 */
export function validateParams<T>(params: unknown, schema: z.ZodSchema<T>): T {
  return schema.parse(params)
}

/**
 * 安全验证（不抛出异常）
 */
export function safeValidate<T>(
  data: unknown,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

// utils/response.ts
import { SuccessResponse, ErrorResponse, PaginationMeta } from '../types/api'

/**
 * 创建成功响应
 */
export function success<T>(data: T, meta?: PaginationMeta): SuccessResponse<T> {
  return {
    success: true,
    data,
    meta
  }
}

/**
 * 创建错误响应
 */
export function error(
  code: string,
  message: string,
  requestId: string,
  path: string,
  details?: unknown
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      requestId,
      path
    }
  }
}
```
