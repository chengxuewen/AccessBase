# 批次 K 实施计划 — 防线批（审核修订版）

**Spec:** `docs/superpowers/specs/2026-09-18-batch-k-defense-line-design.md`
**日期:** 2026-09-18
**级别:** full（双 Momus 已审 → 附录 R1-R7 已吸收进本文）
**基线:** master `1c119a8` · vitest 796 全绿 · e2e 125+3skip

## 任务分解（4 任务：T1 ∥ T2 ∥ T4；T3 依赖 T2 的 isSystem API 面）

### Task 1 — audit/stats 租户读隔离（server，G1/G2）

**RED（扩展既有文件，setAuditDb/setStatsDb 注入接缝）：**
1. `apps/server/src/__tests__/audit-logs.test.ts`：两租户 fixture（A/B 行 + 'system' 行，mock db 结构捕获或忠实过滤）——A 租户 JWT → 仅 A 行；'system' 行仅 DEFAULT_TENANT 请求可见；`csv-export.test.ts` 同谓词（路由实名 `/api/v1/audit-logs`）。
2. `apps/server/src/__tests__/stats.test.ts`：A 租户 JWT → 四计数 + recent 只计本租户（sessions 经 join users.tenantId）；B 数据不可见。

**GREEN：**
3. `routes/audit.ts` `buildWhere(query, tenantId)`：请求期常量分支——`:t === DEFAULT_TENANT` → `inArray(auditLogs.tenantId, [t, 'system'])`；否则 `eq(auditLogs.tenantId, t)`。两处调用（L74 list / L134 export）传 `request.tenantId ?? DEFAULT_TENANT`。
4. `routes/stats.ts`：handler 签名补 `request`；四计数 + recent 挂租户谓词（audit 计数同 'system' 规则）；activeSessionCount `innerJoin(users, eq(sessions.userId, users.id))` + `eq(users.tenantId, :t)`。
**禁改：** 审计写侧归属（middleware）——认证事件归 'system' 是已知边界（附录语义注记，写侧归属 L 批 backlog）。
**验证：** 三 vitest 文件 + 根 tsc。

### Task 2 — RBAC 护城河·后端（identity+server，G3/G4，附录 R1/R2/R4/R5/R7）

**RED：**
1. `packages/identity/src/__tests__/RoleManager.test.ts`（makeChain mock 风格沿 UserManager.test 先例）：`create({name, isSystem: true})` 落库；update/delete 对 isSystem 角色 throw 以 `ROLE_PROTECTED:` 前缀开头。
2. 新模块单测 `last-admin-guard.test.ts`：谓词纯函数——唯一 active admin 被移除/挂起/删除 → true；两名 admin 剩一 → 放行；目标持非 admin 角色 / 本就 suspended → 放行；转 'pending'/'active' 不触发。
3. `UserManager.test.ts`：delete 唯一 admin → throw `LAST_ADMIN_GUARD:`；changeStatus(→suspended) 唯一 admin → throw；changeStatus(→active/pending) 放行；`setUserRoles`/`revokeFromUser`（RoleManager.test）移除唯一 admin 的 admin 角色 → throw。
4. server：`roles.test.ts`——manager mock reject `ROLE_PROTECTED: x` → 409 envelope `{code:'ROLE_PROTECTED'}`；`users.test.ts`——**PUT /:id 改 roleIds 触发 reject `LAST_ADMIN_GUARD:` → 409**（R5 新用例）+ DELETE 同形 + PATCH /status suspend 经 changeStatus throw → 409；SCIM 用例：PATCH active=false 唯一 admin → SCIM 形状错误（非 500 裸文本，经 scoped error handler）。
5. `permissions-seed.test.ts`：stamp 幂等——连跑两遍，admin 角色（含非默认租户）isSystem=true，第二遍零变更零 throw。

**GREEN：**
6. 新模块 `packages/identity/src/services/last-admin-guard.ts`：导出 `wouldOrphanLastAdmin(db, tenantId, excludingUserId)`（users×user_roles×roles，`roles.isSystem && users.status='active'`，持有者中排除目标后计数 == 0 → true）；`ROLE_PROTECTED` / `LAST_ADMIN_GUARD` tag 常量随出（TENANT_PROTECTED 先例）。
7. `RoleManager`：create input 加 `isSystem?: boolean`（默认 false）；update/delete 守卫 message 改 tag 前缀；setUserRoles（移除集 ∩ 目标现持 isSystem-admin 非空时）与 revokeFromUser（同形，实名 R7）前置闸；mapToRole 透出 `isSystem`；identity `types.ts` / `@accessbase/types` Role interface 同步。
8. `UserManager`：delete 与 changeStatus(→suspended) 前置闸（route 层零预查——SCIM 五处直调同闸，R2）；auth.ts 注册 'pending' 转换不受影响（谓词只挂 suspended）。
9. `routes/roles.ts` + `routes/users.ts`：共享 error mapper（前缀 → 409 envelope + 可读英文 message，仿 tenants.ts sendTenantError 形态；users.ts POST/PUT/DELETE/status 四路由 catch 统一过闸）。
10. 落点：`init.ts`/`setup.ts` admin 角色 create 传 `isSystem: true`；`permissions-seed.ts` selfHealSeed 追加 **direct SQL 无租户过滤** `UPDATE roles SET is_system = true WHERE name = 'admin'`（不走 manager.update——input 不收 + 非幂等，R4）；仅 index.ts 挂载（buildApp 无副作用规约）。
**验证：** identity vitest → `pnpm --filter @accessbase/identity build` → server roles/users/scim/permissions-seed vitest → 根 tsc。

### Task 3 — Roles 页护城河 UI（admin-ui，依赖 T2，附录 R6/R7）

**RED：** `e2e/roles-crud.spec.ts`（实名，非 roles.spec.ts）扩展：roles list mock 一行 `isSystem: true` → 该行编辑/删除控件 disabled；普通行不受影响。
**GREEN：** `Roles.tsx` 行操作按 isSystem 禁用 + 锁定标识；api 类型补 `isSystem: boolean`。**不做 locales 补键**——409 message 由服务端 mapper 供可读英文，`apiErrorMessage` 透传即达标（R6：code→key 机制不存在）。
**验证：** admin-ui tsc + roles-crud 单文件 e2e。

### Task 4 — CORS 生产 fail-fast + 启动路径接线（server+ops，G5，附录 R3）

**RED：** `config.test.ts` 沿既有 resetModules+env 接缝：prod + 有 JWT_SECRET + 空 CORS_ORIGINS → import throw；prod + CORS_ORIGINS 已设 → OK；dev + 空 → OK。
**GREEN：**
1. `config.ts`：`requireCorsOrigins(env)` 与 requireJwtSecret 同形（throw message 含修复指引：逗号分隔白名单）。
2. `docker-compose.prod.yml`：env 补 `CORS_ORIGINS: ${CORS_ORIGINS:?CORS_ORIGINS required in production}`（镜像同文件 JWT_SECRET `:?` 先例）。
3. `.env.example` CORS_ORIGINS 行补「生产必填」注记。
4. 验证 accessbase.sh container 模式交互：--env-file 透传 .env 的 CORS_ORIGINS；未设时 config throw（fail-fast 即期望行为，message 已含指引）——脚本不改。
**验证：** config.test.ts + 根 tsc。与 T1/T2 零文件交叠，全程并行。

### Task 5 — 收官回归 + 记忆（控制器自执行）

全量 vitest + 双 tsc + eslint 改动面 + 全量 e2e（workers=1）→ status.md 批次 K 记录 + conventions（audit 读侧 'system' 规则 + guard funnel 约束）+ 必要 PIT。

## 风险与预裁定（审核后）

- 守卫全部落 manager 层（changeStatus/delete/setUserRoles 漏斗）——route 级预查方案已被 R2 否决；SCIM 面错误形状走既有 scoped handler。
- 非默认租户 audit 页无认证事件、G 前旧 JWT 视同平台视角：附录语义注记，勿翻案。
- Roles.tsx 清空权限确认流对 isSystem 行经按钮禁用不可达 + 服务端 ROLE_PROTECTED 双保险。
- last-admin 谓词 status 语义：suspended/pending 不算 active admin（与批次 A 挂起门一致）。
