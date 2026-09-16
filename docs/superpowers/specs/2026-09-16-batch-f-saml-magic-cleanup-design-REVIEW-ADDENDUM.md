# Batch F 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-16-batch-f-saml-magic-cleanup-design.md 的强制修订——双 Momus 审核（critic-flows / critic-blockers）独立互证，3H 交叉命中。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **日期**: 2026-09-16

## R1 (F1, H — ACS 响应通道归一)

spec L21/L24（ACS 直接返回 200 JSON 双形 + 200 schema 声明）是改稿前残留，与 L26 终裁冲突。**裁定：以 exchange 通道为准**——ACS 恒 302；`saml_exchange` payload 双变体镜像 oauth.ts:475-487（`{userId, mfaPending: true}` / `{accessToken, refreshToken, user}`）；MFA 的 `mfa_verify`（{userId}+300s）由 **exchange 端点**签发（镜像 oauth.ts:529-535）；R2 union 200 schema（mfaRequired/flowToken + token 对全字段）落在 **exchange** 上，ACS 无 200 schema。ACS 只有两个出口：302 `/login?samlCode=…` 或错误重定向 `/login?samlError=<code>`。

## R2 (F1, H — RelayState 不消费)

RelayState 不被 IdP 签名；若 ACS 以其为跳转目标即开放重定向 + samlCode 泄漏；`validateInResponseTo:'always'` 只防断言重放。**裁定：方案 (a)**——ACS 完全不消费 RelayState（登录端点也不设 RelayState=origin），恒 302 `/login?samlCode=`（与 OAuth 通道完全对齐，oauth.ts:480 同样不携带 origin；pre-login location 保持降为 backlog）。若未来需要 deep-link，必须走 safeOidcRedirect 同款同源白名单校验。

## R3 (F2, H — site.url 键落位)

options `site_url` 是幽灵键：全库唯一 site 键是 `site.name`（setup.ts:68）；向导 config body 的 siteUrl 字段 handler 解构后丢弃（setup.ts:336/376/389）从未持久化。**裁定**：新键命名 `site.url`（对齐 site.* 惯例）+ 在 setup/config handler 补 `setIfAbsent('site.url', …)`（向导首写者模式同 site.name——顺手修复既有丢弃缺陷）；env 回退 `SITE_URL`；.env.example 补行。magic link 链接 origin 解析顺序：options `site.url` → env `SITE_URL` → 请求自身 origin（request.protocol + host，仅当前两者缺省）。

## R4 (F3-4, H — env 透传是实作任务非验证)

现状：native dev 无 .env 加载（config.ts 直读 process.env，tsx watch 无 --env-file，accessbase.sh dev 路径不 source）；container 模式 `docker run` 显式列表只传 JWT_SECRET+NODE_ENV（accessbase.sh:461-463）；deploy 模式已 `set -a; source .env`（start.sh:12-14）——唯一覆盖模式。**裁定**：F3-4 实作 = ① accessbase.sh dev/native 路径加 `set -a; [ -f .env ] && . ./.env; set +a`（在启动 server 前）；② container 模式 `docker run` 改用 `--env-file .env`（存在时），或补 -e 清单（MFA_ENCRYPTION_KEY/SMTP_*/SAML_*/SITE_URL/OAUTH_PROVIDERS）；③ compose 文件 env_file 校验。验收：四种模式下 server 进程能读到 .env 中 MFA_ENCRYPTION_KEY。

## R5 (F1, M — SamlProvider lazy import)

identity index.ts 静态 re-export（index.ts:16/24 先例）→ server boot 时任意 `import '@accessbase/identity'` 连带执行 SamlProvider 模块。"SAML 关闭零开销"只有配合 **SamlProvider.ts 内部 lazy `await import('@node-saml/node-saml')`**（无顶层 import，方法内首次调用时加载）才成立。保持 index.ts 静态导出不变。

## R6 (F1, M — SAML 路由级限流)

全局 100/min（app.ts:92-99）不足以保护最贵的 XML 签名验证。路由级 `config: { rateLimit: { … } }`（auth.ts:91/842 先例）：ACS **10/min**、saml/login **30/min**、saml/exchange **20/min**、metadata **30/min**、status **60/min**。

## R7 (F2, M — 限流按 IP 不按 email)

@fastify/rate-limit 路由级默认按 IP 分桶；email+IP 需自定义 keyGenerator + preValidation hook（库内无先例，子代理易漏）。**裁定：magic request 按 IP 5/15min、consume 按 IP 10/15min**（镜像 forgot-password 5/hour per-IP 先例）；email 维度限流 = backlog。

## R8 (F2, M — Mailer 键清单钉死)

Mailer 配置必须逐键复用 forgot-password 的 options `smtp_host/smtp_port/smtp_user/smtp_password/smtp_from` + `SMTP_*` env 回退（auth.ts:576-581），禁止发明第二套 SMTP 配置源。

## R9 (F2, M — 审计事件降级)

routes/auth.ts 零显式审计调用——现有覆盖只有全局 onResponse 钩子记 generic action（app.ts:262-274）。命名事件 `magic_login_requested/consumed` 是新模式。**裁定：删命名事件**，依赖全局中间件自动覆盖（`token` 字段名已在审计 redact 清单——packages/audit/src/types.ts:149，redaction 应用于 requestBody——logger.ts:196，magic consume 的 {token} 自动脱敏 ✓）。

## R10 (F1, M — ACS 审计排除)

ACS urlencoded body（多 KB SAMLResponse XML）会被全局审计钩子整体写入 audit_logs.requestBody——bloat + 断言内容入库。**裁定**：`/api/v1/auth/saml/acs` 加入审计排除（app.ts 排除清单，/api/v1/options 先例 app.ts:264-268）。exchange/magic 端点照常审计。

## R11 (§0, M — node-saml CJS 导入冒烟)

根 tsconfig `moduleResolution: "bundler"`（tsconfig.json:5）类型层 named import 可过；运行时是 Node cjs-module-lexer 路径，spec 的"detects"是推断非实测。**裁定**：T1 RED 步骤首测真实 `import { SAML } from '@node-saml/node-saml'` + 构造实例；若运行时 named export 探测失败，回退 `import nodeSaml from '@node-saml/node-saml'; const { SAML } = nodeSaml`。v5 自带类型，无需 @types。node-saml 进 packages/identity dependencies（非 devDeps）。

## R12 (F1, L — 端点计数与路由清单)

"4 public endpoints"实为 5：login / acs / metadata / status / **exchange**（exchange 提为正式 bullet，隶属 routes/saml.ts 同插件）。

## R13 (F2, L — consume 链补分支)

consume 链补：user lookup null（request 与 consume 间被删）→ `AUTH_MAGIC_001` generic 401。四签发点形状已核对一致（{userId}/300s/mfa_verify；suspended 门序与 oauth.ts:463→474、ldap auth.ts:971→980 对齐；issueTokenPair 带 status claim ✓）。

## R14 (F3-2, L — sessionStorage restore 顺序硬约束)

restore effect 必须声明在 oauthCode effect（Login.tsx:42-62，守卫 :48 读 mfaFlowToken）**之前**（React 按声明序执行）。verifyMfa 失败路径有意保留 mfaFlowToken（stores/auth.ts:115-116/136-141），sessionStorage 于 mount restore 即清 → 无残留。写 before `window.location.assign` 时对 null 值跳过（removeItem 而非写 "null"）。

## 已核验为 PASS（无需动作）

- 单插件布局安全：Fastify 4 封装域 parser 按内容类型叠加，同域 exchange(JSON) 走继承 parser；app.ts `grep -c addContentTypeParser` 守恒为 0
- 掩码自动覆盖：`SENSITIVE_KEY_PATTERN=/secret|password|token|key/i`（options.ts:23）自动命中 saml_private_key（GET 掩码 + PUT 拒写回）；**saml_idp_cert/saml_public_cert 有意不掩码（公开证书材料）**——spec 固化此分类
- status 端点独立正确，**禁止**复用 /oauth/providers（其 FALLBACK_PROVIDERS 兜底语义与 SAML 严格门冲突——OAuthButtons.tsx:7,25）
- F3-1 清 token/user 无现存测试钉死旧行为（可安全改）；补 vitest 断言锁新行为（MFA 分支后 token/refreshToken/user 均 null）
- F3-5 e2e 插入点：auth-session.spec.ts:299-340 R6 式新 case，mock `**/api/v1/auth/oauth/exchange` 返 `{mfaRequired:true, flowToken:'flow-1'}`；page.route 按测试隔离，无冲突
- F3-3 stub burn 修复方向正确（oauth.test.ts:140-145 现状确为 purpose-check-before-delete）
- 四签发点 MFA 形状统一、verify 单门未动、seed 18 不变、/auth/* 免权限码、FastifyACS 403 JSON 与 OAuth suspended 同形（parity）
