# 认证提供商架构

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§12 认证提供商架构

---

## 12. 认证提供商架构

### 12.1 设计原则

**配置驱动 + 可插拔提供商**：
- 配置文件声明启用的认证方式
- 代码实现可插拔的 Provider 接口
- 支持内置 + OAuth + 外部服务

### 12.2 认证提供商接口

```typescript
// 认证提供商接口（可插拔）
interface AuthProvider {
  name: string
  type: 'password' | 'oauth' | 'webauthn' | 'saml' | 'oidc'
  enabled: boolean
  
  authenticate(credentials: any): Promise<AuthResult>
  register?(userData: any): Promise<AuthResult>
  verify?(token: string): Promise<VerifyResult>
}

// 认证管理器
class AuthManager {
  private providers: Map<string, AuthProvider> = new Map()
  
  // 注册提供商
  register(provider: AuthProvider): void {
    this.providers.set(provider.name, provider)
  }
  
  // 获取所有启用的提供商
  getEnabledProviders(): AuthProvider[] {
    return Array.from(this.providers.values()).filter(p => p.enabled)
  }
  
  // 认证
  async authenticate(providerName: string, credentials: any): Promise<AuthResult> {
    const provider = this.providers.get(providerName)
    if (!provider) throw new Error(`Provider ${providerName} not found`)
    return provider.authenticate(credentials)
  }
}
```

### 12.3 内置认证提供商

#### 12.3.1 密码认证（Password Provider）

```typescript
class PasswordProvider implements AuthProvider {
  name = 'password'
  type = 'password' as const
  enabled = true
  
  private config: {
    // 密码策略
    minLength: number
    requireUppercase: boolean
    requireLowercase: boolean
    requireNumbers: boolean
    requireSpecialChars: boolean
    
    // 邮箱验证
    requireEmailVerification: boolean
    
    // 域名限制
    allowedDomains: string[]
    blockedDomains: string[]
    
    // 邮箱别名
    blockEmailAliases: boolean
  }
  
  async authenticate(credentials: { email: string; password: string }): Promise<AuthResult> {
    // 1. 验证邮箱格式
    this.validateEmail(credentials.email)
    
    // 2. 检查域名限制
    this.checkDomainRestrictions(credentials.email)
    
    // 3. 验证密码
    const user = await this.verifyPassword(credentials.email, credentials.password)
    
    // 4. 检查邮箱验证状态
    if (this.config.requireEmailVerification && !user.emailVerified) {
      throw new Error('Email not verified')
    }
    
    // 5. 生成 JWT
    return this.generateToken(user)
  }
}
```

**配置示例**：
```yaml
auth:
  password:
    enabled: true
    config:
      minLength: 8
      requireUppercase: true
      requireLowercase: true
      requireNumbers: true
      requireSpecialChars: false
      requireEmailVerification: true
      allowedDomains:
        - gmail.com
        - 163.com
        - 126.com
        - qq.com
        - outlook.com
        - hotmail.com
        - icloud.com
        - yahoo.com
        - foxmail.com
      blockEmailAliases: true
```

#### 12.3.2 OAuth 提供商（OAuth Provider）

```typescript
class OAuthProvider implements AuthProvider {
  name: string
  type = 'oauth' as const
  enabled: boolean
  
  private config: {
    clientId: string
    clientSecret: string
    authorizationUrl: string
    tokenUrl: string
    userInfoUrl: string
    scopes: string[]
    callbackUrl: string
  }
  
  async authenticate(credentials: { code: string }): Promise<AuthResult> {
    // 1. 用授权码换取访问令牌
    const accessToken = await this.exchangeCodeForToken(credentials.code)
    
    // 2. 获取用户信息
    const userInfo = await this.getUserInfo(accessToken)
    
    // 3. 查找或创建用户
    const user = await this.findOrCreateUser(userInfo)
    
    // 4. 生成 JWT
    return this.generateToken(user)
  }
}
```

**支持的 OAuth 提供商**：

| 提供商 | 认证方式 | 说明 |
|--------|---------|------|
| GitHub | OAuth 2.0 | 开发者常用 |
| Discord | OAuth 2.0 | 社区平台 |
| OIDC | OpenID Connect | 标准协议，支持任意 OIDC 提供商 |
| Telegram | Telegram Login | 即时通讯 |
| LinuxDO | OAuth 2.0 | 中文社区 |
| 微信 | 微信开放平台 | 国内常用 |

#### 12.3.3 通行密钥认证（WebAuthn Provider）

```typescript
class WebAuthnProvider implements AuthProvider {
  name = 'webauthn'
  type = 'webauthn' as const
  enabled: boolean
  
  private config: {
    rpName: string           // 人类可读名称
    rpId: string             // 有效域
    origin: string           // 允许的来源
    authenticatorSelection: {
      authenticatorAttachment: 'platform' | 'cross-platform'
      userVerification: 'required' | 'preferred' | 'discouraged'
      residentKey: 'required' | 'preferred' | 'discouraged'
    }
    attestation: 'none' | 'indirect' | 'direct'
  }
  
  async authenticate(credentials: {
    credentialId: string
    authenticatorData: string
    clientDataJSON: string
    signature: string
  }): Promise<AuthResult> {
    // 1. 验证签名
    const isValid = await this.verifySignature(credentials)
    
    // 2. 查找用户
    const user = await this.findUserByCredential(credentials.credentialId)
    
    // 3. 更新签名计数器
    await this.updateSignatureCounter(credentials.credentialId)
    
    // 4. 生成 JWT
    return this.generateToken(user)
  }
}
```

### 12.4 外部服务集成

#### 12.4.1 Auth0 集成

```typescript
class Auth0Provider implements AuthProvider {
  name = 'auth0'
  type = 'oidc' as const
  enabled: boolean
  
  private config: {
    domain: string
    clientId: string
    clientSecret: string
    audience: string
  }
  
  async authenticate(credentials: { code: string }): Promise<AuthResult> {
    // 使用 Auth0 SDK
    const auth0 = new Auth0Client({
      domain: this.config.domain,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    })
    
    // 交换令牌
    const tokenSet = await auth0.exchangeCode(credentials.code)
    
    // 获取用户信息
    const userInfo = await auth0.getUserInfo(tokenSet.access_token)
    
    // 查找或创建用户
    const user = await this.findOrCreateUser(userInfo)
    
    // 生成 JWT
    return this.generateToken(user)
  }
}
```

#### 12.4.2 Keycloak 集成

```typescript
class KeycloakProvider implements AuthProvider {
  name = 'keycloak'
  type = 'oidc' as const
  enabled: boolean
  
  private config: {
    realm: string
    clientId: string
    clientSecret: string
    serverUrl: string
  }
  
  async authenticate(credentials: { code: string }): Promise<AuthResult> {
    // 使用 Keycloak SDK
    const keycloak = new KeycloakClient({
      realm: this.config.realm,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      serverUrl: this.config.serverUrl,
    })
    
    // 交换令牌
    const tokenSet = await keycloak.exchangeCode(credentials.code)
    
    // 获取用户信息
    const userInfo = await keycloak.getUserInfo(tokenSet.access_token)
    
    // 查找或创建用户
    const user = await this.findOrCreateUser(userInfo)
    
    // 生成 JWT
    return this.generateToken(user)
  }
}
```

### 12.5 完整配置示例

```yaml
# config.yaml
auth:
  # 内置提供商
  password:
    enabled: true
    config:
      minLength: 8
      requireEmailVerification: true
      allowedDomains:
        - gmail.com
        - 163.com
        - qq.com
    
  webauthn:
    enabled: true
    config:
      rpName: AccessBase
      rpId: example.com
      origin: https://example.com
      userVerification: preferred
    
  # OAuth 提供商
  github:
    enabled: true
    config:
      clientId: ${GITHUB_CLIENT_ID}
      clientSecret: ${GITHUB_CLIENT_SECRET}
      scopes: ['user:email']
      callbackUrl: https://example.com/oauth/github
    
  wechat:
    enabled: true
    config:
      appId: ${WECHAT_APP_ID}
      appSecret: ${WECHAT_APP_SECRET}
      scopes: ['snsapi_login']
      callbackUrl: https://example.com/oauth/wechat
    
  # OIDC 提供商（通用）
  oidc:
    enabled: false
    config:
      issuer: https://auth.example.com
      clientId: ${OIDC_CLIENT_ID}
      clientSecret: ${OIDC_CLIENT_SECRET}
      scopes: ['openid', 'profile', 'email']
    
  # 外部服务提供商
  auth0:
    enabled: false
    config:
      domain: ${AUTH0_DOMAIN}
      clientId: ${AUTH0_CLIENT_ID}
      clientSecret: ${AUTH0_CLIENT_SECRET}
    
  keycloak:
    enabled: false
    config:
      serverUrl: https://keycloak.example.com
      realm: accessbase
      clientId: ${KEYCLOAK_CLIENT_ID}
      clientSecret: ${KEYCLOAK_CLIENT_SECRET}
```

### 12.6 前端登录页面

```typescript
// 登录页面组件
function LoginPage() {
  const { providers } = useAuth()
  
  return (
    <div className="login-page">
      {/* 基本登录表单 */}
      {providers.password?.enabled && (
        <PasswordLoginForm onSubmit={handlePasswordLogin} />
      )}
      
      {/* 分隔线 */}
      <Divider>或</Divider>
      
      {/* OAuth 登录按钮 */}
      {providers.github?.enabled && (
        <OAuthButton provider="github" onClick={handleGitHubLogin}>
          GitHub 登录
        </OAuthButton>
      )}
      
      {providers.wechat?.enabled && (
        <OAuthButton provider="wechat" onClick={handleWeChatLogin}>
          微信登录
        </OAuthButton>
      )}
      
      {/* 通行密钥登录 */}
      {providers.webauthn?.enabled && (
        <WebAuthnButton onClick={handleWebAuthnLogin}>
          Passkey 登录
        </WebAuthnButton>
      )}
    </div>
  )
}
```

### 12.7 认证流程

```
用户访问登录页
    ↓
前端获取启用的提供商列表
    ↓
用户选择认证方式
    ↓
┌─────────────────────────────────────────────────────┐
│  密码登录          │  OAuth 登录      │  Passkey 登录 │
│  ├─ 输入邮箱/密码  │  ├─ 跳转到提供商  │  ├─ 调用 API  │
│  ├─ 验证密码      │  ├─ 用户授权      │  ├─ 生物识别  │
│  └─ 生成 JWT     │  ├─ 回调处理      │  └─ 生成 JWT  │
│                  │  └─ 生成 JWT     │              │
└─────────────────────────────────────────────────────┘
    ↓
返回 JWT + 用户信息
    ↓
前端存储 JWT，跳转到首页
```

---
