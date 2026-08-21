# 文件存储管理

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§41 文件存储管理

---

## 41. 文件存储管理

### 41.1 文件存储 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/files` | POST | 上传文件 |
| `/api/v1/files/:id` | GET | 下载文件 |
| `/api/v1/files/:id` | DELETE | 删除文件 |
| `/api/v1/files/:id/info` | GET | 文件信息 |
| `/api/v1/files` | GET | 文件列表 |

### 41.2 文件上传

```typescript
// 文件上传服务
class FileStorageService {
  async upload(file: File, options: UploadOptions): Promise<FileInfo> {
    // 验证文件类型
    if (!options.allowedTypes.includes(file.type)) {
      throw new AppError('FILE_001', '不支持的文件类型')
    }
    
    // 验证文件大小
    if (file.size > options.maxSize) {
      throw new AppError('FILE_002', '文件大小超过限制')
    }
    
    // 生成唯一文件名
    const filename = `${uuid()}.${file.extension}`
    const path = `${options.directory}/${filename}`
    
    // 上传到存储
    await this.storage.upload(path, file.buffer)
    
    // 保存文件信息
    const fileInfo = await db.insert(filesTable).values({
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      path,
      userId: options.userId,
      tenantId: options.tenantId
    }).returning()
    
    return fileInfo
  }
}
```

### 41.3 文件权限控制

```typescript
// 文件权限检查
class FilePermissionService {
  async checkAccess(userId: string, fileId: string, action: 'read' | 'write' | 'delete'): Promise<boolean> {
    const file = await db.select().from(filesTable).where(eq(filesTable.id, fileId)).limit(1)
    
    if (!file) {
      return false
    }
    
    // 所有者有完全权限
    if (file.userId === userId) {
      return true
    }
    
    // 检查共享权限
    const share = await db.select()
      .from(fileSharesTable)
      .where(and(
        eq(fileSharesTable.fileId, fileId),
        eq(fileSharesTable.userId, userId)
      ))
      .limit(1)
    
    if (!share) {
      return false
    }
    
    // 检查权限级别
    return share.permission === 'write' || share.permission === 'read'
  }
}
```

### 41.4 文件配额管理

```typescript
// 文件配额管理
class FileQuotaService {
  async checkQuota(tenantId: string, fileSize: number): Promise<boolean> {
    const quota = await this.getQuota(tenantId)
    const usage = await this.getUsage(tenantId)
    
    return usage + fileSize <= quota.maxStorage
  }
  
  async getUsage(tenantId: string): Promise<number> {
    const result = await db.select({
      total: sql<number>`sum(${filesTable.size})`
    })
    .from(filesTable)
    .where(eq(filesTable.tenantId, tenantId))
    
    return result[0]?.total || 0
  }
}
```

---
