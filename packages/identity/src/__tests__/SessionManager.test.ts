import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { SessionManager } from '../managers/SessionManager.js';
import { sessions } from '../db/schema.js';
import type { RedisLike } from '../services/redis.js';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Chainable drizzle-style mock builder. Each call records its node; terminal
 * methods (.from → .where → .limit → rows, .insert().values(), .update().set()
 * → .where()) resolve against a shared in-memory session list.
 */
function makeMockDb(store: { rows: Record<string, unknown>[] }) {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };

  const selectChain = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    db.select.mockReturnValue(chain);
    chain.from.mockReturnValue(chain);
    chain.where.mockImplementation(() => ({
      // await (select…from…where) → all rows; .limit() → first row (drizzle semantics)
      limit: vi.fn(async () => store.rows.slice(0, 1)),
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve([...store.rows]).then(resolve, reject),
    }));
    chain.limit.mockImplementation(async () => store.rows.slice(0, 1));
    return chain;
  };

  db.select.mockImplementation(selectChain);

  db.insert.mockReturnValue({
    values: vi.fn(async (row: Record<string, unknown>) => {
      store.rows.push(row);
      return [];
    }),
  });

  db.update.mockReturnValue({
    set: vi.fn((patch: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        // Patch is applied to matching rows only when predicate inspects rows;
        // tests assert via explicit expectations on set() payload instead.
        store.lastUpdatePatch = patch;
        return [];
      }),
    })),
  });

  return db;
}

describe('SessionManager', () => {
  let store: { rows: Record<string, unknown>[]; lastUpdatePatch?: Record<string, unknown> };
  let mockDb: ReturnType<typeof makeMockDb>;
  let manager: SessionManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = { rows: [] };
    mockDb = makeMockDb(store);
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(mockDb as never);
    manager = new SessionManager();
  });

  const meta = { ip: '127.0.0.1', userAgent: 'test-agent' };

  const sessionRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: randomBytes(8).toString('hex'),
    userId: '550e8400-e29b-41d4-a716-446655440000',
    token: 'legacy-session-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    revokedAt: null,
    usedAt: null,
    refreshTokenHash: null,
    ...over,
  });

  describe('issueRefreshToken', () => {
    it('inserts session with sha256 hash and returns raw token', async () => {
      const result = await manager.issueRefreshToken(
        'sess-1',
        '550e8400-e29b-41d4-a716-446655440000',
        meta,
      );

      expect(result.refreshToken).toMatch(/^[0-9a-f]{80}$/); // 40 random bytes hex
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      const valuesArg = mockDb.insert.mock.calls[0][0];
      expect(valuesArg).toBe(sessions);
      const inserted = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(inserted.refreshTokenHash).toBe(hash(result.refreshToken));
      expect(inserted.ipAddress).toBe('127.0.0.1');
      expect(inserted.deviceInfo).toEqual({ userAgent: 'test-agent' });
      expect(inserted.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('rotateRefreshToken', () => {
    it('issues a NEW refresh token and invalidates the old one', async () => {
      const old = await manager.issueRefreshToken('sess-1', 'u-1', meta);
      // Simulate the DB row the first insert created
      store.rows = [
        sessionRow({
          id: 'sess-1',
          refreshTokenHash: hash(old.refreshToken),
          usedAt: null,
          revokedAt: null,
        }),
      ];

      const rotated = await manager.rotateRefreshToken(old.refreshToken, meta);

      expect(rotated.refreshToken).not.toBe(old.refreshToken);
      // Old session marked used
      expect(store.lastUpdatePatch).toHaveProperty('usedAt');
      // New insert carried the new hash
      const lastResult = mockDb.insert.mock.results.at(-1)?.value;
      const lastCall = lastResult?.values.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      const inserted = lastCall?.[0];
      expect(inserted.refreshTokenHash).toBe(hash(rotated.refreshToken));
    });

    it('rejects unknown token with Session not found', async () => {
      store.rows = [];
      await expect(manager.rotateRefreshToken('nope', meta)).rejects.toThrow(
        'Session not found',
      );
    });

    it('rejects expired session', async () => {
      const old = await manager.issueRefreshToken('sess-1', 'u-1', meta);
      store.rows = [
        sessionRow({
          id: 'sess-1',
          refreshTokenHash: hash(old.refreshToken),
          expiresAt: new Date(Date.now() - 1000),
        }),
      ];

      await expect(manager.rotateRefreshToken(old.refreshToken, meta)).rejects.toThrow(
        /expired/i,
      );
    });

    it('rejects revoked session', async () => {
      const old = await manager.issueRefreshToken('sess-1', 'u-1', meta);
      store.rows = [
        sessionRow({
          id: 'sess-1',
          refreshTokenHash: hash(old.refreshToken),
          revokedAt: new Date(),
        }),
      ];

      await expect(manager.rotateRefreshToken(old.refreshToken, meta)).rejects.toThrow(
        /revoked/i,
      );
    });

    it('reuse of a rotated token revokes ALL user sessions and throws', async () => {
      const old = await manager.issueRefreshToken('sess-1', 'u-1', meta);
      store.rows = [
        sessionRow({
          id: 'sess-1',
          userId: 'u-1',
          refreshTokenHash: hash(old.refreshToken),
          usedAt: new Date(), // already rotated once
        }),
      ];

      await expect(manager.rotateRefreshToken(old.refreshToken, meta)).rejects.toThrow(
        /reuse/i,
      );
      // Reuse detection triggered the revoke-all path
      expect(store.lastUpdatePatch).toHaveProperty('revokedAt');
    });
  });

  describe('revokeOtherSessions', () => {
    it('updates sessions for the user with revokedAt patch', async () => {
      await manager.revokeOtherSessions('u-1', 'sess-keep');

      expect(store.lastUpdatePatch).toHaveProperty('revokedAt');
    });
  });

  describe('revokeAllUserSessions', () => {
    it('updates all sessions for the user with revokedAt', async () => {
      await manager.revokeAllUserSessions('u-1');

      expect(store.lastUpdatePatch).toHaveProperty('revokedAt');
    });
  });

  describe('revokeSession', () => {
    it('marks the session revoked by id', async () => {
      await manager.revokeSession('sess-1');

      expect(store.lastUpdatePatch).toHaveProperty('revokedAt');
    });
  });

  describe('findSessionByToken', () => {
    it('resolves session id by refresh token', async () => {
      const old = await manager.issueRefreshToken('sess-1', 'u-1', meta);
      store.rows = [
        sessionRow({ id: 'sess-9', refreshTokenHash: hash(old.refreshToken) }),
      ];

      const found = await manager.findSessionByToken(old.refreshToken);
      expect(found?.id).toBe('sess-9');
    });
  });

  describe('hashToken', () => {
    it('is a stable sha256 hex digest', () => {
      expect(manager.hashToken('abc')).toBe(hash('abc'));
      expect(manager.hashToken('abc')).toHaveLength(64);
    });
  });

/**
 * In-memory RedisLike stub. get/set behave like plain KV; tracks keys
 * deleted via del() so invalidation assertions can check Redis contents.
 */
class FakeRedis implements RedisLike {
  private kv = new Map<string, string>();
  deleted: string[] = [];

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.kv.delete(key);
    this.deleted.push(key);
  }

  has(key: string): boolean {
    return this.kv.has(key);
  }
}

describe('SessionManager session lifecycle', () => {
  let store: { rows: Record<string, unknown>[]; lastUpdatePatch?: Record<string, unknown> };
  let mockDb: ReturnType<typeof makeMockDb>;
  let manager: SessionManager;
  let redis: FakeRedis;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = { rows: [] };
    mockDb = makeMockDb(store);
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(mockDb as never);
    redis = new FakeRedis();
    manager = new SessionManager(undefined, redis);
  });

  const sessionRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: randomBytes(8).toString('hex'),
    userId: 'u-1',
    token: 'legacy-session-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    revokedAt: null,
    usedAt: null,
    refreshTokenHash: null,
    deviceInfo: { userAgent: 'test-agent' },
    ipAddress: '127.0.0.1',
    ...over,
  });

  describe('getUserSessions', () => {
    it('returns only active sessions in safe shape', async () => {
      store.rows = [
        sessionRow({ id: 'a', deviceInfo: { userAgent: 'chrome' }, ipAddress: '10.0.0.1' }),
        sessionRow({ id: 'b', revokedAt: new Date() }), // revoked — excluded
        sessionRow({ id: 'c', expiresAt: new Date(Date.now() - 1000) }), // expired — excluded
      ];
      // N.B. mock db .where().limit() returns rows unfiltered (mock limitation);
      // active-filter is expressed in SQL (asserted below), so simulate the DB
      // already returning only active rows here.
      store.rows = [store.rows[0]!];

      const list = await manager.getUserSessions('u-1');

      expect(list).toHaveLength(1);
      const s = list[0]!;
      expect(s).toEqual({
        id: 'a',
        userAgent: 'chrome',
        ip: '10.0.0.1',
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
    });

    it('never leaks token hashes in the returned shape', async () => {
      store.rows = [
        sessionRow({ id: 'a', token: 'SECRET', refreshTokenHash: 'SECRET', deviceInfo: null, ipAddress: null }),
      ];

      const list = await manager.getUserSessions('u-1');

      expect(list).toHaveLength(1);
      expect(JSON.stringify(list[0])).not.toContain('SECRET');
      expect(list[0]).not.toHaveProperty('refreshTokenHash');
      expect(list[0]).not.toHaveProperty('token');
    });

    it('filters by userId + revoked_at IS NULL + expires_at > now (SQL asserted)', async () => {
      const { and, eq, isNull, gt } = await import('drizzle-orm');
      const { PgDialect } = await import('drizzle-orm/pg-core');
      await manager.getUserSessions('u-9');

      const whereArg = mockDb.select.mock.results[0]!.value.where.mock.calls[0]![0];
      const { sql, params } = new PgDialect().sqlToQuery(whereArg);
      expect(sql).toContain('"sessions"."user_id" = $1');
      expect(sql).toContain('"sessions"."revoked_at" is null');
      expect(sql).toContain('"sessions"."expires_at" > $2');
      expect(params[0]).toBe('u-9');
      expect(new Date(params[1] as string | Date).getTime()).toBeGreaterThan(0);
    });

    it('serves from cache on second call without hitting db again', async () => {
      store.rows = [sessionRow({ id: 'a', deviceInfo: { userAgent: 'chrome' }, ipAddress: '10.0.0.1' })];

      await manager.getUserSessions('u-1');
      await manager.getUserSessions('u-1');

      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache on revokeSession', async () => {
      store.rows = [sessionRow({ id: 'a' })];
      await manager.getUserSessions('u-1');
      expect(redis.has('session:u-1')).toBe(true);

      await manager.revokeSession('sess-a');

      expect(redis.has('session:u-1')).toBe(false);
    });

    it('invalidates cache on rotateRefreshToken', async () => {
      const old = await manager.issueRefreshToken('sess-1', 'u-1', { ip: '127.0.0.1', userAgent: 'ua' });
      store.rows = [sessionRow({ id: 'sess-1', refreshTokenHash: hash(old.refreshToken) })];
      await manager.getUserSessions('u-1');
      expect(redis.has('session:u-1')).toBe(true);

      await manager.rotateRefreshToken(old.refreshToken, { ip: '127.0.0.1', userAgent: 'ua' });

      expect(redis.has('session:u-1')).toBe(false);
    });

    it('invalidates cache on revokeAllUserSessions', async () => {
      store.rows = [sessionRow({ id: 'a' })];
      await manager.getUserSessions('u-1');

      await manager.revokeAllUserSessions('u-1');

      expect(redis.has('session:u-1')).toBe(false);
    });

    it('falls back to db and does not throw when redis is down', async () => {
      store.rows = [sessionRow({ id: 'a', deviceInfo: { userAgent: 'ua' }, ipAddress: '1.2.3.4' })];
      const broken: RedisLike = {
        get: async () => { throw new Error('ECONNREFUSED'); },
        set: async () => { throw new Error('ECONNREFUSED'); },
        del: async () => { throw new Error('ECONNREFUSED'); },
      };
      const m = new SessionManager(undefined, broken);

      const list = await m.getUserSessions('u-1');

      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe('a');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('works with no redis at all (cache paths no-op)', async () => {
      store.rows = [sessionRow({ id: 'a', deviceInfo: { userAgent: 'ua' }, ipAddress: '1.2.3.4' })];
      const m = new SessionManager();

      const list = await m.getUserSessions('u-1');
      await m.revokeSession('a');

      expect(list).toHaveLength(1);
    });
  });

  describe('validateSession', () => {
    it('returns true for active session', async () => {
      store.rows = [sessionRow({ id: 'a' })];
      expect(await manager.validateSession('a')).toBe(true);
    });

    it('returns false for revoked session', async () => {
      store.rows = [sessionRow({ id: 'a', revokedAt: new Date() })];
      expect(await manager.validateSession('a')).toBe(false);
    });

    it('returns false for expired session', async () => {
      store.rows = [sessionRow({ id: 'a', expiresAt: new Date(Date.now() - 1000) })];
      expect(await manager.validateSession('a')).toBe(false);
    });

    it('returns false when session not found', async () => {
      store.rows = [];
      expect(await manager.validateSession('ghost')).toBe(false);
    });
  });
});
});
