# 运维补充

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§31 运维补充 P1 + §38 运维补充 P2

---

## 31. 运维补充 P1

### 31.1 容器资源限制

```yaml
# docker-compose.yml
services:
  app:
    image: accessbase/app:latest
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'
```

### 31.2 Alertmanager 配置

```yaml
# alertmanager.yml
global:
  smtp_smarthost: 'smtp.example.com:587'
  smtp_from: 'alert@example.com'
  smtp_auth_username: '${SMTP_USER}'
  smtp_auth_password: '${SMTP_PASS}'

route:
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical'
      repeat_interval: 5m
    - match:
        severity: warning
      receiver: 'warning'
      repeat_interval: 1h

receivers:
  - name: 'default'
    email_configs:
      - to: 'ops@example.com'
  - name: 'critical'
    email_configs:
      - to: 'ops@example.com'
      - to: 'cto@example.com'
  - name: 'warning'
    email_configs:
      - to: 'ops@example.com'
```

### 31.3 SLO/SLA 定义

| 指标             | SLO        | SLA        | 说明                 |
| ---------------- | ---------- | ---------- | -------------------- |
| **可用性**       | 99.9%      | 99.5%      | 每月最多 43 分钟停机 |
| **响应时间 P50** | ≤ 100ms    | ≤ 200ms    | API 响应时间         |
| **响应时间 P99** | ≤ 500ms    | ≤ 1000ms   | API 响应时间         |
| **错误率**       | ≤ 0.1%     | ≤ 1%       | 5xx 错误比例         |
| **数据持久性**   | 99.999999% | 99.999999% | 数据不丢失           |
| **RPO**          | ≤ 1 小时   | ≤ 4 小时   | 恢复点目标           |
| **RTO**          | ≤ 30 分钟  | ≤ 2 小时   | 恢复时间目标         |

### 31.4 Runbook / 应急响应

```yaml
# runbook.yml
runbooks:
  - name: 'high-error-rate'
    alert: 'HighErrorRate'
    severity: critical
    steps:
      - '检查应用日志：kubectl logs -f deployment/accessbase'
      - '检查数据库连接：kubectl exec -it postgres -- psql -c "SELECT 1"'
      - '检查 Redis 连接：kubectl exec -it redis -- redis-cli ping'
      - '检查最近部署：kubectl rollout history deployment/accessbase'
      - '如有必要，回滚：kubectl rollout undo deployment/accessbase'

  - name: 'high-memory-usage'
    alert: 'HighMemoryUsage'
    severity: warning
    steps:
      - '检查内存使用：kubectl top pods'
      - '检查内存泄漏：node --inspect app.js'
      - '重启 Pod：kubectl delete pod <pod-name>'

  - name: 'database-connection-pool-exhausted'
    alert: 'DatabasePoolExhausted'
    severity: critical
    steps:
      - '检查活跃连接：SELECT * FROM pg_stat_activity'
      - '检查长时间运行的查询：SELECT * FROM pg_stat_activity WHERE state = \"active\" AND query_start < NOW() - INTERVAL \"5 minutes\"'
      - '终止长时间查询：SELECT pg_terminate_backend(pid)'
      - '增加连接池大小（如需要）'
```

---

## 38. 运维补充 P2

### 38.1 K8s 生产化配置

```yaml
# PersistentVolumeClaim
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
  storageClassName: gp3
---
# NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: accessbase-network-policy
spec:
  podSelector:
    matchLabels:
      app: accessbase
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: nginx
      ports:
        - port: 3000
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
    - to:
        - podSelector:
            matchLabels:
              app: redis
      ports:
        - port: 6379
---
# PodDisruptionBudget
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: accessbase-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: accessbase
---
# HorizontalPodAutoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: accessbase-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: accessbase
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### 38.2 日志保留策略

```yaml
# config.yaml
logging:
  retention:
    # 应用日志
    application:
      hot: 7 # 热存储 7 天
      warm: 30 # 温存储 30 天
      cold: 90 # 冷存储 90 天

    # 审计日志
    audit:
      hot: 30 # 热存储 30 天
      warm: 90 # 温存储 90 天
      cold: 365 # 冷存储 1 年

    # 访问日志
    access:
      hot: 7 # 热存储 7 天
      warm: 30 # 温存储 30 天
      cold: 90 # 冷存储 90 天

  # 日志轮转
  rotation:
    max_size: 100m # 单文件最大 100MB
    max_files: 10 # 最多保留 10 个文件
    compress: true # 压缩旧日志
```

### 38.3 多环境配置管理

```yaml
# config/development.yaml
app:
  debug: true
  log_level: debug

database:
  host: localhost
  port: 5432
  name: accessbase_dev

redis:
  host: localhost
  port: 6379

# config/staging.yaml
app:
  debug: false
  log_level: info

database:
  host: postgres-staging
  port: 5432
  name: accessbase_staging

redis:
  host: redis-staging
  port: 6379

# config/production.yaml
app:
  debug: false
  log_level: warn

database:
  host: ${DB_HOST}
  port: 5432
  name: accessbase_prod

redis:
  host: ${REDIS_HOST}
  port: 6379
```

### 38.4 镜像安全扫描

```yaml
# .github/workflows/security-scan.yml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Trivy 扫描
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'accessbase/app:latest'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'

      # Snyk 扫描
      - name: Run Snyk security scan
        uses: snyk/actions/docker@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          image: 'accessbase/app:latest'
          args: '--severity-threshold=high'

      # 上传结果
      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
```

### 38.5 审计日志保留策略

```typescript
// 审计日志保留管理器
class AuditLogRetentionManager {
  private config = {
    retentionDays: 365, // 保留 1 年
    archiveDays: 730, // 归档 2 年
    deleteDays: 2555, // 删除 7 年（合规要求）
  };

  // 定期清理任务
  async cleanup(): Promise<void> {
    const now = new Date();

    // 归档超过 1 年的日志
    await this.archiveLogs(now - this.config.retentionDays * 24 * 60 * 60 * 1000);

    // 删除超过 7 年的日志
    await this.deleteLogs(now - this.config.deleteDays * 24 * 60 * 60 * 1000);
  }

  // 归档日志
  private async archiveLogs(before: Date): Promise<void> {
    await db.query(
      `
      INSERT INTO audit_logs_archive
      SELECT * FROM audit_logs WHERE created_at < $1
    `,
      [before],
    );

    await db.query(
      `
      DELETE FROM audit_logs WHERE created_at < $1
    `,
      [before],
    );
  }
}
```

---
