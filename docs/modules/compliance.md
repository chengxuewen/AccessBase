# 合规与数据隐私（GDPR）

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§39 合规与数据隐私（GDPR）

---

## 39. 合规与数据隐私（GDPR）

### 39.1 数据保留策略

| 数据类型 | 保留期 | 说明 |
|---------|--------|------|
| 用户数据 | 账户活跃期间 | 账户注销后 30 天删除 |
| 审计日志 | 1 年 | 法规要求 |
| 会话数据 | 7 天 | 过期自动清理 |
| 登录历史 | 90 天 | 安全审计 |
| 文件上传 | 账户活跃期间 | 账户注销后删除 |

### 39.2 用户数据导出

```typescript
// 用户数据导出 API
fastify.get('/api/v1/users/me/data-export', {
  preHandler: [authenticate]
}, async (request, reply) => {
  const userId = request.user.id
  
  // 收集用户数据
  const userData = {
    profile: await getUserProfile(userId),
    roles: await getUserRoles(userId),
    sessions: await getUserSessions(userId),
    apiKeys: await getUserApiKeys(userId),
    auditLogs: await getUserAuditLogs(userId)
  }
  
  // 生成 JSON 文件
  const data = JSON.stringify(userData, null, 2)
  
  return reply
    .header('Content-Type', 'application/json')
    .header('Content-Disposition', 'attachment; filename=user-data.json')
    .send(data)
})
```

### 39.3 用户数据删除

```typescript
// 用户数据删除 API
fastify.delete('/api/v1/users/me', {
  preHandler: [authenticate]
}, async (request, reply) => {
  const userId = request.user.id
  
  // 标记为待删除（30 天后正式删除）
  await db.update(usersTable)
    .set({
      status: 'pending_deletion',
      deletionScheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    })
    .where(eq(usersTable.id, userId))
  
  // 撤销所有会话
  await sessionManager.revokeAllSessions(userId)
  
  // 发送确认邮件
  await emailService.send({
    to: request.user.email,
    subject: '账户注销确认',
    template: 'account-deletion',
    data: {
      deletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()
    }
  })
  
  return reply.send({
    success: true,
    message: '账户已标记为待删除，30 天后正式删除'
  })
})
```

### 39.4 隐私同意管理

```typescript
// 隐私同意记录
interface PrivacyConsent {
  userId: string
  consentType: 'privacy_policy' | 'terms_of_service' | 'marketing'
  version: string
  acceptedAt: Date
  ipAddress: string
}

// 隐私同意 API
fastify.post('/api/v1/privacy/consent', {
  preHandler: [authenticate]
}, async (request, reply) => {
  const { consentType, version } = request.body
  
  await db.insert(privacyConsentsTable).values({
    userId: request.user.id,
    consentType,
    version,
    acceptedAt: new Date(),
    ipAddress: request.ip
  })
  
  return reply.send({ success: true })
})
```

---
