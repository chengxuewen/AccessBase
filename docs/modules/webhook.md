# Webhook 系统

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§33 Webhook 系统

---

## 33. Webhook 系统

### 33.1 Webhook 事件类型

| 事件 | 触发时机 | 说明 |
|------|---------|------|
| `user.created` | 用户创建 | 新用户注册或管理员创建 |
| `user.updated` | 用户更新 | 个人信息变更 |
| `user.deleted` | 用户删除 | 账户注销 |
| `role.created` | 角色创建 | 新角色 |
| `role.updated` | 角色更新 | 角色权限变更 |
| `auth.login` | 用户登录 | 登录成功 |
| `auth.logout` | 用户登出 | 登出 |
| `auth.failed` | 登录失败 | 密码错误 |
| `license.expiring` | 许可证即将过期 | 提前 30 天 |
| `license.expired` | 许可证已过期 | 过期 |

### 33.2 Webhook 配置

```typescript
// Webhook 配置接口
interface WebhookConfig {
  id: string
  url: string
  events: string[]
  secret: string  // 用于签名验证
  enabled: boolean
  retryPolicy: {
    maxRetries: number
    backoffMultiplier: number
  }
}

// Webhook 发送
class WebhookService {
  async send(webhook: WebhookConfig, event: WebhookEvent): Promise<void> {
    const payload = JSON.stringify(event)
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex')
    
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': event.type
      },
      body: payload
    })
    
    if (!response.ok) {
      await this.retry(webhook, event)
    }
  }
  
  async retry(webhook: WebhookConfig, event: WebhookEvent): Promise<void> {
    const { maxRetries, backoffMultiplier } = webhook.retryPolicy
    
    for (let i = 0; i < maxRetries; i++) {
      const delay = Math.pow(backoffMultiplier, i) * 1000
      await new Promise(resolve => setTimeout(resolve, delay))
      
      try {
        await this.send(webhook, event)
        return
      } catch (error) {
        continue
      }
    }
    
    // 记录失败
    await this.logFailure(webhook.id, event)
  }
}
```

### 33.3 Webhook 管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/webhooks` | GET | Webhook 列表 |
| `/api/v1/webhooks` | POST | 创建 Webhook |
| `/api/v1/webhooks/:id` | GET | Webhook 详情 |
| `/api/v1/webhooks/:id` | PUT | 更新 Webhook |
| `/api/v1/webhooks/:id` | DELETE | 删除 Webhook |
| `/api/v1/webhooks/:id/test` | POST | 测试 Webhook |
| `/api/v1/webhooks/:id/deliveries` | GET | 交付历史 |

---
