import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db module entirely
vi.mock('../db/index.js', () => ({
  createDb: vi.fn(),
}));

// Pin JWT_SECRET for deterministic scrypt-derived keys in tests
const TEST_JWT_SECRET = 'test-jwt-secret-for-oidc-32bytes!!';

let savedJwt: string | undefined;

import {
  OidcClientManager,
  encryptSecret,
  decryptSecret,
} from '../managers/OidcClientManager.js';
import type { DrizzleDB } from '../db/index.js';

/**
 * Chainable drizzle-style mock — same shape as OptionsManager.test.ts.
 */
function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.returning = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.onConflictDoUpdate = vi.fn(() => chain);
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

describe('encryptSecret / decryptSecret (crypto helpers)', () => {
  beforeEach(() => {
    savedJwt = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = TEST_JWT_SECRET;
  });

  afterEach(() => {
    if (savedJwt === undefined) {
      delete process.env['JWT_SECRET'];
    } else {
      process.env['JWT_SECRET'] = savedJwt;
    }
  });

  it('roundtrips: decrypt(encrypt(secret)) === secret', () => {
    const secret = 'my-super-secret-client-secret-abc123';
    const blob = encryptSecret(secret);
    const decrypted = decryptSecret(blob);
    expect(decrypted).toBe(secret);
  });

  it('produces v1: format with 5 base64 segments', () => {
    const blob = encryptSecret('hello');
    const parts = blob.split(':');
    expect(parts[0]).toBe('v1');
    expect(parts).toHaveLength(5);
    // salt, iv, tag, ct should all be valid base64
    for (const part of parts.slice(1)) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow();
    }
  });

  it('accepts an explicit salt parameter', () => {
    const salt = Buffer.alloc(16, 0x42);
    const secret = 'test';
    const blob = encryptSecret(secret, salt);
    const parts = blob.split(':');
    expect(Buffer.from(parts[1], 'base64')).toEqual(salt);
    expect(decryptSecret(blob)).toBe(secret);
  });

  it('uses JWT_SECRET from process.env', () => {
    delete process.env['JWT_SECRET'];
    expect(() => encryptSecret('x')).toThrow();
    process.env['JWT_SECRET'] = TEST_JWT_SECRET;
    expect(() => encryptSecret('x')).not.toThrow();
  });
});

describe('OidcClientManager', () => {
  let db: ReturnType<typeof makeMockDb>;
  let manager: OidcClientManager;

  beforeEach(async () => {
    savedJwt = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = TEST_JWT_SECRET;

    vi.clearAllMocks();
    db = makeMockDb();
    const { createDb } = await import('../db/index.js');
    vi.mocked(createDb).mockReturnValue(db as never);
    manager = new OidcClientManager();
  });

  afterEach(() => {
    if (savedJwt === undefined) {
      delete process.env['JWT_SECRET'];
    } else {
      process.env['JWT_SECRET'] = savedJwt;
    }
  });

  describe('create', () => {
    it('returns a plaintext secret once and stores an encrypted blob that differs', async () => {
      const fakeInsertedRow = {
        id: 'db-assigned-uuid-001',
        clientId: 'ab_test123',
        name: 'Test Client',
        secretEncrypted: 'v1:placeholder',
        redirectUris: ['https://example.com/callback'],
        postLogoutRedirectUris: [],
        grantTypes: ['authorization_code', 'refresh_token'],
        scope: 'openid profile',
        tokenAuthMethod: 'client_secret_basic',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      const insertChain = makeChain([fakeInsertedRow]);
      db.insert.mockReturnValue(insertChain);

      const result = await manager.create({
        name: 'Test Client',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        scope: 'openid profile',
      });

      expect(result.client.id).toBe('db-assigned-uuid-001');
      expect(result.client.clientId).toMatch(/^ab_/);
      // plaintext secret is a base64url string
      expect(result.plaintextSecret).toBeTruthy();
      expect(result.plaintextSecret.length).toBeGreaterThan(10);

      // The insert was called — verify the values contain secretEncrypted
      expect(db.insert).toHaveBeenCalledTimes(1);
      const insertedValues = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertedValues['secretEncrypted']).toBeTruthy();
      // Stored blob MUST differ from plaintext
      expect(insertedValues['secretEncrypted']).not.toBe(result.plaintextSecret);
      // Stored blob starts with v1:
      expect(String(insertedValues['secretEncrypted'])).toMatch(/^v1:/);
    });
  });

  describe('get', () => {
    it('returns a row when found', async () => {
      const fakeRow = {
        id: 'id-1',
        clientId: 'ab_test123',
        name: 'Test',
        secretEncrypted: 'v1:abc:def:ghi:jkl',
        redirectUris: ['https://example.com'],
        postLogoutRedirectUris: [],
        grantTypes: ['authorization_code'],
        scope: 'openid',
        tokenAuthMethod: 'client_secret_basic',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.select.mockReturnValue(makeChain([fakeRow]));

      const result = await manager.get('ab_test123');
      expect(result).toEqual(fakeRow);
    });

    it('returns undefined when not found', async () => {
      db.select.mockReturnValue(makeChain([]));

      const result = await manager.get('ab_nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns rows without secretEncrypted column', async () => {
      const rows = [
        { id: 'id-1', clientId: 'ab_a', name: 'A', scope: 'openid', grantTypes: ['authorization_code'], redirectUris: ['https://a.com'], postLogoutRedirectUris: [], tokenAuthMethod: 'client_secret_basic', createdAt: new Date(), updatedAt: new Date() },
        { id: 'id-2', clientId: 'ab_b', name: 'B', scope: 'profile', grantTypes: ['client_credentials'], redirectUris: ['https://b.com'], postLogoutRedirectUris: [], tokenAuthMethod: 'client_secret_basic', createdAt: new Date(), updatedAt: new Date() },
      ];
      db.select.mockReturnValue(makeChain(rows));

      const result = await manager.list();
      expect(result).toHaveLength(2);
      // None of the returned objects should have secretEncrypted
      for (const row of result) {
        expect(row).not.toHaveProperty('secretEncrypted');
      }
    });
  });

  describe('rotateSecret', () => {
    it('returns a new plaintext secret different from the original', async () => {
      const fakeRow = {
        id: 'id-1',
        clientId: 'ab_rotate',
        name: 'Rotate Me',
        secretEncrypted: 'v1:abc:def:ghi:jkl',
        redirectUris: ['https://example.com'],
        postLogoutRedirectUris: [],
        grantTypes: ['authorization_code'],
        scope: 'openid',
        tokenAuthMethod: 'client_secret_basic',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.select.mockReturnValue(makeChain([fakeRow]));
      const updateChain = makeChain(undefined);
      db.update.mockReturnValue(updateChain);

      const newSecret = await manager.rotateSecret('ab_rotate');

      expect(newSecret).toBeTruthy();
      expect(newSecret).not.toBe(fakeRow.secretEncrypted);
      expect(db.update).toHaveBeenCalledTimes(1);
      // The update set should contain a new v1: blob
      const setArg = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(String(setArg['secretEncrypted'])).toMatch(/^v1:/);
    });
  });

  describe('remove', () => {
    it('deletes the client by clientId', async () => {
      const deleteChain = makeChain(undefined);
      db.delete.mockReturnValue(deleteChain);

      await manager.remove('ab_delete-me');

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(deleteChain.where).toHaveBeenCalled();
    });
  });

  describe('constructor', () => {
    it('accepts both a string url and a DrizzleDB instance', async () => {
      const { createDb } = await import('../db/index.js');

      const mgrString = new OidcClientManager('postgres://example/db');
      expect(createDb).toHaveBeenCalledWith('postgres://example/db');

      createDb.mockClear();
      const mgrDb = new OidcClientManager(db as unknown as DrizzleDB);
      expect(createDb).not.toHaveBeenCalled();

      expect(mgrString).toBeInstanceOf(OidcClientManager);
      expect(mgrDb).toBeInstanceOf(OidcClientManager);
    });
  });
});
