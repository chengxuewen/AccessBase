# 批次 L′ 实施计划 — 多租户控制面（rev.3，双 Momus + scoped re-review 吸收后）

**日期**: 2026-09-20
**依据**: spec rev.3 + 附录 REVIEW-ADDENDUM.md + re-review（bg_b0b51d2a）GAPS×4 → 本 rev.3 全钉，裁定即派发
**前版**: v1 FLOWS-REJECT；rev.2 吸 X1-X4/B/R 系；re-review 确认 20 行吸收全 ADDRESSED、无重开攻击面，余 4 文本钉（G-1 假「幂等」前提 / G-2 误归因被控制器实测定驳 / G-3 'user_create' 编辑无归属 / G-4「唯一汇聚」过声 + T6 双模式前置注）
**执行方式**: subagent-driven；组内并行（文件面互斥矩阵见 §任务表），组间串行

**日期**: 2026-09-20
**依据**: spec rev.2（X1-X4/R/B 全吸收）+ 附录 REVIEW-ADDENDUM.md
**前版**: v1 被 FLOWS REJECT（R1 分区算术 + R5 假原语/矩阵冲突为核心）——本版逐条闭合
**执行方式**: subagent-driven；组内并行（文件面互斥矩阵见 §任务表），组间串行

## 事实基线修正（承 flows R10 + 双审实证，HEAD 5cddd20=源树）

| 事实 | 修订后 |
|---|---|
| 分区终数 | **9 bindable + 12 platform-only = 21**（apikeys×3 → platform-only，X2 裁决）；「11 码」全废 |
| setRolePermissions | RoleManager 私有汇聚 = **可达**写者唯一（create 撞名早返回 = find-or-create / update 拒 isSystem）——X1 校验落此；PermissionManager 同名公共孪生（:221-240）HEAD 零调用者 = 休眠，入 §3 backlog 注（G-4） |
| checkInheritanceCycle | **不收 roleId = 假原语**（自环/互环漏检）——本批修复，X3 |
| 密码策略 | 路由层 readPasswordPolicy/assertPasswordPolicy per-call-site；UserManager.create 仅 bcrypt；**users POST（users.ts:204）仅 minLength:8 无策略调用——G-2 实测定驳 re-review 误归因（其引用的 :292/:309 属 :270 '/import' 路由）**；策略函数是 register/import 在用——R2 维持原钉 |
| checkInheritanceCycle | **不收 roleId = 假原语**（自环/互环漏检）——本批修复，X3 |
| 密码策略 | 路由层 readPasswordPolicy/assertPasswordPolicy per-call-site；UserManager.create 仅 bcrypt；users POST 仅 minLength:8——R2 改钉 |
| seedBuiltinPermissions | 永不 throw（best-effort）——bootstrap 用新严格内核 bindPermissions，X4 |
| users.email | schema 全局 unique + findByEmail 无租户参 = 全局查重语义 ✓ |
| /me | 无 response schema（无剥字段陷阱 ✓）；auth.ts 已有 getTenantManager() 懒单例（必须复用，B7b） |
| apikey 分支 | scopes `'*'` 通吃所有码闸（R-E 措辞废）——B3 belt 扩面闭合类 |
| force-logout | users.ts:348-367 零租户校验（B5，一行修，并入 T2） |
| 前端权限 hook | `useAuthStore((s) => s.hasPermission)`（Clients.tsx:51 实证；「usePermission」不存在，R9c） |
| 最长前缀裁剪 | 实证 `/api/v1/tenants/<uuid>/bootstrap` → `POST:/api/v1/tenants` → tenants:write ✓（authorize.ts 注 26-27 + 实现 67-80） |
| 错误码 | D2 表钉死：TENANT_PLATFORM_ONLY / TENANT_PROTECTED / EMAIL_EXISTS / PERMISSION_NOT_BINDABLE / 400 策略族——T4 mock 逐字拷贝（PIT-033） |

## 任务表

### 组一（四路并行，文件面互斥）

**T1 — identity 加固包（地基，原 T1+T5 的 identity 面合并）**
- 新 `packages/identity/src/services/permission-partition.ts`：TENANT_BINDABLE(9)/PLATFORM_ONLY(12) + DEFAULT_TENANT_ID 复用 TenantManager 常量。
- `RoleManager.setRolePermissions` 漏斗校验（tenantId≠DEFAULT → permissionIds 名 ⊆ bindable，越界 throw `PERMISSION_NOT_BINDABLE:<name>`）——X1。
- `checkInheritanceCycle` 重写（收 roleId；自环直拒 + 祖先链达 roleId 即环）+ `setParent` 补 isSystem→ROLE_PROTECTED——X3/R6。RED：self、mutual 两支。
- 严格内核 `bindPermissions(db, roleId, names)`（insert 全局码 conflict-do-nothing → 绑 → count===names.length 断言 → throw on fail）；`seedBuiltinPermissions` 改薄包壳（吞错语义逐字保留——向导/init 零破坏）。
- **（G-1）**`assignToUser` 补 `.onConflictDoNothing()`（user_roles 复合主键 schema.ts:118-130；bare insert 重放即 duplicate-key 500——bootstrap 重放臂的前提由本条制造为真）。
- **（G-3）**`password-policy.ts`：`PasswordPolicyCallsite` 闭集 union + DEFAULTS 扩 `'user_create'`（register 档默认；五 `password_*` options 键跨调用点共享，**无新 options 码、无双注册面**——附录原「注记」句作废）。
- 测试：分区不变量（disjoint+union=21）、漏斗 RED×2、环 RED×2、严格内核失败面、包壳吞错回归锁、assignToUser 重复插入不抛、'user_create' 策略档可读。
- `apps/server`：permissions-seed.ts 改 import 分区清单（删本地重定义）；conflict-mapper 加 `PERMISSION_NOT_BINDABLE` tag → 409（两处字面量同步纪律承 K）。
- 测试：分区不变量（disjoint+union=21）、漏斗 RED×2、环 RED×2、严格内核失败面、包壳吞错回归锁。
- 出口：`pnpm --filter @accessbase/identity build`（dist 同步纪律）。
- 文件面：packages/identity/src/{services,managers}/ + 测试 + apps/server/src/routes/permissions-seed.ts + utils/conflict-mapper.ts + 测试。

**T2 —（组二，吃 T1）bootstrap 端点 + belt 扩面 + force-logout 修**
- `POST /v1/tenants/:id/bootstrap` 按 spec D2 九步序（**belt 首查**；step4 重放臂条件 = 「user ∈ 目标租户」，不要求已持 admin，重跑 step7+step9 后 200（assignToUser 冲突安全由 T1 制造）；step5 用 T1 已扩的 `'user_create'` 策略档；step6 `roleManager.create` 直用 + 无条件直 UPDATE 幂等 stamp；step7 严格 bindPermissions）。
- tenants.ts POST/PUT/DELETE 三处理器各加 platform belt（B3，~3 行）。
- users.ts force-logout：吊销前 `findById(id, request.tenantId)` → 404（B5）。
- 测试：矩阵全守卫 + 幂等三径 + apikey '*' 构造行（直插 key 行）→ belt 403 + selfHeal 后仍 9 码钉（D3）+ force-logout 跨租 404。
- 文件面：apps/server/src/routes/{tenants,users}.ts + 两测试文件。

**T3 — /auth/me 租户暴露 + 顶栏 Tag**
- auth.ts /me：tenantId（user 行）+ tenantName（**getTenantManager() 单例**，findById 失败短路 undefined）；路由 test 三支 + 容错支。
- admin-ui：MeResponse 两字段；AppLayout Tag 按 `tenantId !== DEFAULT_TENANT_FRONT`（新前端常量）显隐（**零新 locale key**——Tag 内容是数据；locales 全归 T4，消除并行冲突）；e2e GlobalGuard mock 族全扫补字段（grep -l "auth/me" e2e/）。
- 文件面：auth.ts + 其测试 + admin-ui api/types + AppLayout + e2e mock 族。

**T4 — Tenants 管理页（mock-first，契约抄 spec D2 错误码表）**
- api/tenants.ts 四函数；pages/Tenants.tsx 五件套 + 默认租户行锁（id 常量判）+ Init admin 模态（200 replay / 409 inline）；App.tsx 路由+菜单（tenants:read，TeamOutlined）；locales en/zh 全集（含 T3 无需之注记）。
- 行动作门 `useAuthStore(s=>s.hasPermission)`（实名）。**无 users-hint 列**。
- e2e `tenants-crud.spec.ts` 六例（expect.poll 纪律）+ visual-qa 一轮。
- 文件面：admin-ui pages/App.tsx/api/tenants/locales + 新 e2e spec。

**T5 — roles 路由+UI 收尾（identity 面已并入 T1）**
- roles.ts PUT：body parentId?: string|null；**parentId present → setParent 先行**（全验证先于任何写），再 update 字段面；409 族走 conflict-mapper。
- Roles.tsx：parent Select（当前租户角色减自身，复用列表 state）；计数列 `permissions?.length ?? 0`。
- 测试：三支（持久化/null 解除/isSystem 拒）；e2e roles-crud 扩两例。
- 文件面：roles.ts + Roles.tsx + 两测试文件。

### 组三（控制器亲执）

**T6 — 真后端验真 + 全量门禁**
- `export no_proxy=...`（PIT-031，R9d）前置一切测试命令。
- reset:native → 向导 → curl V1-V8：建租户→bootstrap 201→租 admin 登录→/me 9 码 + tenantId/Name→打 tenants 三写 403→**升级 RED 实战**（GET permissions → POST roles 绑平台码 → 409）→ force-logout 跨租 404→同 email 重放 200→default 行三锁。
- vitest / 双 tsc（identity 先 build）/ eslint / e2e workers=1 / coverage。
- **双模式互斥前置**（re-review f 注）：curl 验真弹结束后、跑 mock e2e 前——停后端 + `curl 5101 探活应 000`（2026-09-12 conventions 硬约束，health.spec 除外）。
- 记忆收口四件套（含 conventions：分区双注册 +「新增权限码必须归入两清单之一，union=21 不变量测试即门禁」检查命令）。

## 并行矩阵（文件互斥核查）

| 文件 | 归属 |
|---|---|
| packages/identity/**、permissions-seed、conflict-mapper | T1 |
| auth.ts、types(MeResponse)、AppLayout、e2e mock 族 | T3 |
| pages/Tenants.tsx、App.tsx、api/tenants、locales | T4 |
| roles.ts、Roles.tsx、roles 测试、roles-crud.spec | T5 |
| tenants.ts、users.ts、bootstrap/force-logout 测试 | T2（组二，无并行者） |
| tenants-crud.spec.ts（新建） | T4 |

组一 = {T1,T3,T4,T5} 四路后台；T1 绿 → T2；全绿 → T6。

## 门禁基线期望

vitest 857 起 +~35；e2e 126+3 起 +9~12（workers=1 权威）；21 码期望计数不动（分区是清单内重排非增码）；DEFAULT_TENANT keep-list grep 域=apps/server——identity 的 DEFAULT_TENANT_ID 常量已存在（TenantManager:20），keep-list 零命中面不变；前端新常量不入 server grep 域。

## 派发门禁（承 blockers 尾部映射，rev.2 已全数前置闭合）

T1 无阻塞（X2 修正即本文 + G-1/G-3 新入）；T2 brief 含 X1/X4/B5/B6/B7a/R2/R4/G-1 依赖注；T3 含 B7b；T4 含错误码表/R9a/R9c；T5 含 X3 次序注记（identity 面在 T1）。

**Re-review 轮记录**（bg_b0b51d2a，HEAD 4a95883）：20 行吸收逐条 ADDRESSED（源证齐全）；GAPS×4——G-1 assignToUser 假幂等 / G-2 事实行异议（**控制器实测反证：users.ts:204 POST 体内无策略调用，re-reviewer 行归属错**，维持原文）/ G-3 'user_create' identity 编辑无归属→T1 / G-4 过声→§3 注 + T6 停后端前置。除 G-2 驳回外全吸收 = 视同 ALL-ADDRESSED，派发解除。

## 完成判据

spec §5 八条全过 + T6 execution-log 追加本文件尾部 + scoped re-review（附录吸收核对，flows 裁定：无需全量复审）+ 记忆四件套。
