# Setup Wizard 首次初始化统一化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 admin 初始化统一到 Setup Wizard（DB 为唯一真相源），消除启动时自动建 admin + 随机密码进日志的旁路；`reset` 清库后天然回到向导；env 双变量保留为自动化部署的显式旁路。

**Architecture:** 状态推导制——`/setup/status` 与 setupGuard 都从 `users` 表实时推导 `adminExists`（DB 即真相，删除内存 `setupState`/`setupComplete`），`init.ts` 收缩为"状态同步器"（仅 env 双变量齐备时创建 admin，吞错不崩启动），`accessbase.sh reset` 补 schema push + 可脚本化确认 + 重启提示。

**Tech Stack:** TypeScript / Fastify v4 / Drizzle ORM / Vitest / Playwright / bash

**Spec:** 本计划自含 spec（2026-09-01 对话中与用户逐项确认：方案本体 4 项 + reset 对齐 + 测试 + 文档）

## Global Constraints

- 禁止 `as any` / `@ts-ignore` / `@ts-expect-error`
- tsc 双检查必须过：`pixi run npx tsc --noEmit`（root）+ `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json`
- vitest 基线 300 用例，允许测试数变化但 **0 新失败**
- E2E 基线 60 passed / 2 pre-existing（users-search + setup-full-flow）；运行命令 `NO_PROXY="localhost,127.0.0.1" pixi run npx playwright test --project=chromium`
- E2E mock-passthrough 教训：现有 spec 挂载页面新增的任何请求必须 mock
- 每 Task 独立 commit，conventional commits
- 环境事实：DB `postgresql://accessbase:accessbase@localhost:5432/accessbase`；手动起 server 必须带 `DATABASE_URL`+`REDIS_URL`，用 `setsid nohup` + PID 文件（PIT-025/026）；本机代理需 `NO_PROXY`
- 现有 admin：`admin@accessbase.local` / `bQ0zGWZHX2hp0sJ5`（Task 3 reset 冒烟会删除它，之后按 Task 3 Step 3 重建）

---

### Task 1: setup 状态改为 DB 实时推导

**Files:**
- Modify: `apps/server/src/routes/setup.ts`（删内存 `setupState` 与 `setAdminExists`/`setIsInitialized`，新增导出 `getSetupStatus` + `isSystemInitialized`）
- Modify: `apps/server/src/middleware/setup-guard.ts`（删 `setupComplete` 内存态与 `setSetupComplete`，改调 `isSystemInitialized()`）
- Modify: `apps/server/src/init.ts`（本任务**临时**处理：删掉其对旧 setter 的引用与调用块，保留其余逻辑原样——Task 2 整体重写）
- Modify: `apps/server/src/app.ts`（line 18 import 与 line 28 re-export 的 `setSetupComplete` 一并移除——Momus 审核发现的引用点，tsc 门禁强制处理）
- Test: `apps/server/src/__tests__/setup-guard.test.ts`（重写状态相关用例）

**Interfaces:**
- Consumes: `UserManager.findByEmail(email: string): Promise<User | null>`（`packages/identity/src/managers/UserManager.ts:75`）；`config.adminEmail`（`apps/server/src/config.ts:13`，可能为空字符串，代码须兜底 `'admin@accessbase.local'`）
- Produces: `getSetupStatus(): Promise<{ isInitialized: boolean; adminExists: boolean; configComplete: boolean }>` — **永不 reject**（status 端点用，内部 catch 转 false + log error）
- Produces: `isSystemInitialized(): Promise<boolean>` — DB 失败时 **reject**（guard 三态判定用：resolve true / resolve false / reject）
- Produces: guard 三态行为——DB 不可达 → **503 `SETUP_STATE_UNAVAILABLE`**；未初始化 → **403 `SETUP_REQUIRED`**（白名单路径不受限）；已初始化 → 放行（setup 写端点 410 `SETUP_ALREADY_COMPLETE` 沿用现有 `SETUP_WRITE_PATHS`）

- [ ] **Step 1: 写失败测试**

重写 `setup-guard.test.ts` 中状态相关用例。mock 模式沿用该文件现有的 `vi.mock('@accessbase/identity')` 写法，核心用例：

```typescript
// 用例 1: findByEmail → 非 null
//   GET /api/v1/setup/status → 200 { adminExists: true, isInitialized: true, configComplete: true }
//   POST /api/v1/setup/admin → 410 SETUP_ALREADY_COMPLETE
// 用例 2: findByEmail → null
//   GET /api/v1/setup/status → 200 { adminExists: false, isInitialized: false }
//   GET /api/v1/users → 403 SETUP_REQUIRED
//   POST /api/v1/setup/admin → 放行（identity mock 后路由内部行为不限，断言 status !== 403 && !== 410）
// 用例 3: findByEmail → rejects(new Error('db down'))
//   GET /api/v1/setup/status → 200 { adminExists: false, ... }（status 端点 fail-open）
//   GET /api/v1/users → 503 SETUP_STATE_UNAVAILABLE（guard fail-closed，三态区分）
// 用例 4: 白名单——未初始化时 /api/v1/setup/status 与 /api/v1/setup/checks 不被拦截
// 用例 5: config.adminEmail 为空字符串 → findByEmail 收到 'admin@accessbase.local'（兜底生效）
```

- [ ] **Step 2: 运行确认失败**

Run: `pixi run npx vitest run apps/server/src/__tests__/setup-guard.test.ts`
Expected: FAIL——`isSystemInitialized`/`getSetupStatus` 不存在或内存 setter 断言失败

- [ ] **Step 3: 实现**

`setup.ts`——删除 `let setupState = {...}`、`setAdminExists`、`setIsInitialized`（保留 `setupInProgress` 防并发创建），新增：

```typescript
import { UserManager } from '@accessbase/identity';
import { config } from '../config.js';

export type SetupStatus = {
  isInitialized: boolean;
  adminExists: boolean;
  configComplete: boolean;
};

// 内部：不 catch，DB 失败时 throw（guard 三态判定依赖 reject 信号）
async function queryAdminExists(): Promise<SetupStatus> {
  const userManager = new UserManager();
  const admin = await userManager.findByEmail(config.adminEmail || 'admin@accessbase.local');
  if (admin) return { isInitialized: true, adminExists: true, configComplete: true };
  return { isInitialized: false, adminExists: false, configComplete: false };
}

// status 端点用：永不 reject（fail-open + log）
export async function getSetupStatus(): Promise<SetupStatus> {
  try {
    return await queryAdminExists();
  } catch (err) {
    logger.error({ err }, 'getSetupStatus: DB query failed — reporting uninitialized');
    return { isInitialized: false, adminExists: false, configComplete: false };
  }
}

// setup-guard 用：DB 失败时 reject
export async function isSystemInitialized(): Promise<boolean> {
  const status = await queryAdminExists();
  return status.isInitialized;
}
```

`/status` 路由 handler 改为 `return { success: true, data: await getSetupStatus() }`。

`setup-guard.ts` 重写核心：

```typescript
import { isSystemInitialized } from '../routes/setup.js';

export async function setupGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.url;
  if (ALLOWED_PATHS.some((path) => (path === '/' ? url === '/' : url.startsWith(path)))) return;

  let initialized: boolean;
  try {
    initialized = await isSystemInitialized();
  } catch (err) {
    logger.error({ err, url }, 'Setup state unavailable (DB error) — failing closed');
    return reply.status(503).send({
      success: false,
      error: { code: 'SETUP_STATE_UNAVAILABLE', message: 'Setup state cannot be determined.' },
    });
  }

  if (initialized && SETUP_WRITE_PATHS.some((path) => url.startsWith(path))) {
    return reply.status(410).send({
      success: false,
      error: { code: 'SETUP_ALREADY_COMPLETE', message: 'System setup has already been completed.' },
    });
  }

  if (!initialized && !url.startsWith('/api/v1/setup')) {
    return reply.status(403).send({
      success: false,
      error: { code: 'SETUP_REQUIRED', message: 'System setup is not complete. Please complete setup first.' },
    });
  }
}
```

注意：guard 每请求一次 DB 点查（users.email 唯一索引），dev 规模完全可接受；缓存优化明确不做（YAGNI，D113 备注可后续加）。

- [ ] **Step 4: 运行通过**

Run: `pixi run npx vitest run apps/server/src/__tests__/setup-guard.test.ts`
Expected: PASS 全部用例

- [ ] **Step 5: 旧引用清理 + 全量门禁**

Run: `grep -rn "setSetupComplete\|setAdminExists\|setIsInitialized" apps/server/src/ --include="*.ts"`
Expected: Task 1 完成后仅可能在**测试文件**命中（security/mfa/jwt-rs256/password/audit-logs/oauth/roles/users/permissions/auth-sessions/auth-refresh/stats/mfa-integration 等 14 个测试 mock 过这些 setter）——逐文件移除相关 mock 行或适配新导入，**不得删除测试用例本身**
Run: `pixi run npx vitest run` → 0 新失败；tsc 双检查通过
（`init.ts` 内对旧 setter 的调用必须在本步骤中一并移除——最简单方式：该调用块改为直接删除，init.ts 剩余逻辑 Task 2 再重写；tsc 必须绿）

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/setup.ts apps/server/src/middleware/setup-guard.ts apps/server/src/init.ts apps/server/src/__tests__/
git commit -m "feat(setup): derive setup state from users table — DB as single source of truth"
```

---

### Task 2: init.ts 收缩为状态同步器 + env 双变量旁路

**Files:**
- Modify: `apps/server/src/init.ts`（重写）
- Modify: `apps/server/src/index.ts`（**不改**——`initializeAdmin(app)` 调用点与签名保持不变）
- Test: `apps/server/src/__tests__/init.test.ts`（新建）

**Interfaces:**
- Consumes: `UserManager`/`RoleManager`（identity 包）；`config.adminEmail` / `config.adminPassword`
- Produces: `initializeAdmin(app: FastifyInstance): Promise<void>` 签名不变。行为：admin 存在 → no-op；不存在 + `config.adminEmail && config.adminPassword` 双齐 → 创建 admin（**不再生成随机密码，密码绝不入日志**）；env 不齐 → 仅日志 "Setup Wizard will run on first access"；**任何异常吞掉不 throw**（向导接管，启动不崩）

- [ ] **Step 1: 写失败测试**

新建 `apps/server/src/__tests__/init.test.ts`。config mock 提为**模块级可变对象**，用例内改字段后 `vi.resetModules()` + 动态 re-import：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@accessbase/logging';

const mockFindByEmail = vi.fn();
const mockCreateUser = vi.fn();
const mockCreateRole = vi.fn();

vi.mock('@accessbase/identity', () => ({
  UserManager: vi.fn().mockImplementation(() => ({
    findByEmail: mockFindByEmail,
    create: mockCreateUser,
  })),
  RoleManager: vi.fn().mockImplementation(() => ({ create: mockCreateRole })),
}));

vi.mock('../config.js', () => ({
  config: { adminEmail: '', adminPassword: '' },
}));

// 每个用例: 修改 mock config 字段 → vi.resetModules() → await import('../init.js')

// 用例 1: findByEmail → 非 null → create 未被调用（no-op）
// 用例 2: findByEmail → null + adminEmail='x@y.z' + adminPassword='Xxx12345678'
//   → mockCreateUser 以 expect.objectContaining({ email: 'x@y.z' }) 被调用
//   → logger.warn 未收到含 password 字段的对象（密码不入日志断言）
// 用例 3: findByEmail → null + adminEmail='x@y.z' + adminPassword=''（单边）
//   → create 未被调用；logger.info 收到含 'Setup Wizard will run on first access' 的调用
// 用例 4: findByEmail → rejects → initializeAdmin resolves undefined（吞错不崩）
```

- [ ] **Step 2: 运行确认失败**

Run: `pixi run npx vitest run apps/server/src/__tests__/init.test.ts`
Expected: FAIL（现 init.ts 行为：会创建 / 会 throw / 密码入日志）

- [ ] **Step 3: 重写 init.ts**

```typescript
/**
 * Setup state synchronizer + env-bypass admin creation.
 * DB 是 setup 状态唯一真相源（D113）；本模块仅在 env 双变量齐备时显式创建 admin。
 */
import type { FastifyInstance } from 'fastify';
import { UserManager, RoleManager } from '@accessbase/identity';
import { logger } from '@accessbase/logging';
import { config } from './config.js';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

export async function initializeAdmin(_app: FastifyInstance): Promise<void> {
  try {
    const userManager = new UserManager();
    const email = config.adminEmail || 'admin@accessbase.local';
    const admin = await userManager.findByEmail(email);
    if (admin) {
      logger.info('Admin user already exists, skipping initialization');
      return;
    }

    if (config.adminEmail && config.adminPassword) {
      // env bypass for automated deployments (Docker/CI) — D113
      const roleManager = new RoleManager();
      const adminRole = await roleManager.create(
        { name: 'admin', description: 'System administrator with full access' },
        DEFAULT_TENANT,
      );
      await userManager.create(
        { email, name: 'Administrator', password: config.adminPassword, roles: [adminRole.id] },
        DEFAULT_TENANT,
      );
      logger.warn({ email }, 'Admin created via ADMIN_EMAIL/ADMIN_PASSWORD env bypass');
      return;
    }

    logger.info('No admin user found — Setup Wizard will run on first access');
  } catch (err) {
    logger.error({ err }, 'initializeAdmin failed — Setup Wizard will handle on first access');
  }
}
```

（`generatePassword` 函数与 `DEFAULT_TENANT` 以外的全部旧逻辑删除。）

- [ ] **Step 4: 运行通过 + 全量门禁**

Run: `pixi run npx vitest run apps/server/src/__tests__/init.test.ts` → PASS
Run: `grep -n "generatePassword" apps/server/src/init.ts` → 无输出
Run: `pixi run npx vitest run`（0 新失败）+ tsc 双检查

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/init.ts apps/server/src/__tests__/init.test.ts
git commit -m "feat(setup): init.ts → state sync + env dual-var bypass; eliminate random password in logs"
```

---

### Task 3: accessbase.sh reset 对齐 + 确认提示

**Files:**
- Modify: `accessbase.sh`（`cmd_reset_native`，line ~267-278）

**Interfaces:**
- Consumes: `scripts/native/{pg-stop,redis-stop,pg-init}.sh`（现有）；`pnpm db:push`（根 package.json 已有）
- Produces: reset 完成 = 空库 + 表结构就绪；dev 重启后 `GET /api/v1/setup/status` 返回 `adminExists:false` → 浏览器访问进向导

- [ ] **Step 1: cmd_reset_native 改造**

```bash
cmd_reset_native() {
    log_warn "This will DELETE all native data (PG+Redis) — system returns to Setup Wizard on next dev start"

    # Confirm guard — non-interactive bypass for scripts/CI
    if [ "${ACCESSBASE_RESET_CONFIRM:-}" != "yes" ]; then
        read -r -p "Type 'yes' to confirm reset: " reply
        if [ "$reply" != "yes" ]; then
            log_error "Reset cancelled"
            return 1
        fi
    fi

    export PATH="${PROJECT_ROOT}/.pixi/envs/native/bin:$PATH"
    bash "${SCRIPT_DIR}/scripts/native/pg-stop.sh"
    bash "${SCRIPT_DIR}/scripts/native/redis-stop.sh"
    log_info "Deleting data..."
    rm -rf "${PROJECT_ROOT}/.pixi/data/pg" "${PROJECT_ROOT}/.pixi/data/redis"
    log_info "Reinitializing..."
    bash "${SCRIPT_DIR}/scripts/native/pg-init.sh"

    # Schema push — 空库无表则向导无法创建 admin（users 表不存在）
    log_info "Pushing database schema..."
    if ! pnpm db:push; then
        log_error "Schema push failed — wizard cannot create admin without tables"
        return 1
    fi

    log_ok "Reset complete — next 'bash accessbase.sh dev' boots into Setup Wizard"
    log_info "If dev servers are running, restart them to pick up the fresh DB"
}
```

（分发点 `reset:native)` 与 `reset)` 不变；`read` 在非 TTY 下会失败读——`ACCESSBASE_RESET_CONFIRM=yes` 旁路覆盖 CI/脚本场景。）

- [ ] **Step 2: 手验（真删数据，执行前确认无重要数据）**

```bash
ACCESSBASE_RESET_CONFIRM=yes bash accessbase.sh reset
# Expected: 停服务 → 删目录 → 重建 → push 成功 → 结尾提示语
# 取消路径: 直接回车 → "Reset cancelled" → 数据完好

# 空库验证:
export PATH=".pixi/envs/native/bin:$PATH"
psql -h localhost -U accessbase -d accessbase -c "SELECT count(*) FROM users;"   # Expected: 0

# 全周期冒烟:
bash accessbase.sh dev    # 前台, 等 "AccessBase running" 横幅
# 另一终端:
NO_PROXY="localhost,127.0.0.1" curl -s http://localhost:5101/api/v1/setup/status
# Expected: {"success":true,"data":{"isInitialized":false,"adminExists":false,...}}
# 浏览器 http://localhost:5173 → 自动重定向 /setup → 向导三步走通 → 登录页
# 启动日志确认: 无 "Generated admin password" 字样
# Ctrl+C 停 dev
```

- [ ] **Step 3: 重建基线 admin（恢复 E2E 前置；顺带真实验证 env 双变量旁路）**

```bash
ADMIN_EMAIL=admin@accessbase.local ADMIN_PASSWORD='bQ0zGWZHX2hp0sJ5' \
DATABASE_URL=postgresql://accessbase:accessbase@localhost:5432/accessbase \
REDIS_URL=redis://localhost:6379 \
pixi run pnpm --filter @accessbase/server dev
# 等待日志 "Admin created via ADMIN_EMAIL/ADMIN_PASSWORD env bypass" → Ctrl+C

# 确认:
NO_PROXY="localhost,127.0.0.1" curl -s http://localhost:5101/api/v1/setup/status
# Expected: adminExists:true
```

- [ ] **Step 4: 记录 D113 + PIT-027**

`.agents/memorys/decisions.md` 追加：

```markdown
## D113: Setup 状态以 DB 为准 + env 双变量旁路 (2026-09-01)

- **决策**: setup 状态（isInitialized/adminExists/configComplete）不再内存化，每次从 users 表推导；env 旁路收紧为 ADMIN_EMAIL+ADMIN_PASSWORD 双变量齐备才触发，未设则首次访问进入 Setup Wizard
- **理由**: DB-as-truth 使 reset/新环境天然回向导，无状态漂移；双变量设计防半配置意外旁路；随机密码进日志的隐患一并消除
- **参考**: docs/superpowers/plans/2026-09-01-setup-wizard-unification.md
```

`.agents/memorys/pitfalls.md` 追加：

```markdown
## PIT-027: reset 后 server 未重启 → 内存 setupState 与 DB 漂移 (2026-09-01)

- **症状**: reset 清库后访问不出向导，/setup/status 仍报 initialized（旧机制下）
- **根因**: setupState/setupComplete 为内存变量，与 DB 生命周期不同步；reset 不重启 server
- **解法**: D113 DB 推导制落地后免疫；accessbase.sh reset 补 db:push + 重启提示
- **验证**: reset → dev 重启 → /setup/status 返回 adminExists:false
- **禁止**: 重新引入内存态 setup 标记；reset 后不重启 server 继续操作
```

- [ ] **Step 5: Commit**

```bash
git add accessbase.sh .agents/memorys/decisions.md .agents/memorys/pitfalls.md
git commit -m "feat(dev): reset → schema push + confirm guard + wizard boot (D113/PIT-027)"
```

---

### Task 4: E2E 验证 + 文档收尾

**Files:**
- Test: `e2e/setup.spec.ts`（检查是否需适配新行为）
- Modify: `.agents/memorys/status.md`（近期工作行）

**Interfaces:**
- Consumes: Task 1-3 全部产出 + Task 3 Step 3 重建的基线 admin
- Produces: 验收证据 + 文档同步

- [ ] **Step 1: 检查 setup.spec.ts 对新行为的依赖**

Run: `grep -n "needsSetup\|setup/status\|setup/admin\|Generated admin" e2e/setup.spec.ts`
检查点：mock 版 spec 是否 mock `/setup/status`（mock 与后端实现无关，预计不受影响）；真后端 full-flow 是否依赖"启动即自动建 admin"旧行为——若依赖，适配为 Task 3 Step 3 的 env 旁路前置。**若失败根因是预存环境问题则保持预存并注明根因，不强制转绿。**

- [ ] **Step 2: 全量 E2E**

Run: `NO_PROXY="localhost,127.0.0.1" pixi run npx playwright test --project=chromium`
Expected: ≥60 passed / ≤2 failed（users-search + setup-full-flow），**0 新失败**。若 setup-full-flow 本次转绿 → 更新基线表述。

- [ ] **Step 3: status.md 同步**

`.agents/memorys/status.md` 近期工作追加：

```markdown
- 2026-09-01: Setup 统一化（setup 状态 DB 推导 D113 / init.ts 收缩 + env 双变量旁路 / reset 天然回向导 PIT-027；vitest 0 新失败 / E2E 无回归）
```

- [ ] **Step 4: Commit**

```bash
git add e2e/setup.spec.ts .agents/memorys/status.md
git commit -m "test(e2e): setup wizard unification adaptation + status sync"
```

---

## 验收清单（人工，实施完成后逐项打勾）

- [ ] 全新环境模拟：`ACCESSBASE_RESET_CONFIRM=yes bash accessbase.sh reset` → `bash accessbase.sh dev` → 浏览器自动进 `/setup` → 向导三步走通 → 登录成功
- [ ] env 双变量旁路：`ADMIN_EMAIL`+`ADMIN_PASSWORD` 启动 → admin 自动存在，向导不出现，日志无密码明文
- [ ] env 单变量（只设 email）：启动日志出现 "Setup Wizard will run on first access"，向导出现
- [ ] reset 取消：交互中直接回车 → "Reset cancelled"，数据完好
- [ ] 全量门禁：vitest 0 新失败 / E2E 0 新失败 / tsc 双绿
