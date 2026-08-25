# Secret 管理

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§28 Secret 管理

---

## 28. Secret 管理

### 28.1 Secret 存储方案

| 方案                    | 适用场景     | 说明                      |
| ----------------------- | ------------ | ------------------------- |
| **环境变量**            | 单机/开发    | 简单，但不安全            |
| **Docker Secrets**      | Docker Swarm | 加密存储，运行时注入      |
| **K8s Secrets**         | Kubernetes   | Base64 编码，可配合 Vault |
| **HashiCorp Vault**     | 企业级       | 动态密钥、自动轮转        |
| **AWS Secrets Manager** | AWS 环境     | 托管服务、自动轮转        |

### 28.2 Secret 清单

| Secret              | 用途          | 轮转周期 |
| ------------------- | ------------- | -------- |
| JWT_PRIVATE_KEY     | JWT 签名      | 90 天    |
| JWT_PUBLIC_KEY      | JWT 验证      | 90 天    |
| DB_PASSWORD         | 数据库密码    | 90 天    |
| REDIS_PASSWORD      | Redis 密码    | 90 天    |
| LDAP_BIND_PASSWORD  | LDAP 绑定密码 | 90 天    |
| ENCRYPTION_SECRET   | 数据加密      | 90 天    |
| COOKIE_SECRET       | Cookie 签名   | 90 天    |
| SMTP_PASSWORD       | 邮件发送      | 90 天    |
| OAuth_CLIENT_SECRET | OAuth 提供商  | 不定期   |

### 28.3 K8s Secret 配置

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: accessbase-secrets
type: Opaque
data:
  jwt-private-key: <base64-encoded>
  jwt-public-key: <base64-encoded>
  db-password: <base64-encoded>
  redis-password: <base64-encoded>
  encryption-secret: <base64-encoded>
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: app
          env:
            - name: JWT_PRIVATE_KEY
              valueFrom:
                secretKeyRef:
                  name: accessbase-secrets
                  key: jwt-private-key
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: accessbase-secrets
                  key: db-password
```

### 28.4 Secret 轮转策略

```typescript
// Secret 轮转管理器
class SecretRotationManager {
  // 检查 Secret 是否需要轮转
  async checkRotation(secretName: string): Promise<boolean> {
    const secret = await this.getSecret(secretName);
    const rotationDays = 90;
    const daysSinceRotation = (Date.now() - secret.lastRotatedAt) / (1000 * 60 * 60 * 24);

    return daysSinceRotation >= rotationDays;
  }

  // 轮转 Secret
  async rotate(secretName: string): Promise<void> {
    const newSecret = this.generateSecret();

    // 更新 Secret
    await this.updateSecret(secretName, newSecret);

    // 重启服务（滚动更新）
    await this.restartServices();

    // 验证服务正常
    await this.verifyServices();
  }
}
```

---
