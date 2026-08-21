---
name: code-simplification
description: "Reduce complexity in TypeScript code. Chesterton's Fence analysis, Rule of 500 enforcement, dead code elimination. Complements ponytail for TypeScript-specific over-engineering. Use after ponytail-audit, before PRs, or when diagnosing complexity smells."
---

# code-simplification — 复杂度消减

> Chesterton's Fence + Rule of 500 + TypeScript 特定模式。
> 只删该删的。不删不理解的。

## 触发条件

- 用户说"太复杂"、"简化"、"refactor"、"dead code"
- ponytail-audit 发现可删除项后
- 文件超过 500 行（`wc -l` > 500）
- 函数超过 50 行
- 同一文件被连续编辑 3+ 次

## Chesterton's Fence 流程

```
发现复杂度 → 查原因 → 有合理原因? → YES: 留，加注释 / NO: 删
```

### 查原因工具

| 来源 | 命令 |
|------|------|
| git blame | `git blame -L <line>,<line> <file>` |
| commit 信息 | `git log --all -S "<code>" --oneline` |
| issues/PRs | `gh search issues "<keyword>"` |
| ADR 决策 | `.agents/memorys/decisions.md` |
| 社区参考 | `grep_app_searchGitHub` |

### 栅栏注释

保留有原因的复杂度时，加注释标记：

```typescript
// chesterton: 这里的 as never 是因为 Drizzle 0.45 的 where() 返回类型
// 缩窄问题，无法在不引入 $dynamic()（本版本不支持）的情况下解决。
// 尝试过类型断言 → exactOptionalPropertyTypes 冲突。
// 等 Drizzle 1.0 或 $dynamic 支持后移除。
const dbQuery = db.select().from(table) as never
```

## Rule of 500

| 检查项 | 命令 | 阈值 | 行动 |
|--------|------|------|------|
| 文件行数 | `wc -l <file>` | >500 | 拆分为多个模块 |
| 函数行数 | `grep -n '^  function' <file>` | >50 | 提取辅助函数 |
| 参数个数 | 手动检查 | >5 | 合并为对象参数 |
| 嵌套深度 | 缩进层数 | >4 | 提前 return |
| export 数 | `grep -c 'export' <file>` | >20 | 细粒度模块 |

### 执行

```bash
# 扫描超标文件
find packages/ -name '*.ts' -exec wc -l {} + | sort -rn | head -20

# 对每个超标文件应用 Chesterton's Fence
# 拆分、提取、删除
# 验证: pnpm tsc --noEmit
```

## TypeScript 特定模式

### 过度泛型简化

```typescript
// BEFORE: 过度泛型
function processData<T extends Record<string, unknown>, K extends keyof T, V extends T[K]>(data: T, key: K): V { ... }

// AFTER: 实际类型
function processData(data: Device, key: 'name'): string { ... }
```

### 不必要的类型断言

```typescript
// BEFORE: as never 滥用
const result = await db.insert(table).values(data as never).returning()

// AFTER: 类型安全
const result = await db.insert(table).values(data).returning()
```

### 过度包装

```typescript
// BEFORE: 无意义的包装函数
function getUserById(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) })
}

// AFTER: 直接调用（如果只用一次）
const user = await db.query.users.findFirst({ where: eq(users.id, id) })
```

### 重复代码消除

```typescript
// BEFORE: 每个路由重复的认证+授权逻辑
app.get('/api/users', async (req, reply) => {
  const userId = (req as unknown as { user?: { sub?: string } }).user?.sub
  if (!userId) return reply.code(401)...
  const tenantId = (req as unknown as { tenantId: string | null }).tenantId
  // ... 业务逻辑
})

// AFTER: 提取中间件
const authContext = (req: FastifyRequest) => ({
  userId: (req as any).user?.sub,
  tenantId: (req as any).tenantId,
})
```

## 与 ponytail 的关系

| ponytail | code-simplification |
|----------|---------------------|
| 全局审计 → 排序 | 单文件/模块深入 |
| "这个能删吗？" | "这个为什么存在？" |
| 删除决策 | 拆分+重构决策 |

**工作流**: `/ponytail-audit` → 排序 → `/code-simplification` 逐个处理

## 验证门禁

```bash
# 1. 类型检查通过
pnpm tsc --noEmit

# 2. Lint 通过
pnpm eslint --max-warnings=0

# 3. 测试全过
pnpm test

# 4. 文件行数下降
git diff --stat | grep -E '\+[0-9]+.*-' | tail -5

# 5. 无新增 export（简化不应扩大接口）
git diff --stat | grep '\+.*export' || echo "无新增"
```

## 反模式检测

| 反模式 | 检测命令 | 修复 |
|--------|---------|------|
| `as any` | `grep -rn 'as any' packages/ --include='*.ts'` | 替换为类型守卫 |
| `@ts-ignore` | `grep -rn '@ts-ignore' packages/ --include='*.ts'` | 修复类型问题 |
| `console.log` | `grep -rn 'console\.log' packages/ --include='*.ts'` | 替换为 logger |
| 重复代码块 | `git diff --cached` 检查新增行 | 提取为共享函数 |
| 过度 `clone()` | `grep -rn '\.\.\.' packages/ --include='*.ts'` | 分析是否真的需要展开 |
| `as never` | `grep -rn 'as never' packages/ --include='*.ts'` | 理解类型问题并修复 |

## 输出格式

```markdown
## 简化报告

文件: packages/core/src/app.ts
检测前: 1140 行 → 检测后: 800 行 (-30%)

### 移除
- [行 45-78] 未使用变量 `LegacyAdapter` → 删除
- [行 203-206] 死代码 `if (false) { ... }`

### 拆分
- [app.ts] → `routes/auth.ts`, `routes/users.ts`, `routes/plugins.ts`

### 保留 (Chesterton's Fence)
- [行 300] `as never` cast — Drizzle 0.45 限制，见注释

### 验证
✅ pnpm tsc --noEmit
✅ pnpm test
```

## 禁止

- 删除不理解的代码
- 合并不相关的模块
- 在无 git blame 的情况下移除"看起来没用"的代码
- 删除 feature-gated 代码而不先确认 CI variant
