# Batch E 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-15-batch-e-mfa-alignment.md 的强制修订——双 Momus 审核（critic-flows 2M+3m / critic-blockers 3H+1H+1M+1L）全部吸收。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-15

## R1 (T1, WebAuthn select 扩列 — 两路独立实锤)

webauthn.ts:283-287 的 user 投影只有 `{id, email, name, status}`——`user.totpEnabled` 恒 undefined，照计划写分支 `if (user.totpEnabled)` 永假（RED 测试永不变绿）。修正：:284 投影加 `totpEnabled: users.totpEnabled`（1 行）；测试 mock 行加 `totpEnabled:true`（webauthn.test.ts:146-154 userRows 透传）。**顺手**：更新 webauthn.ts:19-20 "MFA interplay: NONE — bypasses TOTP step-up" 头注释（实现后变谎言）。

## R2 (T1, LDAP 200 schema 剥字段)

auth.ts:854-878 的 LDAP 200 response schema 只声明 accessToken/refreshToken/expiresIn/user——Fastify（fast-json-stringify）会静默剥掉未声明的 `{mfaRequired, flowToken}` → SPA 收到 `{data:{}}`，RED 测试报 undefined 极难排查。修正：schema 补 `mfaRequired: {type:'boolean'}, flowToken: {type:'string'}`（镜像 auth.ts:114-116 本地登录先例）。webauthn.ts 与 oauth exchange 无 200 schema，不受影响。

## R3 (T2, FlowTokenService 跨实例消费在 vitest 不可能 — 关键暗雷)

三处构造同为 `nodeEnv==='test' ? undefined : safeRedis()`（auth.ts:32 / webauthn.ts:61 / oauth.ts:256）→ 测试环境传 undefined → **各实例私有内存 Map**。T2 Step 1 的"oauth 实例签 mfa_verify → auth.ts:749 另一实例 consume"在 vitest 必失败。测试接缝二选一：① `vi.mock` FlowTokenService 为共享模块级 Map 包装；② 拆两段各自在同实例内断言（oauth.test 断签发、auth 侧用自签 token 断消费——oauth.test.ts:576-577 已有"per-instance memory fallback"先例注释）。执行者选①（更直接），报告注明。

## R4 (T2, "无前端改动"全局约束修正 — 双 critic 独立推翻)

exchangeOAuthCode（stores/auth.ts:172-183）对响应无条件解构 token 并 `set({isAuthenticated:true})`——mfaRequired 响应会写 undefined token + 假认证态且被 persist；Login.tsx:53-60 换发后无条件 fetchUser+navigate。**修正（采纳 flows 方案 a）**：Task 2 Files 补两个前端文件——
1. `apps/admin-ui/src/stores/auth.ts` exchangeOAuthCode：响应含 `mfaRequired` 时 `set({mfaFlowToken, isAuthenticated:false})`，不写 token（复用既有 login() 的 mfaFlowToken 状态位，auth.ts store:63）；
2. `apps/admin-ui/src/pages/Login.tsx` oauthCode effect：mfaFlowToken 已设时跳过 fetchUser/navigateAfterAuth（交由既有 TOTP 表单渲染，stores/auth.ts:117-142 的 verifyMfa action 直接复用——TOTP 提交后既有逻辑接管）。
约 10 行。验收清单第 4 条改口："WebAuthn/LDAP 零前端改动；OAuth 仅 exchangeOAuthCode + Login 两处分支"。

## R5 (T2, 接缝预裁断：verify 不动)

方案 a（verify 感知 provider）违反"单一门"约束，删除；方案 b 即现状但未明说——**显式裁决：/auth/mfa/verify 零改动**。OAuth-TOTP 用户的收尾与 local login 完全同构（TOTP 验证通过 → verify 返回标准 token 对 → SPA 既有 verifyMfa 流接管）。R6 的来源标记用于 exchange 端点分叉响应，verify 侧无感。

## R6 (T2, mfa_verify 签发位置定死)

callback **只发 oauth_exchange** code（payload = `{userId, mfaPending: true}`），exchange 端点消费 payload 时**现签** mfa_verify flowToken（300s）——少一次 redirect 链上的 token 存储传递，exchange 已有 payload 消费点。mfa/verify 无需 provider 来源感知（verify 返回标准 token 对，SPA verifyMfa 流统一收口）。

## R7 (T1, LDAP schema 附带 + T2 payload 细节)

- R2 的 LDAP schema 扩展属于 Task 1 范围（照 :114-116 先例两属性）。
- Task 2 exchange 端点响应 mfaRequired 形态无 200 schema 剥字段风险（exchange 无 response schema）。

## 审核结论汇总

| 审核人 | 裁决 | 吸收 |
|---|---|---|
| critic-flows | NEEDS-FIXES 2M+3m | R4 / R5 / R1(m1) / R2(m2) / R6(m3) |
| critic-blockers | NEEDS-FIXES 3H+1H+1M+1L | R1 / R2 / R3 / R4 / R6(MED 来源标记→并入 R6)/ R7(L ow 注释) |

冲突裁定：双 critic 对"前端改动"结论一致采纳方案 (a)；R6 定死签发位置（吸收 flows m3 + blockers MED 的来源标记）；webauthn 投影问题双路独立实锤（R1）。

## 安全面核记档（双 critic 均核过，无 finding）

- mfa_verify flowToken 绑 userId-only 安全：verify 用 payload.userId 查该用户 TOTP 密钥，他人 code 必不通过
- 三路径第一因子全部先行（passkey 断言/provider code 换发/LDAP bind）——无第一因子拿不到 flowToken
- suspended→totp→issue 顺序与既有 P0 门兼容
- 错码即烧 token（consume 先行）使 TOTP 爆破受 login 限速间接约束
