/**
 * re-encrypt integration — real PG, throwaway DB (never the dev `accessbase`
 * database). Proves the FULL production path: run() → realCodecs() → the
 * actual crypto.decrypt / decryptSecret read paths + the pool UPDATE, against
 * real tables, converting legacy envelopes to v2 in place.
 *
 * Seeds the repo's authoritative LEGACY ciphertexts (frozen pre-edit fixtures
 * from crypto.test.ts / OidcClientManager.test.ts) — NOT fresh crypto.encrypt
 * output, because encrypt() now emits v2 (which planRewrap correctly skips).
 * A migration tool is only meaningful against the legacy forms it must read.
 *
 * Minimal real-name tables (id + the one secret column each) — exactly the
 * surface re-encrypt's SQL touches; sidesteps full-migration NOT NULL friction.
 * skipIf PG probe down, per the ops-migrate.test.ts idiom.
 */
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';

import { run } from '../../../../scripts/re-encrypt.js';
import { decrypt } from '../../../../packages/identity/src/services/crypto.js';
import { decryptSecret } from '../../../../packages/identity/src/managers/OidcClientManager.js';

// Scratch keys/legacy fixtures (mirrors the frozen fixtures checked into the
// identity suites — the canonical bare/v1 ciphertexts those keys decrypt).
const MFA_KEY = 'ab'.repeat(32); // crypto.test.ts KEY
const MFA_LEGACY = 'Ui0HNFIWovZK5lI7wvB1Zx9+TcoR69uPyXt9FIfIW9UBNmXC8q+SW3POZMyyCiUSo5bKZg==';
const MFA_PLAIN = 'fixture-totp-secret-JK3M';

const JWT_SECRET = 'test-jwt-secret-for-oidc-32bytes!!'; // OidcClientManager.test.ts
const OIDC_LEGACY =
  'v1:FJNBPR1P6TPszTTBdagpFA==:I9iZYBWeMs4m5cK9:FmfAX2U1Nu59NWesRyzYWw==:gmn3w+sqeAw5ZHgVssPzQd/s0YBFmF1/z0Lk4jSd2A==';
const OIDC_PLAIN = 'fixture-oidc-client-secret-9PQX';

const MAINT_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';

const probe = new pg.Client({ connectionString: MAINT_URL });
const pgAvailable = await (async () => {
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
})();

const createdDbs: string[] = [];
async function tmpDbUrl(): Promise<string> {
  const name = `tmp_reencrypt_test_${Date.now()}_${createdDbs.length}`;
  const admin = new pg.Client({ connectionString: MAINT_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  createdDbs.push(name);
  return `postgresql://accessbase:accessbase@localhost:5432/${name}`;
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const HOOK_ID = '33333333-3333-3333-3333-333333333333';

async function seed(url: string): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`CREATE TABLE users (id uuid PRIMARY KEY, totp_secret text)`);
    await c.query(`CREATE TABLE oidc_clients (id uuid PRIMARY KEY, secret_encrypted text NOT NULL)`);
    await c.query(`CREATE TABLE webhook_endpoints (id uuid PRIMARY KEY, secret_encrypted text NOT NULL)`);
    await c.query(`INSERT INTO users (id, totp_secret) VALUES ($1, $2)`, [USER_ID, MFA_LEGACY]);
    await c.query(`INSERT INTO oidc_clients (id, secret_encrypted) VALUES ($1, $2)`, [CLIENT_ID, OIDC_LEGACY]);
    await c.query(`INSERT INTO webhook_endpoints (id, secret_encrypted) VALUES ($1, $2)`, [HOOK_ID, OIDC_LEGACY]);
  } finally {
    await c.end();
  }
}

afterAll(async () => {
  if (!pgAvailable) return;
  for (const name of createdDbs) {
    const admin = new pg.Client({ connectionString: MAINT_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});

describe.skipIf(!pgAvailable)('re-encrypt against real PG (scratch DB)', () => {
  it('run(commit) migrates every legacy row to v2 and it still decrypts', async () => {
    process.env['MFA_ENCRYPTION_KEY'] = MFA_KEY;
    process.env['JWT_SECRET'] = JWT_SECRET;
    delete process.env['MFA_ENCRYPTION_KEY_OLD'];
    delete process.env['JWT_SECRET_OLD'];

    const url = await tmpDbUrl();
    await seed(url);

    const report = await run(url, { commit: true });

    // Three legacy rows (one per column) → exactly three UPDATEs, zero failures.
    expect(report.failures).toEqual([]);
    expect(report.updates).toBe(3);
    expect(report.plan).toHaveLength(3);
    expect(report.plan.every((r) => r.action === 'rewrap')).toBe(true);

    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      const [u] = (await c.query(`SELECT totp_secret AS s FROM users WHERE id = $1`, [USER_ID])).rows as [
        { s: string },
      ];
      const [oc] = (
        await c.query(`SELECT secret_encrypted AS s FROM oidc_clients WHERE id = $1`, [CLIENT_ID])
      ).rows as [{ s: string }];
      const [wh] = (
        await c.query(`SELECT secret_encrypted AS s FROM webhook_endpoints WHERE id = $1`, [HOOK_ID])
      ).rows as [{ s: string }];

      expect(u.s.startsWith('v2:')).toBe(true);
      expect(oc.s.startsWith('v2:')).toBe(true);
      expect(wh.s.startsWith('v2:')).toBe(true);

      // Re-encrypted under the SAME current keys → decrypts to the originals.
      expect(decrypt(u.s, MFA_KEY)).toBe(MFA_PLAIN);
      expect(decryptSecret(oc.s)).toBe(OIDC_PLAIN);
      expect(decryptSecret(wh.s)).toBe(OIDC_PLAIN);
    } finally {
      await c.end();
    }

    // Idempotence: a second commit pass now plans everything as skip, zero writes.
    const again = await run(url, { commit: true });
    expect(again.updates).toBe(0);
    expect(again.plan.every((r) => r.action === 'skip')).toBe(true);
  });
});
