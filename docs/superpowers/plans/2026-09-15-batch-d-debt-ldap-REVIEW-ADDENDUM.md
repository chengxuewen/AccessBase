# Batch D 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-15-batch-d-debt-ldap.md 的强制修订——三路审核（cross-checker 全过 / critic-correctness 4M+6m / critic-blockers 3H+4M+1LOW）全部吸收。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-15

## R1 (T2, ldapts 真实 API — 两路独立实证)

- 无 `connect(url)`/`createClient`；正确形态：`import { Client } from 'ldapts'` + `new Client({ url })`（惰性连接，无显式 connect）
- **bind 失败是抛异常**（InvalidCredentialsError 等），不返回 false——测试 mock 用 rejection 模型：admin bind 抛错→AUTH_063，user bind 抛错→AUTH_064
- `client.search(baseDn, { scope: 'sub', filter })` 返回 `{ searchEntries: [{ dn, ...attrs }] }`（pojo 扁平属性 `entry.mail`，解包 searchEntries）
- 收尾 `client.unbind()`；版本锁 `^7`

## R2 (T2, AuthResult 真实形状)

接口实为 `{ success, user?: User, accessToken?, refreshToken?, requiresMfa?, error?: AuthError }`（types.ts:32-39）——无 userId/email/name 字段。authenticate 返回 `{ success: true, user: <User 全行> }` 或 `{ success: false, error: { code: 'AUTH_064', ... } }`；路由层取 `user.id/email/status` 传 issueTokenPair。错误分支走 `error.code`（接口已有），**禁止 Error.message 带码字符串匹配**。

## R3 (T2/T3, autoProvision 通道与去重)

- `UserManager.create(data, tenantId)` 第二参必填（UserManager.ts:30）——**provider 保持纯 LDAP 协议**：查找+供给整体上移到路由层（auth.ts:578 内联 `new UserManager()` 先例），autoProvision 签名加 tenantId 由路由层传 DEFAULT_TENANT（禁止 identity 包内硬编码 UUID）
- users.email 全局唯一（schema.ts:27）——登录链先 findByEmail：存在即复用该用户（链接语义），不存在才供给；email 缺失 → 显式 AUTH_065
- LDAP 用户无密码合法：passwordHash nullable（schema.ts:29）、CreateUserInput.password 可选（types.ts:107）、本地登录被 `!user.passwordHash` 守卫拒绝（UserManager.ts:198）；issueTokenPair 只需 {id, email, status?}

## R4 (T2, LDAP filter 注入防护 — 安全面)

username 直接拼入 searchFilter 属信任边界注入面。新增 `escapeLdapFilter(value: string): string`（RFC 4515：`\` → `\5c`，`*` → `\2a`，`(` → `\28`，`)` → `\29`，NUL → `\00`，约 5 行纯函数，identity 包内），searchUser/查询链一律经转义。**测试 RED 先行**：注入 payload（如 `*)(uid=*))(|uid=*`）经转义后仅作字面 uid 匹配。

## R5 (T2, LdapConfig 字段名零改名)

现有字段 `bindDN / searchBase / searchFilter / attributeMapping`（types.ts:329-338，index.ts defaultIdentityConfig.ldap 同名）——**保留现名，禁止计划所写 baseDn/bindDn/userFilter/attributeMap 改名**（否则 defaultIdentityConfig 引用炸 tsc）。T3 落 options→LdapConfig 映射表：`ldap_url→url`、`ldap_base_dn→searchBase`、`ldap_bind_dn→bindDN`、`ldap_bind_password→bindPassword`、`ldap_user_filter→searchFilter`。测试 mock 按真实字段名写（cross-checker 同此备注）。

## R6 (T3, options 键清单补 ldap_enabled)

503 判定需要开关：options 键补 `ldap_enabled`（env `LDAP_ENABLED`，**默认 false**——LDAP 未显式启用时登录路由 503 AUTH_063 语义）。掩码核查：ldap_url/base_dn/bind_dn/user_filter 均不命中 SENSITIVE pattern，仅 ldap_bind_password 掩码（正是意图）；options.get 服务端读真值，掩码只在 GET /options 层。

## R7 (T1, middleware.test.ts 是 New file)

packages/audit/src/__tests__/ 只有 logger.test.ts——T1 Files 改 "Create"。测试形态：直接构造 fake req/reply 调 createAuditMiddleware 产物（audit 包无 fastify 运行时依赖，无 buildApp）；:86 站点经 reply.raw 'finish' 事件触发。

## R8 (T1, test.fail 前提已失效)

全 e2e 实际 `test.fail(` 调用为 0（唯一命中是 auth-session.spec.ts:8 的注释行）——13 个预存债已于 65a2a0d 清偿。T1 Step 3 与验收项 2 改为："grep 实测存量=0 + 报告归档 D114 判定（已于 65a2a0d 清偿）"。

## R9 (T4, e2e 收缩为回归形态)

前端无 LDAP 表单（Login 页不调 /auth/ldap/login）——T4 删除"登录成功进 Dashboard / 401 inline 错误"等套套逻辑步骤，收缩为：现有登录流 UI 回归（确认零破坏）+ 报告注明新路由语义由 T3 buildApp inject 测试为准入门槛。e2e 基线以 runner 实报为准（status.md 批次 C 终态 112+3skip，计划所写 116 系笔误），零新失败即达标。

## R10 (T1, username 列残留 — 显式决策)

JWT/apikey payload 均无 username 字段——修完 userId 四处后，:87/:125/:158 的 `user?.username || 'anonymous'` 仍落 anonymous（DB username 列残留，用户可见 actor 列/CSV 已修好）。**裁定：接受残留**（本批 spec 边界 = actor id 归属），报告记录为已知限制；后续若审计 UI 展示 username 再加 `?? user?.email` 回退。

## 审核结论汇总

| 审核人 | 裁决 | 吸收 |
|---|---|---|
| cross-checker | 全过 | LdapConfig 字段名对齐备注（并入 R5） |
| critic-correctness | NEEDS-FIXES 4M+6m | R4 / R2 / R5 / R7 / R8 / R6 / R9 / R10 / R3 去重 / R1 版本 |
| critic-blockers | NEEDS-FIXES 3H+4M+1LOW | R1 / R2 / R3 / R7 / R5 / R9 / R8 / R10（与 correctness 独立互证，加 ldapts rejection 模型/RESOURCES 层细节/tenantId 通道） |

冲突裁定：两 critic 的 ldapts/AuthResult/test.fail/LdapConfig 发现高度重合——以 blockers 的 API 形状细节（rejection 模型、searchEntries 解包）为准，correctness 的注入面（R4）为独有增量全部吸收。
