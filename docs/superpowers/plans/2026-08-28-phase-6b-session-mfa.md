# Phase 6b: Session Management + MFA + Password Security

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement server-side session management (DB authoritative + Redis cache), flow_token multi-step auth foundation, TOTP-based 2FA, password management with history, and account lockout/IP blacklisting.

**Architecture:** SessionManager owns all session lifecycle (create, rotate, revoke) with DB as source of truth and Redis as hot cache. FlowTokenService provides single-use, time-scoped tokens for multi-step auth (2FA step-up). Auth routes delegate to SessionManager instead of signing JWTs directly. MfaManager wraps otplib for TOTP setup/verify with recovery codes. PasswordProvider uses bcryptjs (matching existing UserManager.hash at 12 rounds). Account lockout uses Redis counters.

**Tech Stack:** TypeScript / Fastify v4 / @fastify/jwt v8 / Drizzle ORM v0.29 / PostgreSQL 16 / ioredis v5 / bcryptjs (existing) / otplib / qrcode / Vitest

**Spec:** `docs/modules/{security,database,api,core-packages}.md` + `.agents/memorys/decisions.md` (D22/D23/D42/D60/D84) + `.refinfo/new-api/controller/auth_session.go` (flow_token concept reference)

---

## Global Constraints

(Copied verbatim from master plan)

- 包管理一律 pnpm workspace，不新增非必要依赖；新增依赖必须进 pixi/pnpm lockfile 一起提交
- API 路径必须 `/api/v1/` 前缀；前端 client.baseURL='/api'，请求路径带 `/v1/`
- 严格 TypeScript，无 `as any` / `@ts-ignore`（project anti-pattern）
- 每个任务: 失败测试先行 → 最小实现 → 通过 → commit
- E2E 用 Playwright（mock API 默认，真后端仅 setup/auth-flow 类测试）；webServer.reuseExistingServer: true
- 测试命令统一: `pixi run npx vitest run <file>` / `pixi run npx playwright test --project=chromium e2e/<file>.spec.ts`
- 用户实体无 status/roles 字段（D105）；PATCH /users/:id/status 独立端点
- 测试数据独立（Date.now() 标识）；beforeEach 检测 401 → 重建 admin 重试
- Zod 校验在信任边界；日志 pino 结构化（对象第一参）
- Response envelope: `{ success: boolean, data?: T, error?: { code: string, message: string } }`
- Migration via `pixi run npx drizzle-kit push`
- Password hashing: bcryptjs, 12 rounds (existing in `UserManager.create` and `PasswordProvider`)
- Redis: ioredis already in `@accessbase/identity` package.json
- `@fastify/jwt` v8 in `@accessbase/server`; `jsonwebtoken` v9 in `@accessbase/identity`
- SessionManager and FlowTokenService consumed by Phase 6d (WebAuthn/OAuth) -- signatures must stay clean

## Existing Code Reference

| Item | Location | Key Facts |
|------|----------|-----------|
| SessionManager stubs | `packages/identity/src/managers/SessionManager.ts` | All throw `Not implemented`; constructor takes `JwtConfig`; uses `jsonwebtoken` |
| PasswordProvider | `packages/identity/src/providers/PasswordProvider.ts` | Uses `bcryptjs`; `authenticate` throws after email validation |
| MfaManager stubs | `packages/identity/src/managers/MfaManager.ts` | All throw `Not implemented`; constructor takes `MfaConfig` |
| UserManager | `packages/identity/src/managers/UserManager.ts` | `hash(password, 12)` for create; `verifyPassword` does bcrypt compare |
| Auth routes | `apps/server/src/routes/auth.ts` | login/me/logout/refresh; login calls `UserManager.verifyPassword` then `app.jwt.sign`; logout stateless; refresh verifies JWT directly |
| Drizzle schema | `packages/identity/src/db/schema.ts` | `users` (id/email/name/passwordHash/tenantId/status/tokenVersion); `sessions` (id/userId/token/expiresAt/createdAt) |
| DB connection | `packages/identity/src/db/index.ts` | `createDb(databaseUrl?)` returns `drizzle(pool, { schema })`; type `DrizzleDB` |
| Server config | `apps/server/src/config.ts` | Has `redisUrl`, `jwtSecret`, `databaseUrl` |
| Identity defaults | `packages/identity/src/index.ts` | lockoutThreshold:5, lockoutDuration:900, passwordHistoryCount:5, bcryptRounds:12 |

## Intentional Existing Test Expectations That Will Change

| File | Current | Change Reason | New |
|------|---------|--------------|-----|
| `apps/server/src/__tests__/routes.test.ts` | Login signs JWT via `app.jwt.sign` | Login calls `SessionManager.createSession` | Same response shape, internal wiring |
| Same file | Logout stateless | Logout calls `SessionManager.revokeSession` | Same response shape, DB call added |
| Same file | Refresh re-signs JWT | Refresh calls `SessionManager.rotateRefreshToken` | Same response shape, rotation logic |

---

## Task 1: SessionManager Implementation

**Files:**
- Create: `packages/identity/src/__tests__/SessionManager.test.ts`
- Modify: `packages/identity/src/managers/SessionManager.ts` (replace stubs)
- Modify: `packages/identity/src/types.ts` (add `SessionManagerConfig`, `SessionRecord`)
- Modify: `packages/identity/src/db/schema.ts` (ALTER sessions: add refresh_token_hash, device_info, ip_address, revoked_at, used_at)
- Modify: `apps/server/src/routes/auth.ts` (login/createSession, logout/revokeSession, refresh/rotate)
- Modify: `packages/identity/src/index.ts` (export `SessionManagerConfig`)

**Interfaces:**
- Consumes: `DrizzleDB` (DI), `sessions` schema, `bcryptjs` (existing), `jsonwebtoken` (existing), `ioredis` (existing)
- Produces: `createSession(user:{id,email}, meta:{ip?,device?}) -> SessionTokens`, `rotateRefreshToken(oldToken, meta) -> SessionTokens`, `revokeSession(id) -> void`, `revokeAllSessions(userId) -> number`, `getUserSessions(userId) -> SessionRecord[]`, `validateRefreshToken(token) -> SessionRecord|null`

Phase 6d extension: constructor takes db+redis as DI. WebAuthn/OAuth login calls `sessionManager.createSession(user, meta)` identically.

- [ ] **Step 1: Add schema columns**

In `packages/identity/src/db/schema.ts`, extend the `sessions` pgTable. Add after the existing `createdAt` column:

```typescript
    refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(),
    deviceInfo: varchar('device_info', { length: 500 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
```

Also add to `packages/identity/src/types.ts`:

```typescript
export interface SessionRecord {
  id: string; userId: string; refreshTokenHash: string;
  deviceInfo: string | null; ipAddress: string | null;
  expiresAt: Date; revokedAt: Date | null; usedAt: Date | null; createdAt: Date;
}

export interface SessionManagerConfig {
  jwtSecret: string; issuer: string; accessTokenTTL: number; refreshTokenTTL: number;
}
```

Run migration: `pixi run npx drizzle-kit push`

- [ ] **Step 2: Write failing tests**

Create `packages/identity/src/__tests__/SessionManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../db/index.js', () => ({ createDb: vi.fn() }));

import { SessionManager } from '../managers/SessionManager.js';
import type { DrizzleDB } from '../db/index.js';

function createMockDb() {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'session-new', userId: 'u1' }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => [{ id: 'updated' }]),
      })),
    })),
  } as unknown as DrizzleDB;
}

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    manager = new SessionManager(
      { jwtSecret: 'test-secret', issuer: 'test', accessTokenTTL: 900, refreshTokenTTL: 604800 },
      mockDb,
    );
  });

  describe('createSession', () => {
    it('returns accessToken and refreshToken', async () => {
      const result = await manager.createSession(
        { id: 'user-1', email: 'test@example.com' },
        { ip: '127.0.0.1', device: 'Mozilla/5.0' },
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.expiresIn).toBe(900);
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('stores session row in DB', async () => {
      await manager.createSession({ id: 'u1', email: 'e@e.com' }, { ip: '10.0.0.1' });
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('rotateRefreshToken', () => {
    it('issues new token pair on valid token', async () => {
      const tokens = await manager.createSession({ id: 'user-1', email: 'e@e.com' }, {});
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{
              id: 'session-1', userId: 'user-1', refreshTokenHash: 'hash',
              revokedAt: null, usedAt: null, expiresAt: new Date(Date.now() + 86400000),
              deviceInfo: null, ipAddress: null, createdAt: new Date(),
            }]),
          })),
        })),
      } as never);
      const result = await manager.rotateRefreshToken(tokens.refreshToken, {});
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('rejects expired refresh token', async () => {
      const tokens = await manager.createSession({ id: 'u1', email: 'e@e.com' }, {});
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{
              id: 's1', userId: 'u1', refreshTokenHash: 'hash',
              revokedAt: null, usedAt: null, expiresAt: new Date(Date.now() - 1000),
              deviceInfo: null, ipAddress: null, createdAt: new Date(),
            }]),
          })),
        })),
      } as never);
      await expect(manager.rotateRefreshToken(tokens.refreshToken, {})).rejects.toThrow(/expired/i);
    });

    it('rejects reused token and revokes all sessions', async () => {
      const tokens = await manager.createSession({ id: 'u1', email: 'e@e.com' }, {});
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{
              id: 's1', userId: 'u1', refreshTokenHash: 'hash',
              revokedAt: null, usedAt: new Date(),
              expiresAt: new Date(Date.now() + 86400000),
              deviceInfo: null, ipAddress: null, createdAt: new Date(),
            }]),
          })),
        })),
      } as never);
      await expect(manager.rotateRefreshToken(tokens.refreshToken, {})).rejects.toThrow(/used|reused|revoked/i);
    });
  });

  describe('revokeSession', () => {
    it('sets revokedAt on session row', async () => {
      await manager.revokeSession('session-id');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('revokeAllSessions', () => {
    it('returns count of revoked sessions', async () => {
      vi.mocked(mockDb.update).mockReturnValueOnce({
        set: vi.fn(() => ({ where: vi.fn(async () => [{ id: '1' }, { id: '2' }]) })),
      } as never);
      const count = await manager.revokeAllSessions('user-1');
      expect(count).toBe(2);
    });
  });

  describe('getUserSessions', () => {
    it('returns active sessions for user', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 's1' }, { id: 's2' }]) })),
          })),
        })),
      } as never);
      const sessions = await manager.getUserSessions('u1');
      expect(sessions).toHaveLength(2);
    });
  });

  describe('validateRefreshToken', () => {
    it('returns session record for valid token', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{
              id: 's1', userId: 'u1', refreshTokenHash: 'hash',
              revokedAt: null, expiresAt: new Date(Date.now() + 86400000),
              usedAt: null, deviceInfo: null, ipAddress: null, createdAt: new Date(),
            }]),
          })),
        })),
      } as never);
      const result = await manager.validateRefreshToken('valid-token');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('s1');
    });

    it('returns null for invalid token', async () => {
      vi.mocked(mockDb.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
      } as never);
      const result = await manager.validateRefreshToken('bad-token');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `pixi run npx vitest run packages/identity/src/__tests__/SessionManager.test.ts`
Expected: FAIL (stubs throw "Not implemented")

- [ ] **Step 4: Implement SessionManager**

Replace `packages/identity/src/managers/SessionManager.ts` entirely. Design: refresh token is `sessionId.userId.hmacSig` (HMAC-signed, not JWT, so we can look up the session row by ID). Access token is JWT. Redis cache is fire-and-forget.

```typescript
import { eq, and, sql } from 'drizzle-orm';
import { randomBytes, createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { sessions } from '../db/schema.js';
import { logger } from '@accessbase/logging';
import type { DrizzleDB } from '../db/index.js';
import type { SessionTokens } from '../types.js';

export interface SessionRecord {
  id: string; userId: string; refreshTokenHash: string;
  deviceInfo: string | null; ipAddress: string | null;
  expiresAt: Date; revokedAt: Date | null; usedAt: Date | null; createdAt: Date;
}

export interface SessionManagerConfig {
  jwtSecret: string; issuer: string; accessTokenTTL: number; refreshTokenTTL: number;
}

interface RedisLike {
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

function signRefreshToken(sessionId: string, userId: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(`${sessionId}:${userId}`).digest('hex').slice(0, 16);
  return `${sessionId}.${userId}.${sig}`;
}

function decodeRefreshToken(token: string): { sessionId: string; userId: string } | null {
  const parts = token.split('.');
  return parts.length === 3 ? { sessionId: parts[0]!, userId: parts[1]! } : null;
}

function verifyRefreshTokenSig(token: string, secret: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const expected = createHmac('sha256', secret).update(`${parts[0]}:${parts[1]}`).digest('hex').slice(0, 16);
  return parts[2] === expected;
}

export class SessionManager {
  constructor(
    private readonly config: SessionManagerConfig,
    private readonly db: DrizzleDB,
    private readonly redis?: RedisLike,
  ) {}

  async createSession(user: { id: string; email: string }, meta: { ip?: string; device?: string }): Promise<SessionTokens> {
    const refreshTokenHash = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTTL * 1000);
    const [session] = await this.db.insert(sessions).values({
      userId: user.id, token: refreshTokenHash, refreshTokenHash,
      expiresAt, ipAddress: meta.ip ?? null, deviceInfo: meta.device ?? null,
    }).returning();
    if (!session) throw new Error('Failed to create session');
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email }, this.config.jwtSecret,
      { expiresIn: `${this.config.accessTokenTTL}s`, issuer: this.config.issuer },
    );
    const refreshToken = signRefreshToken(session.id, user.id, this.config.jwtSecret);
    if (this.redis) {
      this.redis.set(`session:${user.id}:${session.id}`, session.id, 'EX', this.config.refreshTokenTTL).catch(() => {});
    }
    return { accessToken, refreshToken, expiresIn: this.config.accessTokenTTL };
  }

  async rotateRefreshToken(oldRefreshToken: string, meta: { ip?: string; device?: string }): Promise<SessionTokens> {
    if (!verifyRefreshTokenSig(oldRefreshToken, this.config.jwtSecret)) throw new Error('Invalid refresh token');
    const decoded = decodeRefreshToken(oldRefreshToken)!;
    const [session] = await this.db.select().from(sessions)
      .where(and(eq(sessions.id, decoded.sessionId), eq(sessions.userId, decoded.userId))).limit(1);
    if (!session) throw new Error('Session not found');
    if (session.revokedAt) {
      logger.warn({ userId: decoded.userId }, 'Refresh token reuse detected');
      await this.revokeAllSessions(decoded.userId);
      throw new Error('Token revoked');
    }
    if (session.usedAt) {
      logger.warn({ userId: decoded.userId }, 'Refresh token replay detected');
      await this.revokeAllSessions(decoded.userId);
      throw new Error('Token already used');
    }
    if (new Date(session.expiresAt) < new Date()) throw new Error('Refresh token expired');
    await this.db.update(sessions).set({ usedAt: new Date() }).where(eq(sessions.id, session.id));
    return this.createSession({ id: decoded.userId, email: '' }, { ip: meta.ip, device: meta.device });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
    if (this.redis) this.redis.del(`session:*:${sessionId}`).catch(() => {});
  }

  async revokeAllSessions(userId: string): Promise<number> {
    const result = await this.db.update(sessions).set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} IS NULL`));
    if (this.redis) this.redis.del(`session:${userId}:*`).catch(() => {});
    return Array.isArray(result) ? result.length : 0;
  }

  async getUserSessions(userId: string): Promise<SessionRecord[]> {
    return this.db.select().from(sessions)
      .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} IS NULL`))
      .orderBy(sessions.createdAt) as Promise<SessionRecord[]>;
  }

  async validateRefreshToken(token: string): Promise<SessionRecord | null> {
    if (!verifyRefreshTokenSig(token, this.config.jwtSecret)) return null;
    const decoded = decodeRefreshToken(token);
    if (!decoded) return null;
    const [session] = await this.db.select().from(sessions)
      .where(and(eq(sessions.id, decoded.sessionId), eq(sessions.userId, decoded.userId))).limit(1);
    if (!session || session.revokedAt || new Date(session.expiresAt) < new Date()) return null;
    return session as SessionRecord;
  }
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `pixi run npx vitest run packages/identity/src/__tests__/SessionManager.test.ts`
Expected: PASS

- [ ] **Step 6: Integrate into auth routes**

In `apps/server/src/routes/auth.ts`:

**Login** (after `verifyPassword` succeeds, replace the `app.jwt.sign` block):
```typescript
import { SessionManager, createDb } from '@accessbase/identity';
import { config } from '../config.js';

// Inside login handler:
const db = createDb();
const sessionManager = new SessionManager(
  { jwtSecret: config.jwtSecret, issuer: 'accessbase', accessTokenTTL: 900, refreshTokenTTL: 604800 }, db,
);
const tokens = await sessionManager.createSession(
  { id: user.id, email: user.email },
  { ip: request.ip, device: request.headers['user-agent'] as string },
);
return { success: true, data: { ...tokens, user: { id: user.id, email: user.email, name: user.name, roles: [] } } };
```

**Logout** (replace stateless return):
```typescript
async (request, reply) => {
  const payload = request.user as { sub: string; sid?: string };
  if (payload.sid) await sessionManager.revokeSession(payload.sid);
  return { success: true };
};
```

**Refresh** (replace JWT re-sign with rotation):
```typescript
async (request, reply) => {
  const { refreshToken } = request.body as { refreshToken: string };
  try {
    const tokens = await sessionManager.rotateRefreshToken(refreshToken, {
      ip: request.ip, device: request.headers['user-agent'] as string,
    });
    return { success: true, data: tokens };
  } catch {
    return reply.status(401).send({ success: false, error: { code: 'AUTH_003', message: 'Invalid or expired refresh token' } });
  }
};
```

- [ ] **Step 7: Type check**

Run: `pixi run npx tsc --noEmit -p packages/identity/tsconfig.json && pixi run npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: 0 errors

- [ ] **Step 8: Run all identity tests**

Run: `pixi run npx vitest run packages/identity/`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add packages/identity/src/managers/SessionManager.ts packages/identity/src/types.ts packages/identity/src/db/schema.ts packages/identity/src/__tests__/SessionManager.test.ts apps/server/src/routes/auth.ts packages/identity/src/index.ts
git commit -m "feat: implement SessionManager with DB authoritative session lifecycle"
```

---

## Task 2: FlowToken Service

**Files:**
- Create: `packages/identity/src/services/FlowTokenService.ts`
- Create: `packages/identity/src/__tests__/FlowTokenService.test.ts`
- Modify: `packages/identity/src/index.ts` (add export)

**Interfaces:**
- Consumes: Redis `ioredis` (or in-memory `Map` fallback for tests)
- Produces: consumed by Task 3 (MFA login step-up) and Task 4 (password reset)

```typescript
export interface FlowTokenPayload { purpose: string; userId: string; [key: string]: unknown; }
export class FlowTokenService {
  constructor(redis?: RedisLike | null);
  async issue(purpose: string, payload: FlowTokenPayload, ttlSeconds?: number): Promise<string>;
  async consume(token: string, expectedPurpose: string): Promise<FlowTokenPayload | null>;
}
```

Phase 6d extension: `FlowTokenPayload` index signature allows WebAuthn challenge data. `purpose` is extensible. No DB dependency.

- [ ] **Step 1: Write failing tests**

Create `packages/identity/src/__tests__/FlowTokenService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FlowTokenService } from '../services/FlowTokenService.js';

describe('FlowTokenService', () => {
  let service: FlowTokenService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FlowTokenService(null);
  });

  it('returns a token string on issue', async () => {
    const token = await service.issue('mfa_verify', { purpose: 'mfa_verify', userId: 'u1' });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('consumes token and returns payload', async () => {
    const token = await service.issue('mfa_verify', { purpose: 'mfa_verify', userId: 'u1' });
    const payload = await service.consume(token, 'mfa_verify');
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe('u1');
    expect(payload?.purpose).toBe('mfa_verify');
  });

  it('returns null for double-use (replay)', async () => {
    const token = await service.issue('mfa_verify', { purpose: 'mfa_verify', userId: 'u1' });
    await service.consume(token, 'mfa_verify');
    const second = await service.consume(token, 'mfa_verify');
    expect(second).toBeNull();
  });

  it('returns null for non-existent token', async () => {
    expect(await service.consume('fake', 'mfa_verify')).toBeNull();
  });

  it('returns null for purpose mismatch', async () => {
    const token = await service.issue('mfa_verify', { purpose: 'mfa_verify', userId: 'u1' });
    expect(await service.consume(token, 'password_reset')).toBeNull();
  });

  it('returns null for expired token', async () => {
    const token = await service.issue('mfa_verify', { purpose: 'mfa_verify', userId: 'u1' }, 0);
    await new Promise(r => setTimeout(r, 50));
    expect(await service.consume(token, 'mfa_verify')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pixi run npx vitest run packages/identity/src/__tests__/FlowTokenService.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement FlowTokenService**

Create `packages/identity/src/services/FlowTokenService.ts`:

```typescript
import { randomBytes, createHash } from 'node:crypto';
import { logger } from '@accessbase/logging';

export interface FlowTokenPayload { purpose: string; userId: string; [key: string]: unknown; }

interface RedisLike {
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

interface StoredEntry { payload: FlowTokenPayload; expiresAt: number; }
const DEFAULT_TTL = 300;

export class FlowTokenService {
  private readonly redis?: RedisLike;
  private readonly store = new Map<string, StoredEntry>();

  constructor(redis?: RedisLike | null) { if (redis) this.redis = redis; }

  async issue(purpose: string, payload: FlowTokenPayload, ttlSeconds = DEFAULT_TTL): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const key = this.keyFor(token);
    const entry: StoredEntry = { payload: { ...payload, purpose }, expiresAt: Date.now() + ttlSeconds * 1000 };
    if (this.redis) await this.redis.set(key, JSON.stringify(entry), 'EX', ttlSeconds).catch(() => {});
    this.store.set(key, entry);
    return token;
  }

  async consume(token: string, expectedPurpose: string): Promise<FlowTokenPayload | null> {
    const key = this.keyFor(token);
    let entry: StoredEntry | undefined;

    if (this.redis) {
      const raw = await this.redis.get(key);
      if (raw) { entry = JSON.parse(raw) as StoredEntry; await this.redis.del(key); }
    }
    if (!entry) { entry = this.store.get(key); if (entry) this.store.delete(key); }

    if (!entry) return null;
    if (Date.now() > entry.expiresAt) return null;
    if (entry.payload.purpose !== expectedPurpose) return null;

    logger.debug({ purpose: expectedPurpose }, 'Flow token consumed');
    return entry.payload;
  }

  private keyFor(token: string): string {
    return `flow:${createHash('sha256').update(token).digest('hex')}`;
  }
}
```

- [ ] **Step 4: Add export to index**

In `packages/identity/src/index.ts`, add:
```typescript
export { FlowTokenService } from './services/FlowTokenService.js';
export type { FlowTokenPayload } from './services/FlowTokenService.js';
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `pixi run npx vitest run packages/identity/src/__tests__/FlowTokenService.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/services/FlowTokenService.ts packages/identity/src/__tests__/FlowTokenService.test.ts packages/identity/src/index.ts
git commit -m "feat: add FlowTokenService for multi-step auth flows"
```

---
## Task 3: 2FA/TOTP

**Files:**
- Modify: `packages/identity/src/db/schema.ts` (add `mfa_recovery_codes` table; users columns: `totp_secret`, `totp_enabled`)
- Modify: `packages/identity/src/managers/MfaManager.ts` (replace stubs)
- Modify: `apps/server/src/routes/auth.ts` (add mfa endpoints, modify login flow)
- Create: `packages/identity/src/__tests__/MfaManager.test.ts`
- Modify: `packages/identity/src/types.ts` (add MfaSetupResult, MfaVerifyResult)
- New deps: `pnpm add -F @accessbase/identity otplib qrcode && pnpm add -D -F @accessbase/identity @types/qrcode`

**Interfaces:**
- Consumes: `FlowTokenService.issue/consume` (Task 2), `DrizzleDB`, `bcryptjs` (recovery code hashing)
- Produces: `setup(userId) -> { otpauthUrl, qrDataUrl, recoveryCodes }`, `enable(userId, code) -> void`, `verify(userId, code) -> MfaVerifyResult`, `verifyRecoveryCode(userId, code) -> MfaVerifyResult`, `disable(userId, password) -> void`, `regenerateRecoveryCodes(userId) -> string[]`

Auth route contract (UI is 6c scope):
- `POST /api/v1/auth/mfa/setup` (auth required) -> `{ otpauthUrl, qrDataUrl, recoveryCodes }`
- `POST /api/v1/auth/mfa/enable` (auth required, body: `{code}`) -> `{ success }`
- `POST /api/v1/auth/mfa/verify` (body: `{flowToken, code}`) -> `{accessToken, refreshToken, expiresIn}`
- `POST /api/v1/auth/mfa/disable` (auth required, body: `{password}`) -> `{ success }`

Login flow change: if `user.totp_enabled`, response is `{ mfaRequired: true, flowToken }` instead of tokens.

- [ ] **Step 1: Schema changes** -- Add `totpSecret: text('totp_secret')` and `totpEnabled: boolean('totp_enabled').default(false).notNull()` to users table. Add `mfaRecoveryCodes` table with `id, userId, codeHash, usedAt, createdAt`. Run: `pixi run npx drizzle-kit push`

- [ ] **Step 2: Write failing tests** -- Create `packages/identity/src/__tests__/MfaManager.test.ts` with 5 tests: setup returns otpauthUrl+qrDataUrl+recoveryCodes (10 codes), enable activates on valid code, verify returns valid:true for correct TOTP, verify returns valid:false for wrong code, disable deactivates and clears secret. Mock otplib (authenticator.generateSecret/keyuri/verify), qrcode (toDataURL), bcryptjs, db.

- [ ] **Step 3: Run tests, verify they fail** -- `pixi run npx vitest run packages/identity/src/__tests__/MfaManager.test.ts` -- Expected: FAIL

- [ ] **Step 4: Implement MfaManager** -- Replace stubs in `packages/identity/src/managers/MfaManager.ts`. Use otplib `authenticator.generateSecret()`, `authenticator.keyuri(email, 'AccessBase', secret)`, `authenticator.verify({token, secret})`. QR via `QRCode.toDataURL(otpauthUrl)`. Recovery codes: `randomBytes(4).toString('hex')` x10, stored as bcryptjs hashes. Verify: try TOTP first, fall back to recovery codes. Disable: verify password, then clear totpSecret+totpEnabled, delete recovery codes.

- [ ] **Step 5: Add mfa routes and modify login flow** -- In auth routes: add `/mfa/setup`, `/mfa/enable`, `/mfa/verify` (consumes flow_token, creates session), `/mfa/disable`. Modify login: after verifyPassword, if user.totp_enabled, issue FlowToken with purpose 'mfa_verify' and return `{ mfaRequired: true, flowToken }`.

- [ ] **Step 6: Type check** -- `pixi run npx tsc --noEmit -p packages/identity/tsconfig.json && pixi run npx tsc --noEmit -p apps/server/tsconfig.json` -- Expected: 0 errors

- [ ] **Step 7: Run tests** -- `pixi run npx vitest run packages/identity/src/__tests__/MfaManager.test.ts` -- Expected: PASS

- [ ] **Step 8: Commit** -- `git add ... && git commit -m "feat: implement 2FA/TOTP with setup, enable, verify, disable endpoints"`

---

## Task 4: Password Management

**Files:**
- Modify: `packages/identity/src/db/schema.ts` (add `password_history` table)
- Modify: `apps/server/src/routes/auth.ts` (add change-password, forgot-password, reset-password)
- Create: `packages/identity/src/__tests__/PasswordManagement.test.ts`

**Interfaces:**
- Consumes: `FlowTokenService.issue/consume` (Task 2), `SessionManager.revokeAllSessions` (Task 1), `DrizzleDB`, `bcryptjs`
- Produces: `POST /api/v1/auth/change-password` (auth, `{oldPassword, newPassword}`), `POST /api/v1/auth/forgot-password` (rate-limited, always 200), `POST /api/v1/auth/reset-password` (`{token, newPassword}`)

New table: `password_history (id, user_id, password_hash, created_at)` with userId index.

- [ ] **Step 1: Schema change** -- Add `passwordHistory` table. Run: `pixi run npx drizzle-kit push`

- [ ] **Step 2: Write failing tests** -- Create `packages/identity/src/__tests__/PasswordManagement.test.ts`. 3 contract tests: (1) forgot-password always returns `{success:true}` even for non-existent emails (anti-enumeration), (2) password history rejects reused passwords (check last 5 hashes via bcryptjs compare), (3) change-password requires auth + old password verification.

- [ ] **Step 3: Implement password management** -- In auth routes: `change-password` verifies old password via UserManager.verifyPassword, checks password_history (last 5 via bcryptjs compare), hashes new password, stores in history, updates users.passwordHash. `forgot-password` always returns 200, generates reset token via FlowTokenService with 'password_reset' purpose, stores hash in Redis with 30min TTL. `reset-password` consumes flow token, hashes new password, updates user, calls sessionManager.revokeAllSessions.

- [ ] **Step 4: Type check + run tests** -- `pixi run npx tsc --noEmit` for both packages + `pixi run npx vitest run packages/identity/src/__tests__/PasswordManagement.test.ts`

- [ ] **Step 5: Commit** -- `git commit -m "feat: add password management (change, forgot, reset) with history"`

---

## Task 5: Account Lockout + IP Blacklist

**Files:**
- Create: `packages/identity/src/services/AccountLockoutService.ts`
- Create: `packages/identity/src/__tests__/AccountLockoutService.test.ts`
- Modify: `packages/identity/src/index.ts` (export)
- Modify: `apps/server/src/routes/auth.ts` (add lockout check at login, clear on success)

**Interfaces:**
- Consumes: Redis `ioredis` (or in-memory `Map` fallback)
- Produces: `isLockedOut(id) -> boolean`, `recordFailure(id) -> {locked, remaining}`, `clearFailures(id) -> void`, `blacklistIp(ip, ttl?) -> void`, `isIpBlacklisted(ip) -> boolean`

Redis keys: `lockout:{email}` counter (5 fails in 900s -> lock 900s), `blacklist:{ip}` boolean with TTL.

- [ ] **Step 1: Write failing tests** -- Create `packages/identity/src/__tests__/AccountLockoutService.test.ts` with 5 tests: (1) allows login below threshold (4 failures, not locked), (2) locks out at threshold (5 failures, locked), (3) clears on success, (4) blacklists IP, (5) allows non-blacklisted IPs. Use in-memory Map as mock Redis.

- [ ] **Step 2: Run tests, verify they fail** -- `pixi run npx vitest run packages/identity/src/__tests__/AccountLockoutService.test.ts` -- Expected: FAIL

- [ ] **Step 3: Implement AccountLockoutService** -- Create service with Redis incr/expire/ttl/get/set/del. `isLockedOut` checks count >= threshold. `recordFailure` increments counter with TTL, locks if threshold reached. `clearFailures` deletes both keys. `blacklistIp` sets key with TTL. `isIpBlacklisted` checks key existence.

- [ ] **Step 4: Add lockout to login route** -- At top of login handler: check IP blacklist (429 if blacklisted), check account lockout (423 if locked). After success: clearFailures. After failure: recordFailure, if locked return 423.

- [ ] **Step 5: Type check + run tests** -- `pixi run npx tsc --noEmit -p packages/identity/tsconfig.json` + `pixi run npx vitest run packages/identity/src/__tests__/AccountLockoutService.test.ts`

- [ ] **Step 6: Commit** -- `git commit -m "feat: add account lockout and IP blacklist with Redis counters"`

---

## Task 6: Integration Closeout

**Files:**
- Create: `apps/server/src/__tests__/auth-mfa-integration.test.ts` (true-backend E2E)

**Goal:** Full gate verification + true-backend E2E for 2FA flow (login -> mfaRequired -> verify -> tokens) at API level.

- [ ] **Step 1: Run full test suite** -- `pixi run npx vitest run` -- Expected: All pass

- [ ] **Step 2: Type check all packages** -- `pixi run npx tsc --noEmit -p packages/identity/tsconfig.json && pixi run npx tsc --noEmit -p apps/server/tsconfig.json` -- Expected: 0 errors

- [ ] **Step 3: Write 2FA integration test** -- Create `apps/server/src/__tests__/auth-mfa-integration.test.ts` using `buildApp()` + `app.inject()`. Test: create user, enable TOTP via API, login returns mfaRequired+flowToken, verify with TOTP code returns tokens. Requires running DB + Redis.

- [ ] **Step 4: Run integration tests** -- `pixi run npx vitest run apps/server/src/__tests__/auth-mfa-integration.test.ts` -- Expected: PASS

- [ ] **Step 5: Verify schema migration** -- `pixi run npx drizzle-kit push` -- All new columns and tables created

- [ ] **Step 6: Update memorys** -- Update `.agents/memorys/status.md` with Phase 6b completion

- [ ] **Step 7: Final commit** -- `git commit -m "feat: Phase 6b integration closeout - full test suite + 2FA E2E"`

---

## Test Case Count Summary

| Task | Test File | Cases |
|------|-----------|-------|
| 1: SessionManager | `packages/identity/src/__tests__/SessionManager.test.ts` | 9 |
| 2: FlowTokenService | `packages/identity/src/__tests__/FlowTokenService.test.ts` | 6 |
| 3: MfaManager | `packages/identity/src/__tests__/MfaManager.test.ts` | 5 |
| 4: Password Mgmt | `packages/identity/src/__tests__/PasswordManagement.test.ts` | 3 |
| 5: Lockout | `packages/identity/src/__tests__/AccountLockoutService.test.ts` | 5 |
| 6: Integration | `apps/server/src/__tests__/auth-mfa-integration.test.ts` | 1 |
| **Total** | **6 files** | **29 new** |

## Signature Consistency Check

| Class | Method | Consumed By | Task |
|-------|--------|-------------|------|
| `SessionManager` | `createSession(user, meta) -> SessionTokens` | Auth routes login, Task 3 MFA verify, Phase 6d WebAuthn/OAuth | 1 |
| `SessionManager` | `rotateRefreshToken(oldToken, meta) -> SessionTokens` | Auth routes /refresh | 1 |
| `SessionManager` | `revokeSession(id) -> void` | Auth routes logout | 1 |
| `SessionManager` | `revokeAllSessions(userId) -> number` | Task 4 reset-password, Phase 6d | 1 |
| `FlowTokenService` | `issue(purpose, payload, ttl?) -> string` | Task 3 MFA login step-up, Task 4 forgot-password | 2 |
| `FlowTokenService` | `consume(token, purpose) -> payload\|null` | Task 3 /mfa/verify, Task 4 /reset-password | 2 |
| `MfaManager` | `setup(userId, email) -> MfaSetupResult` | Auth routes /mfa/setup | 3 |
| `MfaManager` | `enable(userId, code) -> void` | Auth routes /mfa/enable | 3 |
| `MfaManager` | `verify(userId, code) -> MfaVerifyResult` | Auth routes /mfa/verify | 3 |
| `AccountLockoutService` | `isLockedOut(id) -> boolean` | Auth routes login | 5 |
| `AccountLockoutService` | `recordFailure(id) -> {locked, remaining}` | Auth routes login failure | 5 |
| `AccountLockoutService` | `clearFailures(id) -> void` | Auth routes login success | 5 |

## Deviations

1. **Password hashing stays bcryptjs** (12 rounds). The user prompt said "choose argon2id if no existing hasher exists" but bcryptjs is already in use across PasswordProvider and UserManager. Switching would break existing password hashes.
2. **Refresh token format**: `sessionId.userId.hmacSig` (custom HMAC-signed opaque token) instead of JWT. This allows O(1) session lookup by ID without scanning, and avoids the complexity of storing JWT metadata for revocation.
3. **No separate Redis client in server package**: SessionManager accepts Redis as constructor DI. Server creates Redis instance if REDIS_URL is set, passes to SessionManager. Avoids adding ioredis to server package.json.
4. **Password Management tests (Task 4)** are contract tests at present. Full implementation tests should be added when the route-level integration tests are written in Task 6 or Phase 6c.
