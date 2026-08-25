---
name: security-hardening
description: 'AccessBase 安全加固。OWASP Top 10 + JWT/RBAC + 数据库安全 + 密钥管理。发布前/权限模块修改后/新增 API endpoint 后使用。'
---

# security-hardening — 安全加固

> OWASP Top 10 + JWT 认证 + RBAC + PostgreSQL 安全 + 密钥管理。
> 每一条规则都有检查命令。每个检查都必须通过。

## 触发条件

- 发布前（release candidate）
- Auth / RBAC 模块修改后
- 新增 API endpoint
- 新增 JWT secret / 密钥
- 用户说 "security review" / "安全审计"

## Mode A: 审计模式 (audit)

完整安全审计，手动触发。运行所有 Phase，生成审计报告。

## Mode B: Guard-while-editing（轻量级）

代码变更时快速检查，阻断不安全提交。

### B1: 密钥检测

```bash
# 检查暂存文件中的硬编码密钥
git diff --cached --name-only -- '*.ts' '*.tsx' | xargs -I{} grep -n 'token.*=\|password.*=\|api[_-]key\|secret.*=' {} 2>/dev/null || true
```

### B2: 危险模式扫描

```bash
# 检查暂存文件中的危险模式
git diff --cached --name-only -- '*.ts' '*.tsx' | xargs -I{} grep -n 'as any\|@ts-ignore\|eval(\|console\.log' {} 2>/dev/null || true
```

### B3: 依赖审计

```bash
# 检查已知漏洞
pnpm audit --audit-level moderate 2>&1 | head -20
```

### Guard 执行顺序

```
PreToolUse (on edit .ts/.tsx):
  1. 危险模式扫描     (<0.5s)
  2. 密钥检测         (<1s)
  3. 依赖审计         (<3s, 仅 pnpm-lock.yaml 变更时)

任一失败 → 阻断操作
```

## Phase 1: 密钥扫描

```bash
# 检查硬编码密钥
grep -rn 'api[_-]key\|api[_-]secret\|token.*=\|password.*="' packages/ --include='*.ts' --include='*.tsx' | grep -v '//.*TODO' | grep -v 'process\.env'
grep -rn 'JWT_SECRET\|AUDE_DB' .env* 2>/dev/null

# 检查 .gitignore 覆盖
grep '\.env' .gitignore
grep 'aude_access_token\|aude_tenant_id' .gitignore || true
```

| 检查项        | 命令                                                  | 通过标准            |
| ------------- | ----------------------------------------------------- | ------------------- |
| 无硬编码密钥  | `grep -rn 'JWT_SECRET.*=' packages/ --include='*.ts'` | 仅 process.env 引用 |
| .env 不在 git | `git ls-files .env`                                   | 空                  |
| 密钥强度      | `echo $AUDE_JWT_SECRET \| wc -c`                      | ≥32 字符            |

## Phase 2: 认证审计

```bash
# 1. JWT secret 来源
grep -rn 'JWT_SECRET' packages/auth/ packages/core/ --include='*.ts'

# 2. Token 过期时间
grep -rn 'expiresIn\|exp.*15.*min\|refresh.*7.*day' packages/auth/ --include='*.ts'

# 3. Refresh token 轮换
grep -rn 'refresh_token\|token_version' packages/auth/ packages/core/ --include='*.ts'

# 4. 密码哈希
grep -rn 'bcrypt\|hash.*12\|hashSync' packages/ --include='*.ts'

# 5. 登录端点保护
grep -rn 'rate.limit\|login.*rate\|too.many' packages/ --include='*.ts'
```

| 检查项            | 命令                | 通过标准 |
| ----------------- | ------------------- | -------- |
| JWT secret 强度   | 环境变量 + ≥32 字符 | ✅       |
| Access token 过期 | ≤15min              | ✅       |
| Refresh token     | 7 天 + 轮换         | ✅       |
| 密码哈希          | bcrypt cost 12      | ✅       |
| 登录限速          | 5 次/分钟           | ✅       |

## Phase 3: RBAC 审计

```bash
# 1. 权限检查点
grep -rn 'PermissionEngine\|requireAuth\|aclMiddleware' packages/ --include='*.ts'

# 2. Record Rules 注入
grep -rn 'generateWhereClause\|parseDomainFilter\|buildRecordRulesWhere' packages/ --include='*.ts'

# 3. 字段级权限
grep -rn 'FieldDef.*requires\|filterVisibleFields' packages/ --include='*.ts'

# 4. 系统用户保护
grep -rn 'is_system\|isSystem' packages/core/ --include='*.ts'
```

## Phase 4: API 安全

```bash
# 1. CORS 配置
grep -rn 'cors\|origin\|access-control' packages/core/ --include='*.ts'

# 2. 速率限制
grep -rn 'rate.limit\|RateLimiter\|429' packages/ --include='*.ts'

# 3. Zod 验证
grep -rn 'safeParse\|z\.object\|buildZodSchema' packages/ --include='*.ts'

# 4. SQL 注入防护
grep -rn 'sql`.*\$\|sql\.raw\|execute(' packages/ --include='*.ts'

# 5. XSS 防护
grep -rn 'innerHTML\|dangerouslySetInnerHTML' packages/admin-ui/ --include='*.tsx'
```

## Phase 5: 数据库安全

```bash
# 1. 连接字符串
grep -rn 'DATABASE_URL' .env* 2>/dev/null
grep -rn 'process\.env\.DATABASE_URL' packages/ --include='*.ts'

# 2. 多租户隔离
grep -rn 'tenant_id\|tenantId' packages/core/ --include='*.ts'

# 3. RLS（如果启用）
docker exec audebase-postgres psql -U audebase -c "SELECT * FROM pg_policies;" 2>/dev/null
```

## Phase 6: 依赖安全

```bash
# 1. npm audit
pnpm audit --audit-level moderate

# 2. 未使用依赖
pnpm depcheck 2>/dev/null || true

# 3. 已知高危 CVE
pnpm audit --audit-level critical
```

## 报告格式

```markdown
## 安全审计报告 — [日期]

### Phase 1: 密钥扫描

✅ 无硬编码密钥
✅ .env 不在 git

### Phase 2: 认证

✅ JWT secret 强度合格
✅ Access token 15min
⚠️ 无登录限速 (P1)

### Phase 3: RBAC

✅ Record Rules 注入完整
✅ 系统用户保护有效
⚠️ 字段级权限未接入 (P2)

### Phase 4: API 安全

✅ CORS 配置正确
✅ Zod 验证完整
✅ 速率限制已实现

### 总结

CRITICAL: 0 | HIGH: 0 | MEDIUM: 2 | LOW: 0
```

## 与 OWASP Top 10 对应

| OWASP          | AccessBase 检查项                            |
| -------------- | -------------------------------------------- |
| A01 访问控制   | PermissionEngine + Record Rules + 字段级权限 |
| A02 加密       | JWT HS256 + bcrypt + HTTPS                   |
| A03 注入       | Drizzle 参数化查询 + Zod 验证                |
| A04 不安全设计 | 速率限制 + 超时                              |
| A05 安全配置   | 环境变量 + .env 不入库                       |
| A06 脆弱组件   | pnpm audit                                   |
| A07 认证失败   | JWT + refresh + 登录限速                     |
| A08 数据完整性 | Zod 验证 + 系统用户保护                      |
| A09 日志监控   | 审计日志 + 结构化日志                        |
| A10 SSRF       | 无服务端 HTTP 拉取                           |
