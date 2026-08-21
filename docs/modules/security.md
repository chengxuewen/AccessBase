# 网络信息安全

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§19 网络信息安全 + §25 安全加固 + §29 安全加固 P1 + §36 安全补充 P2

---

## 19. 网络信息安全

### 19.1 安全威胁分析

| 威胁类型 | 攻击方式 | 影响 | 防御措施 |
|---------|---------|------|---------|
| **XSS** | 注入恶意脚本 | 窃取 Cookie、会话劫持 | 输入验证、输出编码、CSP |
| **CSRF** | 伪造请求 | 执行未授权操作 | CSRF Token、SameSite Cookie |
| **SQL 注入** | 注入 SQL 代码 | 数据泄露、数据篡改 | 参数化查询、ORM |
| **DDoS** | 流量攻击 | 服务不可用 | 限流、CDN、WAF |
| **暴力破解** | 密码猜测 | 账户被攻破 | 限流、账户锁定、验证码 |
| **中间人攻击** | 窃听通信 | 数据泄露 | HTTPS、证书固定 |
| **会话劫持** | 窃取会话 ID | 冒充用户 | HttpOnly Cookie、会话管理 |

### 19.2 传输安全

#### 19.2.1 HTTPS 配置

```typescript
const httpsOptions = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt'),
  ca: fs.readFileSync('ca.crt'),
  
  // TLS 版本
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  
  // 加密套件
  ciphers: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256'
  ].join(':')
}
```

#### 19.2.2 HSTS 配置

```typescript
fastify.register(helmet, {
  hsts: {
    maxAge: 31536000,  // 1 年
    includeSubDomains: true,
    preload: true
  }
})
```

### 19.3 防 XSS 攻击

#### 19.3.1 输入验证

```typescript
import { z } from 'zod'

const userInputSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_\-\s]+$/),
  email: z.string().email(),
  content: z.string().max(1000).refine(
    (val) => !/<script|javascript:|on\w+=/i.test(val),
    { message: 'Invalid content' }
  )
})
```

#### 19.3.2 输出编码

```typescript
import { escape } from 'html-escaper'

function encodeOutput(data: any): any {
  if (typeof data === 'string') {
    return escape(data)
  }
  
  if (Array.isArray(data)) {
    return data.map(encodeOutput)
  }
  
  if (typeof data === 'object' && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, encodeOutput(value)])
    )
  }
  
  return data
}
```

#### 19.3.3 CSP 配置

```typescript
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.example.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
})
```

### 19.4 防 CSRF 攻击

#### 19.4.1 CSRF Token

```typescript
import crypto from 'crypto'

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

fastify.addHook('preHandler', async (request, reply) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const token = request.headers['x-csrf-token'] || request.body?._csrf
    const sessionToken = request.session?.csrfToken
    
    if (!token || !sessionToken || token !== sessionToken) {
      return reply.status(403).send({ error: 'Invalid CSRF token' })
    }
  }
})
```

#### 19.4.2 SameSite Cookie

```typescript
fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET,
  parseOptions: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7  // 7 天
  }
})
```

### 19.5 防 SQL 注入

#### 19.5.1 参数化查询

```typescript
// Drizzle ORM 参数化查询
import { sql } from 'drizzle-orm'

// 正确：参数化查询
const users = await db.select().from(usersTable).where(
  eq(usersTable.email, email)
)

// 错误：字符串拼接（SQL 注入风险）
// const users = await db.query(`SELECT * FROM users WHERE email = '${email}'`)
```

### 19.6 防 DDoS 攻击

#### 19.6.1 限流配置

```typescript
fastify.register(rateLimit, {
  max: 100,  // 最大请求数
  timeWindow: '1 minute',  // 时间窗口
  
  keyGenerator: (request) => {
    return request.ip
  },
  
  errorResponseBuilder: (request, context) => {
    return {
      code: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${context.after}`,
      retryAfter: context.after
    }
  }
})
```

#### 19.6.2 IP 黑名单

```typescript
class IPBlacklist {
  private blacklist: Set<string> = new Set()
  
  async add(ip: string, duration: number = 3600): Promise<void> {
    this.blacklist.add(ip)
    
    setTimeout(() => {
      this.blacklist.delete(ip)
    }, duration * 1000)
  }
  
  async has(ip: string): Promise<boolean> {
    return this.blacklist.has(ip)
  }
}

fastify.addHook('preHandler', async (request, reply) => {
  if (await ipBlacklist.has(request.ip)) {
    return reply.status(403).send({ error: 'IP blocked' })
  }
})
```

### 19.7 防暴力破解

#### 19.7.1 账户锁定

```typescript
class AccountLockout {
  private attempts: Map<string, { count: number; lastAttempt: Date }> = new Map()
  
  async check(email: string): Promise<boolean> {
    const record = this.attempts.get(email)
    
    if (!record) return true
    
    if (record.count >= 5) {
      const lockoutTime = 15 * 60 * 1000  // 15 分钟
      if (Date.now() - record.lastAttempt.getTime() < lockoutTime) {
        return false  // 已锁定
      }
      
      this.attempts.delete(email)
      return true
    }
    
    return true
  }
  
  async recordAttempt(email: string): Promise<void> {
    const record = this.attempts.get(email)
    
    if (record) {
      record.count++
      record.lastAttempt = new Date()
    } else {
      this.attempts.set(email, { count: 1, lastAttempt: new Date() })
    }
  }
}
```

### 19.8 数据加密

#### 19.8.1 AES-256-GCM 加密

```typescript
import crypto from 'crypto'

class Encryption {
  private algorithm = 'aes-256-gcm'
  private key: Buffer
  
  constructor(secret: string) {
    this.key = crypto.scryptSync(secret, 'salt', 32)
  }
  
  encrypt(text: string): string {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv)
    
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    
    const authTag = cipher.getAuthTag()
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
  }
  
  decrypt(encryptedText: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':')
    
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv)
    decipher.setAuthTag(authTag)
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  }
}
```

#### 19.8.2 密码哈希

```typescript
import bcrypt from 'bcrypt'

class PasswordHasher {
  private saltRounds = 12
  
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds)
  }
  
  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
  }
}
```

### 19.9 安全头配置

```typescript
fastify.register(helmet, {
  // XSS 防护
  xssFilter: true,
  
  // MIME 类型嗅探
  noSniff: true,
  
  // 点击劫持防护
  frameguard: { action: 'deny' },
  
  // HSTS
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  
  // CSP
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  
  // 引用策略
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  
  // 权限策略
  permissionsPolicy: {
    features: {
      geolocation: ["'none'"],
      camera: ["'none'"],
      microphone: ["'none'"],
      payment: ["'none'"]
    }
  }
})
```

### 19.10 配置示例

```yaml
# config.yaml
security:
  # HTTPS
  https:
    enabled: true
    port: 443
    min_version: TLSv1.2
    max_version: TLSv1.3
  
  # HSTS
  hsts:
    enabled: true
    max_age: 31536000
    include_subdomains: true
    preload: true
  
  # CSP
  csp:
    enabled: true
    directives:
      default_src: ["'self'"]
      script_src: ["'self'"]
      style_src: ["'self'", "'unsafe-inline'"]
      img_src: ["'self'", "data:", "https:"]
  
  # CSRF
  csrf:
    enabled: true
    token_name: _csrf
    cookie:
      http_only: true
      secure: true
      same_site: strict
  
  # XSS
  xss:
    enabled: true
    input_validation: true
    output_encoding: true
    xss_filter: true
  
  # SQL 注入
  sql_injection:
    enabled: true
    parameterized_queries: true
    orm: drizzle
  
  # DDoS 防护
  ddos:
    enabled: true
    rate_limit:
      max: 100
      window: 60
    ip_blacklist:
      enabled: true
      duration: 3600
  
  # 暴力破解防护
  brute_force:
    enabled: true
    max_attempts: 5
    lockout_duration: 900
    captcha:
      enabled: true
      threshold: 3
  
  # 数据加密
  encryption:
    enabled: true
    algorithm: aes-256-gcm
    key: ${ENCRYPTION_SECRET}
  
  # 密码策略
  password:
    min_length: 8
    require_uppercase: true
    require_lowercase: true
    require_numbers: true
    require_special_chars: false
    max_age: 90
    history_count: 5
```

---

## 25. 安全加固

### 25.1 CSP 配置修复

```typescript
// 修复：使用 nonce 替代 unsafe-inline
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
})

// nonce 生成中间件
fastify.addHook('onRequest', async (request, reply) => {
  reply.locals.nonce = crypto.randomBytes(16).toString('base64')
})
```

### 25.2 OAuth State + PKCE

```typescript
// OAuth state 参数（防 CSRF）
function generateOAuthState(): string {
  const state = crypto.randomBytes(32).toString('hex')
  // 存储到 session
  return state
}

function verifyOAuthState(receivedState: string, sessionState: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(receivedState),
    Buffer.from(sessionState)
  )
}

// PKCE（防授权码拦截）
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

// OAuth 授权 URL
const authUrl = `${provider.authorizationUrl}?` + new URLSearchParams({
  client_id: config.clientId,
  redirect_uri: config.callbackUrl,
  response_type: 'code',
  scope: config.scopes.join(' '),
  state: generateOAuthState(),
  code_challenge: pkce.codeChallenge,
  code_challenge_method: 'S256'
})
```

### 25.3 MFA 框架（TOTP）

```typescript
import { authenticator } from 'otplib'

// MFA 管理器
class MFAManager {
  // 生成 MFA 密钥
  generateSecret(userId: string): { secret: string; otpauth: string } {
    const secret = authenticator.generateSecret()
    const otpauth = authenticator.keyuri(userId, 'AccessBase', secret)
    return { secret, otpauth }
  }
  
  // 验证 TOTP 令牌
  verify(secret: string, token: string): boolean {
    return authenticator.verify({ token, secret })
  }
  
  // 生成恢复码
  generateRecoveryCodes(count: number = 8): string[] {
    return Array.from({ length: count }, () => 
      crypto.randomBytes(4).toString('hex').toUpperCase()
    )
  }
  
  // 验证恢复码
  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codes = await this.getRecoveryCodes(userId)
    const matched = codes.find(c => !c.used && c.codeHash === hashRecoveryCode(code))
    
    if (matched) {
      await this.markRecoveryCodeUsed(matched.id)
      return true
    }
    return false
  }
}

// MFA API
fastify.post('/api/v1/auth/mfa/enable', {
  preHandler: [authenticate]
}, async (request, reply) => {
  const { secret, otpauth } = mfaManager.generateSecret(request.user.id)
  const recoveryCodes = mfaManager.generateRecoveryCodes()
  
  // 暂存密钥（待验证后正式启用）
  await redis.set(`mfa:pending:${request.user.id}`, secret, 'EX', 300)
  
  return reply.send({
    secret,
    qrCode: otpauth,
    recoveryCodes
  })
})

fastify.post('/api/v1/auth/mfa/verify', {
  preHandler: [authenticate]
}, async (request, reply) => {
  const { token } = request.body
  const secret = await redis.get(`mfa:pending:${request.user.id}`)
  
  if (!secret || !mfaManager.verify(secret, token)) {
    return reply.status(400).send({ error: 'MFA_001', message: '无效的 MFA 令牌' })
  }
  
  // 正式启用 MFA
  await db.update(usersTable)
    .set({ mfaEnabled: true, mfaSecret: encrypt(secret) })
    .where(eq(usersTable.id, request.user.id))
  
  return reply.send({ success: true })
})
```

### 25.4 Refresh Token 持久化

```typescript
// Refresh Token 存储到数据库（而非仅 Redis）
class SessionManager {
  async createSession(userId: string, deviceInfo: DeviceInfo): Promise<SessionTokens> {
    const accessToken = this.generateAccessToken(userId)
    const refreshToken = this.generateRefreshToken(userId)
    
    // 持久化到数据库
    await db.insert(sessionsTable).values({
      userId,
      refreshTokenHash: await bcrypt.hash(refreshToken, 10),
      deviceInfo,
      ipAddress: deviceInfo.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)  // 7 天
    })
    
    // 同时缓存到 Redis（快速验证）
    await redis.set(`session:${refreshToken}`, userId, 'EX', 7 * 24 * 60 * 60)
    
    return { accessToken, refreshToken }
  }
  
  async refreshSession(refreshToken: string): Promise<SessionTokens> {
    // 先查 Redis
    const userId = await redis.get(`session:${refreshToken}`)
    
    if (!userId) {
      // Redis 未命中，查数据库
      const session = await db.select()
        .from(sessionsTable)
        .where(and(
          eq(sessionsTable.revokedAt, null),
          gt(sessionsTable.expiresAt, new Date())
        ))
        .limit(1)
      
      if (!session || !await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        throw new AppError('AUTH_002', 'Refresh token 无效或已过期')
      }
    }
    
    // 生成新 token（轮转）
    const newTokens = await this.createSession(userId, deviceInfo)
    
    // 撤销旧 token
    await this.revokeSession(refreshToken)
    
    return newTokens
  }
  
  async revokeSession(refreshToken: string): Promise<void> {
    await redis.del(`session:${refreshToken}`)
    await db.update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(sessionsTable.refreshTokenHash, await bcrypt.hash(refreshToken, 10)))
  }
  
  // 撤销用户所有会话（密码重置时调用）
  async revokeAllSessions(userId: string): Promise<void> {
    const sessions = await db.select()
      .from(sessionsTable)
      .where(and(
        eq(sessionsTable.userId, userId),
        eq(sessionsTable.revokedAt, null)
      ))
    
    for (const session of sessions) {
      await redis.del(`session:${session.id}`)
    }
    
    await db.update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(sessionsTable.userId, userId))
  }
}
```

### 25.5 JWT 签名算法

```typescript
// 明确指定 RS256（非对称加密）
import jwt from 'jsonwebtoken'

const JWT_ALGORITHM = 'RS256'  // 明确指定，防止算法混淆攻击

// 签发令牌
function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: JWT_ALGORITHM,
    expiresIn: '15m',
    issuer: 'accessbase',
    audience: 'api'
  })
}

// 验证令牌
function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: [JWT_ALGORITHM],  // 明确指定允许的算法
    issuer: 'accessbase',
    audience: 'api'
  }) as TokenPayload
}
```

---

## 29. 安全加固 P1

### 29.1 账户锁定持久化

```typescript
// 账户锁定持久化到 Redis（而非内存）
class PersistentAccountLockout {
  constructor(private redis: Redis) {}
  
  async check(email: string): Promise<{ allowed: boolean; remainingAttempts: number; lockoutEndsAt?: Date }> {
    const key = `lockout:${email}`
    const data = await this.redis.get(key)
    
    if (!data) {
      return { allowed: true, remainingAttempts: 5 }
    }
    
    const { count, lastAttempt } = JSON.parse(data)
    
    if (count >= 5) {
      const lockoutEndsAt = new Date(lastAttempt + 15 * 60 * 1000)
      if (new Date() < lockoutEndsAt) {
        return { allowed: false, remainingAttempts: 0, lockoutEndsAt }
      }
      // 锁定已过期，重置
      await this.redis.del(key)
      return { allowed: true, remainingAttempts: 5 }
    }
    
    return { allowed: true, remainingAttempts: 5 - count }
  }
  
  async recordAttempt(email: string): Promise<void> {
    const key = `lockout:${email}`
    const data = await this.redis.get(key)
    
    if (data) {
      const { count } = JSON.parse(data)
      await this.redis.set(key, JSON.stringify({
        count: count + 1,
        lastAttempt: Date.now()
      }), 'EX', 900)  // 15 分钟过期
    } else {
      await this.redis.set(key, JSON.stringify({
        count: 1,
        lastAttempt: Date.now()
      }), 'EX', 900)
    }
  }
  
  async reset(email: string): Promise<void> {
    await this.redis.del(`lockout:${email}`)
  }
}
```

### 29.2 IP 黑名单持久化

```typescript
// IP 黑名单持久化到 Redis
class PersistentIPBlacklist {
  constructor(private redis: Redis) {}
  
  async add(ip: string, duration: number = 3600, reason: string = ''): Promise<void> {
    await this.redis.set(`blacklist:${ip}`, JSON.stringify({
      reason,
      addedAt: Date.now()
    }), 'EX', duration)
  }
  
  async has(ip: string): Promise<boolean> {
    const result = await this.redis.exists(`blacklist:${ip}`)
    return result === 1
  }
  
  async remove(ip: string): Promise<void> {
    await this.redis.del(`blacklist:${ip}`)
  }
}
```

### 29.3 登录端点限速

```typescript
// 登录端点专用限速（更严格）
fastify.register(rateLimit, {
  max: 10,  // 每分钟最多 10 次登录尝试
  timeWindow: '1 minute',
  keyGenerator: (request) => request.ip,
  skipOnError: false,
  skipSuccessfulRequests: false
})

// 密码重置端点限速
fastify.register(rateLimit, {
  max: 5,  // 每小时最多 5 次密码重置
  timeWindow: '1 hour',
  keyGenerator: (request) => request.body?.email || request.ip
})
```

### 29.4 账户枚举防护

```typescript
// 统一错误消息，防止账户枚举
fastify.post('/api/v1/auth/login', async (request, reply) => {
  const { email, password } = request.body
  
  const user = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1)
  
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    // 统一错误消息，不区分用户不存在和密码错误
    return reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_001',
        message: '邮箱或密码错误',  // 不说 '用户不存在'
        timestamp: new Date().toISOString(),
        requestId: request.id,
        path: request.url
      }
    })
  }
})
```

### 29.5 Redis 认证与加密

```yaml
# config.yaml
redis:
  host: ${REDIS_HOST:localhost}
  port: ${REDIS_PORT:6379}
  password: ${REDIS_PASSWORD}  # 必须设置密码
  tls:
    enabled: ${REDIS_TLS_ENABLED:false}
    cert: ${REDIS_TLS_CERT}
    key: ${REDIS_TLS_KEY}
    ca: ${REDIS_TLS_CA}
  db: 0
  keyPrefix: 'accessbase:'
```

### 29.6 PostgreSQL 复制密码安全

```yaml
# 使用环境变量，不硬编码
# docker-compose.yml
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_REPLICATION_USER: replicator
      POSTGRES_REPLICATION_PASSWORD: ${DB_REPLICATION_PASSWORD}

# 使用 K8s Secret
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
type: Opaque
data:
  password: <base64>
  replication-password: <base64>
```

---

## 36. 安全补充 P2

### 36.1 日志脱敏增强

```typescript
// 结构化日志脱敏
const logger = pino({
  redact: {
    paths: [
      // 请求头
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-csrf-token',
      // 请求体
      'req.body.password',
      'req.body.token',
      'req.body.secret',
      'req.body.credit_card',
      'req.body.api_key',
      // 响应体
      'res.body.data.token',
      'res.body.data.refresh_token',
      // 用户信息
      'user.mfa_secret',
      'user.password_hash'
    ],
    censor: '[REDACTED]'
  }
})

// 自定义脱敏函数
function sanitizeForLog(data: any): any {
  if (!data) return data
  
  const sensitiveFields = ['password', 'token', 'secret', 'api_key', 'credit_card']
  const sanitized = { ...data }
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]'
    }
  }
  
  return sanitized
}
```

### 36.2 密钥轮转策略

```typescript
// 密钥轮转管理器
class KeyRotationManager {
  // 轮转配置
  private config = {
    jwtKeyRotationDays: 90,
    encryptionKeyRotationDays: 90,
    oauthSecretRotationDays: 180
  }
  
  // 检查是否需要轮转
  async checkRotationNeeded(keyName: string): Promise<boolean> {
    const key = await this.getKey(keyName)
    const daysSinceRotation = (Date.now() - key.lastRotatedAt) / (1000 * 60 * 60 * 24)
    return daysSinceRotation >= this.config[`${keyName}RotationDays`]
  }
  
  // 轮转 JWT 密钥
  async rotateJwtKey(): Promise<void> {
    const newKeyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    
    // 保存新密钥
    await this.saveKey('jwt', newKeyPair)
    
    // 通知服务重启
    await this.notifyServiceRestart()
  }
}
```

### 36.3 CORS 配置

```typescript
// CORS 配置
fastify.register(cors, {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://example.com',
      'https://admin.example.com',
      'http://localhost:5173'  // 开发环境
    ]
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400  // 24 小时
})
```

### 36.4 WebAuthn 挑战时效

```typescript
// WebAuthn 挑战管理
class WebAuthnChallengeManager {
  private challengeTTL = 60 * 1000  // 1 分钟
  
  async createChallenge(userId: string): Promise<string> {
    const challenge = crypto.randomBytes(32)
    
    // 存储到 Redis（1 分钟过期）
    await this.redis.set(`webauthn:challenge:${userId}`, challenge.toString('hex'), 'EX', 60)
    
    return challenge.toString('base64url')
  }
  
  async verifyChallenge(userId: string, challenge: string): Promise<boolean> {
    const storedChallenge = await this.redis.get(`webauthn:challenge:${userId}`)
    
    if (!storedChallenge) {
      return false  // 挑战已过期
    }
    
    // 验证后立即删除（防止重放）
    await this.redis.del(`webauthn:challenge:${userId}`)
    
    return crypto.timingSafeEqual(
      Buffer.from(storedChallenge, 'hex'),
      Buffer.from(challenge, 'base64url')
    )
  }
}
```

### 36.5 许可证离线宽限期优化

```yaml
# config.yaml
license:
  validation:
    offline:
      enabled: true
      grace_period: 3  # 缩短为 3 天（原 7 天）
      # 首次验证必须在线
      require_first_online: true
      # 宽限期内定期尝试在线验证
      retry_interval: 3600  # 1 小时
```

---
