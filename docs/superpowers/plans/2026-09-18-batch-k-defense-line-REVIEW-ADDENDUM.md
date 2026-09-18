# 批次 K 计划审核修订附录（Review Addendum）

**审核:** 双 Momus 并行（bg_ed5c7f3b 流程正确性 / bg_c6594363 阻塞面+爆炸半径），2026-09-18，均三轮 fallback 后完成（限额墙，PIT-047 纪律生效）
**结论:** 2 BLOCKER + 4 MEDIUM + 3 LOW 吸收；关键接线问题（seed 绑定是否过 manager）双审交叉确认 CLEAN。

## R1 (HIGH — C1：私有 helper 与三处跨类调用矛盾)

计划 T2 GREEN 5 写「新增**私有** helper wouldOrphanLastAdmin」，但谓词需要被 RoleManager（setUserRoles/revokeFromUser）、UserManager（delete、changeStatus）两类调用。私有 = 字面不可执行，且执行者被迫现场做公共 API 决策（违架构门）。
**处置:** 新模块 `packages/identity/src/services/last-admin-guard.ts` 导出纯函数（接收 db 实例 + tenantId + excludingUserId + 可选 transition 语义），两类 manager 各持 `this.db` 调用；route 层不再直查（见 R2）。vitest 直测该模块。

## R2 (BLOCKER — C2-B1：suspend 守卫放 route 层被 SCIM 五处直调绕过)

`userManager.changeStatus` 是挂起写侧的唯一漏斗：users.ts:449（管理页）+ scim.ts:422/449/499（IdP PATCH/PUT/DELETE active=false）。计划把守卫放 users.ts route 级 = 外部 IdP 仍可挂起租户最后管理员 → G3 宣称目标留活口。
**处置:** 守卫下沉 `UserManager.changeStatus`（仅当目标态 = suspended 且移除后租户零 active isSystem-admin 才拒；auth.ts:353 注册转 'pending' 不受影响——谓词只挂 suspended 转换）。users.ts route 不再预查，改由共享 error mapper 把 `LAST_ADMIN_GUARD:` message tag 映射 409。SCIM 面经既有 scoped setErrorHandler 成形 SCIM 错误（IdP 可见失败即可，403 细化入 backlog）。**控制器实证核实**：grep changeStatus 五调用点 + docker-compose.prod.yml:9 `NODE_ENV: production` 无 CORS_ORIGINS 透传（R3 前置证据）。

## R3 (BLOCKER — C2-B1：CORS fail-fast 把随附生产启动路径全数 brick)

实证：`docker-compose.prod.yml`（NODE_ENV=production 硬置、无 CORS_ORIGINS 键）、`accessbase.sh:481/488`（container 模式 `-e NODE_ENV=production`，--env-file 分支依赖 .env 且无 fallback）、`.env.example:61 CORS_ORIGINS=`（空）。T4 只改 config.ts = 按文档部署的 start:prod/start:container 启动即崩（config import throw → crash loop）。
**处置:** T4 扩面：docker-compose.prod.yml 的 env 加 `CORS_ORIGINS: ${CORS_ORIGINS:?CORS_ORIGINS required in production}`（镜像同文件 JWT_SECRET 的 `:?` 先例）；.env.example 该行补「生产必填」注记；accessbase.sh container 分支无需改代码（--env-file 已透传，缺值时 compose `-e` 覆盖不含 CORS 键 → config throw——验证该交互并让 throw message 自带修复指引）。

## R4 (MEDIUM — C1：stamp 落点两连坑)

`ensureSeedForAdmin` 查询 `eq(roles.tenantId, DEFAULT_TENANT)`——若新 stamp 沿用此函数形态，非默认租户永不受保护（且 last-admin 谓词以 role.isSystem 计数 → 那些租户守卫整体失效）；若走 `RoleManager.update` 传 isSystem：input 不收该字段 + 已 true 后再跑即 ROLE_PROTECTED throw = 不自愈。
**处置:** 明确 **direct SQL、无租户过滤**：`UPDATE roles SET is_system = true WHERE name = 'admin'`（permissions-seed 同风格，与既有 seedBuiltinPermissions 直插先例一致——该先例双审已证 CLEAN，故 stamp 不会反噬自愈绑定路径）。RED 幂等测试跑两遍断言第二次零变更+零 throw。

## R5 (MEDIUM — C1：PUT /users/:id 降权路径无映射)

守卫落 manager 后，`setUserRoles` throw `LAST_ADMIN_GUARD:` 经 PUT /:id（管理页改角色主路径）→ 该 catch 只映射 not-found、其余 rethrow → 全局 500。测试矩阵也缺此用例。
**处置:** users.ts 挂共享 mapper（POST/PUT/DELETE/status 四路由统一 catch），RED 矩阵补「PUT 移除唯一 admin 角色 → 409 LAST_ADMIN_GUARD」。

## R6 (MEDIUM — C1+C2 交叉：locales code→key 机制不存在)

`apiErrorMessage` 实为服务端 `error.message` 透传（en/zh.json 无任何错误码键，PERM_001 前端零命中）——计划/spec 引用的「既有 code→key 机制」是假前提；补 locales 键 = 死键。
**处置:** T3 删 locales 项；409 mapper 按 TENANT_PROTECTED 先例自带可读英文 message（前端透传即达标）。spec K2 同步改述。

## R7 (LOW — 参考名修正，三项)

方法实名 `revokeFromUser`（非 unassignFromUser；HTTP 无调用方，manager 面卫生仍加闸）；e2e 文件名 `roles-crud.spec.ts`（非 roles.spec.ts）；audit 路由实际挂 `/api/v1/audit-logs`（测试 URL 用实名）。

## 双审确认 CLEAN / SOUNDED 区

- **seed 绑定不过 manager**（本批最险接线题）：seedBuiltinPermissions 直插 rolePermissions + onConflictDoNothing → isSystem stamp 不断自愈。双审交叉证实。
- roles 路由无 response schema → 无 fast-json-stringify 剥字段陷阱（批 E R2 家族本批不适用）；mapToRole 现不透出 isSystem（T2 步骤 9 义务）。
- packages/audit/src/middleware.ts:97 `tenantId || 'system'` 实锤：读侧 'system' 规则匹配写侧现实；现状泄露 = 任意租户 audit:read 可见全体登录失败事件（含 body email），HIGH 定级成立。
- e2e 全 mock API（page.route 替换响应）→ 服务端过滤零冲击。
- config.test.ts 接缝（resetModules+env+动态 import）可用；对象字面量求值序保证 JWT throw 先行，既有测试不破。
- role.delete 已兼 isSystem + assigned-users 双检，闸后充分。
- T1∥T2∥T4 文件不相交；T3 依赖 T2 成立。

## 语义注记（非缺陷，入册防翻案）

- 非默认租户在 audit 页看不到自家用户的**认证事件**（登录/锁定写侧归 'system'——读侧无租户可归）；写侧认证事件租户归属为 L 批（多租户控制面）backlog。
- 批次 G 前签发的无 tenantId claim 旧 JWT → `?? DEFAULT_TENANT` → 视同平台视角可见 'system' 行，过渡期接受。
