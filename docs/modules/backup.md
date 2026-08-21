# 备份与灾难恢复

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§27 备份与灾难恢复

---

## 27. 备份与灾难恢复

### 27.1 备份策略

| 类型 | 频率 | 保留期 | 说明 |
|------|------|--------|------|
| **全量备份** | 每日 | 30 天 | 完整数据库备份 |
| **增量备份** | 每小时 | 7 天 | WAL 归档 |
| **配置备份** | 每次变更 | 永久 | Git 版本控制 |
| **文件备份** | 每日 | 30 天 | 用户上传文件 |

### 27.2 RTO/RPO

| 指标 | 目标 | 说明 |
|------|------|------|
| **RPO（恢复点目标）** | ≤ 1 小时 | 最多丢失 1 小时数据 |
| **RTO（恢复时间目标）** | ≤ 30 分钟 | 30 分钟内恢复服务 |

### 27.3 备份脚本

```bash
#!/bin/bash
# backup.sh
set -euo pipefail

BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 数据库备份
pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME -F c -f "$BACKUP_DIR/db.dump"

# 文件备份
tar -czf "$BACKUP_DIR/files.tar.gz" /data/uploads/

# 配置备份
tar -czf "$BACKUP_DIR/config.tar.gz" /app/config/

# 清理旧备份（保留 30 天）
find /backups -type d -mtime +30 -exec rm -rf {} +

echo "Backup completed: $BACKUP_DIR"
```

### 27.4 恢复流程

```bash
#!/bin/bash
# restore.sh
set -euo pipefail

BACKUP_DIR=$1

# 停止服务
docker compose stop app

# 恢复数据库
pg_restore -h $DB_HOST -U $DB_USER -d $DB_NAME -c "$BACKUP_DIR/db.dump"

# 恢复文件
tar -xzf "$BACKUP_DIR/files.tar.gz" -C /

# 启动服务
docker compose start app

# 验证
curl -sf http://localhost:3000/health/ready || echo 'Recovery failed!'
```

---
