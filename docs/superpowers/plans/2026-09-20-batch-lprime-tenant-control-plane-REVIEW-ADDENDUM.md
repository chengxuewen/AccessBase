# 批次 L′ 双 Momus 对抗评审附录

**日期**: 2026-09-20 | **评审对象**: spec 5f15d6d + plan 5f15d6d | **评审方**: Momus-FLOWS (bg_b780ed71) + Blockers-Oracle (bg_1ea7ee77)
**裁定**: FLOWS = **REJECT**（一轮修复可清）；BLOCKERS = **APPROVE-WITH-FIXES**（带派发门禁：T1 待分区修正、T2 待 B1/B6/B7、T5 待 B4）。flows 尾部注记：吸收后 **scoped re-review 即可，无需全量复审**。

## 双证交叉（两方独立命中 = 最高优先）

| # | 级别 | 发现 | 吸收 |
|---|---|---|---|
| X1 (B1/R-partition-escape) | **BLOCKER** | 分区是纸糊的：租户 admin 有 roles:write + permissions:read → `GET /v1/permissions` 枚举全局 21 行 id → `POST /v1/roles {permissionIds:[tenants:write…]}` → `setRolePermissions`（RoleManager.ts:519-532）盲插 → `PUT /v1/users/:self {roleIds:[新角色]}`（unknownRoleId 只验角色同租户，验不了权限）→ **3 次请求拿到平台码，全接管**（options:write 改 SMTP/密码策略、clients:write 建 OIDC、tenants:* 跨租户）。 | **新 D1a 绑定校验漏斗**：分区清单迁入 identity（`services/permission-partition.ts`）；`setRolePermissions`（create/update 唯一汇聚点）当 `tenantId !== DEFAULT_TENANT_ID` 时校验 permissionIds 解析名 ⊆ TENANT_BINDABLE，越界 throw `PERMISSION_NOT_BINDABLE:<name>` → 路由 409 信封（conflict-mapper 加第三 tag）。RED 测试：租户上下文绑 tenants:write → 409。 |
| X2 (B2/R1) | **BLOCKER** | 分区算术错：两清单标注 (10)/(11) 实际各 9 名，**apikeys:r/w/d 三码无归属**，9+9=18≠21——T1 的「并集=21」不变量测试按写面**不可能通过**，实现者将被迫即兴裁决安全分区。 | 裁决入册：**apikeys:\* → PLATFORM_ONLY**（租户 admin 不管理 key；SCIM key 本就 DEFAULT 租户专属）。终数 **TENANT_BINDABLE = 9**（users×3, roles×3, permissions:read, audit:read, stats:read）/ **PLATFORM_ONLY = 12**。全文「11 码」→「9 码」。 |
| X3 (B4/R5) | **BLOCKER** | setParent 环检是**假原语**：`checkInheritanceCycle(parentId, tenantId)` 签名根本不收 roleId——自环 A→A 与互环 A→B→A 均漏检（判据 5「cycle/self → 409」机制上不可达）；且**文件矩阵冲突**：环修复必动 `packages/identity/.../RoleManager.ts` + 其测试 + identity dist 重建，均不在 T5 声明范围。 | T5 范围显式扩至 identity RoleManager：环检重写为 `walkFrom(parent) 达 roleId 即环`（含 `parentId === roleId` 直拒）+ setParent 补 isSystem→ROLE_PROTECTED 守卫（R6 漏斗纪律）+ 互环/自环 RED 两支 + 计划注记 `pnpm --filter @accessbase/identity build`。 |
| X4 (R3/B6) | **MAJOR** | seed 静默吞：step5 `seedBuiltinPermissions` 永不 throw → 绑定半途失败仍 201「成功」，且 step3 email 全局查重使**同 email 重试永久 409 无法补救**（R4 收敛洞同根）。 | 抽严格内核 `bindPermissions(db, roleId, names): Promise<void>`（throw on failure + 结尾断言 `count == names.length` 否则 throw）；`seedBuiltinPermissions` 保持 best-effort 包壳（向导路径逐字不变）；**bootstrap 直调严格版**。 |

## Blockers 侧其余

| # | 级别 | 发现 | 吸收 |
|---|---|---|---|
| B5 | MED | **force-logout 跨租户**：`POST /v1/users/:id/force-logout`（users.ts:348-367）对 :id 零租户校验，users:write 前缀裁剪即达——L′ 造出租租户 admin 这一新行动者后才致命（可吊销任意租户用户会话，需 uuid 故 DoS 级）。 | 吊销前 `userManager.findById(id, request.tenantId)` → null 404，一行；**并入 T2 文件面**（users.ts 与 T2 无冲突）。 |
| B6 | MED | isSystem 盖章窗：RoleManager.create 撞名早返回**不补 isSystem** → 命中既有非 system 'admin' 角色时 last-admin 闸（键 isSystem=true）不罩 → 唯一租 admin 可自悬→租户永久孤儿（恢复仅剩直 SQL）。 | D2 step4 改为 `roleManager.create({name:'admin', isSystem:true}, tenantId)` 直用其 find-or-create（废 findAll/ILIKE 法）+ 返回后**无条件幂等直 UPDATE is_system=true**（镜像 selfHeal 形制，不走 update() 守卫）。 |
| B3 | MED | apikey `scopes:['*']` 通吃所有码闸（requirePermission apikey 分支）；租约 key 当前 API 不可造（key.tenantId=创建者 DEFAULT），属预存骨架键风险，但 D1 安全模型声称与之矛盾。 | **belt 扩面**：tenants.ts POST/PUT/DELETE 三 mutation 处理器各加 `request.tenantId === DEFAULT_TENANT` 首闸（~3 行），闭合整类；R-E 措辞改「需 '*' scope + handler belt」。 |
| B7a | LOW | belt 须为处理器**首查**（先于 404/409 枚举面）。 | 入 D2 步骤序。 |
| B7b | LOW | /me 必须复用 auth.ts `getTenantManager()` 懒单例（每请求 new = 池累积，permission.ts:21-25 有案）；`TenantManager.findById` 无缓存，D4「cached-path」为假。 | D4 措辞改「+1 PK SELECT/me，可接受」+ T3 brief 钉单例。 |
| 接受 | — | 租户 suspend 后 access-token 15min 残窗（预存批 G 设计，登录/refresh 双闸已罩）；SCIM/manager 级 setUserRoles 不验 role.tenantId（users 路由已验，防御纵深入 backlog）。 | 记录不动。 |

## Flows 侧其余

| # | 级别 | 发现 | 吸收 |
|---|---|---|---|
| R2 | MAJOR | **假事实**：密码策略不在 UserManager.create（仅 bcrypt），users POST 只有 schema minLength:8；策略函数是路由层 `readPasswordPolicy`/`assertPasswordPolicy`（per-call-site，register/import 在用）。 | D2 body 段改钉：bootstrap 处理器在 create 前显式 `assertPasswordPolicy(..., '<site>')`——site 键由 T2 在既有键集择一（若无贴切键则新增 `'user_create'` 并在 options 密码策略双注册面注记），400 信封形制对齐 register。 |
| R4 | MAJOR | 收敛洞：step6 后崩溃 → email 占用 → 同 email 永久 409。 | step3 补臂：email 已存在 && 该用户 ∈ 目标租户 && 已持本租户 admin 角色 → **200 幂等重放**（同 data 形 + `alreadyBootstrapped:true`）；否则 409 EMAIL_EXISTS。 |
| R7 | MINOR | step4 原语错（ILIKE 子串 + 无必要）。 | 并入 B6 吸收。 |
| R8 | MINOR | R-E「需 tenants:write scope」与代码不符（apikey 分支只认 '*'）。 | 并入 B3 吸收。 |
| R9a-d | MINOR | ①spec D5「users hint」列无端点支撑；②判据1 isSystem「next selfHeal or」二义（create 即落 isSystem:82 行）；③「usePermission hook」不存在（实际 `useAuthStore(s=>s.hasPermission)`，Clients.tsx:51）；④T6 缺 no_proxy 前置。 | 全部改正文。 |
| R10 | MINOR | 事实表行号漂（authorize 26-27+67-80 / me 365-395）。 | 修引注。 |
| 错误码钉名 | — | T4 mock-first 依赖 T2 错误码，plan 写「T2 定」= 交叉契约悬空。 | 即刻钉死：403 `TENANT_PLATFORM_ONLY` / 409 `TENANT_PROTECTED`（默认租户拒启+非 active）/ 409 `EMAIL_EXISTS` / 409 `PERMISSION_NOT_BINDABLE` / 400 `AUTH_REG_002` 族（策略）。T4 mock 从 spec 表拷贝（PIT-033 纪律）。 |
| 次序 | MINOR | 环错时 update 已落字段=部分写。 | D6 改：parentId present 时 **setParent 先行**（校验全过才写），再 update 字段面。 |

## 派发门禁映射（承 blockers 尾部）

- T1：X2 修正后派发（清单终数 9+12、identity 迁置）
- T2：X1/X4/B5/B6/B7a/R2/R4 全入 brief
- T3：B7b 钉单例
- T4：错误码表 + R9c hook 实名 + 无 users-hint 列
- T5：X3（扩至 identity RoleManager）+ 次序修正 + R6 守卫
- T6：R9d no_proxy

**吸收量级**（oracle 原话）：identity 分区常量迁移 + 1 校验函数 + 3 处 belt + setParent 3 行 + force-logout 1 行 + 若干测试与文案——无架构变更。

---

## 附：Scoped re-review 轮（bg_b0b51d2a，Momus-FLOWS，HEAD 4a95883）

逐行吸收核对：X1-X4 / B3 / B5 / B6 / B7a / B7b / R6 / R7 / R8 / R9a-d / R10 / 错误码钉 / 次序 / 派发映射 / Deferred = **全 ADDRESSED**（源证齐全，含 app.ts:276-285 审计排除表实核：bootstrap 不在排除列 = D2 声称成立）。

**GAPS×4 处置**：
- **G-1（采納）** spec D2 step4/9 之「idempotent insert」在 HEAD 为假（assignToUser 裸 insert vs user_roles 复合主键 → 重放 500）→ T1 增 `.onConflictDoNothing()` 把前提制造为真。
- **G-2（驳回，附反证）** re-reviewer 称 users POST 已在 :292/:309 应用 'register' 策略——控制器实测：`:292/:309` 属 `:270 '/import'` 路由，POST（:204）体仅 minLength:8。plan 行 15 原文维持。
- **G-3（采纳）** 'user_create' 需动 identity `PasswordPolicyCallsite` 闭集 union + DEFAULTS → 划归 T1；options 五键跨调用点共享 → 附录原「双注册面注记」句作废。
- **G-4（采纳）** 「唯一汇聚点」过声：PermissionManager.setRolePermissions 公共孪生（零调用者，休眠）→ §3 backlog 注 + 事实行改「可达写者唯一」。
- 非阻断注采纳：T6 增「mock e2e 前停后端 + 5101 探活 000」双模式前置。

**终态**：除 G-2 外全钉 → 视同 ALL-ADDRESSED，派发解除。
