# 设置向导安全审查最终报告

**审查日期**: 2026-08-25  
**审查范围**: `docs/modules/setup-api-plan.md` 和 `docs/modules/setup-ui-plan.md`  
**审查人**: final-security-reviewer  
**总体结论**: ⚠️ **有条件通过 (CONDITIONAL PASS)**

---

## 审查项目总览

| #   | 审查项                     | 状态          | 说明                  |
| --- | -------------------------- | ------------- | --------------------- |
| 1   | CSRF 防护                  | ✅ 通过       | 完整的 token 机制     |
| 2   | 速率限制                   | ✅ 通过       | 全局 + 端点级别限制   |
| 3   | 密码强度要求               | ✅ 通过       | 前后端双重验证        |
| 4   | 设置端点防重复触发         | ✅ 通过       | 双向 guard + 410 Gone |
| 5   | Token 安全性（设置完成后） | ⚠️ 有条件通过 | 需补充 token 清理逻辑 |

---

## 详细审查

### 1. CSRF 防护 ✅ 通过

**实现方案**:

- `GET /api/v1/setup/status` 返回一次性 `setupToken`
- 所有 POST 端点必须在 `X-Setup-Token` header 中携带此 token
- Token 存储在 `system_config` 表中
- 验证时比对数据库中的存储值

**优点**:

- 使用 `randomBytes(32).toString('hex')` 生成 32 字节随机 token
- 每次请求 status 都会刷新 token（`onConflictDoUpdate`）
- 测试覆盖了缺少 token 和无效 token 的场景

**无问题**。

---

### 2. 速率限制 ✅ 通过

**实现方案**:

- 全局限制：`max: 60, timeWindow: '1 minute'`（基于 IP）
- Setup 端点限制：`max: 5, timeWindow: '5 minutes'`（更严格）
- 使用 `@fastify/rate-limit` 插件 + Redis 存储

**优点**:

- 区分全局和端点级别限制
- 错误响应格式统一：`RATE_LIMIT_EXCEEDED`
- 测试验证了超限返回 429

**无问题**。

---

### 3. 密码强度要求 ✅ 通过

**实现方案**:

**后端验证**（不可绕过）:

```typescript
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
```

**前端验证**（用户体验）:

```typescript
pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
// 配合 min: 8 规则
```

**要求**:

- 最少 8 位字符
- 必须包含大写字母
- 必须包含小写字母
- 必须包含数字

**优点**:

- 前后端双重验证，不信任前端
- 后端返回明确错误码 `WEAK_PASSWORD`
- 测试覆盖了弱密码拒绝场景

**建议增强**（非阻塞）:

- 考虑添加特殊字符要求（如 `?=.*[!@#$%^&*]`）
- 考虑添加常见密码字典检查

---

### 4. 设置端点防重复触发 ✅ 通过

**实现方案**:

**双重保护机制**:

1. **端点内部检查**（任务 2/3/4）:

   ```typescript
   const setupComplete = await app.db.query.systemConfig.findFirst({
     where: (fields, { eq }) => eq(fields.key, 'setup_complete'),
   });
   if (setupComplete?.value === true) {
     return reply.status(410).send({
       success: false,
       error: { code: 'SETUP_ALREADY_COMPLETE', ... },
     });
   }
   ```

2. **双向 Guard 中间件**（任务 5）:
   - 设置完成前：阻止非 setup 路由访问（403 SETUP_REQUIRED）
   - 设置完成后：阻止 setup 写入端点（410 SETUP_ALREADY_COMPLETE）
   - 始终允许：`GET /setup/status`、`/health`、`/docs`

**优点**:

- 防御深度：即使绕过 guard，端点内部仍有检查
- 使用 `system_config` 表的 `setup_complete` 键作为单一事实来源
- 测试覆盖了完整的设置流程和重复触发场景

**无问题**。

---

### 5. Token 安全性（设置完成后）⚠️ 有条件通过

**当前实现**:

- Setup token 存储在 `system_config` 表中
- Token 用于 CSRF 防护
- 设置完成后，guard 阻止写入端点

**发现的问题**:

#### 问题 5.1: 设置完成后 Token 未显式清理 🔶 中

**现象**:
计划中提到"设置完成后 setup token 失效"（API 计划第 47 行），但实现代码中：

- `POST /api/v1/setup/complete` 端点（任务 4）只标记 `setup_complete = true` 并返回 JWT
- 未显式删除或失效 `setup_token` 记录

**风险**:

- 设置完成后，`setup_token` 仍存在于数据库中
- `GET /setup/status` 在设置完成后仍然可访问（guard 允许）
- 虽然写入端点被 guard 阻止，但 token 本身未清理

**建议修复**:
在 `POST /api/v1/setup/complete` 端点中添加 token 清理逻辑：

```typescript
// 在标记 setup_complete 之后，清理 setup_token
await app.db.delete(app.schema.systemConfig).where(eq(app.schema.systemConfig.key, 'setup_token'));
```

或将其值设为 null：

```typescript
await app.db
  .update(app.schema.systemConfig)
  .set({ value: null, updatedAt: new Date() })
  .where(eq(app.schema.systemConfig.key, 'setup_token'));
```

#### 问题 5.2: SMTP 密码明文存储 🔶 中

**现象**:
配置保存端点（任务 3）将 SMTP 密码直接存入 `system_config` 表：

```typescript
...(config.smtpPassword ? [{ key: 'smtp_password', value: config.smtpPassword, category: 'smtp' }] : []),
```

**风险**:

- 数据库泄露时 SMTP 密码可被直接读取
- 违反敏感数据加密存储最佳实践

**建议修复**:
使用加密存储 SMTP 密码：

```typescript
import { encrypt, decrypt } from '../utils/encryption.js';

// 存储时加密
const encryptedPassword = encrypt(config.smtpPassword);
// 读取时解密
const smtpPassword = decrypt(storedPassword);
```

或使用环境变量存储敏感配置。

---

## 安全架构评估

### 优点

1. **分层防御**: guard 中间件 + 端点内部检查 + CSRF + 速率限制
2. **单一事实来源**: `system_config` 表的 `setup_complete` 键
3. **不信任前端**: 后端独立验证密码复杂度
4. **并发控制**: Redis 分布式锁防止重复创建管理员
5. **事务保证**: 数据库事务确保原子性
6. **日志脱敏**: 敏感字段（密码、token）不写入日志
7. **信息最小化**: 系统检查端点不暴露敏感信息

### 改进建议（非阻塞）

1. **审计日志**: 记录所有 setup 操作到 `@accessbase/audit`
2. **Token 过期**: 为 setup token 添加 TTL（如 30 分钟）
3. **IP 白名单**: 在生产环境中限制 setup 端点的访问 IP
4. **管理员邮箱灵活性**: 当前硬编码 `admin@accessbase.local`，建议支持自定义

---

## 前端安全评估

### 优点

1. **状态持久化**: 使用 Zustand + localStorage，防止意外丢失
2. **表单验证**: 前端验证提供即时反馈
3. **错误处理**: 统一的错误展示策略
4. **无障碍设计**: ARIA 标签、键盘导航、焦点管理

### 潜在风险

1. **localStorage 敏感数据**: `formData` 包含密码，持久化到 localStorage
   - **建议**: 不持久化密码字段，或使用 sessionStorage

2. **CSRF token 前端存储**: setup token 通过 API 获取，存储在内存中
   - **当前方案可接受**: token 是一次性的，且设置完成后失效

---

## 测试覆盖评估

### 已覆盖场景 ✅

- CSRF token 缺失/无效 → 403
- 速率限制超限 → 429
- 弱密码 → 400 WEAK_PASSWORD
- 设置完成后再触发 → 410 SETUP_ALREADY_COMPLETE
- 完整设置流程 → 端到端测试
- Guard 双向保护 → 单元测试

### 建议补充测试

- Token 过期场景（如果实现 TTL）
- 并发设置请求（竞态条件）
- 数据库连接失败时的行为
- Redis 不可用时的降级策略

---

## 结论

### 总体评定: ⚠️ 有条件通过 (CONDITIONAL PASS)

**通过条件**:

1. ✅ CSRF 防护完整实现
2. ✅ 速率限制配置合理
3. ✅ 密码强度要求足够
4. ✅ 设置端点防重复触发机制健全
5. ⚠️ Token 安全性需补充清理逻辑

### 必须修复项

| 优先级 | 问题                          | 修复建议                           |
| ------ | ----------------------------- | ---------------------------------- |
| 🔶 中  | 设置完成后 setup_token 未清理 | 在 complete 端点中删除或失效 token |
| 🔶 中  | SMTP 密码明文存储             | 使用加密或环境变量                 |

### 建议改进项（非阻塞）

| 优先级 | 问题                       | 修复建议                           |
| ------ | -------------------------- | ---------------------------------- |
| 🔵 低  | 前端 localStorage 存储密码 | 改用 sessionStorage 或不持久化密码 |
| 🔵 低  | 缺少审计日志               | 集成 @accessbase/audit             |
| 🔵 低  | Token 无过期机制           | 添加 TTL                           |

---

## 附录：审查依据

- OWASP Top 10 (2021)
- CWE-352: Cross-Site Request Forgery
- CWE-799: Improper Control of Interaction Frequency
- CWE-521: Weak Password Requirements
- CWE-287: Improper Authentication

---

**审查完成时间**: 2026-08-25  
**审查人**: final-security-reviewer  
**下次审查建议**: 实现完成后进行代码级安全审查
