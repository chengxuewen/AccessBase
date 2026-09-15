# Batch C 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-12-batch-c-admin-features.md 的强制修订——三路审核（cross-checker 1MED+1LOW+2INFO / critic-correctness 3M+4m / critic-blockers 6 BLOCKER+3MEDIUM+3LOW）全部吸收。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-12

## R1 (T1, 迁移路径与命名 — 两路独立复核一致)

`packages/identity/drizzle/` 不存在。真实迁移链：`packages/migration/drizzle/`（0000_reflective_triathlon.sql + meta/_journal.json），drizzle.config.ts 的 schema 指向 ../identity/src/db/schema.ts、out=./drizzle。修正 Step 0：在 packages/migration 下用 **drizzle-kit generate 自动生成** `0001_<随机词>.sql`（同步 journal+snapshot，禁止手写 00XX 前缀破坏 journal idx）。SQL 风格照 0000（CREATE TABLE IF NOT EXISTS + --> statement-breakpoint；gen_random_uuid() 有先例）。tenant_id 加 NOT NULL（roles 先例）。

## R2 (T2, authorize 映射落位)

映射表在 **packages/identity/src/hooks/authorize.ts:29-52**（routePermissions Record），非 app.ts；D115 后实际执行的是 requirePermission 路线（app.ts 无 authorizeHook 注册）。T2 Files 显式加该文件（identity 改后必 build）。三条映射键写死：`'GET:/api/v1/auth/api-keys'→apikeys:read`、`'POST:/api/v1/auth/api-keys'→apikeys:write`、`'DELETE:/api/v1/auth/api-keys'→apikeys:delete`（DELETE /:id 靠 longest-prefix 截断命中，authorize.ts:60-72 机制已验证）。

## R3 (T2, seed 双数组)

三码进 BUILTIN_PERMISSIONS **且** RESOURCES 数组（permissions-seed.ts:32）追加 'apikeys'——漏 RESOURCES 则 admin 绑定被回读过滤跳过（:46-52），新路由全 403。ACTIONS 已含 read/write/delete 无需动。conventions 计数 15→18 同 commit（含两条检查命令期望值）。

## R4 (T2, API key 授权死锁 — 两路独立实锤)

requirePermission（utils/permission.ts:30-39）直接 `hasPermission(user.sub, ...)`，keyId 非用户 id → ab_ 请求打任何受守卫路由必 403（keyId 无角色=空权限集）。修正：requirePermission 增加分支——

```typescript
const payload = request.user as TokenPayload & { type?: string; scopes?: string[] };
if (payload.type === 'apikey') {
  // v1: scopes are ['*'] only (spec non-goal: scope engine deferred)
  return; // allow
}
```

（v1 scopes 只有 ['*']，无引擎； future scopes 引擎批次再实现匹配。）T2 测试补：带 ab_ key 的请求调 GET /api/v1/users → 200（授权路径贯通）。

## R5 (T4, 密码策略第 5 维 + 分调用点默认 — lead 拍板)

三调用点现策略不一致（register：8+大小写数字无 special、AUTH_REG_002；changePassword/resetPassword：zod min12+四类含 special、VALIDATION_001）。「零破坏收口」要求 → 采纳第 5 维：

- PolicyOpts 增加 `requireSpecial: boolean`、`minLength` 独立可配
- **分调用点默认**：register = {minLength:8, upper:true, lower:true, digit:true, special:false}（现行为）；changePassword/resetPassword = {minLength:12, upper:true, lower:true, digit:true, special:true}（现行为）
- options 键增加第 5 个 `password_require_special`（default 按 above 调用点缺省；env 同名回退）。helper 签名：`assertPasswordPolicy(pw, opts): {ok, code?, message?}`——code/message 由调用点传入映射（register 传 AUTH_REG_002，change/reset 保持 zod 侧或改断言，执行者读现场后保持各自错误契约不变）
- 验收锁不变：既有测试零改动通过

## R6 (T6, 导入 pending 语义 — lead 拍板)

「create 自动继承 pending」不成立（UserManager.create:44-47 默认 active；register 的 pending 是显式 changeStatus）。**裁定：admin 导入 = active**（与 POST /users 现行为一致，管理员批量导入不需要二次激活步骤）。测试断言改 active；spec「pending 语义继承」句作废，UI copy 同步（导入说明写明导入用户直接激活）。

## R7 (T5, audit 路由需补 requirePermission)

audit.ts:23 现只有 authenticate，无 requirePermission——「audit:read 既有码」的门实际不存在。T5 需补 `app.addHook('preHandler', requirePermission())`（import 照 users.ts:20 形态）；导出与 list 共享此门。users.ts 已有模块级门无需动。

## R8 (T5, 过滤参数与响应形态)

list 过滤参数实为 **page/pageSize/action/actor/startDate/endDate**（audit.ts:38-41，非 dateRange）；导出响应需 `reply.header('Content-Type','text/csv; charset=utf-8')` + `reply.header('Content-Disposition','attachment; filename=audit-YYYY-MM-DD.csv')` 后 send 字符串（仓库无下载先例，此为首例）。users export 的路径授权由既有 `GET:/api/v1/users` 前缀裁剪覆盖——**勿新增映射键**（防映射漂移）。

## R9 (T3, 注册点四处 + 页面形态)

Clients 页注册点实为：App.tsx:17 import、App.tsx:120 Route、AdminLayout.tsx:40 权限映射、AdminLayout.tsx:47 菜单项 + i18n en/zh menu key。API Keys 走**顶级页**（照 Clients 形态，非 Settings Tab——Settings.tsx 是 Tabs 形态不同）。i18n 两侧同步。

## R10 (T1, key 明文格式 — lead 拍板)

spec 说 35 字符纯 alnum，计划 base64url≈32 含 -_。**裁定：按 api.md 预设计**——`ab_` + 32 位纯小写字母数字（crypto.randomBytes(24) 转 hex 取前 16 + 再 16，或循环过滤直至凑满 32 alnum；实现取最简形式并注释），prefix 存前 8 字符。spec 35 字符契约保持。

## R11 (T6, 行操作与 CSV 解析)

Users.tsx 行操作是固定 **Popconfirm** 直排（非 Dropdown）——force-logout 按钮追加进该 Popconfirm 区。前端 CSV 解析**仅支持简单 CSV（无引号包裹字段）**，UI copy 显式声明该限制（不引 papaparse；RFC4180 引号换行边界超范围）。

## R12 (T4, jsonb 真实类型 seam — cross-checker MED)

PIT-045 直接应用：assertPasswordPolicy 的测试 seam 必须注入 **jsonb 真实类型**（number/boolean 而非字符串 "4"/"true"）；helper 内部对 options 读出值做 typeof 协调（`typeof v === 'string' ? v === 'true' : v` 形态）——若实现侧经三参 get 已带类型化 default（int/bool），则 jsonb number/boolean 天然匹配，seam 用同型注入即可；执行者读 OptionsManager.get 现场后选择，报告中注明。

## R13 (T6, force-logout 精简)

权限门：POST /:id/force-logout 经前缀截断落 'POST:/api/v1/users'→users:write（无需新映射键）。`invalidatePermissionCache` 调用**删除**（权限缓存与登出无关；suspend 先例只调 revokeAllUserSessions）。

## R14 (T6, e2e RED 步骤补位 — cross-checker LOW)

T6 补 Step 1.5：前端 e2e 先写失败测试（导入 Modal 报告展示 / 导出下载 / force-logout 行操作）→ 对未实现 UI 跑一次 RED → 实现转 GREEN。

## 附注（非本批引入，登记不处理）

- e2e/auth-session.spec.ts 有 1 处预存 test.fail()（conventions 期望存量为 0）——后续批清偿
- CSV OFFSET 循环在并发写入下可能重复/漏行——spec 已自认 YAGNI

## 审核结论汇总

| 审核人 | 裁决 | 吸收 |
|---|---|---|
| cross-checker | 1 MED + 1 LOW + 2 INFO | R12 / R14 / R2 文件清单附注 / test.fail 登记 |
| critic-correctness | NEEDS-FIXES 3M+4m | R1 / R5 / R4 / R10 / R2 映射键形态 / R8 勿新增映射 / R11 |
| critic-blockers | NEEDS-FIXES 6 BLOCKER + 3 MEDIUM + 3 LOW | R1-R9、R11、R13（与 correctness 独立复现互证，加 RESOURCES/journal/行号层细节） |

冲突裁定：R15>R2 式歧义本批无；R4/R5/R6/R10 为 lead 拍板项（已内联标注）。
