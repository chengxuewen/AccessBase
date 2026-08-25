# 分布式架构设计

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§11 分布式架构设计

---

## 11. 分布式架构设计

### 11.1 部署场景矩阵

| 场景              | 架构           | 数据同步              | 网络      | 适用规模      |
| ----------------- | -------------- | --------------------- | --------- | ------------- |
| **单机部署**      | Docker Compose | 本地                  | 本地      | 开发/小规模   |
| **主公司+分公司** | 中心化         | 主→分（单向）         | VPN/专线  | 中型企业      |
| **分布式部署**    | 去中心化       | 双向同步              | 公网/专线 | 大型企业      |
| **K8s 集群**      | 容器编排       | 共享存储/分布式数据库 | 集群网络  | 云原生/大规模 |

### 11.2 数据同步策略

**选择：主从复制（主公司→分公司单向同步）**

| 数据类型      | 同步方向 | 同步策略 | 冲突解决   |
| ------------- | -------- | -------- | ---------- |
| 用户/权限数据 | 主→分    | 实时同步 | 主公司优先 |
| 业务数据      | 主→分    | 定时同步 | 主公司优先 |
| 配置数据      | 主→分    | 实时同步 | 主公司优先 |
| 审计日志      | 分→主    | 定时上传 | 合并       |

**同步机制**：

```typescript
// PostgreSQL 主从复制
主公司（主库） → WAL 流复制 → 分公司（从库）

// 文件同步
主公司（MinIO/NFS） → rsync/rclone → 分公司（本地存储）
```

### 11.3 高可用设计

**选择：主备热备（秒级切换）**

```
┌─────────────┐    ┌─────────────┐
│   主实例    │    │   备实例    │
│  (Active)   │ ←→ │  (Standby)  │
└─────────────┘    └─────────────┘
       ↑ 心跳检测        ↑ 自动切换
       └─────────────────┘
```

**切换策略**：

- 心跳检测：每秒检测主实例状态
- 自动切换：主实例故障时，备实例秒级接管
- 数据一致性：同步复制，零数据丢失
- 故障恢复：原主实例恢复后自动成为备实例

**组件高可用**：

| 组件       | 高可用方案                | 切换时间 |
| ---------- | ------------------------- | -------- |
| PostgreSQL | 主从流复制 + 自动故障转移 | 秒级     |
| Redis      | Redis Sentinel            | 秒级     |
| 应用层     | 负载均衡 + 多实例         | 无感知   |
| 文件存储   | MinIO 分布式 / NFS 主备   | 秒级     |

### 11.4 网络架构

**选择：混合网络（专线+VPN+公网）**

```
┌─────────────────────────────────────────────────────────┐
│                     主公司（总部）                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ 应用层  │  │ 数据库  │  │  缓存   │  │ 文件存储 │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
        ↑               ↑               ↑
    ┌───┴───┐       ┌───┴───┐       ┌───┴───┐
    │ 专线  │       │  VPN  │       │ 公网  │
    │(安全) │       │(平衡) │       │(经济) │
    └───┬───┘       └───┬───┘       └───┬───┘
        ↓               ↓               ↓
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 重要分公司   │ │ 一般分公司   │ │ 临时办事处   │
│ (财务/研发)  │ │ (销售/客服)  │ │ (项目组)     │
└──────────────┘ └──────────────┘ └──────────────┘
```

**分级网络策略**：

| 分公司类型              | 网络方式 | 安全级别 | 成本 |
| ----------------------- | -------- | -------- | ---- |
| 重要分公司（财务/研发） | 专线     | 最高     | 高   |
| 一般分公司（销售/客服） | VPN      | 高       | 中   |
| 临时办事处（项目组）    | 公网+SSL | 中       | 低   |

### 11.5 服务发现与负载均衡

**单机/小规模**：

```yaml
# 静态配置
services:
  app:
    image: accessbase/app
    environment:
      - DB_HOST=postgres
      - REDIS_HOST=redis
```

**主公司+分公司**：

```yaml
# DNS 服务发现 + Nginx 负载均衡
upstream app_backend {
server app1:3000;
server app2:3000;
}

server {
listen 80;
location / {
proxy_pass http://app_backend;
}
}
```

**K8s 集群**：

```yaml
# K8s Service + Ingress
apiVersion: v1
kind: Service
metadata:
  name: accessbase-app
spec:
  selector:
    app: accessbase
  ports:
    - port: 80
      targetPort: 3000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: accessbase-ingress
spec:
  rules:
    - host: accessbase.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: accessbase-app
                port:
                  number: 80
```

### 11.6 容器编排

**Docker Compose（单机/开发）**：

```yaml
version: '3.8'
services:
  app:
    image: accessbase/app
    ports:
      - '3000:3000'
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: accessbase
      POSTGRES_USER: accessbase
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  redis:
    image: redis:7-alpine

  nginx:
    image: nginx:alpine
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
```

**Docker Swarm（多实例）**：

```bash
# 初始化 Swarm
docker swarm init

# 部署服务
docker stack deploy -c docker-compose.yml accessbase

# 扩展实例
docker service scale accessbase_app=3
```

**Kubernetes（云原生）**：

```yaml
# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: accessbase-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: accessbase
  template:
    metadata:
      labels:
        app: accessbase
    spec:
      containers:
        - name: app
          image: accessbase/app:latest
          ports:
            - containerPort: 3000
          env:
            - name: DB_HOST
              value: postgres
            - name: REDIS_HOST
              value: redis
```

### 11.7 分公司部署架构

**典型部署（群晖 NAS 那种）**：

```
┌─────────────────────────────────────────────────────────┐
│                     主公司（总部）                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ 应用层  │  │ 主数据库│  │  缓存   │  │ 文件存储 │    │
│  │ (读写)  │  │ (读写)  │  │ (主)    │  │ (主副本) │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
        ↑
    ┌───┴───┐
    │ 专线  │
    │/VPN   │
    └───┬───┘
        ↓
┌─────────────────────────────────────────────────────────┐
│                     分公司（N个）                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ 应用层  │  │ 从数据库│  │  缓存   │  │ 文件存储 │    │
│  │ (只读)  │  │ (只读)  │  │ (从)    │  │ (同步)  │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
```

**分公司配置**：

```yaml
# 分公司 Docker Compose
version: '3.8'
services:
  app:
    image: accessbase/app
    environment:
      - DB_HOST=postgres-slave
      - REDIS_HOST=redis-slave
      - MASTER_HOST=master.example.com
      - SYNC_MODE=slave

  postgres-slave:
    image: postgres:16
    environment:
      POSTGRES_DB: accessbase
      POSTGRES_USER: accessbase
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      # 主从复制配置
      POSTGRES_MASTER_HOST: master.example.com
      POSTGRES_REPLICATION_MODE: slave

  redis-slave:
    image: redis:7-alpine
    command: redis-server --replicaof master.example.com 6379
```

### 11.8 数据同步实现

**PostgreSQL 主从复制**：

```sql
-- 主公司（主库）配置
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET max_wal_senders = 10;
ALTER SYSTEM SET wal_keep_size = '1GB';

-- 创建复制用户
CREATE USER replicator WITH REPLICATION ENCRYPTED 'password';

-- 分公司（从库）配置
PRIMARY_CONNINFO = 'host=master.example.com user=replicator password=password'

-- 从库启动复制
pg_basebackup -h master.example.com -U replicator -D /var/lib/postgresql/data -P
```

**文件同步（rsync/rclone）**：

```bash
# 主公司 → 分公司 文件同步
rsync -avz --delete /data/files/ user@branch1:/data/files/

# 定时同步（cron）
0 */6 * * * rsync -avz --delete /data/files/ user@branch1:/data/files/
```

**应用层数据同步**：

```typescript
// 同步服务
class SyncService {
  // 同步用户数据
  async syncUsers() {
    const users = await this.getMasterUsers();
    await this.updateLocalUsers(users);
  }

  // 同步配置
  async syncConfig() {
    const config = await this.getMasterConfig();
    await this.updateLocalConfig(config);
  }

  // 上传审计日志
  async uploadAuditLogs() {
    const logs = await this.getLocalAuditLogs();
    await this.uploadToMaster(logs);
  }
}
```

### 11.9 故障转移与恢复

**主公司故障**：

```
1. 主数据库故障 → 备数据库自动接管（秒级）
2. 应用层故障 → 负载均衡切换到健康实例
3. 网络故障 → 分公司降级为只读模式
```

**分公司故障**：

```
1. 分公司数据库故障 → 从主公司重新同步
2. 分公司应用层故障 → 本地重启或主公司接管
3. 网络故障 → 分公司离线运行，网络恢复后同步
```

**故障恢复流程**：

```
故障检测 → 自动切换 → 故障修复 → 数据同步 → 恢复正常
```

---
