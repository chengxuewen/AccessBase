# Batch H 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-16-batch-h-scim-design.md 的强制修订——双 Momus 审核（critic-flows / critic-blockers）独立互证，一致 NEEDS-FIXES。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-16

## R1 (H — scope 隔离的具体改法)

spec 所称 "requirePermission checks key.scopes" **不存在**：requirePermission apikey 分支整体放行数据面（permission.ts:33-40 `return; // allow`），authenticate 硬编码 `scopes:['*']`（app.ts:135）。**裁定**：两处具体变更——
1. authenticate apikey 分支：从行读 scope，payload.scopes = scope==='scim' ? ['scim'] : ['*']；
2. requirePermission apikey 分支：`payload.scopes` 含 '*' 放行（存量 data key 兼容）；仅 ['scim'] → 403。
存量 key scopes jsonb=['*'] 天然兼容，零回填。

## R2 (H — 复用 scopes jsonb，删 scope varchar 列)

`api_keys.scopes` jsonb default ['*'] **已存在**（schema.ts:354）。新增 `scope` varchar 列与之撞名（3am 事故配方）且冗余。**裁定**：删 scope 列方案——scim token = scopes `['scim']`，data token = `['*']`（存量零回填）。迁移 0003 仅剩 `users.external_id`。ApiKeyManager 联动：`create()` 签名不改（scopes 参数已有）；SAFE_COLUMNS 加 scopes 投影；api-keys create 路由接 body.scopes 白名单（['*']|['scim'] 二值）。

## R3 (H — POST /Users 租户归属)

明文裁定：**传 `key.tenantId`**（request.tenantId 已由 scim bearer 中间件注入），禁 DEFAULT_TENANT 字面量（R3 batch G keep-list 四件套不含 scim.ts）。spec 原文 "with DEFAULT_TENANT" 作废。

## R4 (H — 测试层裁定)

删除 spec e2e 行（page.route 对 S2S 协议零价值）。协议面全由 **vitest app.inject 集成测试**覆盖（§3 清单 + PIT-056 probe 断言），交付时附 curl 验真步骤（非 e2e）。

## R5 (M — scim+json parser 无条件注册)

Azure AD 恒发 application/scim+json → Fastify 4 必 415。**裁定**：scoped addContentTypeParser **无条件注册**（SAML saml.ts:27 模式），spec 原文 "No new content-type parser needed" 作废；application/json 继承根 parser 共存。

## R6 (M — external_id 唯一性)

**裁定**：`external_id` nullable、**无唯一约束**、correlation-only（SCIM filter 不含 externalId，列不被查询）。注释注明 "per-tenant correlation, best-effort"。

## R7 (M — PATCH 语义)

**裁定**：单 PATCH 请求多属性 → **顺序多 Manager 调用**（active→changeStatus+revoke，name→update，每属性独立成功/失败）；未知属性 → **400 invalidPath**（RFC 7644 §3.5.2 默认，IdP 误配应显式暴露而非静默吞）。PATCH 全量映射矩阵进单测。

## R8 (M — userName 归一化)

userName↔email 查找用 `lower(trim(userName))` 归一化（PG varchar unique 是 case-sensitive，SCIM userName 匹配是 case-insensitive）。users.email 全局 unique 为已知限制——spec 显式声明 "SCIM provisioning 在全局 email 命名空间内运作"（多租户独立 email = backlog）。

## R9 (M — name 缺省)

users.name NOT NULL（schema.ts:28）但 SCIM name 可选。**裁定**：name 缺省取 userName。

## R10 (L — 生命周期措辞)

Token lifecycle = revoke + create-new（scope 在 create 时重选），无 rotate 接口（ApiKeyManager.ts:6 注释明示）。spec "inherits rotate" 措辞作废。

## 已核验无虞

- 迁移链零漂移：0002 snapshot ↔ schema.ts 16 表逐列一致，generate 0003 干净（仅 + external_id）
- authenticate 非全局钩子（逐路由 preHandler），scim 插件不注册即豁免；/auth/login 同理
- scoped parser 封装隔离有效（SAML saml.ts:27 先例）；app.ts addContentTypeParser=0 不变量保持
- 停用 parity：changeStatus + revokeAllUserSessions 两调用序（users.ts:449-453 先例）；re-enable 不复活会话 ✓
- 密码链：UserManager.create 自动 bcrypt + assertPasswordPolicy（users.ts:306 先例）+ null passwordHash（LDAP 先例）

## 修复优先级

R1（安全）→ R3（租户）→ R2（schema）→ R4（测试层）→ R5-R9（实现精度）
