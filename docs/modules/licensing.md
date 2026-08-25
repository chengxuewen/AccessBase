# 授权许可证

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§20 授权许可证

---

## 20. 授权许可证

### 20.1 许可证类型

| 类型           | 说明              | 适用场景    | 计费方式     |
| -------------- | ----------------- | ----------- | ------------ |
| **服务器授权** | 绑定服务器硬件/ID | 私有化部署  | 按服务器数量 |
| **用户授权**   | 绑定用户数量      | SaaS/私有化 | 按用户数量   |
| **租户授权**   | 绑定租户数量      | 多租户 SaaS | 按租户数量   |
| **功能授权**   | 绑定功能模块      | 增值服务    | 按功能模块   |
| **时间授权**   | 绑定使用时间      | 订阅模式    | 按时间周期   |
| **并发授权**   | 绑定并发用户数    | 高并发场景  | 按并发数量   |

### 20.2 许可证模型

#### 20.2.1 服务器授权

```typescript
interface ServerLicense {
  id: string;
  serverFingerprint: string;
  license: {
    type: 'server';
    maxServers: number;
    currentServers: number;
    features: string[];
    expiresAt: Date;
  };
  signature: string;
}

// 服务器指纹生成
function generateServerFingerprint(): string {
  const cpu = os.cpus()[0].model;
  const hostname = os.hostname();
  const macAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => !iface.internal && iface.mac !== '00:00:00:00:00:00')
    .map((iface) => iface.mac);

  return crypto
    .createHash('sha256')
    .update(`${cpu}:${hostname}:${macAddresses.join(',')}`)
    .digest('hex');
}
```

#### 20.2.2 用户授权

```typescript
interface UserLicense {
  id: string;
  tenantId: string;
  license: {
    type: 'user';
    maxUsers: number;
    currentUsers: number;
    features: string[];
    expiresAt: Date;
  };
  signature: string;
}
```

#### 20.2.3 租户授权

```typescript
interface TenantLicense {
  id: string;
  license: {
    type: 'tenant';
    maxTenants: number;
    currentTenants: number;
    features: string[];
    expiresAt: Date;
  };
  signature: string;
}
```

#### 20.2.4 功能授权

```typescript
interface FeatureLicense {
  id: string;
  license: {
    type: 'feature';
    features: {
      [featureName: string]: {
        enabled: boolean;
        expiresAt?: Date;
        limits?: Record<string, number>;
      };
    };
  };
  signature: string;
}
```

### 20.3 许可证管理

#### 20.3.1 许可证生成

```typescript
class LicenseGenerator {
  private privateKey: string;

  constructor(privateKey: string) {
    this.privateKey = privateKey;
  }

  generate(licenseData: LicenseData): string {
    const payload = JSON.stringify(licenseData);

    const signature = crypto.sign('sha256', Buffer.from(payload), this.privateKey);

    const license = {
      payload,
      signature: signature.toString('base64'),
    };

    return Buffer.from(JSON.stringify(license)).toString('base64');
  }

  generateServerLicense(options: {
    serverFingerprint: string;
    maxServers: number;
    features: string[];
    expiresAt: Date;
  }): string {
    const licenseData: LicenseData = {
      id: generateId(),
      type: 'server',
      serverFingerprint: options.serverFingerprint,
      maxServers: options.maxServers,
      currentServers: 0,
      features: options.features,
      expiresAt: options.expiresAt,
      issuedAt: new Date(),
    };

    return this.generate(licenseData);
  }
}
```

#### 20.3.2 许可证验证

```typescript
class LicenseValidator {
  private publicKey: string;

  constructor(publicKey: string) {
    this.publicKey = publicKey;
  }

  validate(licenseString: string): LicenseValidationResult {
    try {
      const license = JSON.parse(Buffer.from(licenseString, 'base64').toString());

      const isValid = crypto.verify(
        'sha256',
        Buffer.from(license.payload),
        this.publicKey,
        Buffer.from(license.signature, 'base64'),
      );

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }

      const licenseData = JSON.parse(license.payload);

      if (new Date(licenseData.expiresAt) < new Date()) {
        return { valid: false, error: 'License expired' };
      }

      return { valid: true, license: licenseData };
    } catch (error) {
      return { valid: false, error: 'Invalid license format' };
    }
  }
}
```

#### 20.3.3 许可证管理器

```typescript
class LicenseManager {
  private validator: LicenseValidator;
  private license: LicenseData | null = null;

  constructor(publicKey: string) {
    this.validator = new LicenseValidator(publicKey);
  }

  async loadLicense(licenseString: string): Promise<boolean> {
    const result = this.validator.validate(licenseString);

    if (!result.valid) {
      console.error('Invalid license:', result.error);
      return false;
    }

    this.license = result.license;
    return true;
  }

  isFeatureEnabled(feature: string): boolean {
    if (!this.license) {
      return false;
    }

    return this.license.features.includes(feature);
  }

  isLimitExceeded(resource: string, currentCount: number): boolean {
    if (!this.license) {
      return true;
    }

    const limit = this.license[`max${resource.charAt(0).toUpperCase() + resource.slice(1)}`];

    if (!limit) {
      return false;
    }

    return currentCount >= limit;
  }

  getLicenseInfo(): LicenseInfo | null {
    if (!this.license) {
      return null;
    }

    return {
      id: this.license.id,
      type: this.license.type,
      features: this.license.features,
      expiresAt: this.license.expiresAt,
      issuedAt: this.license.issuedAt,
    };
  }
}
```

### 20.4 许可证验证中间件

```typescript
function licenseMiddleware(licenseManager: LicenseManager) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // 检查许可证是否有效
    if (!licenseManager.getLicenseInfo()) {
      return reply.status(403).send({
        error: 'License required',
        message: 'Please provide a valid license',
      });
    }

    // 检查许可证是否即将过期
    if (licenseManager.isLicenseExpiringSoon(30)) {
      reply.header('X-License-Warning', 'License expiring soon');
    }

    // 检查功能是否授权
    const feature = request.routeOptions?.config?.feature;
    if (feature && !licenseManager.isFeatureEnabled(feature)) {
      return reply.status(403).send({
        error: 'Feature not licensed',
        message: `Feature '${feature}' is not included in your license`,
      });
    }

    // 检查资源限制
    const resource = request.routeOptions?.config?.resource;
    if (resource) {
      const currentCount = await getResourceCount(resource, request.tenantId);
      if (licenseManager.isLimitExceeded(resource, currentCount)) {
        return reply.status(403).send({
          error: 'Resource limit exceeded',
          message: `You have reached the maximum number of ${resource}`,
        });
      }
    }
  };
}

// 使用示例
fastify.get(
  '/api/premium-feature',
  {
    config: {
      feature: 'premium-feature',
    },
    preHandler: [licenseMiddleware(licenseManager)],
  },
  async (request, reply) => {
    // 高级功能逻辑
  },
);
```

### 20.5 许可证管理 API

```typescript
// 获取许可证信息
fastify.get('/api/license', async (request, reply) => {
  const licenseInfo = licenseManager.getLicenseInfo();

  if (!licenseInfo) {
    return reply.status(404).send({ error: 'No license found' });
  }

  return reply.send(licenseInfo);
});

// 验证许可证
fastify.post('/api/license/validate', async (request, reply) => {
  const { license: licenseString } = request.body;

  const result = licenseValidator.validate(licenseString);

  if (!result.valid) {
    return reply.status(400).send({ error: result.error });
  }

  return reply.send({ valid: true, license: result.license });
});

// 安装许可证
fastify.post(
  '/api/license/install',
  {
    preHandler: [authenticate, authorize('admin')],
  },
  async (request, reply) => {
    const { license: licenseString } = request.body;

    const success = await licenseManager.loadLicense(licenseString);

    if (!success) {
      return reply.status(400).send({ error: 'Invalid license' });
    }

    await licenseStore.save(licenseManager.getLicenseInfo());

    return reply.send({ success: true });
  },
);

// 获取许可证使用情况
fastify.get(
  '/api/license/usage',
  {
    preHandler: [authenticate, authorize('admin')],
  },
  async (request, reply) => {
    const licenseInfo = licenseManager.getLicenseInfo();

    if (!licenseInfo) {
      return reply.status(404).send({ error: 'No license found' });
    }

    const usage = {
      users: await getUserCount(),
      tenants: await getTenantCount(),
      servers: await getServerCount(),
    };

    return reply.send({
      license: licenseInfo,
      usage,
    });
  },
);
```

### 20.6 许可证功能分层

```yaml
# 许可证功能分层
license_features:
  # 基础功能（免费）
  basic:
    - authentication
    - authorization
    - audit
    - logging
    - i18n
    - migration

  # 高级功能（付费）
  premium:
    - sso
    - mfa
    - advanced-audit
    - custom-branding
    - api-rate-limit

  # 企业功能
  enterprise:
    - multi-tenant
    - high-availability
    - dedicated-support
    - custom-integrations
    - sla-guarantee
```

### 20.7 配置示例

```yaml
# config.yaml
license:
  enabled: true

  # 许可证文件路径
  file: ./license.dat

  # 公钥（用于验证许可证签名）
  public_key: |
    -----BEGIN PUBLIC KEY-----
    MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
    -----END PUBLIC KEY-----

  # 许可证验证
  validation:
    # 在线验证
    online:
      enabled: true
      url: https://license.example.com/validate
      interval: 86400 # 24 小时

    # 离线验证
    offline:
      enabled: true
      grace_period: 7 # 7 天宽限期

  # 许可证警告
  warnings:
    # 即将过期警告
    expiring_soon:
      enabled: true
      days: 30

    # 超过限制警告
    limit_exceeded:
      enabled: true
      threshold: 0.9 # 90%

  # 许可证功能
  features:
    # 基础功能（免费）
    basic:
      - authentication
      - authorization
      - audit
      - logging

    # 高级功能（付费）
    premium:
      - sso
      - mfa
      - advanced-audit
      - custom-branding

    # 企业功能
    enterprise:
      - multi-tenant
      - high-availability
      - dedicated-support
```

---
