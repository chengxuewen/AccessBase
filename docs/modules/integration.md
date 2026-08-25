# 集成架构

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§15 集成架构

---

## 15. 集成架构

### 15.1 设计原则

**认证层标准化 + UI 层可选**：

- 认证层：AccessBase 作为标准 OAuth 2.0 / OIDC Provider
- UI 层：提供多框架 UI 组件（React/Vue/原生），但不强制使用
- 集成方式：支持多种集成方式，适应不同技术栈

### 15.2 认证层标准化

#### 15.2.1 标准 OAuth 2.0 / OIDC 端点

```typescript
// AccessBase 提供标准 OAuth 2.0 端点
const endpoints = {
  authorization: '/oauth/authorize', // 授权端点
  token: '/oauth/token', // 令牌端点
  userinfo: '/oauth/userinfo', // 用户信息端点
  revocation: '/oauth/revoke', // 令牌撤销端点
  jwks: '/.well-known/jwks.json', // JWKS 端点
  discovery: '/.well-known/openid-configuration', // OIDC 发现端点
};
```

#### 15.2.2 任何技术栈都可以集成

| 技术栈  | 集成方式              | 说明             |
| ------- | --------------------- | ---------------- |
| React   | `oidc-client-ts`      | 标准 OIDC 客户端 |
| Vue     | `vue-oidc-client`     | Vue OIDC 插件    |
| 原生 JS | `oidc-client-js`      | 标准 OIDC 客户端 |
| 后端    | 标准 OAuth 2.0 客户端 | 任意语言         |

### 15.3 UI 层可选

#### 15.3.1 多框架 UI 组件库

```typescript
// React 组件（可选）
import { AccessBaseLogin, AccessBaseGuard } from '@accessbase/react';

// Vue 组件（可选）
import { AccessBaseLogin, AccessBaseGuard } from '@accessbase/vue';

// 原生 SDK（可选）
import { AccessBaseClient } from '@accessbase/sdk';
```

#### 15.3.2 组件库特性

| 组件库              | 框架    | 特性                         |
| ------------------- | ------- | ---------------------------- |
| `@accessbase/react` | React   | 登录组件、权限守卫、用户信息 |
| `@accessbase/vue`   | Vue     | 登录组件、权限守卫、用户信息 |
| `@accessbase/sdk`   | 原生 JS | OAuth 客户端、JWT 处理       |
| `@accessbase/jwt`   | 后端    | JWT 验证、权限检查           |

### 15.4 集成方式选择

| 集成方式            | 技术栈限制 | 用户体验   | 复杂度 | 推荐场景            |
| ------------------- | ---------- | ---------- | ------ | ------------------- |
| **标准 OAuth/OIDC** | 无限制     | ⭐⭐⭐     | ⭐     | 已有应用、多技术栈  |
| **React 组件库**    | React      | ⭐⭐⭐⭐⭐ | ⭐⭐   | React 应用          |
| **Vue 组件库**      | Vue        | ⭐⭐⭐⭐⭐ | ⭐⭐   | Vue 应用            |
| **原生 SDK**        | 无限制     | ⭐⭐⭐⭐   | ⭐⭐   | 原生应用、自定义 UI |

### 15.5 典型集成场景

#### 15.5.1 MediaServo（React 应用）

```typescript
// MediaServo 使用 React 组件库
import { AccessBaseProvider, AccessBaseLogin, AccessBaseGuard } from '@accessbase/react'

function App() {
  return (
    <AccessBaseProvider config={{
      baseUrl: 'https://accessbase.example.com',
      clientId: 'mediaservo',
      redirectUri: 'https://mediaservo.example.com/callback'
    }}>
      <Router>
        <Route path="/login" component={AccessBaseLogin} />
        <Route path="/dashboard" component={
          <AccessBaseGuard>
            <Dashboard />
          </AccessBaseGuard>
        } />
      </Router>
    </AccessBaseProvider>
  )
}
```

#### 15.5.2 MES（Vue 应用）

```typescript
// MES 使用 Vue 组件库
import { createAccessBase } from '@accessbase/vue';

const accessBase = createAccessBase({
  baseUrl: 'https://accessbase.example.com',
  clientId: 'mes',
  redirectUri: 'https://mes.example.com/callback',
});

app.use(accessBase);

// 在组件中使用
const { login, logout, user } = useAccessBase();
```

#### 15.5.3 原生应用（任意技术栈）

```typescript
// 原生应用使用标准 OAuth 2.0
import { AccessBaseClient } from '@accessbase/sdk';

const client = new AccessBaseClient({
  baseUrl: 'https://accessbase.example.com',
  clientId: 'native-app',
  redirectUri: 'https://native-app.example.com/callback',
});

// 跳转到授权页面
const authUrl = client.getAuthorizationUrl();
window.location.href = authUrl;

// 处理回调
const token = await client.handleCallback(callbackUrl);
```

#### 15.5.4 后端应用（API 集成）

```typescript
// 后端应用使用 JWT 验证
import { verifyJWT } from '@accessbase/jwt';

// 验证 JWT
const payload = await verifyJWT(token, {
  issuer: 'https://accessbase.example.com',
  audience: 'api.example.com',
});

// 获取用户信息
const userId = payload.sub;
const roles = payload.roles;
```

### 15.6 集成架构图

```
┌─────────────────────────────────────────────────────────┐
│                    AccessBase                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │                 认证层（标准化）                  │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │    │
│  │  │ OAuth 2.0│  │  OIDC   │  │  SAML   │         │    │
│  │  │ Server  │  │ Server  │  │ Server  │         │    │
│  │  └─────────┘  └─────────┘  └─────────┘         │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │                 UI 层（可选）                     │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │    │
│  │  │ React   │  │  Vue    │  │  原生   │         │    │
│  │  │ 组件库  │  │ 组件库  │  │  SDK   │         │    │
│  │  └─────────┘  └─────────┘  └─────────┘         │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
        ↓               ↓               ↓
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  React 应用 │  │  Vue 应用   │  │  原生应用   │
│  (MediaServo)│  │   (MES)    │  │  (其他)    │
└─────────────┘  └─────────────┘  └─────────────┘
```

### 15.7 配置示例

```yaml
# config.yaml
integration:
  # OAuth 2.0 配置
  oauth:
    enabled: true
    authorization_endpoint: /oauth/authorize
    token_endpoint: /oauth/token
    userinfo_endpoint: /oauth/userinfo
    revocation_endpoint: /oauth/revoke
    jwks_endpoint: /.well-known/jwks.json
    discovery_endpoint: /.well-known/openid-configuration

    # 客户端配置
    clients:
      mediaservo:
        client_id: mediaservo
        client_secret: ${MEDIASERVO_CLIENT_SECRET}
        redirect_uris:
          - https://mediaservo.example.com/callback
        grant_types:
          - authorization_code
          - refresh_token

      mes:
        client_id: mes
        client_secret: ${MES_CLIENT_SECRET}
        redirect_uris:
          - https://mes.example.com/callback
        grant_types:
          - authorization_code
          - refresh_token

  # UI 组件库配置
  ui:
    react:
      enabled: true
      package: @accessbase/react

    vue:
      enabled: true
      package: @accessbase/vue

    sdk:
      enabled: true
      package: @accessbase/sdk

  # JWT 配置
  jwt:
    issuer: https://accessbase.example.com
    audience: api.example.com
    expiration: 15m
    refresh_expiration: 7d
```

---
