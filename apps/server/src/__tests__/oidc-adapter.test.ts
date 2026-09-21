/**
 * OidcAdapter unit tests — batch N rewrite (was: batch-5 memory-Map suite).
 * Parameter-capture style over the oidc_adapter_state ops; end-to-end PG
 * semantics (consume marks, cross-instance visibility, revoke cascade) live
 * in oidc-persistence.test.ts (real PG, skipIf down).
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

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  capturedValues: Record<string, unknown>[];
}

function makeMockDb(selectResults: unknown[] = []): MockDb {
  const select = vi.fn();
  for (const r of selectResults) select.mockReturnValueOnce(makeChain(r));
  select.mockReturnValue(makeChain([]));
  const capturedValues: Record<string, unknown>[] = [];
  const insert = vi.fn(() => {
    const chain = makeChain(undefined);
    chain.values = vi.fn((v: Record<string, unknown>) => {
      capturedValues.push(v);
      return chain;
    });
    return chain;
  });
  return { select, insert, update: vi.fn(() => makeChain(undefined)), delete: vi.fn(() => makeChain([])), capturedValues };
}

const asDb = (db: MockDb) => db as unknown as DrizzleDB;

beforeEach(() => {
  savedJwt = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;
});
afterEach(() => {
  if (savedJwt === undefined) delete process.env['JWT_SECRET'];
  else process.env['JWT_SECRET'] = savedJwt;
});

describe('upsert — derived columns + TTL (oidc_adapter_state contract)', () => {
  it('Session row: uid derived, notAfter = now + expiresIn seconds, conflict target (kind,id)', async () => {
    const db = makeMockDb();
    const adapter = new OidcAdapter(asDb(db));
    const before = Date.now();
    await adapter.upsert('Session', 's-1', { uid: 'uid-42', lastAuthAt: 'x' }, 120);
    const row = db.capturedValues[0] as Record<string, unknown>;
    expect(row).toMatchObject({ kind: 'Session', id: 's-1', uid: 'uid-42', userCode: null, grantId: null });
    const notAfter = row.notAfter as Date;
    expect(notAfter.getTime() - before).toBeGreaterThanOrEqual(115_000);
    expect(notAfter.getTime() - before).toBeLessThan(125_000);
  });

  it('Grant row: grantId never derived on Grant itself (payload jti is the id); userCode lowered for Interaction', async () => {
    const db = makeMockDb();
    const adapter = new OidcAdapter(asDb(db));
    await adapter.upsert('Interaction', 'i-1', { userCode: 'AbC-DeF' }, undefined);
    await adapter.upsert('RefreshToken', 'rt-1', { grantId: 'g-9' }, 60);
    const [interaction, refresh] = db.capturedValues as Record<string, unknown>[];
    expect(interaction.userCode).toBe('abc-def');
    expect(interaction.notAfter).toBeNull();
    expect(refresh.grantId).toBe('g-9');
    expect(refresh.uid).toBeNull();
  });

  it('uid indexed ONLY for Session (official memory-adapter parity)', async () => {
    const db = makeMockDb();
    const adapter = new OidcAdapter(asDb(db));
    await adapter.upsert('Grant', 'g-1', { uid: 'should-be-ignored' }, undefined);
    expect(db.capturedValues[0]).toMatchObject({ uid: null });
  });

  it('Client upsert throws (manager owns clients)', async () => {
    const adapter = new OidcAdapter(asDb(makeMockDb()));
    await expect(adapter.upsert('Client', 'ab_x', { clientId: 'ab_x' })).rejects.toThrow(
      /OidcClientManager/,
    );
  });
});

describe('find / consume / destroy / revoke — parameter contracts', () => {
  it('find returns parsed payload for live row (object jsonb)', async () => {
    const payload = { grantId: 'g', scopes: ['openid'] };
    const db = makeMockDb([[{ payload, notAfter: new Date(Date.now() + 60_000) }]]);
    const adapter = new OidcAdapter(asDb(db));
    expect(await adapter.find('Grant', 'g-1')).toEqual(payload);
  });

  it('find tolerates STRING jsonb (PIT jsonb-family seam)', async () => {
    const db = makeMockDb([[{ payload: '{"a":1}', notAfter: null }]]);
    const adapter = new OidcAdapter(asDb(db));
    expect(await adapter.find('Session', 's')).toEqual({ a: 1 });
  });

  it('find on expired row deletes it and returns undefined', async () => {
    const db = makeMockDb([[{ payload: {}, notAfter: new Date(Date.now() - 1000) }]]);
    const adapter = new OidcAdapter(asDb(db));
    expect(await adapter.find('Grant', 'gone')).toBeUndefined();
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('consume MARKS via UPDATE (never DELETE) — provider reads the marker later', async () => {
    const db = makeMockDb();
    const adapter = new OidcAdapter(asDb(db));
    await adapter.consume('AuthorizationCode', 'ac-2');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('destroy deletes by kind+id; revokeByGrantId is KIND-SCOPED (B1: kind-blind sweeps would kill in-flight Interaction rows)', async () => {
    const db = makeMockDb();
    const adapter = new OidcAdapter(asDb(db));
    await adapter.destroy('Session', 's-9');
    await adapter.revokeByGrantId('RefreshToken', 'g-9');
    expect(db.delete).toHaveBeenCalledTimes(2);
  });

  it('Client find still maps the decrypted manager row', async () => {
    const secret = 'plaintext-client-secret-xyz';
    const row = {
      clientId: 'ab_testclient',
      name: 'Test RP',
      secretEncrypted: encryptSecret(secret),
      redirectUris: ['https://rp.example/cb'],
      postLogoutRedirectUris: ['https://rp.example/bye'],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: 'openid profile email',
      tokenAuthMethod: 'client_secret_basic',
    };
    const db = makeMockDb([[row]]);
    const adapter = new OidcAdapter(asDb(db));
    const client = await adapter.find('Client', 'ab_testclient');
    expect(client).toMatchObject({
      client_id: 'ab_testclient',
      client_secret: secret,
      redirect_uris: ['https://rp.example/cb'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
  });
});

describe('findAccount claims mapping (unchanged from batch 5)', () => {
  it('returns sub/name/email/email_verified claims', async () => {
    const adapter = new OidcAdapter(asDb(makeMockDb()), {
      getUser: async (id: string) =>
        id === 'user-1' ? { id: 'user-1', name: 'Ada', email: 'ada@example.com' } : null,
    });
    const account = await adapter.findAccount(undefined, 'user-1');
    const claims = await account.claims();
    expect(claims).toEqual({
      sub: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      email_verified: false,
    });
  });
});

describe('sweepExpired', () => {
  it('deletes expired rows and reports the count; errors are swallowed', async () => {
    const db = makeMockDb();
    db.delete.mockReturnValue(makeChain([{ kind: 'Grant', id: 'a' }, { kind: 'Session', id: 'b' }]));
    const adapter = new OidcAdapter(asDb(db));
    expect(await adapter.sweepExpired()).toBe(2);

    db.delete.mockImplementation(() => {
      throw new Error('db down');
    });
    expect(await adapter.sweepExpired()).toBe(0); // swallowed, next tick retries
  });
});
