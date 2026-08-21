# 通知中心

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§34 通知中心

---

## 34. 通知中心

### 34.1 通知类型

| 类型 | 渠道 | 说明 |
|------|------|------|
| **系统通知** | 应用内 | 系统公告、维护通知 |
| **安全通知** | 应用内+邮件 | 登录异常、密码变更 |
| **审计通知** | 应用内 | 操作结果反馈 |
| **许可证通知** | 应用+邮件 | 许可证即将过期 |

### 34.2 通知 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/notifications` | GET | 通知列表（分页） |
| `/api/v1/notifications/unread` | GET | 未读通知 |
| `/api/v1/notifications/:id/read` | POST | 标记已读 |
| `/api/v1/notifications/read-all` | POST | 全部标记已读 |
| `/api/v1/notifications/preferences` | GET/PUT | 通知偏好设置 |

### 34.3 实时通知（WebSocket）

```typescript
// WebSocket 通知
fastify.register(async (fastify) => {
  fastify.get('/ws/notifications', { websocket: true }, (socket, request) => {
    const userId = request.user.id
    
    // 加入用户房间
    socket.join(`user:${userId}`)
    
    // 监听通知事件
    eventBus.on(`notification:${userId}`, (notification) => {
      socket.send(JSON.stringify(notification))
    })
    
    socket.on('close', () => {
      socket.leave(`user:${userId}`)
    })
  })
})
```

### 34.4 通知偏好设置

```typescript
interface NotificationPreferences {
  security: {
    loginFromNewDevice: boolean    // 新设备登录通知
    passwordChanged: boolean       // 密码变更通知
    mfaDisabled: boolean           // MFA 禁用通知
  }
  audit: {
    userCreated: boolean           // 用户创建通知
    roleChanged: boolean           // 角色变更通知
  }
  license: {
    expiringSoon: boolean          // 许可证即将过期
    expired: boolean               // 许可证已过期
  }
  channels: {
    inApp: boolean                 // 应用内通知
    email: boolean                 // 邮件通知
  }
}
```

---
