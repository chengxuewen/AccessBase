# 邮件/短信服务

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§40 邮件/短信服务

---

## 40. 邮件/短信服务

### 40.1 邮件服务

```typescript
// 邮件服务接口
interface EmailService {
  send(options: EmailOptions): Promise<void>
  sendTemplate(template: string, to: string, data: Record<string, any>): Promise<void>
}

// 邮件选项
interface EmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  template?: string
  data?: Record<string, any>
  attachments?: Attachment[]
}

// 邮件模板
const emailTemplates = {
  'welcome': {
    subject: '欢迎加入 AccessBase',
    html: '<h1>欢迎，{{name}}！</h1><p>您的账户已创建成功。</p>'
  },
  'reset-password': {
    subject: '密码重置',
    html: '<h1>密码重置</h1><p>点击链接重置密码：<a href="{{resetUrl}}">重置密码</a></p>'
  },
  'mfa-code': {
    subject: 'MFA 验证码',
    html: '<h1>您的验证码</h1><p>{{code}}</p><p>有效期 5 分钟。</p>'
  }
}
```

### 40.2 短信服务

```typescript
// 短信服务接口
interface SmsService {
  send(phone: string, message: string): Promise<void>
  sendCode(phone: string): Promise<string>
}

// 短信验证码
class SmsVerificationService {
  async sendCode(phone: string): Promise<string> {
    const code = Math.random().toString().slice(2, 8)
    
    // 存储到 Redis（5 分钟过期）
    await this.redis.set(`sms:code:${phone}`, code, 'EX', 300)
    
    // 发送短信
    await this.smsService.send(phone, `您的验证码是：${code}，有效期 5 分钟。`)
    
    return code
  }
  
  async verifyCode(phone: string, code: string): Promise<boolean> {
    const storedCode = await this.redis.get(`sms:code:${phone}`)
    
    if (!storedCode || storedCode !== code) {
      return false
    }
    
    // 验证后删除
    await this.redis.del(`sms:code:${phone}`)
    return true
  }
}
```

---
