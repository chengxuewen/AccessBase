# Batch A 计划审核修订附录（Review Addendum）

> **状态**: 本附录是 2026-09-12-batch-a-p0-security.md 的强制修订——三路团队审核（cross-checker 0 违规 / critic-2 5HIGH+3MED / critic-1 7M+7m）后的统一修正案。**执行者必须先读本附录再执行主计划**；冲突处以本附录为准。
> **审核日期**: 2026-09-12　**审核团队**: plan-review-squad（已归档）

## 修订总览（按任务号）

### T1 — 测试桩重写（critic-2 HIGH-1/HIGH-2 + critic-1 m-1）

1. **删掉 `vi.mock('bcrypt')` 内联块**——项目用 **bcryptjs**（identity/package.json:30，无 bcrypt 依赖）；且 vi.mock 提升到文件顶，写在测试体内不生效。
2. **mock 模式**：`vi.spyOn(mgr,'db','get')` accessor 模式经 critic-1 实测（vitest 3.2.7 探针）**可行**；但与 UserManager.test.ts 现有 file-level `vi.mock('../db/index.js')` 风格不一致时，优先沿用现有文件模式：`vi.mocked(createDb).mockReturnValue(链式桩 select().from().where().limit()→[user行])`。二选一，全文件统一。
3. **"bcrypt 之前抛"的断言**：依赖文件级 bcryptjs mock 的 `compare` 默认 resolve(true)，断言 `expect(compare).not.toHaveBeenCalled()` 证明 status 检查先于 bcrypt。

### T2 — login 403 映射 + refresh 旁路 + 测试 mock 齐备（critic-1 M1/M2/M3 + critic-2 MED×3）★最重要修订

1. **login handler 缺 ACCOUNT_SUSPENDED 映射（M1，P0 缺口）**：Task 1 后 login catch 全捕获→401 AUTH_002 且计入 lockout.recordFailure（auth.ts:186-196）。**Task 2 必须新增 Step**：
   ```typescript
   // login catch 内，先于 recordFailure：
   if (err instanceof Error && err.message === 'ACCOUNT_SUSPENDED') {
     return reply.status(403).send({
       success: false,
       error: { code: 'AUTH_004', message: 'Account suspended' },
     });
   }
   ```
   suspended 登录**不计入** recordFailure（critic-1 m-1：无差别计数会锁定已禁用账号的审计语义）。加 1 条 vitest 断言真实 403 映射（不用 e2e mock 糊）。
2. **refresh 旁路补 claim（M2）**：/refresh 直签 `app.jwt.sign({sub})`（auth.ts:408）绕过 issueTokenPair。修正：rotate 成功后经 `userManager.findById(userId)` 取 status，sign 时带 `status` claim。（critic-2 MED-3 的"不需补"结论仅对**本次 PATCH 即 suspend** 的用户成立——吊销后 rotate 直接失败；对**存量 suspended 用户**（如 DB 导入/历史数据）仍可无限换发无 claim token，故仍需补。）
3. **disabled-user.test.ts 必须补全 mock 前导**（M3）：零 mock 直接 buildApp 会让 setupGuard/OIDC createDb/requirePermission 全拨真 PG。复制 users.test.ts:44-77 的六段 mock（cors/swagger/swagger-ui/rate-limit/helmet/identity），其中 UserManager（findById 返回用户）、RoleManager（getUserRoles→[]）、PermissionManager（hasPermission→true）。**SessionManager 保持 importOriginal 真类**（prototype spyOn 才有效；ctor 无 PG 拨号，SessionManager.test.ts:86 裸 new 先例）。
4. **revoke 断言改共享 mock fn 模式**：identity mock 后 SessionManager 若被 mock 则 spyOn 失效——按 users.test.ts 共享 mock fn 模式在 mock 定义层断言。
5. **S5 单例化（MED-1）**：handler 内 `new SessionManager()` 每请求建 Pool。改 users.ts 模块级懒单例（permission.ts:31-36 同款）：`let sm: SessionManager|null; function getSessionManager() { sm ??= new SessionManager(); return sm; }`
6. **向后兼容断言收紧（m-3）**：`.not.toBe('AUTH_004')` 过弱 → `expect(res.statusCode).not.toBe(403)`。
7. **Step 5 片段补 import**（m-6）；AUTH_004 信封可选走 setErrorHandler 同构（带 timestamp）——非阻塞。

### T3 — create 两参 + pending 语义 + bcryptjs（critic-2 HIGH-3/HIGH-4 + critic-1 M5 + m-6）

1. **签名**：`create(data: CreateUserInput, tenantId: string)` **两参**（UserManager.ts:32-56；users.ts:174 先例）。计划原片段单参+status:'pending' **tsc 必报错**。
2. **pending 语义**：CreateUserInput 无 status 字段，create 内部硬编码 `isActive===false?'suspended':'active'`（UserManager.ts:44）——**照原计划执行会静默产出 active 用户**。修正（采用 critic-2 推荐的 b）：
   ```typescript
   const user = await userManager.create({ email, name, passwordHash }, DEFAULT_TENANT);
   await userManager.changeStatus(user.id, 'pending', DEFAULT_TENANT);
   ```
3. **bcryptjs**：`await import('bcrypt')` → module not found。改 bcryptjs，或更懒：UserManager.create 内部自带 `hash(data.password, 12)`——**直接传明文 password 字段**（以 CreateUserInput 实际字段名为准），handler 不碰 bcrypt。二选一，以 types.ts CreateUserInput 为准。
4. **测试 mock 补 queryAdminExists**（m-6）：否则依赖 setupGuard fail-open 才能过——mock 类需含该方法（users.test.ts 同款）。
5. 弱密码正则/201 断言等其余部分维持原计划。

### T4 — 未接线键处理（critic-1 m-4）

- JWT_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN / LOG_LEVEL 代码零消费（TTL 硬编码 '15m'，auth.ts:58,408）→ 模板中标注 `# reserved (unwired)` 或剔除，勿制造新漂移。
- Task 6 落地后回写 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM 到模板（T4 步骤注明依赖 T6）。

### T5 — health 断言更新 + ping 类型 + 测试重写（critic-2 HIGH-6/HIGH-7 + critic-1 M4）

1. **routes.test.ts 必炸预警**：routes.test.ts:91-92 现有断言 `checks.redis === 'not_configured'`——本任务必须同步更新该断言（database 行不动），否则全量 vitest 假红。
2. **ping 类型**：RedisLike 只有 get/set/del（identity/redis.ts:15-20）。采用 critic-2 推荐前者：getRedis 返回类型改 `import type { Redis } from 'ioredis'`（有 ping）；health 探活 `await redis.ping()`。
3. **getRedis 测试 1 重写**（M4）：getRedisClient 同步、恒返回实例、REDIS_URL 缺失回退 localhost（services/redis.ts:24-37）——`returns null when REDIS_URL missing` 按原测试**实现后仍 FAIL**。修正语义：
   ```typescript
   it('getRedis caches the client and returns the same instance', async () => {
     const a = await getRedis();
     const b = await getRedis();
     expect(a).not.toBeNull();
     expect(a).toBe(b);
   });
   ```
   getRedis 实现：同步调 getRedisClient()（不抛），模块级 cached 缓存；失败 try/catch 保留。
4. **health schema**（M4 尾）：health.ts:43 输出类型是 string——redis 状态输出 `'ok'|'down'` 字符串（不改 schema 形状）， ping 失败 catch → 'down'。

### T6 — options.get 三参（critic-2 HIGH-5 + critic-1 M7）

1. 真实签名：`async get<T>(key: string, envValue: T | undefined, defaultValue: T): Promise<T>`（OptionsManager.ts:32）——**env 回退已内建**，计划里手写 `?? process.env['SMTP_HOST']` 冗余且语义错。
2. 修正调用形态（auth.ts 需按 permission.ts 单例模式新建 OptionsManager 实例）：
   ```typescript
   const host = await options.get('smtp_host', process.env['SMTP_HOST'], '');
   const port = Number(await options.get('smtp_port', process.env['SMTP_PORT'] ? Number(process.env['SMTP_PORT']) : undefined, 587));
   const user = await options.get('smtp_user', process.env['SMTP_USER'], '');
   const pass = await options.get('smtp_password', process.env['SMTP_PASSWORD'], '');
   const from = await options.get('smtp_from', process.env['SMTP_FROM'], '');
   if (host) { const mailer = Mailer.fromConfig({ host, port, user, pass, from }); ... }
   ```
3. forgot-password 接线补 1 条集成断言（cross-checker 提醒）：SMTP 配置齐全时 `mailer.send` 被调用；缺失时降级 log 不抛（在 auth 相关测试文件内，mock Mailer.fromConfig）。

### T7 — e2e mock 穿透修正（critic-1 M6）

1. `page.request.post` **不经 page.route 拦截**（APIRequestContext 独立作用域）→ 请求穿透真 dev server，mock 永不生效。修正：测试 1 改 `page.evaluate(() => fetch('/api/v1/auth/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({...}) }))` 并断言 `res.status===201`；或走真实 UI 表单流（如有注册页）。
2. 测试 2（suspended 登录 403）维持 mock 形态（login 页 UI 流天然经 page.route）——但该用例现在测的是**真实映射**（T2 修订 1 已让 server 返回 403 AUTH_004），mock 只是回归锁，语义成立。

## 验收清单增补（并入主计划验收节）

- [ ] suspended 用户**登录**返回 403 AUTH_004（真实映射，非仅 e2e mock）且不计 lockout
- [ ] 存量 suspended 用户 refresh 换发的 token 带 status claim（会被 authenticate 拦截）
- [ ] register 产出 status='pending'（真实 DB 行为，非 mock 期望）——users 表语义级断言
- [ ] routes.test.ts redis 断言与新 health 输出一致（'ok'/'down'）
- [ ] e2e register 用例经 page 作用域（fetch/UI 流）而非 APIRequestContext

## 审核结论记录

- cross-checker：0 硬性违规；2 提醒级（T4 豁免 TDD 合理 / T6 接线补集成断言——已纳入 T6 修订 3）
- plan-critic-2：NEEDS-FIXES 5HIGH+3MED——全部纳入（HIGH-1/2→T1、HIGH-3/4→T3、HIGH-5→T6、HIGH-6/7→T5、MED-1→T2.5、MED-2→T2.3、MED-3→T2.2 注）
- plan-critic-1：NEEDS-FIXES 7M+7m——M1→T2.1、M2→T2.2、M3→T2.3、M4→T5.3/5.4、M5→T3.2、M6→T7.1、M7→T6.1；7m 随修随带
- 两 critic 实测分歧裁定：`vi.spyOn(mgr,'db','get')` 经 critic-1 实测可行（vitest 3.2.7），critic-2 的"直接抛错"结论未被复现；但为风格统一仍建议优先沿用文件现有 createDb mock 模式（T1 修订 2）
