import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

import { ApiKeyManager } from '../managers/ApiKeyManager.js';

/**
 * Chainable drizzle-style mock (same shape as PermissionManager.test.ts).
 */
function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.returning = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

function makeMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('generateApiKey', () => {
  const mgr = new ApiKeyManager(undefined as never);

  it('returns plaintext with ab_ prefix + exactly 32 lowercase-alnum chars', () => {
    const { plaintext } = ApiKeyManager.generateApiKey();
    expect(plaintext).toMatch(/^ab_[a-z0-9]{32}$/);
    expect(plaintext).toHaveLength(35);
  });

  it('hash is recomputable as sha256(plaintext) hex and prefix = first 8 chars', () => {
    const { plaintext, hash, prefix } = ApiKeyManager.generateApiKey();
    expect(hash).toBe(sha256(plaintext));
    expect(prefix).toBe(plaintext.slice(0, 8));
    expect(prefix).toMatch(/^ab_/);
  });

  it('generates unique keys across calls', () => {
    const a = ApiKeyManager.generateApiKey();
    const b = ApiKeyManager.generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe('ApiKeyManager', () => {
  let db: ReturnType<typeof makeMockDb>;
  let manager: ApiKeyManager;

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'k1',
    name: 'ci-key',
    prefix: 'ab_abcd12',
    hash: sha256('ab_seeded0123456789abcdefghij'),
    scopes: ['*'],
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    tenantId: 't1',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeMockDb();
    manager = new ApiKeyManager(db as never);
  });

  describe('create', () => {
    it('inserts hash/prefix (no plaintext column) and returns plaintext exactly once', async () => {
      const inserted = row();
      const chain = makeChain([inserted]);
      db.insert.mockReturnValue(chain);

      const result = await manager.create('ci-key', ['*'], 't1');

      expect(result.plaintext).toMatch(/^ab_[a-z0-9]{32}$/);
      const values = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(values['hash']).toBe(sha256(result.plaintext));
      expect(values['prefix']).toBe(result.plaintext.slice(0, 8));
      expect(values).not.toHaveProperty('plaintext');
      // Plaintext is not echoed back in any stored field
      expect(JSON.stringify(values)).not.toContain(result.plaintext);
    });

    it('passes scopes and tenantId, omits expiresAt when not given', async () => {
      const chain = makeChain([row()]);
      db.insert.mockReturnValue(chain);

      await manager.create('k', ['users:read'], 't2');

      const values = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(values['scopes']).toEqual(['users:read']);
      expect(values['tenantId']).toBe('t2');
      expect(values).not.toHaveProperty('expiresAt');
    });

    it('includes expiresAt when provided', async () => {
      const chain = makeChain([row()]);
      db.insert.mockReturnValue(chain);
      const exp = new Date('2030-01-01T00:00:00Z');

      await manager.create('k', ['*'], 't1', exp);

      const values = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(values['expiresAt']).toBe(exp);
    });

    it('throws when insert returns no row', async () => {
      db.insert.mockReturnValue(makeChain([]));
      await expect(manager.create('k', ['*'], 't1')).rejects.toThrow('Failed to create API key');
    });
  });

  describe('list', () => {
    it('never leaks the hash: SAFE_COLUMNS projection excludes it', async () => {
      db.select.mockReturnValue(makeChain([row()]));

      await manager.list('t1');

      // The projection handed to db.select must not contain the hash column
      // (in prod drizzle projects only these columns; mock returns rows as-is).
      const projection = db.select.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(projection).toBeDefined();
      expect(Object.keys(projection as object)).not.toContain('hash');
      expect(Object.keys(projection as object)).toContain('prefix');
    });
  });

  describe('findByHash', () => {
    it('returns the full row (with hash) on hit', async () => {
      const full = row();
      db.select.mockReturnValue(makeChain([full]));

      const result = await manager.findByHash(full.hash as string);

      expect(result).toEqual(full);
      expect(result).toHaveProperty('hash');
    });

    it('returns null on miss', async () => {
      db.select.mockReturnValue(makeChain([]));
      expect(await manager.findByHash('deadbeef')).toBeNull();
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on the row scoped by id + tenant', async () => {
      const chain = makeChain(undefined);
      db.update.mockReturnValue(chain);

      await manager.revoke('k1', 't1');

      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('isExpired', () => {
    it('false for null expiresAt', () => {
      expect(ApiKeyManager.isExpired(null)).toBe(false);
    });

    it('true when expiresAt is in the past', () => {
      expect(ApiKeyManager.isExpired(new Date(Date.now() - 1000))).toBe(true);
    });

    it('false when expiresAt is in the future', () => {
      expect(ApiKeyManager.isExpired(new Date(Date.now() + 1000))).toBe(false);
    });
  });
});
