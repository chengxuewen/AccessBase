# 设置向导安全审查报告

> **审查人：** security-reviewer
> **日期：** 2026-08-25
> **范围：** `docs/modules/setup-api-plan.md` + `docs/modules/setup-ui-plan.md`

---

## 总评

**风险等级：🔴 高 — 有多个 CRITICAL/HIGH 级别问题必须在实现前修复。**

设置向导的核心问题是：它是一个特权操作（创建超级管理员），但计划中缺少几乎所有的安全防护层。以下是逐项审查结果。

---

## 1. 设置端点保护（SETUP ENDPOINT PROTECTION）

### 🔴 CRITICAL-1：设置完成后可被重复调用

**问题：** API 计划中 `POST /api/v1/setup/admin` 仅检查 `findByEmail(email)` 是否存在同邮箱用户。攻击者可以用**不同邮箱**再次调用，创建第二个管理员。

```typescript
// 当前计划的检查逻辑 — 只检查 email，不检查系统是否已初始化
const existingAdmin = await userManager.findByEmail(email);
if (existingAdmin) {
  return reply.status(400).send({ ... });
}
```

**修复方案：**
- 必须增加全局 `isInitialized` 标志（数据库中的 `system_config` 表或 Redis 键）
- `POST /setup/admin` 和 `POST /setup/config` 端点必须检查此标志，已初始化则返回 `410 Gone`
- 建议中间件层统一拦截：`if (isSetupComplete) → reject all /api/v1/setup/*` (除 GET /status)

### 🔴 CRITICAL-2：setup-guard 中间件在设置完成后不阻断

**问题：** `setupGuard` 仅在管理员不存在时阻断其他路由，但设置完成后，`/api/v1/setup/admin` 端点仍然暴露，可以被再次调用（见 CRITICAL-1）。

**修复方案：** setup-guard 需双向保护：
- 设置完成前：阻断非 setup 路由 ✅ 已有
- 设置完成后：阻断 setup 写入端点（`POST /setup/admin`, `POST /setup/config`）❌ 缺失

---

## 2. 重复初始化防护（RE-INITIALIZATION）

### 🔴 CRITICAL-3：UI 端缺少初始化后阻断

**问题：** UI 的 `SetupGuard` 和 `checkSetupStatus()` 只用于重定向到 `/setup`，但没有反向保护：已初始化的系统直接访问 `/setup` 路由不会被阻止。

**场景：** 攻击者直接访问 `https://target.com/setup`，如果后端未阻断，可以走完向导流程。

**修复方案：**
- 前端 `SetupGuard` 需要在 `needsSetup === false` 时重定向到登录页
- 后端必须作为最终防线（前端绕过容易）

---

## 3. 密码要求（PASSWORD REQUIREMENTS）

### 🟡 HIGH-1：后端密码验证不足

**问题：** 后端 schema 仅 `minLength: 8`，无复杂度要求。UI 端声称要求"大小写字母和数字"，但这是纯前端校验，可绕过。

```typescript
// 后端 schema — 仅检查长度
password: { type: 'string', minLength: 8 }
```

**修复方案：**
- 后端必须独立验证密码复杂度（不信任前端）
- 建议使用 Ajv 自定义关键字或在 handler 中添加验证：
  ```typescript
  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!PASSWORD_REGEX.test(password)) {
    return reply.status(400).send({ error: { code: 'WEAK_PASSWORD', ... } });
  }
  ```
- 考虑集成 zxcvbn 或类似库检查密码强度

### 🟡 HIGH-2：管理员邮箱硬编码

**问题：** `adminEmail` 硬编码为 `'admin@accessbase.local'`。虽然后端允许用户输入邮箱，但 `setupGuard` 检查的是硬编码邮箱。如果用户创建了不同邮箱的管理员，guard 的检查将失效。

**修复方案：** `setupGuard` 应检查 `isInitialized` 标志而非查找特定邮箱用户。

---

## 4. CSRF 保护

### 🔴 CRITICAL-4：设置端点无 CSRF 防护

**问题：** 计划中所有 setup 端点都是标准 POST 请求，无 CSRF token 验证。虽然项目安全设计文档（`security.md` §19.4）有 CSRF 方案，但**实际代码中未实现任何 CSRF 保护**。

设置向导特别容易受 CSRF 攻击，因为：
- 未初始化系统没有认证会话（无 cookie 中的 session token 可验证）
- 请求来自浏览器，天然携带 cookie

**修复方案：**
- 最低限度：setup 端点必须验证 `Origin` 或 `Referer` 头，确保请求来自同源
- 推荐：实现 `SameSite=Strict` cookie + 自定义 header 验证（`X-Setup-Token`）
- setup 令牌可从 `GET /setup/status` 返回，后续 POST 请求必须携带

---

## 5. 速率限制

### 🔴 CRITICAL-5：无任何速率限制

**问题：** 整个项目**没有任何速率限制实现**（grep 确认为零）。设置向导端点是攻击面最大的目标：

- `POST /setup/admin`：暴力破解管理员密码
- `POST /setup/config`：探测系统配置
- `GET /setup/status`：信息泄露（确认系统是否已部署）

**修复方案：**
- 必须在实现 setup API 前或同时实现速率限制
- 建议使用 `@fastify/rate-limit`：
  ```typescript
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });
  ```
- setup 端点的限制应更严格：`max: 5, timeWindow: '5 minutes'`
- 已初始化后，`POST /setup/*` 应完全拒绝（见 CRITICAL-1）

---

## 6. 其他安全问题

### 🟡 HIGH-3：敏感信息日志泄露

**问题：** setup API 计划中，配置保存端点将完整配置（含 SMTP 密码）写入日志：

```typescript
// setup-api-plan.md 第 394 行
logger.info({ config }, 'Setup configuration saved');
// config 包含 smtpPassword！
```

**修复方案：**
```typescript
const { smtpPassword: _, ...safeConfig } = config;
logger.info({ config: safeConfig }, 'Setup configuration saved');
```

### 🟡 HIGH-4：系统检查端点信息泄露

**问题：** UI 计划中 `GET /api/setup/checks` 返回数据库连接、Redis 连接、磁盘空间等信息。在未认证状态下暴露这些信息，有助于攻击者进行侦察。

**修复方案：**
- `checks` 端点应返回通过/失败状态，不暴露具体的错误信息、版本号、连接字符串
- 磁盘空间信息不应暴露具体的路径和容量

### 🟡 MEDIUM-1：UserManager 每次请求实例化

**问题：** 计划中每次请求都 `new UserManager()`，如果 UserManager 初始化时建立数据库连接池，可能导致连接泄露。

**修复方案：** 使用 Fastify 的依赖注入或装饰器模式，共享 UserManager 实例。

### 🟡 MEDIUM-2：`completeSetup` 端点未在后端计划中

**问题：** UI 计划中有 `POST /api/setup/complete` 端点（返回 accessToken + refreshToken），但后端 API 计划中**没有这个端点**。

**风险：** 实现时可能跳过认证逻辑，直接生成 token，缺少必要的安全检查。

**修复方案：** 后端计划必须补充此端点，且需要：
- 验证管理员已创建
- 验证配置已保存
- 使用标准的 JWT 签发流程
- 返回的 token 需要合理的过期时间

### 🟢 LOW-1：缺少审计日志

**问题：** 设置操作（创建管理员、保存配置）是高特权操作，应写入审计日志。当前仅有 `logger.info`，未使用 `@accessbase/audit` 包。

**修复方案：** 使用 audit logger 记录所有 setup 操作。

---

## 问题汇总

| ID | 严重度 | 问题 | 状态 |
|----|--------|------|------|
| C-1 | 🔴 CRITICAL | 设置完成后可重复创建管理员 | 必须修复 |
| C-2 | 🔴 CRITICAL | setup-guard 不阻断已完成系统的 setup 写入端点 | 必须修复 |
| C-3 | 🔴 CRITICAL | UI/后端缺少反向保护（已初始化后阻止访问 /setup） | 必须修复 |
| C-4 | 🔴 CRITICAL | 无 CSRF 防护 | 必须修复 |
| C-5 | 🔴 CRITICAL | 无速率限制 | 必须修复 |
| H-1 | 🟡 HIGH | 后端密码复杂度验证不足 | 应修复 |
| H-2 | 🟡 HIGH | 管理员邮箱硬编码导致 guard 检查失效 | 应修复 |
| H-3 | 🟡 HIGH | SMTP 密码写入日志 | 应修复 |
| H-4 | 🟡 HIGH | 系统检查端点信息泄露 | 应修复 |
| M-1 | 🟡 MEDIUM | UserManager 每请求实例化 | 建议修复 |
| M-2 | 🟡 MEDIUM | completeSetup 端点后端缺失 | 建议补充 |
| L-1 | 🟢 LOW | 缺少审计日志 | 建议补充 |

---

## 建议的修复优先级

**第一阶段（实现前必须）：**
1. 实现 `isInitialized` 全局标志 + 数据库支持
2. setup-guard 双向保护
3. 后端密码复杂度验证
4. 敏感信息日志脱敏

**第二阶段（实现同时）：**
5. 速率限制（`@fastify/rate-limit`）
6. CSRF 防护（Origin/Referer 验证）
7. 补充 `completeSetup` 后端端点

**第三阶段（实现后）：**
8. 审计日志集成
9. 系统检查端点信息最小化
