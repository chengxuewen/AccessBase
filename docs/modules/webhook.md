# Webhook 系统

> **Implementation status (2026-09-23 gap audit):** `implemented` — the §33 surface shipped in Q4c (2026-09-24): `events` outbox (chain 0009) + `/api/v1/webhooks` CRUD/rotate-secret/ping/deliveries + HMAC-SHA256 dispatcher with exponential backoff and a fail-closed SSRF guard — A8/A9 discharged (the 2026-09-23 audit cited this module as "§42"; §33 is its real number, §42 is `p3-supplement.md`). R1-T3 (2026-09-28) added the `auth.login.success` / `auth.login.failure` / `auth.logout` telemetry lane. Only the `license.*` rows of the §33.1 design table have no emitter (licensing is its own design-only module); see the as-shipped catalog note under §33.1, including the subscription-validator limitation it records. See [gap-audit](../superpowers/reports/2026-09-23-gap-audit.md) and [round-2 audit H4](../superpowers/reports/2026-09-28-gap-audit-round2.md).

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§33 Webhook 系统

---

## 33. Webhook 系统

### 33.1 Webhook 事件类型

| 事件               | 触发时机       | 说明                   |
| ------------------ | -------------- | ---------------------- |
| `user.created`     | 用户创建       | 新用户注册或管理员创建 |
| `user.updated`     | 用户更新       | 个人信息变更           |
| `user.deleted`     | 用户删除       | 账户注销               |
| `role.created`     | 角色创建       | 新角色                 |
| `role.updated`     | 角色更新       | 角色权限变更           |
| `auth.login`       | 用户登录       | 登录成功               |
| `auth.logout`      | 用户登出       | 登出                   |
| `auth.failed`      | 登录失败       | 密码错误               |
| `license.expiring` | 许可证即将过期 | 提前 30 天             |
| `license.expired`  | 许可证已过期   | 过期                   |

> **As-shipped catalog (Q4c + R1-T3, 2026-09-28):** the live names are the `DomainEventType` union in
> `packages/identity/src/services/events.ts` — `user.created` / `user.updated` / `user.deleted` /
> `user.suspended`, `role.changed` (single name; the mutation kind rides in `payload.op`), `tenant.created` /
> `tenant.updated` / `tenant.suspended` / `tenant.deleted`, `apikey.revoked`, `group.changed`, `webhook.test`
> (test-ping only, excluded from tenant fan-out), and the R1-T3 auth lane: `auth.login.success` /
> `auth.login.failure` (`payload.reason` = bad_credentials|locked|suspended|other) / `auth.logout`
> (payload `{ email, method, userId?, reason? }`, emitted fire-and-forget from `apps/server/src/utils/auth-events.ts`
> on the password / totp / admin-wizard lanes; oauth/saml/webauthn/ldap/sms/magic = R-schedule).
> R-audit (2026-09-28) adds `audit.erased` — payload `{ subjectUserId, rowsAffected, legacySkipped }` (ids and counts only; `legalBasis` never appears in the payload and is never logged). Emitted on the caller transaction handle inside the erasure funnel, never swallowed.
> Subscription note: `audit.erased` is a two-segment name, so it IS subscribable by name (unlike the three-segment `auth.login.*` lane above).
> Subscription matching is literal on these names, but the entry validator ("*" or `^[a-z]+\.[a-z_]+$` in
> `apps/server/src/routes/webhooks.ts`, mirrored in `pages/Webhooks.tsx`) accepts only TWO-segment names — so
> `auth.login.success` / `auth.login.failure` cannot be subscribed by name and reach endpoints only through a
> `'*'` subscription (three-segment names are rejected with WEBHOOK_INVALID). Widening the pattern is an
> open follow-up; do not "fix" the table above to hide it. The `role.created`/`role.updated`/`auth.login`/
> `auth.failed`/`license.*` design names are NOT emitted at all.

### 33.2 Webhook 配置

```typescript
// Webhook 配置接口
interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  secret: string; // 用于签名验证
  enabled: boolean;
  retryPolicy: {
    maxRetries: number;
    backoffMultiplier: number;
  };
}

// Webhook 发送
class WebhookService {
  async send(webhook: WebhookConfig, event: WebhookEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const signature = crypto.createHmac('sha256', webhook.secret).update(payload).digest('hex');

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': event.type,
      },
      body: payload,
    });

    if (!response.ok) {
      await this.retry(webhook, event);
    }
  }

  async retry(webhook: WebhookConfig, event: WebhookEvent): Promise<void> {
    const { maxRetries, backoffMultiplier } = webhook.retryPolicy;

    for (let i = 0; i < maxRetries; i++) {
      const delay = Math.pow(backoffMultiplier, i) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        await this.send(webhook, event);
        return;
      } catch (error) {
        continue;
      }
    }

    // 记录失败
    await this.logFailure(webhook.id, event);
  }
}
```

### 33.3 Webhook 管理 API

| 端点                              | 方法   | 说明         |
| --------------------------------- | ------ | ------------ |
| `/api/v1/webhooks`                | GET    | Webhook 列表 |
| `/api/v1/webhooks`                | POST   | 创建 Webhook |
| `/api/v1/webhooks/:id`            | GET    | Webhook 详情 |
| `/api/v1/webhooks/:id`            | PUT    | 更新 Webhook |
| `/api/v1/webhooks/:id`            | DELETE | 删除 Webhook |
| `/api/v1/webhooks/:id/test`       | POST   | 测试 Webhook |
| `/api/v1/webhooks/:id/deliveries` | GET    | 交付历史     |

---
