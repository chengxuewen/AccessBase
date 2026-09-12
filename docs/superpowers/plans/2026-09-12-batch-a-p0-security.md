# Batch A — P0 Security Plug + Infra Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plug the P0 security hole (user disable not enforced), unlock the SMTP notification channel, close the register 501 stub, fix .env.example drift, and consolidate Redis wiring.

**Architecture:** All changes stay in the existing manager/route layer. UserManager.verifyPassword gains a status check before bcrypt; the authenticate decorator re-checks status from a JWT claim (no DB hit, backward-compatible with claim-less old tokens); a new Mailer service (nodemailer, config via options table with env fallback) feeds password-reset and register flows. SessionManager/rate-limit/health receive Redis via a shared getRedis() helper. No schema migration needed (users.status exists; flow_tokens reused for email verification).

**Tech Stack:** Fastify, nodemailer, Drizzle ORM, vitest, Playwright (mock-API e2e mode).

**Spec:** 综合差距分析 2026-09-12（四路团队报告）P0 清单 + conventions 全部约束。

## Global Constraints

- 权限码双注册：新路由权限码必须同时进 authorize.ts routePermissions 与 permissions-seed.ts BUILTIN_PERMISSIONS（conventions 检查命令）
- API 信封 `{success,data}`；错误 `{success:false,error:{code,message}}`
- pino 对象式日志 `logger.info({key},'msg')`，禁模板字符串
- 提交信息与代码注释英文；本计划文档中文（语言约束）
- 新依赖仅 `nodemailer` + `@types/nodemailer`
- TDD（D114 红先行）：每任务先写失败测试；vitest 用 mock，不连真 PG
- identity 包改动后必须 `pnpm --filter @accessbase/identity build`（dist 同步陷阱）
- E2E mock-API 模式：跑前确认 5101 无真后端（`curl :5101/health/live` 应 000）
- 前端如有改动：tsc 双闸 + e2e 无新失败
- 每任务完成即 commit

---

## Task 1: 禁用立即生效 — verifyPassword 拒绝非 active 用户

**Files:**
- Modify: `packages/identity/src/managers/UserManager.ts` (verifyPassword, 约 :189)
- Test: `packages/identity/src/__tests__/UserManager.test.ts` (追加)

**Interfaces:**
- Consumes: 现有 `verifyPassword(email: string, password: string): Promise<User>`（UserManager.ts:189）
- Produces: 非 active 状态抛 `Error('ACCOUNT_SUSPENDED')`；Task 2 的 auth 路由捕获此错误映射 403 AUTH_004；登录路径（verifyPassword 的所有调用方）行为变更

- [ ] **Step 1: 写失败测试** — UserManager.test.ts 追加（沿用该文件现有 vi.mock db 模式）：

```typescript
describe('verifyPassword status enforcement', () => {
  it('rejects suspended users before bcrypt compare', async () => {
    // Arrange: db mock returns user with status='suspended'
    const mgr = new UserManager();
    vi.spyOn(mgr as unknown as { db: unknown }, 'db', 'get')
      .mockReturnValue(makeDbReturning([{ id: 'u1', email: 'a@b.c', name: 'A',
        status: 'suspended', passwordHash: '$2a$10$whatever', tokenVersion: 1 }]));
    // Act + Assert
    await expect(mgr.verifyPassword('a@b.c', 'any-password'))
      .rejects.toThrow('ACCOUNT_SUSPENDED');
  });

  it('rejects pending users with the same error', async () => {
    const mgr = new UserManager();
    vi.spyOn(mgr as unknown as { db: unknown }, 'db', 'get')
      .mockReturnValue(makeDbReturning([{ id: 'u2', email: 'p@b.c', name: 'P',
        status: 'pending', passwordHash: '$2a$10$whatever', tokenVersion: 1 }]));
    await expect(mgr.verifyPassword('p@b.c', 'any-password'))
      .rejects.toThrow('ACCOUNT_SUSPENDED');
  });

  it('still succeeds for active users (bcrypt path unchanged)', async () => {
    const mgr = new UserManager();
    vi.spyOn(mgr as unknown as { db: unknown }, 'db', 'get')
      .mockReturnValue(makeDbReturning([{ id: 'u3', email: 'ok@b.c', name: 'O',
        status: 'active', passwordHash: '$2a$10$realhash', tokenVersion: 1 }]));
    vi.mock('bcrypt', () => ({ compare: vi.fn().mockResolvedValue(true) }));
    const user = await mgr.verifyPassword('ok@b.c', 'right-password');
    expect(user.status).toBe('active');
  });
});
```

（执行者注：`makeDbReturning` 是示意 helper——请按 UserManager.test.ts 现有 mock 写法实现同等效果的 db 桩；关键断言是 suspended/pending 在 bcrypt 之前抛 ACCOUNT_SUSPENDED，active 路径不回归。）

- [ ] **Step 2: 跑测试确认失败** — `pixi run npx vitest run packages/identity/src/__tests__/UserManager.test.ts -t "status enforcement"`
  预期：FAIL（现实现不做 status 检查，suspended 也走 bcrypt）

- [ ] **Step 3: 最小实现** — UserManager.ts verifyPassword 内，查到 user 后、bcrypt compare 之前插入：

```typescript
if (user.status !== 'active') {
  throw new Error('ACCOUNT_SUSPENDED');
}
```

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令预期 PASS；然后全量 `pixi run npx vitest run` 无回归（若 auth/login 相关 mock 断言受影响，仅更新断言不改语义）

- [ ] **Step 5: Commit**

```bash
pnpm --filter @accessbase/identity build
git add -A && git commit -m "feat(identity): verifyPassword rejects non-active users (P0 disable semantics)"
```

---

## Task 2: 禁用立即生效 — authenticate 复查 status claim + suspend 吊销会话

**Files:**
- Modify: `apps/server/src/app.ts` (authenticate decorator, 约 :115-125)
- Modify: `apps/server/src/routes/auth.ts` (issueTokenPair — 签发时打 status claim)
- Modify: `apps/server/src/routes/users.ts` (changeStatus 路由, 约 :275-280 — suspended 时吊销会话)
- Test: `apps/server/src/__tests__/disabled-user.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 的 ACCOUNT_SUSPENDED 错误；`SessionManager.revokeAllUserSessions(userId)`（SessionManager.ts 已有，:167 被复用检测调用）；`changeStatus(id, status, tenantId)`（UserManager.ts 已有）
- Produces: JWT access token payload 新增 `status` claim；authenticate 对 `status!=='active'` 的已验签 token 返回 403 `AUTH_004`；PATCH /users/:id/status=suspended 时该用户全部 refresh 会话吊销
- 向后兼容：旧 token（无 status claim）放行——15 分钟 TTL 自然淘汰，不强制断线

- [ ] **Step 1: 写失败测试** — 新建 `apps/server/src/__tests__/disabled-user.test.ts`（沿用 route-guard.test.ts 的 buildApp + inject 模式）：

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';

describe('disabled user enforcement (P0)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  it('authenticate returns 403 AUTH_004 when token carries status!=active', async () => {
    const token = app.jwt.sign({ sub: 'u1', email: 'a@b.c', status: 'suspended' });
    const res = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_004' } });
  });

  it('still authenticates claim-less legacy tokens (backward compat)', async () => {
    const token = app.jwt.sign({ sub: 'u1', email: 'a@b.c' });
    // me 会因 db mock 返回失败或 200——只断言不是 403 AUTH_004
    const res = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().error?.code).not.toBe('AUTH_004');
  });

  it('PATCH status=suspended calls revokeAllUserSessions', async () => {
    const spy = vi.spyOn(SessionManager.prototype, 'revokeAllUserSessions')
      .mockResolvedValue(undefined);
    // 认证 token + users route 的 db mock 按 users.test.ts 现有模式
    const token = app.jwt.sign({ sub: 'admin1', email: 'ad@x.io', status: 'active' });
    await app.inject({
      method: 'PATCH', url: '/api/v1/users/u1/status',
      payload: { status: 'suspended' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(spy).toHaveBeenCalledWith('u1');
  });
});
```

（执行者注：SessionManager import 自 '@accessbase/identity'；users 路由依赖的 db 层 mock 复制 users.test.ts 现有写法，本任务只断言 revoke 调用发生。）

- [ ] **Step 2: 跑测试确认失败** — `pixi run npx vitest run apps/server/src/__tests__/disabled-user.test.ts`
  预期：3 个用例中前 1/3 FAIL（现 authenticate 只验签名）、第 3 个 FAIL（无 revoke 调用）

- [ ] **Step 3: authenticate 加 claim 复查** — app.ts authenticate 装饰器，jwtVerify 成功后追加：

```typescript
const claims = request.user as { status?: string };
if (claims.status && claims.status !== 'active') {
  return reply.status(403).send({
    success: false,
    error: { code: 'AUTH_004', message: 'Account suspended' },
  });
}
```

- [ ] **Step 4: issueTokenPair 打 status claim** — auth.ts 中签发 access token 的 payload 增加 `status: user.status`（login / refresh / step-up 各调用点均经 issueTokenPair 处则一处改完；若有旁路签发点一并补）

- [ ] **Step 5: suspend 路由吊销会话** — users.ts changeStatus 路由（:275-280）成功分支追加：

```typescript
if (status === 'suspended') {
  const sessionManager = new SessionManager();
  await sessionManager.revokeAllUserSessions(id);
}
```

（import SessionManager 自 '@accessbase/identity'，与文件头现有 import 合并）

- [ ] **Step 6: 全量验证** —

```bash
pixi run npx vitest run                    # 无回归
pixi run npx tsc --noEmit                  # server 闸
pnpm --filter @accessbase/identity build   # identity dist 同步（本任务若未改 identity 也无害）
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(server): authenticate re-checks status claim; suspend revokes all sessions (P0)"
```

---

## Task 3: register 501 stub → 真注册（pending 语义）

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (register handler, 约 :200-235)
- Test: `apps/server/src/__tests__/register.test.ts` (new)

**Interfaces:**
- Consumes: `UserManager.findByEmail(email)`、`UserManager.create({...})`（users.ts:181 现有调用签名）；bcrypt hash（AuthManager/UserManager 内已有 bcrypt 先例）
- Produces: `POST /api/v1/auth/register` → 201 `{success:true,data:{id,email,name,status:'pending'}}`；重复邮箱 409 `AUTH_REG_001`；密码策略不合格 400 `AUTH_REG_002`（≥8 位 + 小写 + 大写 + 数字）
- 决策：注册后 status='pending'（邮箱验证未上线的过渡语义——admin 在 Users 页手动 activate；SMTP 落地后改为验证邮件激活）。前端 /register 入口保持隐藏（ui.md:511 Deferred 不动）

- [ ] **Step 1: 写失败测试** — 新建 `apps/server/src/__tests__/register.test.ts`：

```typescript
import { buildApp } from '../app.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
const findByEmailMock = vi.fn();

vi.mock('@accessbase/identity', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...mod,
    UserManager: class {
      findByEmail = findByEmailMock;
      create = createMock;
    },
  };
});

describe('POST /api/v1/auth/register', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    findByEmailMock.mockResolvedValue(null);
    createMock.mockResolvedValue({
      id: 'u9', email: 'new@x.io', name: 'New', status: 'pending',
    });
    app = await buildApp();
    await app.ready();
  });

  it('creates pending user on valid payload', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'new@x.io', name: 'New', password: 'Passw0rd!' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ success: true, data: { status: 'pending' } });
  });

  it('409 AUTH_REG_001 on duplicate email', async () => {
    findByEmailMock.mockResolvedValueOnce({ id: 'u1' });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'dup@x.io', name: 'D', password: 'Passw0rd!' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUTH_REG_001');
  });

  it('400 AUTH_REG_002 on weak password (no uppercase)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'w@x.io', name: 'W', password: 'weakpass1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_REG_002');
  });

  it('400 AUTH_REG_002 on short password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 's@x.io', name: 'S', password: 'Aa1' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

（执行者注：若 register handler 内还有 flowTokens/audit 等依赖，按 auth-sessions.test.ts 现有 mock 模式补充；bcrypt.hash 需 mock 为固定串。）

- [ ] **Step 2: 跑测试确认失败** — `pixi run npx vitest run apps/server/src/__tests__/register.test.ts`
  预期：FAIL（现 handler 返回 501 "Identity package not yet wired"）

- [ ] **Step 3: 实现 handler** — auth.ts register handler 替换 501 段为：

```typescript
const { email, name, password } = request.body as RegisterBody;
const userManager = new (await import('@accessbase/identity')).UserManager();

if (await userManager.findByEmail(email)) {
  return reply.status(409).send({
    success: false,
    error: { code: 'AUTH_REG_001', message: 'Email already registered' },
  });
}

const policyOk =
  password.length >= 8 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /[0-9]/.test(password);
if (!policyOk) {
  return reply.status(400).send({
    success: false,
    error: {
      code: 'AUTH_REG_002',
      message: 'Password needs 8+ chars with lower, upper and digit',
    },
  });
}

const bcrypt = await import('bcrypt');
const passwordHash = await bcrypt.hash(password, 10);
const user = await userManager.create({
  email, name, passwordHash,
  status: 'pending',
  tenantId: DEFAULT_TENANT,
});

return reply.status(201).send({
  success: true,
  data: { id: user.id, email: user.email, name: user.name, status: user.status },
});
```

（执行者注：`userManager.create` 实际签名以 users.ts:181 调用处为准，参数名不一致时以现有签名为准适配；DEFAULT_TENANT 从 `../utils/constants.js` import。）

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令预期 4/4 PASS；全量 vitest 无回归

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(server): wire register endpoint — pending-user creation with password policy (P0)"
```

---

## Task 4: .env.example 补全（21 keys）

**Files:**
- Create: `.env.example`（仓库根目录，当前不存在）

**Interfaces:**
- Produces: 新环境部署模板；.gitignore 若含 .env.example 需排除（检查 `git check-ignore .env.example`）

- [ ] **Step 1: 从代码提取真实 key 清单**

```bash
grep -rhoE "process\.env\[[A-Z_']+\]|env\('[A-Z_]+'" apps/server/src --include='*.ts' \
  | grep -oE "[A-Z_]{3,}" | sort -u
```

- [ ] **Step 2: 写 .env.example** — 按 Step 1 输出全量罗列，每 key 带英文注释（required/optional + 格式示例）。必须包含（quality 报告确认的漂移键）：`DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_PRIVATE_KEY_PATH, JWT_PUBLIC_KEY_PATH, MFA_ENCRYPTION_KEY, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, PORT, HOST, NODE_ENV, LOG_LEVEL, ADMIN_EMAIL, ADMIN_PASSWORD, STATIC_DIR, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_BASE, CORS_ORIGINS`（+ Step 1 若发现 WEBAUTHN_*/LOCKOUT_* 等一并补）

- [ ] **Step 3: 验证** — `git check-ignore .env.example` 应无输出（未被忽略）；对照检查命令 `grep -c '=' .env.example` ≥ 21

- [ ] **Step 4: Commit**

```bash
git add .env.example && git commit -m "chore(ops): add complete .env.example covering all 21 env keys (P0 ops drift)"
```

---

## Task 5: Redis 收口 — SessionManager 接线 + rate-limit Redis storage + health 真 ping

**Files:**
- Create: `apps/server/src/utils/redis.ts`（getRedis() 单例 helper）
- Modify: `apps/server/src/routes/auth.ts:20`（SessionManager 接 redis）
- Modify: `apps/server/src/app.ts:89-92`（rateLimit 加 redis storage）
- Modify: `apps/server/src/routes/health.ts`（redis 检查从 not_configured 改真 ping）
- Test: `apps/server/src/__tests__/redis-wiring.test.ts` (new)

**Interfaces:**
- Consumes: `SessionManager(databaseUrl?, redis?)`（SessionManager.ts:35）；`getRedisClient()`（packages/identity/src/services/redis.ts 已有，set 签名 `set(key, value, ...args)`）
- Produces: `getRedis(): Promise<RedisLike|null>`（apps/server/src/utils/redis.ts 导出，失败返回 null 不抛）；rate-limit 多实例共享计数；/health/ready 报告真实 Redis 状态

- [ ] **Step 1: 写失败测试** — 新建 `apps/server/src/__tests__/redis-wiring.test.ts`：

```typescript
import { describe, expect, it, vi } from 'vitest';
import { getRedis } from '../utils/redis.js';

describe('redis wiring (P0 infra consolidation)', () => {
  it('getRedis returns null (not throw) when REDIS_URL missing', async () => {
    vi.stubEnv('REDIS_URL', '');
    const r = await getRedis();
    expect(r).toBeNull();
  });

  it('rate-limit config includes redis storage when available', async () => {
    // 静态断言（route-guard.test.ts 同款模式）
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('apps/server/src/app.ts', 'utf-8'),
    );
    expect(src).toMatch(/rateLimit[\s\S]{0,200}redis/i);
  });

  it('health ready reports redis status truthfully', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('apps/server/src/routes/health.ts', 'utf-8'),
    );
    expect(src).not.toMatch(/not_configured/);
  });
});
```

（执行者注：第 1 例行为测试优先；第 2/3 例为静态断言回归锁——route-guard.test.ts 已有静态断言先例。）

- [ ] **Step 2: 跑测试确认失败** — `pixi run npx vitest run apps/server/src/__tests__/redis-wiring.test.ts`（utils/redis.ts 不存在 → FAIL）

- [ ] **Step 3: 实现 getRedis helper** — 新建 `apps/server/src/utils/redis.ts`：

```typescript
import { getRedisClient } from '@accessbase/identity';
import type { RedisLike } from '@accessbase/identity';

let cached: RedisLike | null | undefined;

/** Process-wide Redis singleton; returns null when unavailable (fail-soft). */
export async function getRedis(): Promise<RedisLike | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await getRedisClient();
  } catch {
    cached = null;
  }
  return cached;
}
```

（执行者注：getRedisClient 的真实签名以 packages/identity/src/services/redis.ts 为准；若其本身不抛而返回 null，则 try/catch 冗余可简化。）

- [ ] **Step 4: 三处接线** —
  1. auth.ts:20 改 `const sessionManager = new SessionManager(undefined, await getRedis());`
  2. app.ts rateLimit 注册改为：

```typescript
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: await getRedis() ?? undefined,
});
```

  3. health.ts 的 redis 检查改为 `getRedis()` 有实例 → `ping()` 成功 → `redis: true`；失败 → `redis: false`（不再恒报 not_configured）

- [ ] **Step 5: 跑测试确认通过 + 全量无回归** — `pixi run npx vitest run`（注：oauth.ts 已有自己的 safeRedis 注入，不动）

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(server): consolidate redis wiring — session cache, rate-limit storage, truthful health (P0)"
```

---

## Task 6: Mailer 服务（nodemailer + options 表配置 + env 回退）

**Files:**
- Create: `packages/identity/src/services/mailer.ts`
- Modify: `packages/identity/src/index.ts`（导出 Mailer）
- Modify: `apps/server/src/routes/auth.ts`（forgot-password 真投递替换 log）
- Test: `packages/identity/src/__tests__/mailer.test.ts` (new)

**Interfaces:**
- Consumes: OptionsManager（批 4 已有，三级优先 env>option>default）；nodemailer.createTransport
- Produces: `class Mailer { constructor(opts: {host,port,user,pass,from}); send(to,subject,html): Promise<void>; static fromConfig(cfg): Mailer | null }` — `fromConfig` 在 smtp host 缺失时返回 null（调用方降级打 log，行为与现状一致）；导出经 @accessbase/identity index
- 依赖：`pnpm --filter @accessbase/identity add nodemailer && pnpm --filter @accessbase/identity add -D @types/nodemailer`

- [ ] **Step 0: 安装依赖**

```bash
pnpm --filter @accessbase/identity add nodemailer
pnpm --filter @accessbase/identity add -D @types/nodemailer
```

- [ ] **Step 1: 写失败测试** — 新建 `packages/identity/src/__tests__/mailer.test.ts`：

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

import { createTransport } from 'nodemailer';
import { Mailer } from '../services/mailer.js';

describe('Mailer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fromConfig returns null when smtp host missing (fail-soft)', () => {
    expect(Mailer.fromConfig({})).toBeNull();
  });

  it('fromConfig builds transport with full config', () => {
    const m = Mailer.fromConfig({
      host: 'smtp.x.io', port: 587, user: 'u', pass: 'p', from: 'no-reply@x.io',
    });
    expect(m).not.toBeNull();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.x.io', port: 587 }),
    );
  });

  it('send delivers to recipient with subject and html', async () => {
    const m = Mailer.fromConfig({
      host: 'smtp.x.io', port: 587, user: 'u', pass: 'p', from: 'no-reply@x.io',
    })!;
    await m.send('a@b.c', 'Reset', '<b>link</b>');
    const transport = (createTransport as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.c', subject: 'Reset', html: '<b>link</b>' }),
    );
  });

  it('send failure throws (caller maps to log-degradation)', async () => {
    (createTransport as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      sendMail: vi.fn().mockRejectedValue(new Error('SMTP down')),
    }));
    const m = Mailer.fromConfig({
      host: 'smtp.x.io', port: 587, user: 'u', pass: 'p', from: 'no@x.io',
    })!;
    await expect(m.send('a@b.c', 'S', 'h')).rejects.toThrow('SMTP down');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `pixi run npx vitest run packages/identity/src/__tests__/mailer.test.ts`（services/mailer.ts 不存在 → FAIL）

- [ ] **Step 3: 实现 mailer.ts** —

```typescript
import { createTransport, type Transporter } from 'nodemailer';
import { logger } from '@accessbase/logging';

export interface SmtpConfig {
  host?: string; port?: number; user?: string; pass?: string; from?: string;
}

export class Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  private constructor(transport: Transporter, from: string) {
    this.transport = transport;
    this.from = from;
  }

  /** Returns null when host is absent — callers degrade to logging. */
  static fromConfig(cfg: SmtpConfig): Mailer | null {
    if (!cfg.host) return null;
    return new Mailer(
      createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: (cfg.port ?? 587) === 465,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
      }),
      cfg.from ?? `no-reply@${cfg.host}`,
    );
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, html });
    logger.info({ to, subject }, 'Email sent');
  }
}
```

- [ ] **Step 4: index.ts 导出** — packages/identity/src/index.ts 加 `export * from './services/mailer.js';`；`pnpm --filter @accessbase/identity build`

- [ ] **Step 5: 跑测试确认通过** — `pixi run npx vitest run packages/identity/src/__tests__/mailer.test.ts` 4/4

- [ ] **Step 6: forgot-password 接线** — auth.ts forgot-password handler 内（现有 issue token 的 if(user) 分支），token issue 后追加：

```typescript
const mailer = Mailer.fromConfig({
  host: await options.get('smtp_host') ?? process.env['SMTP_HOST'],
  port: Number(await options.get('smtp_port') ?? process.env['SMTP_PORT'] ?? 587),
  user: await options.get('smtp_user') ?? process.env['SMTP_USER'],
  pass: await options.get('smtp_password') ?? process.env['SMTP_PASSWORD'],
  from: await options.get('smtp_from') ?? process.env['SMTP_FROM'],
});
if (mailer) {
  const link = `${process.env['FRONTEND_ORIGIN'] ?? ''}/reset-password?token=${token}`;
  await mailer.send(email, 'Reset your password', `<p>Click to reset: <a href="${link}">${link}</a></p>`).catch((err) => {
    logger.warn({ err }, 'Reset email delivery failed (degraded to log)');
  });
}
```

（执行者注：options.get 的真实方法名以 OptionsManager 为准（批 4 实现，可能是 get/getValue）；敏感键 smtp_password 经 options 表时批 4 的脱敏/掩码机制自动生效；幂等性——现有 anti-enumeration 恒 200 行为不变。）

- [ ] **Step 7: 全量验证 + Commit**

```bash
pixi run npx vitest run && pixi run npx tsc --noEmit
git add -A && git commit -m "feat(identity,server): Mailer service with options-table SMTP config; forgot-password real delivery (P0)"
```

---

## Task 7: E2E 回归收官 + 全局门禁

**Files:**
- Test: `e2e/auth.spec.ts`（追加 2 用例：register pending 流 / disabled 用户登录 403）— mock-API 模式
- 验证性任务，无产物代码

**Interfaces:**
- Consumes: Task 1-6 全部路由行为（mock 按 routes 实际返回拷贝，conventions PIT-033）

- [ ] **Step 1: 确认 5101 无真后端** — `curl -s -m 2 --noproxy '*' -o /dev/null -w '%{http_code}' http://localhost:5101/health/live` 应 000

- [ ] **Step 2: e2e 追加用例** — auth.spec.ts 追加：

```typescript
test('register returns 201 with pending status (mock)', async ({ page }) => {
  await page.route('**/api/v1/setup/status', (r) => r.fulfill({ status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) }));
  await page.route('**/api/v1/auth/register', (r) => r.fulfill({ status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { id: 'u9', email: 'n@x.io', name: 'N', status: 'pending' } }) }));
  const res = await page.request.post('/api/v1/auth/register', {
    data: { email: 'n@x.io', name: 'N', password: 'Passw0rd!' },
  });
  expect(res.status()).toBe(201);
});

test('suspended user login shows ACCOUNT_SUSPENDED error', async ({ page }) => {
  await page.route('**/api/v1/setup/status', (r) => r.fulfill({ status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) }));
  await page.route('**/api/v1/auth/login', (r) => r.fulfill({ status: 403,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, error: { code: 'AUTH_004', message: 'Account suspended' } }) }));
  await page.goto('/login');
  await page.fill('input[type="email"], #email', 'sus@x.io');
  await page.fill('input[type="password"], #password', 'Passw0rd!');
  await page.click('button[type="submit"]');
  await expect(page.getByText(/suspended/i).first()).toBeVisible({ timeout: 5000 });
});
```

（执行者注：Login 页选择器以现有 auth.spec.ts 用例为准适配；403 前端文案以 i18n 实际 key 为准——若前端尚未处理 AUTH_004 展示，补 Login.tsx 的错误映射一行：AUTH_004 → i18n 'account suspended'。）

- [ ] **Step 3: 全量门禁** —

```bash
pixi run npx vitest run                 # 全绿
pixi run npx tsc --noEmit
pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json
export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1
pixi run npx playwright test --project=chromium --reporter=line   # 基线 102+3skip 无新失败
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(e2e): batch A regression locks — register pending flow + suspended login 403"
```

---

## 验收清单（批次 A 完成定义）

- [ ] suspended/pending 用户登录被拒（403 AUTH_004），active 无回归
- [ ] suspend 操作即时吊销该用户全部 refresh 会话
- [ ] 存量无 claim token 15 分钟内自然淘汰（向后兼容确认）
- [ ] /auth/register 201 pending / 409 重复 / 400 弱密码三态齐备
- [ ] .env.example ≥21 keys 且 git 不忽略
- [ ] rate-limit redis storage 生效（静态断言锁）
- [ ] health/ready 如实报告 redis
- [ ] forgot-password 在 SMTP 配置齐全时真投递、缺失时降级 log（行为不变）
- [ ] vitest 全绿 + e2e 基线无新失败 + tsc 双闸净
