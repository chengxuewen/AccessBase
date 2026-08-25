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
  name: string;
  type: 'password' | 'oauth' | 'webauthn' | 'saml' | 'oidc';
  enabled: boolean;

  authenticate(credentials: any): Promise<AuthResult>;
  register?(userData: any): Promise<AuthResult>;
  verify?(token: string): Promise<VerifyResult>;
}

// 认证管理器
class AuthManager {
  private providers: Map<string, AuthProvider> = new Map();

  // 注册提供商
  register(provider: AuthProvider): void {
    this.providers.set(provider.name, provider);
  }

  // 获取所有启用的提供商
  getEnabledProviders(): AuthProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.enabled);
  }

  // 认证
  async authenticate(providerName: string, credentials: any): Promise<AuthResult> {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider ${providerName} not found`);
    return provider.authenticate(credentials);
  }
}
```

### 12.3 内置认证提供商

#### 12.3.1 密码认证（Password Provider）

```typescript
class PasswordProvider implements AuthProvider {
  name = 'password';
  type = 'password' as const;
  enabled = true;

  private config: {
    // 密码策略
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;

    // 邮箱验证
    requireEmailVerification: boolean;

    // 域名限制
    allowedDomains: string[];
    blockedDomains: string[];

    // 邮箱别名
    blockEmailAliases: boolean;
  };

  async authenticate(credentials: { email: string; password: string }): Promise<AuthResult> {
    // 1. 验证邮箱格式
    this.validateEmail(credentials.email);

    // 2. 检查域名限制
    this.checkDomainRestrictions(credentials.email);

    // 3. 验证密码
    const user = await this.verifyPassword(credentials.email, credentials.password);

    // 4. 检查邮箱验证状态
    if (this.config.requireEmailVerification && !user.emailVerified) {
      throw new Error('Email not verified');
    }

    // 5. 生成 JWT
    return this.generateToken(user);
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
  name: string;
  type = 'oauth' as const;
  enabled: boolean;

  private config: {
    clientId: string;
    clientSecret: string;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scopes: string[];
    callbackUrl: string;
  };

  async authenticate(credentials: { code: string }): Promise<AuthResult> {
    // 1. 用授权码换取访问令牌
    const accessToken = await this.exchangeCodeForToken(credentials.code);

    // 2. 获取用户信息
    const userInfo = await this.getUserInfo(accessToken);

    // 3. 查找或创建用户
    const user = await this.findOrCreateUser(userInfo);

    // 4. 生成 JWT
    return this.generateToken(user);
  }
}
```

**支持的 OAuth 提供商**：

| 提供商   | 认证方式       | 说明                           |
| -------- | -------------- | ------------------------------ |
| GitHub   | OAuth 2.0      | 开发者常用                     |
| Discord  | OAuth 2.0      | 社区平台                       |
| OIDC     | OpenID Connect | 标准协议，支持任意 OIDC 提供商 |
| Telegram | Telegram Login | 即时通讯                       |
| LinuxDO  | OAuth 2.0      | 中文社区                       |
| 微信     | 微信开放平台   | 国内常用                       |

#### 12.3.3 通行密钥认证（WebAuthn Provider）

```typescript
class WebAuthnProvider implements AuthProvider {
  name = 'webauthn';
  type = 'webauthn' as const;
  enabled: boolean;

  private config: {
    rpName: string; // 人类可读名称
    rpId: string; // 有效域
    origin: string; // 允许的来源
    authenticatorSelection: {
      authenticatorAttachment: 'platform' | 'cross-platform';
      userVerification: 'required' | 'preferred' | 'discouraged';
      residentKey: 'required' | 'preferred' | 'discouraged';
    };
    attestation: 'none' | 'indirect' | 'direct';
  };

  async authenticate(credentials: {
    credentialId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  }): Promise<AuthResult> {
    // 1. 验证签名
    const isValid = await this.verifySignature(credentials);

    // 2. 查找用户
    const user = await this.findUserByCredential(credentials.credentialId);

    // 3. 更新签名计数器
    await this.updateSignatureCounter(credentials.credentialId);

    // 4. 生成 JWT
    return this.generateToken(user);
  }
}
```

### 12.4 外部服务集成

#### 12.4.1 Auth0 集成

```typescript
class Auth0Provider implements AuthProvider {
  name = 'auth0';
  type = 'oidc' as const;
  enabled: boolean;

  private config: {
    domain: string;
    clientId: string;
    clientSecret: string;
    audience: string;
  };

  async authenticate(credentials: { code: string }): Promise<AuthResult> {
    // 使用 Auth0 SDK
    const auth0 = new Auth0Client({
      domain: this.config.domain,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });

    // 交换令牌
    const tokenSet = await auth0.exchangeCode(credentials.code);

    // 获取用户信息
    const userInfo = await auth0.getUserInfo(tokenSet.access_token);

    // 查找或创建用户
    const user = await this.findOrCreateUser(userInfo);

    // 生成 JWT
    return this.generateToken(user);
  }
}
```

#### 12.4.2 Keycloak 集成

```typescript
class KeycloakProvider implements AuthProvider {
  name = 'keycloak';
  type = 'oidc' as const;
  enabled: boolean;

  private config: {
    realm: string;
    clientId: string;
    clientSecret: string;
    serverUrl: string;
  };

  async authenticate(credentials: { code: string }): Promise<AuthResult> {
    // 使用 Keycloak SDK
    const keycloak = new KeycloakClient({
      realm: this.config.realm,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      serverUrl: this.config.serverUrl,
    });

    // 交换令牌
    const tokenSet = await keycloak.exchangeCode(credentials.code);

    // 获取用户信息
    const userInfo = await keycloak.getUserInfo(tokenSet.access_token);

    // 查找或创建用户
    const user = await this.findOrCreateUser(userInfo);

    // 生成 JWT
    return this.generateToken(user);
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

### 12.8 RBAC 权限更新传播机制

当角色权限发生变更时，需要确保所有受影响用户的会话立即失效，避免权限提升或越权访问。

**核心机制：`token_version` 递增 + Redis Pub/Sub 多实例传播**

```typescript
// 用户表新增字段
interface User {
  id: string;
  email: string;
  tokenVersion: number; // 每次权限变更递增
  tokenVersionUpdatedAt: Date; // 递增时间戳
}

// 角色-权限关联表
interface RolePermission {
  roleId: string;
  permissionId: string;
  assignedAt: Date;
}

// RBAC 传播管理器
class RBACPropagationManager {
  constructor(
    private db: Database,
    private redis: Redis,
    private pubsub: RedisPubSub,
  ) {}

  // 角色权限变更时调用
  async onRolePermissionChanged(roleId: string): Promise<void> {
    // 1. 查询受影响的用户列表
    const affectedUserIds = await this.db.query(
      `
      SELECT DISTINCT u.id
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = $1
    `,
      [roleId],
    );

    // 2. 批量递增 token_version
    await this.db.query(
      `
      UPDATE users
      SET token_version = token_version + 1,
          token_version_updated_at = NOW()
      WHERE id = ANY($1)
    `,
      [affectedUserIds],
    );

    // 3. 清除受影响用户的 Redis 缓存
    const pipeline = this.redis.pipeline();
    for (const userId of affectedUserIds) {
      pipeline.del(`session:${userId}`);
      pipeline.del(`permissions:${userId}`);
    }
    await pipeline.exec();

    // 4. 通过 Pub/Sub 通知所有实例
    await this.pubsub.publish('rbac:invalidation', {
      roleId,
      affectedUserIds,
      timestamp: Date.now(),
    });
  }

  // 每个实例订阅频道，清除本地权限缓存
  subscribeInvalidation(): void {
    this.pubsub.subscribe('rbac:invalidation', async (message) => {
      const { affectedUserIds } = message;
      for (const userId of affectedUserIds) {
        await this.invalidateLocalPermissionCache(userId);
      }
    });
  }
}

// JWT 校验时检查 token_version
async function verifyToken(token: string, db: Database): Promise<UserContext> {
  const payload = jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });

  // 查询当前 token_version
  const user = await db.query('SELECT token_version FROM users WHERE id = $1', [payload.sub]);

  // 版本不匹配 → 拒绝（权限已变更）
  if (user.tokenVersion !== payload.tokenVersion) {
    throw new TokenVersionMismatchError('Token invalidated by RBAC change');
  }

  return payload as UserContext;
}
```

**配置示例**：

```yaml
auth:
  rbacPropagation:
    enabled: true
    # Redis Pub/Sub 频道名
    channel: 'rbac:invalidation'
    # 本地权限缓存 TTL（秒），作为安全兜底
    localCacheTTL: 300
    # 批量递增批量大小
    batchSize: 1000
```

**触发场景**：

| 操作                  | 触发方式                    | 影响范围               |
| --------------------- | --------------------------- | ---------------------- |
| 修改角色权限（增/删） | `onRolePermissionChanged`   | 该角色下所有用户       |
| 用户角色分配/撤销     | `onUserRoleChanged`         | 该用户                 |
| 角色继承关系变更      | `onRoleHierarchyChanged`    | 继承链下所有角色的用户 |
| 批量权限迁移          | `onBulkPermissionMigration` | 全量用户               |

---

### 12.9 MFA 可信设备机制

多因素认证的可信设备机制允许用户在信任的设备上跳过二次验证，提升用户体验的同时保持安全性。

**核心机制：设备指纹 + 可信设备存储 + 30 天信任窗口**

```typescript
// 设备指纹采集
interface DeviceFingerprint {
  userAgent: string; // 浏览器 UA
  screenResolution: string; // 屏幕分辨率
  timezone: string; // 时区
  language: string; // 语言偏好
  platform: string; // 操作系统平台
  hardwareConcurrency: number; // CPU 核心数
  deviceMemory: number; // 设备内存
  canvasHash: string; // Canvas 指纹哈希
  webglHash: string; // WebGL 指纹哈希
}

// 设备指纹生成（客户端）
function generateDeviceFingerprint(): string {
  const fp: DeviceFingerprint = {
    userAgent: navigator.userAgent,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory || 0,
    canvasHash: getCanvasFingerprintHash(),
    webglHash: getWebGLFingerprintHash(),
  };

  // 哈希合并指纹
  return sha256(JSON.stringify(fp));
}

// 可信设备表
interface TrustedDevice {
  id: string;
  userId: string;
  deviceFingerprint: string; // 设备指纹哈希
  deviceName: string; // 用户可读名称
  trustGrantedAt: Date; // 信任授权时间
  trustExpiresAt: Date; // 信任过期时间
  lastUsedAt: Date; // 最后使用时间
  ipAddress: string; // 授权时 IP
  userAgent: string; // 授权时 UA
  revoked: boolean; // 是否已撤销
}

// 可信设备管理器
class TrustedDeviceManager {
  private config: {
    trustWindowDays: number; // 信任窗口（默认 30 天）
    maxTrustedDevices: number; // 最大可信设备数（默认 10）
    requireMfaToTrust: boolean; // 信任设备时需通过 MFA
  };

  // 检查设备是否可信
  async isTrustedDevice(userId: string, deviceFingerprint: string): Promise<boolean> {
    const device = await this.db.queryOne(
      `
      SELECT * FROM trusted_devices
      WHERE user_id = $1
        AND device_fingerprint = $2
        AND revoked = false
        AND trust_expires_at > NOW()
    `,
      [userId, deviceFingerprint],
    );

    if (device) {
      // 更新最后使用时间
      await this.db.query(
        `
        UPDATE trusted_devices
        SET last_used_at = NOW()
        WHERE id = $1
      `,
        [device.id],
      );
      return true;
    }
    return false;
  }

  // 信任当前设备
  async trustDevice(
    userId: string,
    deviceFingerprint: string,
    metadata: {
      deviceName: string;
      ipAddress: string;
      userAgent: string;
    },
  ): Promise<TrustedDevice> {
    // 检查设备数量上限
    const count = await this.db.queryOne(
      'SELECT COUNT(*) as count FROM trusted_devices WHERE user_id = $1 AND revoked = false',
      [userId],
    );
    if (count >= this.config.maxTrustedDevices) {
      throw new TooManyTrustedDevicesError(this.config.maxTrustedDevices);
    }

    // 创建可信设备记录
    return this.db.insert('trusted_devices', {
      userId,
      deviceFingerprint,
      deviceName: metadata.deviceName,
      trustGrantedAt: new Date(),
      trustExpiresAt: addDays(new Date(), this.config.trustWindowDays),
      lastUsedAt: new Date(),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      revoked: false,
    });
  }

  // 撤销单个设备
  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await this.db.query(
      `
      UPDATE trusted_devices
      SET revoked = true
      WHERE id = $1 AND user_id = $2
    `,
      [deviceId, userId],
    );
  }

  // 撤销所有可信设备（安全事件时使用）
  async revokeAllDevices(userId: string): Promise<number> {
    const result = await this.db.query(
      `
      UPDATE trusted_devices
      SET revoked = true
      WHERE user_id = $1 AND revoked = false
    `,
      [userId],
    );
    // 同时递增 tokenVersion 强制重新认证
    await this.db.query(
      `
      UPDATE users
      SET token_version = token_version + 1
      WHERE id = $1
    `,
      [userId],
    );
    return result.rowCount;
  }
}

// MFA 认证流程集成
async function mfaAuthenticationFlow(
  userId: string,
  deviceFingerprint: string,
  mfaManager: MfaManager,
  trustedDeviceManager: TrustedDeviceManager,
): Promise<void> {
  // 1. 检查设备是否可信
  const isTrusted = await trustedDeviceManager.isTrustedDevice(userId, deviceFingerprint);

  if (isTrusted) {
    // 可信设备 → 跳过 MFA
    return;
  }

  // 2. 不可信设备 → 要求 MFA
  const mfaResult = await mfaManager.verify(userId);

  // 3. MFA 通过后，询问是否信任此设备
  if (mfaResult.success) {
    // 前端弹出「是否信任此设备？」对话框
    // 用户确认后调用 trustDevice
  }
}
```

**配置示例**：

```yaml
auth:
  mfa:
    trustedDevices:
      enabled: true
      trustWindowDays: 30 # 信任窗口 30 天
      maxTrustedDevices: 10 # 每用户最多 10 个可信设备
      requireMfaToTrust: true # 信任设备前需通过 MFA
      deviceFingerprint:
        collectCanvas: true # 采集 Canvas 指纹
        collectWebGL: true # 采集 WebGL 指纹
        collectAudioContext: false # 不采集音频指纹
```

**前端交互流程**：

```
用户登录（密码通过）
    ↓
检查设备是否可信
    ├─ 可信 → 直接进入系统
    └─ 不可信 → 触发 MFA 验证
           ↓
        MFA 验证通过
           ↓
        弹窗：「是否信任此设备？」
        ├─ 是 → 存储可信设备（30 天）→ 进入系统
        └─ 否 → 进入系统（下次仍需 MFA）
```

---

### 12.10 SSO 会话生命周期

单点登录（SSO）会话与本地应用会话之间存在依赖关系，需明确管理两者的生命周期以确保安全性和用户体验。

**核心概念：SSO 会话 vs 本地会话**

```typescript
// 会话类型定义
interface SSOSession {
  id: string; // SSO 会话 ID
  userId: string; // 用户 ID
  identityProviderId: string; // 身份提供商 ID（如 SAML IdP、OIDC Provider）
  createdAt: Date; // 创建时间
  lastActivityAt: Date; // 最后活动时间
  idleTimeout: number; // 空闲超时（秒）
  absoluteTimeout: number; // 绝对超时（秒）
  expiresAt: Date; // 过期时间（基于绝对超时）
  status: 'active' | 'expired' | 'revoked';
}

interface LocalSession {
  id: string; // 本地会话 ID
  userId: string;
  ssoSessionId: string; // 关联的 SSO 会话 ID
  tenantId: string; // 租户 ID
  createdAt: Date;
  lastActivityAt: Date;
  idleTimeout: number; // 本地空闲超时（可与 SSO 不同）
  absoluteTimeout: number; // 本地绝对超时
  expiresAt: Date;
  status: 'active' | 'expired' | 'revoked';
}

// SSO 会话管理器
class SSOSessionManager {
  private config: {
    defaultIdleTimeout: number; // 默认空闲超时（秒），如 1800（30 分钟）
    defaultAbsoluteTimeout: number; // 默认绝对超时（秒），如 28800（8 小时）
    maxSessionsPerUser: number; // 最大并发会话数
    singleLogoutEnabled: boolean; // 是否启用单点登出（SLO）
  };

  // 创建 SSO 会话
  async createSSOSession(userId: string, idpId: string): Promise<SSOSession> {
    const now = new Date();
    return this.db.insert('sso_sessions', {
      userId,
      identityProviderId: idpId,
      createdAt: now,
      lastActivityAt: now,
      idleTimeout: this.config.defaultIdleTimeout,
      absoluteTimeout: this.config.defaultAbsoluteTimeout,
      expiresAt: addSeconds(now, this.config.defaultAbsoluteTimeout),
      status: 'active',
    });
  }

  // 创建本地会话（绑定 SSO 会话）
  async createLocalSession(
    userId: string,
    ssoSessionId: string,
    tenantId: string,
  ): Promise<LocalSession> {
    const ssoSession = await this.getSSOSession(ssoSessionId);
    if (!ssoSession || ssoSession.status !== 'active') {
      throw new SSOSessionExpiredError();
    }

    const now = new Date();
    // 本地会话不能超过 SSO 会话过期时间
    const localExpiresAt = minDate(
      addSeconds(now, this.config.defaultIdleTimeout),
      ssoSession.expiresAt,
    );

    return this.db.insert('local_sessions', {
      userId,
      ssoSessionId,
      tenantId,
      createdAt: now,
      lastActivityAt: now,
      idleTimeout: this.config.defaultIdleTimeout,
      absoluteTimeout: this.config.defaultAbsoluteTimeout,
      expiresAt: localExpiresAt,
      status: 'active',
    });
  }

  // 校验会话有效性
  async validateSession(localSessionId: string): Promise<{ valid: boolean; reason?: string }> {
    const session = await this.getLocalSession(localSessionId);
    if (!session) return { valid: false, reason: 'session_not_found' };

    const now = new Date();

    // 检查本地会话空闲超时
    const idleExpiry = addSeconds(session.lastActivityAt, session.idleTimeout);
    if (now > idleExpiry) {
      await this.expireLocalSession(session.id, 'idle_timeout');
      return { valid: false, reason: 'idle_timeout' };
    }

    // 检查本地会话绝对超时
    if (now > session.expiresAt) {
      await this.expireLocalSession(session.id, 'absolute_timeout');
      return { valid: false, reason: 'absolute_timeout' };
    }

    // 检查 SSO 会话是否仍然有效
    const ssoSession = await this.getSSOSession(session.ssoSessionId);
    if (!ssoSession || ssoSession.status !== 'active') {
      await this.expireLocalSession(session.id, 'sso_session_expired');
      return { valid: false, reason: 'sso_session_expired' };
    }

    // 检查 SSO 会话空闲超时
    const ssoIdleExpiry = addSeconds(ssoSession.lastActivityAt, ssoSession.idleTimeout);
    if (now > ssoIdleExpiry) {
      await this.expireSSOSession(ssoSession.id, 'idle_timeout');
      return { valid: false, reason: 'sso_idle_timeout' };
    }

    // 更新最后活动时间
    await this.touchSession(localSessionId);
    return { valid: true };
  }

  // 单点登出（SLO）
  async singleLogout(userId: string, ssoSessionId: string): Promise<void> {
    if (!this.config.singleLogoutEnabled) return;

    // 1. 撤销 SSO 会话
    await this.expireSSOSession(ssoSessionId, 'user_logout');

    // 2. 撤销所有关联的本地会话
    await this.db.query(
      `
      UPDATE local_sessions
      SET status = 'revoked'
      WHERE sso_session_id = $1 AND status = 'active'
    `,
      [ssoSessionId],
    );

    // 3. 向 IdP 发送登出请求（SAML Logout / OIDC RP-Initiated Logout）
    const ssoSession = await this.getSSOSession(ssoSessionId);
    await this.notifyIdPLogout(ssoSession.identityProviderId, userId);

    // 4. 清除 Redis 中的所有会话缓存
    await this.redis.del(`session:${userId}:*`);
  }

  // 向 IdP 发送登出通知
  private async notifyIdPLogout(idpId: string, userId: string): Promise<void> {
    const idp = await this.getIdentityProvider(idpId);
    switch (idp.protocol) {
      case 'saml':
        // SAML Single Logout (SLO)
        await this.samlClient.sendLogoutRequest(idp, userId);
        break;
      case 'oidc':
        // OIDC RP-Initiated Logout
        await this.oidcClient.endSession(idp, userId);
        break;
    }
  }
}
```

**会话生命周期关系图**：

```
┌──────────────────────────────────────────────────────────────┐
│                      SSO 会话 (Identity Provider)            │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  创建时间: 2026-08-21 09:00                          │    │
│  │  空闲超时: 30 分钟                                    │    │
│  │  绝对超时: 8 小时                                     │    │
│  │  过期时间: 2026-08-21 17:00                          │    │
│  └──────────────────────────────────────────────────────┘    │
│                          │                                    │
│        ┌─────────────────┼─────────────────┐                 │
│        ▼                 ▼                 ▼                 │
│  ┌──────────┐     ┌──────────┐      ┌──────────┐            │
│  │ 本地会话  │     │ 本地会话  │      │ 本地会话  │            │
│  │ 租户 A   │     │ 租户 B   │      │ 租户 C   │            │
│  │ 空闲 30m │     │ 空闲 30m │      │ 空闲 30m │            │
│  └──────────┘     └──────────┘      └──────────┘            │
│                                                              │
│  规则：本地会话 ≤ SSO 会话（不能超过 SSO 绝对过期时间）       │
└──────────────────────────────────────────────────────────────┘
```

**超时策略**：

| 参数         | 默认值         | 说明                                                |
| ------------ | -------------- | --------------------------------------------------- |
| SSO 空闲超时 | 30 分钟        | 用户无操作后 SSO 会话过期，所有关联本地会话同步失效 |
| SSO 绝对超时 | 8 小时         | SSO 会话最长存活时间，无论是否有活动                |
| 本地空闲超时 | 30 分钟        | 本地应用无操作后会话过期（可独立于 SSO 配置）       |
| 本地绝对超时 | ≤ SSO 绝对超时 | 本地会话不能超过 SSO 会话过期时间                   |
| 最大并发会话 | 10             | 每用户最大同时活跃会话数                            |

**单点登出（SLO）流程**：

```
用户在应用 A 中点击「退出」
    ↓
应用 A 调用 SSO Session Manager → singleLogout()
    ↓
┌─ 撤销 SSO 会话（status = revoked）
│
├─ 撤销所有关联本地会话（应用 A/B/C 的会话全部失效）
│
├─ 向 IdP 发送登出请求
│  ├─ SAML: 发送 SAML Logout Request
│  └─ OIDC: 发起 RP-Initiated Logout
│
└─ 清除 Redis 会话缓存
    ↓
所有应用的会话在下一次请求时校验失败 → 跳转到登录页
```

**配置示例**：

```yaml
auth:
  sso:
    session:
      idleTimeout: 1800 # 30 分钟（秒）
      absoluteTimeout: 28800 # 8 小时（秒）
      maxSessionsPerUser: 10
      singleLogoutEnabled: true
      # 租户级别可覆盖
      tenantOverrides:
        high-security:
          idleTimeout: 900 # 高安全租户 15 分钟
          absoluteTimeout: 14400 # 4 小时
```
