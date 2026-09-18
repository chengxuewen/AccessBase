# 批次 K 实施计划 — 防线批

**Spec:** `docs/superpowers/specs/2026-09-18-batch-k-defense-line-design.md`
**日期:** 2026-09-18
**级别:** full（双 Momus 强制）
**基线:** master `22c6ffd` · vitest 796 全绿 · e2e 125+3skip

## 任务分解（4 任务：T1 ∥ T2 ∥ T4；T3 依赖 T2 的 isSystem API 面）

### Task 1 — audit/stats 租户读隔离（server，G1/G2）

**RED：**
1. `apps/server/src/__tests__/audit.test.ts`（或既有 audit 路由测试文件，执行时定位）：两租户 fixture（tenant A/B 各写 audit_logs 行 + 一行 'system'），A 租户 JWT 请求 GET /v1/audit → 只见 A 行；'system' 行仅 DEFAULT_TENANT 请求可见；CSV 导出同谓词。
2. `stats.test.ts` 先例文件：A 租户 JWT → userCount/roleCount/auditCount/recent 只计本租户（sessions 经 join users）；B 租户数据不可见。

**GREEN：**
3. `routes/audit.ts` `buildWhere(query, tenantId)`：push `or(eq(auditLogs.tenantId, tenantId), and(eq(auditLogs.tenantId, 'system'), eq(tenantId-const, DEFAULT_TENANT)))`——注意 default-tenant 条件是请求期常量分支（default 则 `inArray(tenantId,[t,'system'])`，否则 `eq(tenantId,t)`），不是 SQL 里比较常量。两处调用点（list L74 / export L134）传 `request.tenantId ?? DEFAULT_TENANT`。
4. `routes/stats.ts`：四个计数 + recent 查询各挂租户谓词；activeSessionCount `innerJoin(users, eq(sessions.userId, users.id))` + `eq(users.tenantId, :t)`。
**禁改：** 审计写侧归属（middleware）、前端。
**验证：** 相关 vitest 文件 + 根 tsc。

### Task 2 — RBAC 护城河·后端（identity+server，G3/G4）

**RED（identity 层，mock 链风格沿 UserManager.test 先例）：**
1. RoleManager：`create({name, isSystem: true})` 落 isSystem；update/delete 对 isSystem 角色 throw `ROLE_PROTECTED:` 前缀（改既有裸 message）。
2. last-admin 谓词：`setUserRoles` 移除唯一 active admin → throw `LAST_ADMIN_GUARD:`；移除非 admin 角色/存在第二 admin/目标用户本就 suspended → 放行。unassignFromUser 同谓词。
3. server 层：roles.ts 409 映射测试（`{success:false,error:{code:'ROLE_PROTECTED'}}` 形，仿 tenants.ts TENANT_PROTECTED 测试先例）；users.ts delete/suspend 守卫测试（suspended 唯一 admin → 409 LAST_ADMIN_GUARD）。
4. self-heal stamp：permissions-seed 测试——启动自愈后 admin 角色 isSystem=true 幂等。

**GREEN：**
5. `RoleManager.create` input 加 `isSystem?: boolean`（默认 false）；错误 message 改 tag 前缀；新增私有 helper `wouldOrphanLastAdmin(tenantId, excludingUserId)`（users×user_roles×roles join，role.isSystem && users.status='active'，count ≤ 1 且排除者持有 admin → true）。setUserRoles/unassignFromUser 在「移除集含 isSystem admin 角色」时前置检查。
6. `UserManager.delete` 同谓词（delete 前查目标用户是否最后 active admin）。
7. `routes/roles.ts` 共享 error mapper（ROLE_PROTECTED/LAST_ADMIN_GUARD 前缀 → 409 envelope，仿 tenants.ts:21 模式，零 catch → 单 mapper 注册）；`routes/users.ts` suspend 分支前置检查（status==='suspended' 且最后 admin → 409）+ delete 路由 catch 映射。
8. `init.ts` + `setup.ts` admin 角色创建传 `isSystem: true`；`permissions-seed.ts` selfHealSeed 追加幂等 stamp（`UPDATE roles SET is_system=true WHERE name='admin'`——经 manager 或直 SQL，选与既有 seed 代码同风格的一条路；仅 index.ts 挂载点，守 buildApp 无副作用规约）。
9. `GET /v1/roles` list/detail 响应带 `isSystem`（Role entity 已有列，确认 mapToRole/API 映射透出；@accessbase/types Role interface 同步）。
**验证：** identity vitest + server roles/users vitest + identity build + 根 tsc。

### Task 3 — Roles 页护城河 UI（admin-ui，依赖 T2）

**RED：** `e2e/roles.spec.ts` 扩展：mock roles list 含 `isSystem: true` 行 → 该行编辑/删除按钮 disabled + 锁定标识；普通行不受影响。
**GREEN：** `Roles.tsx` 行操作按 isSystem 禁用；api 类型 `isSystem: boolean`；locales 两语言补 `ROLE_PROTECTED`/`LAST_ADMIN_GUARD` 错误码文案（沿 apiErrorMessage 既有 code→key 机制，执行时核对 409 是否走该链——若走通用错误则确认呈现可读即可）。
**验证：** admin-ui tsc + 相关 e2e 单文件。

### Task 4 — CORS 生产 fail-fast（server，G5）

**RED：** config fail-fast 测试——`NODE_ENV=production` + 空 `CORS_ORIGINS` → 加载 throw（沿 JWT_SECRET fail-fast 的既有测试接缝，先读 config.test/现状定方案，若既有无测试接缝则同形补两个 case：prod+空 throw / prod+设置 OK / dev+空 OK）。
**GREEN：** `config.ts:64` 邻域补一条与 :44 同形检查（含修复提示文案）。
**验证：** 该测试文件 + 根 tsc。与 T1/T2 零文件交叠，可全程并行。

### Task 5 — 收官回归 + 记忆（控制器自执行）

全量 vitest + 双 tsc + eslint 改动面 + 全量 e2e（workers=1）→ status.md 批次 K 记录 + conventions（防线约束：读侧谓词 keep-list？视审核结论）+ 必要 PIT。

## 风险与预裁定

- 读侧 'system' 归属：default=platform 可见规则是裁定项，Momus 可质疑但需给替代。
- last-admin 谓词的 status 语义：suspended/pending 不算 active admin（与批次 A 挂起门一致）。
- 守卫放 manager 层（所有调用方过闸）vs route 层（只守 HTTP）：manager 为准，route 层仅 suspend 补查——Momus 验证覆盖面（setup.ts 直建、SCIM PATCH 改 status 等旁路是否绕闸）。
- Roles.tsx 既有「清空权限确认」流程对 isSystem 行必须不可达（按钮禁用即达，T3 锁）。
