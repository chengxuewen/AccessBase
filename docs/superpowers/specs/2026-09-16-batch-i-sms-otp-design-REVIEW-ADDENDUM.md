# Batch I 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-16-batch-i-sms-otp-design.md 的强制修订——双 Momus 审核（critic-flows / critic-blockers）独立互证，一致 NEEDS-FIXES。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-16

## R1 (H — 重复 phone 多命中裁定)

users.phone nullable + non-unique，但 findByPhone 多行命中 = auth 路径上的静默账号映射歧义。**裁定**：findByPhone 多命中 → 视为 no-match + logger.warn（拒绝发放）。迁移 0004 加 partial unique index `CREATE UNIQUE INDEX idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL`（DB 层拒重复双保险）。UserManager.findByPhone 新方法：WHERE phone = X LIMIT 2 → 1 行返回 / 2+ 行 → null + warn。

## R2 (H — 删除 phone lockout)

lockout.recordFailure/isLocked(phone) 引入 magic 模板不存在的跨用户 DoS（burn-first FlowTokenService.ts:70 = 每 token 恰 1 次猜码；token 获取受 5/15min 限流 → 爆破收益≈0，锁定零增益纯 DoS）。且与 I3 "mirrors magic-link consume exactly" 直接矛盾（magic/consume auth.ts:840-891 零 lockout）。**裁定**：删除整条 phone lockout 链（recordFailure/isLocked/clear + "verify locked phone→403" 测试项）；爆破防护由 burn-first + 限流承担。

## R3 (M — verify 链补 phone-match 复验 + findByIdAny)

magic consume 有 email-match 复验（auth.ts:853）——SMS 链须同构：findByIdAny 后复验 user.phone !== payload.phone → 401 AUTH_SMS_001。verify 用户查找用 **findByIdAny**（refresh 门先例 auth.ts:516-518；magic 的 findById(id, request.tenantId ?? DEFAULT) 在公开路由会 401 非 default 租户用户——batch G H1 同族）。测试 mock 两键建模（PIT-055）。

## R4 (M — CJS interop 冒烟)

@alicloud/* 与 twilio 均 CJS——ESM await import() 命名导出依 cjs-module-lexer 静态检测，vitest vi.mock 拦截使真实 interop 在单测中从不执行（batch F R11 同款盲区）。**裁定**：适配器解构用 `const m = await import(pkg); const Client = m.default?.Client ?? m.Client;` 兜底 + 每适配器一条真实 import 冒烟测试（SamlProvider.test.ts:25 先例）。

## R5 (M — twilio 改 raw REST 零依赖)

twilio npm 装机 ~50MB+ 仅为一次 messages.create。**裁定**：twilio 适配器用 raw REST——POST /2010-04-01/Accounts/{sid}/Messages.json + Basic auth + Node 20 全局 fetch + URLSearchParams body。twilio npm 包不进 package.json。aliyun 保留 SDK（V3 签名不值得手写）。

## R6 (M — E.164 正则钉死 + TS 转义)

TS 字符串字面量 '\+' === '+'、'\d' === 'd'——单反斜杠会静默产生非法正则。**裁定**：body schema 用双转义 `pattern: '^\\+[1-9]\\d{1,14}$'`（TS 源码形态）；server-side body schema 强制；DB 手设 phone 须存 E.164（findByPhone 精确匹配），R1 的 warn log 提供排查线索。

## R7 (M — verify 用户查找 findByIdAny)

spec "user lookup (findById)" 依 magic 模板会写成 findById(id, request.tenantId ?? DEFAULT_TENANT)——公开路由无 authenticate → tenantId 恒 DEFAULT → 非 default 租户用户 verify 恒 401（batch G H1 同族）。**裁定**：verify 用 findByIdAny(payload.userId)（refresh 门先例），status 门照旧。测试 mock 两键建模（PIT-055）。

## R8 (M — .env.example + UI 缺位声明)

① 新增 7 个 env 键（SMS_PROVIDER/SMS_SIGN_NAME/SMS_TEMPLATE_CODE/ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET/TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN）须入册 .env.example（批次 A 40 键先例——MFA_ENCRYPTION_KEY PIT 同族教训）。② 全 flow 无 UI 且未声明延后——Non-goals 补"v1 无 admin-ui 变更，端点 S2S/curl 消费，SMS UI 延后"（批次 H R4 vitest-only 先例）。

## R9 (L — 迁移 0004 加 phone 索引)

idx_users_phone（或 partial WHERE phone IS NOT NULL）同笔加入 0004（email 有 idx_users_email 先例 schema.ts:46；findByPhone 无索引全表扫）。

## 已核无误

- request 202 枚举免疫 + send fire-and-forget 时序（auth.ts:741 先例注释）；限流 5/15min+10/15min 与 magic 同值（:689/:763）
- mfa_verify 七签发点计数一致（:867 "six-way" + 1）
- response 全 union 声明 R2 教训由 "mirror magic consume" 覆盖（:772-837 模板在场）
- AUTH_SMS_001 命名合 AUTH_MAGIC_001 族
- @alicloud/dysmsapi20170525 + twilio messages.create API 面正确
- LockoutService identifier 为自由字符串（LockoutService.ts:38-53）技术上可行——反对理由是设计而非机制
- crypto.randomInt CSPRNG + 拒绝采样无模偏差（Node >=20 engine 覆盖）
- 迁移 0004 链净（0003 = ALTER users ADD external_id 单行，无 drift）
- E.164 长度：varchar(20) 够（E.164 max 16 含 '+'）

## 修复优先级

R1（DB+应用层双保险）→ R2（DoS 消除）→ R3/R7（租户盲区）→ R4/R5/R6（实现精度）→ R8/R9（运维完备）
