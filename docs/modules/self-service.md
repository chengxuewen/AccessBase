# 用户自助服务

> **Implementation status (2026-09-23 gap audit):** `partial` — the §32.2 self-service flows shipped (Q1 2026-09-23 forgot/reset/register/verify-email + Q4a 2026-09-23 helpdesk invite / force-change / admin reset); §32.1 personal center is half-shipped under `/auth/*` + `/users/me` (profile read, change-password, session list / revoke / revoke-others) and `login-history` has no endpoint; a standalone portal is still absent — Profile/Settings live inside the admin chrome (gap-audit C). See [gap-audit](../superpowers/reports/2026-09-23-gap-audit.md).

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§32 用户自助服务

---

## 32. 用户自助服务

### 32.1 用户个人中心

| 功能          | 端点                                      | 说明           |
| ------------- | ----------------------------------------- | -------------- |
| 查看个人信息  | GET /api/v1/users/me                      | 当前用户信息   |
| 修改个人信息  | PATCH /api/v1/users/me                    | 姓名、头像等   |
| 修改密码      | POST /api/v1/users/me/change-password     | 需要旧密码     |
| 查看登录历史  | GET /api/v1/users/me/login-history        | 最近 10 次登录 |
| 管理会话      | GET /api/v1/users/me/sessions             | 活跃会话列表   |
| 撤销会话      | DELETE /api/v1/users/me/sessions/:id      | 踢出设备       |
| 管理 API 密钥 | GET/POST/DELETE /api/v1/users/me/api-keys | API 密钥 CRUD  |
| 管理 MFA      | GET/POST/DELETE /api/v1/users/me/mfa      | MFA 启用/禁用  |

### 32.2 密码重置流程

```typescript
// 密码重置流程
// 1. 用户请求重置
fastify.post('/api/v1/auth/forgot-password', async (request, reply) => {
  const { email } = request.body;

  // 始终返回成功（防止账户枚举）
  const user = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);

  if (user) {
    // 生成重置令牌
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    // 存储到数据库（1 小时过期）
    await db
      .update(usersTable)
      .set({
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000),
      })
      .where(eq(usersTable.id, user.id));

    // 发送重置邮件
    await emailService.send({
      to: email,
      subject: '密码重置',
      template: 'reset-password',
      data: { resetUrl: `https://example.com/reset-password?token=${resetToken}` },
    });
  }

  return reply.send({ success: true, message: '如果邮箱存在，重置邮件已发送' });
});

// 2. 用户重置密码
fastify.post('/api/v1/auth/reset-password', async (request, reply) => {
  const { token, newPassword } = request.body;

  const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const user = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.resetPasswordToken, resetTokenHash),
        gt(usersTable.resetPasswordExpires, new Date()),
      ),
    )
    .limit(1);

  if (!user) {
    return reply.status(400).send({ error: 'AUTH_003', message: '重置令牌无效或已过期' });
  }

  // 更新密码
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(usersTable)
    .set({
      passwordHash,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      tokenVersion: sql`${usersTable.tokenVersion} + 1`,
    })
    .where(eq(usersTable.id, user.id));

  // 撤销所有会话（强制重新登录）
  await sessionManager.revokeAllSessions(user.id);

  return reply.send({ success: true, message: '密码重置成功' });
});
```

### 32.3 Audit erasure (RTBF / right to be forgotten)

Audit erasure is an explicit admin opt-in on `DELETE /api/v1/users/:id` with body `{ eraseAudit: true, legalBasis }` (default OFF; `legalBasis` missing or empty answers 400 `VALIDATION_001`). A plain delete never destroys audit history, so a privileged caller cannot nuke forensic evidence by deleting an account. Each erasure writes a receipt-bound ledger row to `audit_erasures` (`subject_user_id`, `requested_by`, `legal_basis`, `receipt_hash` = SHA256 over the affected rows' original `row_hash` set ordered `(created_at, id)`, `rows_affected`, `events_scrubbed`), scrubs the PII columns without touching `row_hash`, `anchor_id`, `created_at` or any provenance column, and in the SAME transaction tombstones the matching outbox rows (their `payload` becomes an erasure marker) so no webhook subscriber keeps personal data. That column-level split is what lets `GET /api/v1/audit-logs/verify` recompute the receipt and tell a sanctioned erasure apart from tampering. Default retention is 365 days (`AUDIT_RETENTION_DAYS`, sweeper ON) and is the ordinary answer; explicit erasure is the GDPR Article 17(3)(e) carve-out, where deletion was requested against a legitimate archiving or audit purpose, and the receipt ledger is the record that the request, the requester and the stated basis existed.

---
