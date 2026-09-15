# Batch C Implementation Plan — API Key + Password Policy + Force Logout + CSV Import/Export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the P1 admin-feature remainder: API keys (service-to-service auth), configurable password policy, admin force-logout, and CSV export/import for audit logs and users.

**Architecture:** C1 adds an api_keys table + ApiKeyManager (sha256 hash storage, one-time plaintext reveal) and a JWT/API-key dual-read in the authenticate path (API key only when the Bearer token starts with `ab_`). C2 converges three hardcoded policy checks into a PasswordPolicy helper reading 4 options keys (defaults = current behavior). C3 wires an existing manager method (revokeAllUserSessions) to a new route + UI row action. C4/C5 share one CSV module (streamed export + injection guard) across two new endpoints and the import two-phase flow (dry-run report, then commit rows through UserManager.create which inherits pending/password-policy/audit semantics automatically).

**Tech Stack:** TypeScript strict, Drizzle ORM, drizzle-kit migration, arctic-free (node:crypto only), vitest, Playwright mock-API.

**Spec:** docs/superpowers/specs/2026-09-12-batch-c-admin-features-design.md (committed bf98357)

## Global Constraints

- TDD 红先行（D114）：每任务先写失败测试；vitest mock 不连真 PG；e2e mock-API（跑前 curl 5101 → 000，no_proxy 导出）
- identity 改动后 `pnpm --filter @accessbase/identity build`（dist 同步陷阱）；本批 identity 有改动（C1/C2）——**每次 identity 改动后 server 侧测试前必须 build**
- 新权限码 **3 个**（apikeys:read/write/delete）→ 双注册（authorize 路由映射 + BUILTIN_PERMISSIONS seed）+ conventions 期望计数 15→18 同 commit 更新；检查命令在 conventions Phase 8a 节
- API 信封 `{success,data}`；错误 `{success:false,error:{code,message}}`；pino 对象式；提交/注释英文
- CSV 注入防护：以 `=+-@` 开头的单元格加 `'` 前缀（C4/C5 共用 helper）
- API Key 明文仅 create 响应出现一次（一次性揭示，OIDC client 先例）；存储 SHA-256
- 认证双读不弱化 JWT 路径：仅 token 以 `ab_` 开头才走 API key 分支，其余原样 401
- 前端改动：tsc 双闸 + e2e 无新失败
- drizzle-kit 迁移文件提交（api_keys 表）；push 流程照旧

---

## Task 1: api_keys 表 + ApiKeyManager（C1 核心）

**Files:**
- Modify: `packages/identity/src/db/schema.ts`（apiKeys 表定义）
- Create: `packages/identity/drizzle/00XX_api_keys.sql`（drizzle-kit generate 或手写对齐现有迁移风格——先看既有迁移文件形态）
- Create: `packages/identity/src/managers/ApiKeyManager.ts`
- Modify: `packages/identity/src/index.ts`（导出）
- Test: `packages/identity/src/__tests__/ApiKeyManager.test.ts`（new）

**Interfaces:**
- Produces: 
  - `generateApiKey(): { plaintext: string; hash: string; prefix: string }`（plaintext=`ab_`+crypto.randomBytes(24).toString('base64url')→32+ 字符；hash=sha256(plaintext) hex；prefix=前 8 字符用于列表识别）
  - `class ApiKeyManager { create(name, scopes, tenantId, expiresAt?): Promise<SafeApiKey & { plaintext }> ; revoke(id, tenantId): Promise<void>; list(tenantId): Promise<SafeApiKey[]>; findByHash(hash): Promise<ApiKeyRow | null> }`——SafeApiKey 无 hash 字段（一次性揭示同 OidcClientManager 先例）
- Consumes: 既有 createDb/schema 模式（照 UserManager 形态）

- [ ] **Step 0: 迁移**——检查 packages/identity/drizzle/ 现有迁移命名与格式，按同样风格新增 api_keys 迁移（id uuid pk default gen_random_uuid()、name varchar(128)、prefix varchar(16)、hash varchar(64) unique、scopes jsonb default '["*"]'、expires_at timestamptz、last_used_at timestamptz、revoked_at timestamptz、tenant_id uuid、created_at/updated_at timestamptz default now()）+ hash 索引
- [ ] **Step 1: 写失败测试**（沿用既有 manager 测试 mock 模式）：generateApiKey 格式断言（ab_ 前缀/长度/hash=sha256 可复算）；create 返回明文且库行无明文；list 无 hash 泄露；findByHash 命中/未命中；revoke 后 findByHash 返回行但 revokedAt 非空（认证层判断失效）；过期 expiresAt 判定
- [ ] **Step 2: RED → 实现 → GREEN**；identity build；全量 vitest
- [ ] **Step 3: Commit** — `feat(identity): api_keys table + ApiKeyManager with one-time reveal (C1)`

---

## Task 2: 认证双读 + API Key CRUD 路由 + 权限码双注册（C1 接线）

**Files:**
- Modify: `apps/server/src/app.ts`（authenticate 装饰器双读分支）
- Create: `apps/server/src/routes/api-keys.ts`
- Modify: `apps/server/src/app.ts`（注册路由 + authorize 映射）
- Modify: `apps/server/src/routes/permissions-seed.ts`（+3 码）
- Modify: `.agents/memorys/conventions.md`（15→18 计数 + 检查命令期望值）——**同一 commit**
- Test: `apps/server/src/__tests__/api-keys.test.ts`（new）、`api-keys-auth.test.ts`（new）

**Interfaces:**
- Consumes: Task 1 ApiKeyManager；requirePermission（utils/permission.ts）；getRequiredPermission（映射表位置按现状——先 grep 确认映射文件）
- Produces: authenticate 双读：token.startsWith('ab_') → sha256 查找 → revokedAt/expiresAt 校验 → request.user={sub:keyId,type:'apikey',scopes:['*'],tenantId}；非 ab_ → JWT 原路径不变。路由：GET/POST /api/v1/auth/api-keys（apikeys:read/write）、DELETE /:id（apikeys:delete）

- [ ] **Step 1: 失败测试**——api-keys.test.ts：三路由权限门（无码 403 PERM_001）；create→201+一次性明文；list 无 hash；revoke→200；双读测试：ab_ token 有效→200、ab_ token 已 revoke→401、非 ab_ 垃圾 token→401 AUTH_001（JWT 路径不变）、JWT 正常→200
- [ ] **Step 2: RED → 接线**（authenticate 双读在 jwtVerify try 之前判断前缀；映射表 + seed 三码——**照 conventions Phase 8a 双注册纪律**）→ GREEN
- [ ] **Step 3: conventions 计数更新同 commit**（grep 检查命令期望 15→18）
- [ ] **Step 4: 全量 vitest + tsc + identity build；Commit** — `feat(server,identity): API key dual-read auth + CRUD routes + 3 permission codes (C1)`

---

## Task 3: Settings API Keys 管理页（C1 前端）

**Files:**
- Create: `apps/admin-ui/src/pages/ApiKeys.tsx`（照 Clients 页形态：表格+创建 Modal+一次性揭示 Alert+撤销 Popconfirm）
- Modify: 路由注册 + Settings/菜单入口（照 Clients 页接线——先 grep Clients 在 router/menu 的三处注册点）
- Modify: `apps/admin-ui/src/api/`（新增 apiKeys.ts：list/create/revoke 信封类型）
- Test: `e2e/api-keys.spec.ts`（new）

**Interfaces:**
- Consumes: Task 2 路由；权限门 apikeys:read（菜单/路由门照 Clients 形态）
- Produces: 管理页完整流（创建→揭示一次→列表→撤销）

- [ ] **Step 1: e2e RED**（mock CRUD + 揭示流；照 clients.spec 模式含 GlobalGuard mock）
- [ ] **Step 2: 页面 + api 层实现 → GREEN**；tsc 双闸
- [ ] **Step 3: 全量门禁；Commit** — `feat(admin-ui): API keys management page with one-time reveal (C1)`

---

## Task 4: PasswordPolicy 服务 + 三调用点收口（C2）

**Files:**
- Create: `packages/identity/src/services/password-policy.ts`
- Modify: `packages/identity/src/index.ts`
- Modify: `apps/server/src/routes/auth.ts`（register :225 区、changePassword、resetPassword 三处收口）
- Test: `packages/identity/src/__tests__/password-policy.test.ts`（new）、auth 相关测试参数化补充

**Interfaces:**
- Produces: `assertPasswordPolicy(pw: string, opts: { minLength: number; requireUpper: boolean; requireLower: boolean; requireDigit: boolean }): { ok: boolean; code?: 'AUTH_REG_002'; message?: string }`；调用点从 options 三参读策略（`password_min_length` int env PASSWORD_MIN_LENGTH default 8；三个 require_* bool env 同名 default true）
- 行为契约：默认 env/option 均缺省 → 与现行为逐字节一致（既有测试零改动通过 = 回归锁）

- [ ] **Step 1: 失败测试**——assertPasswordPolicy 全矩阵（min/upper/lower/digit 各维 + 组合）；register 弱密码用例在策略 options 变更后行为变化（如 min_length=4 时 'Ab1' 通过）——用 seam 注入
- [ ] **Step 2: RED → 实现 + 三处收口 → GREEN（既有弱密码用例零改动通过）**
- [ ] **Step 3: identity build + 全量；Commit** — `feat(identity,server): configurable password policy via options (C2)`

---

## Task 5: CSV 模块 + 审计/用户导出（C4 + C5a）

**Files:**
- Create: `apps/server/src/utils/csv.ts`（toCsv(rows, headers) + 注入防护 + escape）
- Modify: `apps/server/src/routes/audit.ts`（GET /export）
- Modify: `apps/server/src/routes/users.ts`（GET /export）
- Test: `apps/server/src/__tests__/csv-export.test.ts`（new）

**Interfaces:**
- Produces: `toCsv(headers: string[], rows: Record<string,unknown>[]): string`（RFC4180 引号转义 + `=+-@` 前缀 `'` 注入防护）；audit export 复用 list 的过滤参数（actor/action/dateRange），OFFSET 循环全量；users export 全字段平铺（roles 列 join 逗号）；响应头 `text/csv; charset=utf-8` + `Content-Disposition: attachment; filename=audit-2026-09-12.csv`
- 权限：audit:read / users:read（既有码，零新增）

- [ ] **Step 1: 失败测试**——toCsv 基本形状/引号转义/注入防护四前缀/空 rows；audit export 路由（权限门+头+内容形状）；users export 同
- [ ] **Step 2: RED → 实现 → GREEN**；全量；Commit — `feat(server): CSV export module + audit/users export endpoints (C4,C5a)`

---

## Task 6: 用户导入两段式 + 前端接线（C5b）+ 强制下线（C3）

**Files:**
- Modify: `apps/server/src/routes/users.ts`（POST /import；POST /:id/force-logout）
- Modify: `apps/admin-ui/src/pages/Users.tsx`（导入/导出按钮 + 结果 Modal + 行操作 force-logout）
- Test: `apps/server/src/__tests__/users-import.test.ts`（new）、e2e users 相关 spec 扩展

**Interfaces:**
- Consumes: Task 4 PasswordPolicy（导入行密码校验）；UserManager.create（pending 语义自动继承）；revokeAllUserSessions + invalidatePermissionCache（C3）
- Produces: POST /import multipart 或 JSON rows（先 JSON rows 简化——`{rows:[{email,name,password}], commit?: boolean}`）：commit 缺省= dry-run 报告 `{valid: n, errors: [{row, field, message}]}`；commit=true → 逐行 create、成功计数+失败行报告（单行失败不回滚整体，报告呈现）。force-logout：`{success:true,data:{revoked: n}}`
- CSV 解析：前端把 CSV 转 JSON rows 再调 API（后端不做 CSV 解析——保持后端单一职责；前端 papaparse 已有？先 grep——无则手写简版解析 20 行内）

- [ ] **Step 1: 失败测试**——import dry-run 报告形状/错误行隔离（bad email 行不阻好行）/commit 模式 create 调用计数+pending 断言/force-logout 权限门+revoked 计数+缓存失效调用断言
- [ ] **Step 2: RED → 实现 → GREEN**；前端接线（导入 Modal 展示报告；导出下载；force-logout 行操作带 confirm）
- [ ] **Step 3: 全量门禁（vitest/tsc×2/e2e 全量）；Commit** — `feat(server,admin-ui): users import/export + force-logout (C3,C5b)`

---

## Task 7: 收官门禁

**Files:** 无新产物（验证性）；失败修复归本任务

- [ ] **Step 1**: 5101→000 + no_proxy；vitest 全量（预期 491+新增）；tsc ×2；e2e 全量 chromium（基线 107+3skip + 本批新增，零失败）
- [ ] **Step 2**: conventions 双注册检查命令跑一遍（18 码）——`grep -c "resource: '" permissions-seed.ts` 应 =18
- [ ] **Step 3**: 汇报精确数字；修复归本任务 commit

---

## 验收清单（批次 C 完成定义）

- [ ] API Key：创建一次性揭示 / 双读认证（JWT 不弱化）/ revoke 即时 401 / 管理页全流 e2e
- [ ] 密码策略：4 options 键生效（env 回退）/ 默认值=现行为（既有测试零改动）/ 三调用点单一来源
- [ ] 强制下线：路由 + 行操作 + refresh 失效 e2e
- [ ] 审计/用户 CSV 导出（注入防护 + 权限门）
- [ ] 用户导入 dry-run + commit 两段式（pending 语义继承）
- [ ] 权限码 18 双注册 + conventions 计数更新
- [ ] vitest 全绿 / tsc 双闸 / e2e 零新失败
