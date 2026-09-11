/**
 * OidcAdapter tests (Task 4a) — RED first.
 *
 * vi.mock db fixture per OidcClientManager.test.ts / OptionsManager.test.ts pattern:
 * chainable drizzle-style mock; real encryptSecret/decryptSecret for the
 * client-secret roundtrip; JWT_SECRET pinned with env save/restore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../packages/identity/src/db/index.js', () => ({
  createDb: vi.fn(),
}));

const TEST_JWT_SECRET = 'test-jwt-secret-for-oidc-32bytes!!';
let savedJwt: string | undefined;

import { OidcAdapter } from '../oidc/adapter.js';
import { encryptSecret } from '@accessbase/identity';
import type { DrizzleDB } from '@accessbase/identity';

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

interface ClientPayload {
  clientId: string;
  client_secret?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  token_endpoint_auth_method?: string;
}

describe('OidcAdapter', () => {
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

  describe('Client kind (drizzle-backed)', () => {
    it('find maps OidcClientRow to oidc-provider client shape with decrypted secret', async () => {
      const db = makeMockDb();
      const secret = 'plaintext-client-secret-xyz';
      const row = {
        id: '00000000-0000-0000-0000-00000000000a',
        clientId: 'ab_testclient',
        name: 'Test RP',
        secretEncrypted: encryptSecret(secret),
        redirectUris: ['https://rp.example/cb'],
        postLogoutRedirectUris: ['https://rp.example/bye'],
        grantTypes: ['authorization_code', 'refresh_token'],
        scope: 'openid profile email',
        tokenAuthMethod: 'client_secret_basic',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const chain = makeChain([row]);
      db.select.mockReturnValue(chain);

      const adapter = new OidcAdapter(db as unknown as DrizzleDB);
      const client = (await adapter.find('Client', 'ab_testclient')) as ClientPayload | undefined;

      expect(client).toBeDefined();
      expect(client?.client_id).toBe('ab_testclient');
      expect(client?.client_secret).toBe(secret);
      expect(client?.redirect_uris).toEqual(['https://rp.example/cb']);
      expect(client?.grant_types).toEqual(['authorization_code', 'refresh_token']);
      expect(client?.token_endpoint_auth_method).toBe('client_secret_basic');
    });

    it('find returns undefined for unknown client', async () => {
      const db = makeMockDb();
      const chain = makeChain([]);
      db.select.mockReturnValue(chain);

      const adapter = new OidcAdapter(db as unknown as DrizzleDB);
      expect(await adapter.find('Client', 'ab_missing')).toBeUndefined();
    });

    it('upsert throws for Client (clients managed via OidcClientManager)', async () => {
      const adapter = new OidcAdapter(makeMockDb() as unknown as DrizzleDB);
      await expect(
        adapter.upsert('Client', 'ab_x', { clientId: 'ab_x' }),
      ).rejects.toThrow(/OidcClientManager/);
    });
  });

  describe('Grant kind (drizzle-backed)', () => {
    it('upsert/find for Grant round-trips through the in-memory catch-all', async () => {
      const adapter = new OidcAdapter(makeMockDb() as unknown as DrizzleDB);
      const payload = {
        jti: 'grant-jti-1',
        kind: 'Grant',
        accountId: 'user-1',
        clientId: 'ab_testclient',
        scope: 'openid profile email',
        openid: { scope: 'openid profile email' },
      };

      await adapter.upsert('Grant', 'grant-jti-1', payload, undefined);

      const found = await adapter.find('Grant', 'grant-jti-1');
      expect(found).toEqual(payload);
    });

    it('find returns undefined for unknown grant', async () => {
      const db = makeMockDb();
      db.select.mockReturnValue(makeChain([]));

      const adapter = new OidcAdapter(db as unknown as DrizzleDB);
      expect(await adapter.find('Grant', 'nope')).toBeUndefined();
    });
  });

  describe('catch-all in-memory kinds', () => {
    it('unknown kind upsert then find returns payload', async () => {
      const db = makeMockDb();
      const adapter = new OidcAdapter(db as unknown as DrizzleDB);

      const payload = { jti: 'ac-1', accountId: 'user-1', clientId: 'ab_1' };
      await adapter.upsert('AuthorizationCode', 'ac-1', payload, undefined);
      expect(await adapter.find('AuthorizationCode', 'ac-1')).toEqual(payload);
      // No DB touched for transient kinds
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('destroy removes the in-memory record', async () => {
      const adapter = new OidcAdapter(makeMockDb() as unknown as DrizzleDB);
      await adapter.upsert('Session', 's-1', { uid: 'u-1' }, undefined);
      await adapter.destroy('Session', 's-1');
      expect(await adapter.find('Session', 's-1')).toBeUndefined();
    });

    it('findByUid returns session with matching uid', async () => {
      const adapter = new OidcAdapter(makeMockDb() as unknown as DrizzleDB);
      const session = { uid: 'uid-42', login: true };
      await adapter.upsert('Session', 's-1', session, undefined);
      const found = await adapter.findByUid('Session', 'uid-42');
      expect(found).toEqual(session);
    });

    it('findByUserCode finds interaction payload with userCode', async () => {
      const adapter = new OidcAdapter(makeMockDb() as unknown as DrizzleDB);
      await adapter.upsert('Interaction', 'i-1', { userCode: 'XYZ' }, undefined);
      const found = await adapter.findByUserCode('Interaction', 'xyz');
      expect(found).toEqual({ userCode: 'XYZ' });
    });

    it('consume marks record consumed and find returns undefined', async () => {
      const adapter = new OidcAdapter(makeMockDb() as unknown as DrizzleDB);
      await adapter.upsert('AuthorizationCode', 'ac-2', { jti: 'ac-2' }, undefined);
      await adapter.consume('AuthorizationCode', 'ac-2');
      expect(await adapter.find('AuthorizationCode', 'ac-2')).toBeUndefined();
    });
  });

  describe('findAccount claims mapping (review M2)', () => {
    it('returns sub/name/email/email_verified claims', async () => {
      const adapter = new OidcAdapter(makeMockDb() as unknown as DrizzleDB, {
        getUser: async (id: string) =>
          id === 'user-1' ? { id: 'user-1', name: 'Ada', email: 'ada@example.com' } : null,
      });

      const account = await adapter.findAccount(undefined, 'user-1');
      const claims = await account.claims('openid', 'ab_client');

      expect(account.accountId).toBe('user-1');
      expect(claims).toEqual({
        sub: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        email_verified: false,
      });
    });
  });
});
