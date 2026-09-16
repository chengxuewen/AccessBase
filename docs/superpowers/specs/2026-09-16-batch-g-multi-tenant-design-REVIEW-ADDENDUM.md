# Batch G 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-16-batch-g-multi-tenant-design.md 的强制修订——双 Momus 审核（critic-flows / critic-blockers）独立互证，一致 NEEDS-FIXES。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-16

## R0 (H — spec 前提修正: JWT 无 tenantId claim)

spec 行4/行19 的"JWT already carries tenantId (oauth.ts:341)"是**误引**——oauth.ts:341 是 users 表 provisioning INSERT 列，非 JWT claim。实证：4 个 issueTokenPair（auth.ts:63 / oauth.ts:280 / saml.ts:91 / webauthn.ts:91）与 2 个内联签发点（auth.ts:473 mfa/verify、auth.ts:973）全部只签 `{sub, email, status}`。**修正**：新增 Task 0——全部 6 个签发点补 `tenantId` claim（值 = 该路径已解析的租户，G 范围内恒 DEFAULT_TENANT，但结构上从参数取）；authenticate 读 claim、缺失回退 DEFAULT_TENANT（legacy token 兼容）。permission.ts 的 `user.tenantId ?? DEFAULT_TENANT` 在 claim 落地后保持不变（结构兼容）。

## R1 (H — refresh 门)

refresh 端点（auth.ts:335）换发新 access token，**不在六路径清单内** → 挂起租户的已登录会话可无限续命（batch A 对用户状态有 refresh fail-closed 前置门，"same family" 却漏了这扇门）。**裁定**：refresh 路径加租户状态 fail-closed 检查（对齐 batch A 用户挂起先例）；MFA verify（auth.ts:970）与 change-password 重签（auth.ts:533）同样纳入或显式豁免——**裁定纳入**（300s MFA 窗口内租户被挂起的空子一并堵上）。签发点门控统一收敛为：**4 个 issueTokenPair helper 内部 + refresh 前置门**，不按"路径清单"逐处手贴。

## R2 (H — 缓存失效)

TenantManager.update 挂起分支必须显式调 `invalidatePermissionCache(tenantId)`（前缀删 `perm:{tenantId}:*`，permission-cache.ts:22-28 现成 API，RoleManager/UserManager 已有同款先例）。同时：挂起租户的存量 JWT 存活至 15m 过期是**接受的设计**（与用户挂起的 token 窗口同款），spec 文档化此窗口即可，无需强制吊销全会话（backlog）。

## R3 (H — 替换清单补全)

G2 清单补 `users.ts` ×14（:33,71,109,113,143,172,180,243,246,321,405,407,449,487）+ `auth.ts` rolesOf/permissionsOf（:79,84）。收敛判据改用检查命令而非手工清单：`grep -rn "DEFAULT_TENANT" apps/server/src --include='*.ts' | grep -v __tests__ | grep -v constants.ts | grep -v permissions-seed.ts | grep -v setup.ts` 应零命中（setup 自举保留——无 JWT 可读；permissions-seed 基础设施保留）。

## R4 (H — e2e 契约)

G3 列加载失败降级：**catch → 该列显示 '—'，无 toast 无 console error**（console 净检纪律）。首次失败不重试（module 缓存含失败态，避免每 spec 各 403 一次）。受影响 spec（users/roles 系全部）逐个补 `/api/v1/tenants` mock（B2/F per-spec mock 先例，enabled 默认返回 `[{id: DEFAULT_TENANT, slug: 'default', name: 'Default', status: 'active'}]`）。

## R5 (H — 迁移链三件套)

0002 必须经 `drizzle-kit generate` 产出（三元组：`drizzle/0002_*.sql` + `meta/_journal.json` 新 entry idx=2 + `meta/0002_snapshot.json`）。手写 SQL 缺 journal/snapshot 时全新部署 migrate 断链。

## R6 (M — fresh-DB 时序)

setup bootstrap 顺序：**先** `setIfAbsent`/insert DEFAULT_TENANT 行（onConflictDoNothing，与 seed 同型幂等原语）**再** `userManager.create`（setup.ts:259-267 之前）。selfHealSeed（index.ts:40 fire-and-forget、ensureSeedForAdmin 无 admin 早退）不承担首写职责——首写者是 setup bootstrap / env-bypass initializeAdmin 两处。

## R7 (M — apikey 分支)

`request.tenantId` 的数据源是 `request.user` payload 统一读取：JWT 分支读 claim、**apikey 分支读 key 行的 tenantId**（app.ts authenticate apikey 分支已挂 `tenantId: key.tenantId`——不覆写不回退 DEFAULT_TENANT）。fastify.d.ts 补 `FastifyRequest.tenantId?: string` 声明（apps/server/src/fastify.d.ts，现只有 FastifyInstance.authenticate）。

## R8 (M — 门控语义与默认租户保护)

1. 认证链**不做**每请求租户状态 DB 查——挂起检查只在签发点（R1 收敛后的 helper + refresh 门），存量 token 15m 窗口接受（R2）。
2. **默认租户保护**：TenantManager.update/delete 对 DEFAULT_TENANT 目标一律拒绝（409 TENANT_PROTECTED）——防自锁（挂起 default = 全员登录 403 的自毁）。spec 原文"refuse when non-default"系笔误，实义为 refuse **deleting the default**；update 的 suspend 同样禁 default。
3. G 范围内 default 租户不可挂起 → 六路门对 default 恒通过，门控测试必须**直接向 DB 插第二租户行**构造挂起态（spec 补测试策略）。

## R9 (L — 记录项)

- conventions.md 更新已在 spec 范围内（18→21 双检查命令）
- roles 表 `unique(name, tenantId)` 已存在（schema.ts:68），非新工作；setup.ts:44 按名全局查 admin 在 queryAdminExists 语义下保留
- AUTH_SAML_003 式错误码预留：本批新码 `AUTH_TENANT_001`（403 挂起拒绝）——登录族 403 文案对齐 AUTH_004 泛化形态，不泄露租户存在性

## 已核验无虞

- seed 幂等模式（onConflictDoNothing）与 DEFAULT_TENANT 字面 id 插入无冲突面
- RS256 下伪造 tenantId claim 不可行；apikey 行自带 tenantId 可注入
- 六路径槽位定位（auth.ts:170/771/1178、oauth.ts:482、webauthn.ts:313、saml.ts:198）；每登录 +1 次 tenant lookup 可接受
- roles 唯一约束已 tenant-scoped，RoleManager.create 已按 name+tenant 查重
- 权限码双注册纪律 + conventions 更新在 spec 行18 已覆盖

## 修复优先级

R0（地基）→ R1（安全门）→ R2（缓存）→ R3（清单）→ R4/R5（交付纪律）→ R6/R7/R8（实现精度）
