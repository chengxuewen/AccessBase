# Batch B 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-12-batch-b-perf-oidc-ui.md 的强制修订——critic-correctness 6M+6m 审核结论（critic-blockers / cross-checker 报告到齐后如有增量将追加于文末）。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-12

## R1 (M1, T1 — ctor 签名)

PermissionManager ctor 实为 `constructor(databaseUrl?: string, roleManager?: RoleManager)`（PermissionManager.ts:21）——**第二参被 roleManager 占用**。修正：

```typescript
constructor(databaseUrl?: string, roleManager?: RoleManager, options?: { cacheTtlMs?: number })
```

计划 T1 所有 `new PermissionManager(undefined, { cacheTtlMs: ... })` 示例改为 `new PermissionManager(undefined, mockRoleManager, { cacheTtlMs: ... })`（测试沿用现有第 2 参 roleManager mock 注入）。

## R2 (M2+M3, T2 — 失效清单与归属重写)

真实写路径清单替换 spec §2 与计划 T2 的清单（以下为完整、互斥、经源码核实的版本）：

| 写路径 | 归属文件 | 失效粒度 |
|---|---|---|
| RoleManager.update / delete | RoleManager.ts | 租户级 |
| **RoleManager.setParent**（:262，改继承链） | RoleManager.ts | 租户级 |
| **RoleManager.assignToUser / revokeFromUser / setUserRoles**（:348-392） | RoleManager.ts | userId 级 |
| **PermissionManager.setRolePermissions**（:196） | PermissionManager.ts | 租户级 |
| UserManager.changeStatus | UserManager.ts | userId 级 |

**删除**原清单中的 PermissionManager.create/update/delete 接线（permissions 表无 tenantId、与用户有效权限无耦合——接线即死码）。任务 Files 相应修正：UserManager 只保留 changeStatus；users 路由的 setUserRoles 调用（users.ts:189/245）经 RoleManager 方法内部失效，路由层零改动。

spec §2 同步勘误（执行者以本表为准）。

## R3 (M4, T4 — 错误契约统一 400)

未知/非法/畸形 options 导致的未注册 provider 一律 **400 AUTH_OAUTH_001**（沿用现有契约：未支持 provider=400、已配置无凭据=503——oauth.ts:229-241、oauth.test.ts:180-196 既有断言锁死）。计划 T4 三处「404」全部改 400；「invalid provider names rejected」测试断言改 `400` + `AUTH_OAUTH_001`。

## R4 (M5, T4 — arctic mock 扩容)

执行 T4 Step 1 前必须扩展 oauth.test.ts 顶部的 `vi.mock('arctic')` 工厂：补 `OAuth2Client` stub class（含 createAuthorizationURLWithPKCE / validateAuthorizationCode 可调用 vi.fn）与 `CodeChallengeMethod = { S256: 'S256' }`。否则 generic 分支 `new OAuth2Client(...)` = `new undefined()` 直接 TypeError 崩溃（非断言失败）。

## R5 (M6, T6 — Users 筛选按 isActive)

User 列表行**无 status 字段**（仅 `isActive: boolean`，api/users.ts:10、Users.tsx:33-38 二态渲染）。YAGNI 取方案 A：filters 按 isActive 两项 `{text:'Active',value:'active'},{text:'Suspended',value:'suspended'}`，`onFilter: (v, r) => v === 'active' ? r.isActive : !r.isActive`。三态筛（需后端列表带 status）显式不做。

## R6 (M7, T6 — ConfigProvider 在 LocaleGate.tsx)

theme prop 落点为 **components/LocaleGate.tsx:14**（唯一 ConfigProvider，main.tsx:15 挂载），非 App.tsx。任务 Files 与 Step 1 修正：Modify LocaleGate.tsx（algorithm 切换 + html[data-theme] effect 同处）。

## R7 (m, T4 — clientSecret 泄露面)

`oauth_providers` 键值内嵌 clientSecret 明文，不匹配 SENSITIVE_KEY_PATTERN（options.ts:18）→ GET /v1/options 会裸吐。**选型（定案）**：每 provider 密钥拆独立键 `oauth_<name>_client_secret`（天然命中现有 pattern 的 /secret/i 规则，零 pattern 改动）；`oauth_providers` JSON 只存非敏感字段（authUrl/tokenUrl/userinfoUrl/clientId/scope）。resolveProviders 组装时逐 provider 读其 secret 键。计划 T4 的 options JSON 格式与此一致化。

## R8 (m, T5 — 前端文件指位)

GitHub/Google 硬编码按钮在 **components/OAuthButtons.tsx:16-27**（Login.tsx:286 只渲染 `<OAuthButtons/>`）；api/ 目录无 oauth.ts。修正：Modify OAuthButtons.tsx + Create apps/admin-ui/src/api/oauth.ts（listOAuthProviders()）。fallback 语义定案：providers 请求失败 → 渲染现状双内置按钮（保持向后兼容）；i18n 缺键用 `t('login.oauth.'+name, { defaultValue: name.toUpperCase() })`。

## R9 (m, T1/T2 — 测试清场)

模块级缓存跨用例共享 → cache-invalidation.test.ts 及所有触及缓存的测试 describe 级 `beforeEach(() => invalidatePermissionCache())` 清场（防顺序耦合假绿）。

## R10 (m, Spec§3 — 三处测试策略偏差声明)

显式记录（验收对照以此为准，非降级遗漏）：① requirePermission 0-SQL 断言由 manager 层等价覆盖（T1 缓存命中单测）；② B2 generic provider 完整流以 vitest app.inject 集成为准（无 Playwright e2e）；③ B3 theme 以 e2e 替代组件级测试。

## R11 (m, T5 — fallback 自洽)

与 R8 合并定案：请求失败 → 渲染双内置（现状）；成功 → 只渲染返回名单。删除计划中自相矛盾的「失败静默 fallback 双内置」+「只渲染返回名单」并置表述。

---

## R12 (critic-blockers C1/C2, T1 — ctor 第 3 位 + 弃用 spyOn)

R1 的 ctor 修正之外，测试写法同步修正：**弃用 `vi.spyOn(mgr,'roleManager','get')`**——roleManager 是普通私有属性非 getter，spyOn accessor 必炸（PIT-043 同族）。四个缓存测试直接复用该文件 beforeEach 的 ctor 注入 roleManager，断言 `roleManager.getUserRoles.mock.calls.length`（`vi.mocked(createDb)` 顶层 mock 模式照旧）。示例签名：`new PermissionManager(undefined, undefined, { cacheTtlMs })`。

## R13 (critic-blockers C3, T1/T2 — resetPermissionCache 钩子)

模块级缓存重构必须同时导出 `resetPermissionCache(): void`（= clear 全部）。**PermissionManager.test.ts 既有用例全部用 (u1,t1) 键**——无 reset 则 Task 2 落地当轮现有套件即交叉污染全红。T2 Step 1 重构时同步：PermissionManager.test.ts 与 cache-invalidation.test.ts 的 describe 级 `beforeEach(() => resetPermissionCache())`。（R9 的 invalidatePermissionCache 清场升级为 resetPermissionCache。）

## R14 (critic-blockers H1, T2 — 循环 import 断环)

缓存 Map + invalidate/reset 函数放**新叶子模块** `packages/identity/src/managers/permission-cache.ts`（零依赖）——不可放 PermissionManager.ts（其 :7 已 import RoleManager，RoleManager 反向 import 即循环，ESM 提升苟活、加载顺序一变就 TDZ）。两个 manager 都 import 该叶子模块。T1 Step 3 的实现位置相应改为 permission-cache.ts。

## R15 (critic-blockers H2, T2 — 失效语义修正)

与 R2 合并后的最终语义：**PermissionManager 的 create/update/delete 无 tenantId 参数（权限是全局资源）→ 失效调用为 `invalidatePermissionCache()` 全清**（setRolePermissions 同理全清，因其无租户边界语义）。RoleManager.update/delete/setParent → 租户级。assignToUser/revokeFromUser/setUserRoles/UserManager.changeStatus → userId 级。R2 表中 setRolePermissions 的「租户级」修正为「全清」。

## R16 (critic-blockers H3, T4 — arctic 枚举类型 + mock 扩容细节)

(a) CodeChallengeMethod 是**数值枚举**（S256=0）——`'S256'` 字符串字面量过不了类型。实现一律 `import { CodeChallengeMethod } from 'arctic'` 传 `CodeChallengeMethod.S256`；测试 mock 工厂补 `CodeChallengeMethod: { S256: 0 }`（与运行时同值）。(b) R4 的 mock 扩容细节定案：OAuth2Client stub 类含可断言的 vi.fn 成员（createAuthorizationURLWithPKCE / validateAuthorizationCode），测试按实例断言调用参数。

## R17 (critic-blockers H4, T4 — 503/404 语义表)

R3 的「统一 400」与现状冲突，最终语义表（覆盖 R3）：

| 场景 | 状态码 |
|---|---|
| 已知内置（github/google）但 env 凭据未配 | **503 AUTH_OAUTH_002**（现状保留） |
| registry 外名称（未知/非法字符/被跳过的畸形动态 provider） | **404 AUTH_OAUTH_001**（现状未知名称即 404） |
| options JSON 畸形 | 该 provider 不注册 → 请求其 authorize 落 404；内置不受影响 |

既有测试 400 断言（oauth.test.ts:180-196）实为 404 分支（未知名称）——执行者以**本表**为准核对既有断言语义，勿凭 R3 字面统一 400。

## R18 (critic-blockers M1/M2, T4/T5 — 类型放宽与前端指位)

(a) oauth.ts 内部辅助（fetchProviderProfile / findOrCreateOAuthUser / linkAccount、oauthAccounts.provider 的 eq 比较）签名从 SupportedProvider 放宽为 string；email fallback 写 `${sub}@${provider}.oauth.invalid`（provider=名称，与现状模板同构）。(b) T5 指位修正：listOAuthProviders() 放 **api/auth.ts**（非新建 api/oauth.ts——R8 的 Create 改为 Modify auth.ts）；改造目标 components/OAuthButtons.tsx:23-28；label i18n 键为既有命名空间 **`oauth.<provider>`**（en.json:80-81 先例，非 `login.oauth.*`），fallback `provider.toUpperCase()`；**保留既有 oauth-github/oauth-google testid**（e2e 依赖），动态按钮 testid 规约 `oauth-<provider>`。

## R19 (critic-blockers M3, T6 — LocaleGate 定案)

R6 确认：theme algorithm 与 html[data-theme] effect 落 components/LocaleGate.tsx:14（与 locale prop 并列；App.tsx 仅挂 store 无改动）。data-theme 与 lang 同元素不同属性无冲突。

## R20 (critic-blockers M4, T3 — RoleManager 测试基座移植)

「沿用 RoleManager.test.ts:78 mock 风格」不成立（该文件仅 API-surface 断言）。T3 Step 1 从 PermissionManager.test.ts 移植 makeChain/makeMockDb，并造**按调用序出队**的路由 mock（findAll 一次调用发 count→roles→N×perms 多次查询：第 1 次→total、第 2 次→roles 行、后续→perms 行集）。形状断言以现行为准（完整 Permission 对象，join permissions 全字段）。

## R21 (cross-checker — PASS，2 minor 采纳)

三查结论：conventions **0 违规**（theme persist 判 allowed——约定禁瞬态 UI 态，theme 属持久偏好；`/v1/` 前缀为路由文件相对简写非违规）；任务顺序/依赖全对（oauth.ts T4→T5 顺序双触无冲突、auth.ts 全批零修改核实）；覆盖合格。采纳 2 minor：① T5 执行者在 e2e 步骤补「先跑确认失败」一句；② T6 同（e2e 先跑后实现形态已定，不强制 RED，执行者知悉即可）。附加执行者注：auto 态的 matchMedia resolved 瞬时值不入 persist，仅 theme 偏好本身持久化。

## 审核结论汇总

| 审核人 | 裁决 | 吸收 |
|---|---|---|
| critic-correctness | NEEDS-FIXES 6M+6m | R1-R11 |
| critic-blockers | NEEDS-FIXES 3C+3H+4M | R12-R20（R14 叶子模块断环覆盖 R2 的模块落位；R15 修正 R2 的 setRolePermissions 粒度；R17 覆盖 R3 的统一 400） |
| cross-checker | PASS 0 违规 + 2 minor | R21 |

冲突裁定：R12>R1（ctor 修正以 blockers 实证为准）；R14>R2（缓存落位叶子模块）；R15>R2（失效粒度全清）；R17>R3（503/404 语义表）。附录与主计划冲突处一律以本附录为准。
