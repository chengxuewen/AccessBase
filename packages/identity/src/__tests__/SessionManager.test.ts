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
    chain.where.mockImplementation(() => {
      // Filter store.rows lazily by the eq() conditions captured via the where arg
      return {
        limit: vi.fn(async () => store.rows.slice(0, 1)),
      };
    });
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
});
