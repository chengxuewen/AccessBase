/**
 * Batch N integration: the oidc_adapter_state table on REAL PostgreSQL
 * (the memory Map never survived process restarts — this suite is the
 * persistence proof). Scratch DB created from the 0005 chain; skipped
 * whole-file when PG is unreachable (H′-T1 signal discipline).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_oidc_state_it';
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const ROOT = path.resolve(__dirname, '../../../..');
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');
const MIGRATE = path.join(ROOT, 'scripts/migrate.sh');

const pgUp = await (async () => {
  try {
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
})();

let pool: pg.Pool;

beforeAll(async () => {
  execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`]);
  execFileSync(PS, [ADMIN_URL, '-qc', `CREATE DATABASE ${SCRATCH}`]);
  execFileSync('bash', [MIGRATE, path.join(ROOT, 'packages/migration/drizzle')], {
    env: {
      ...process.env,
      DATABASE_URL: URL,
      PATH: `${path.join(ROOT, '.pixi/envs/native/bin')}:${process.env['PATH'] ?? ''}`,
    },
  });
  pool = new pg.Pool({ connectionString: URL });
});

const adapterDbs: { close: () => Promise<void> }[] = [];

afterAll(async () => {
  await pool?.end();
  for (const d of adapterDbs) await d.close();
  execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`]);
});

const makeAdapter = async () => {
  const { createDb, closeDb } = await import('@accessbase/identity/db');
  const { OidcAdapter } = await import('../oidc/adapter.js');
  const db = createDb(URL);
  adapterDbs.push({ close: () => closeDb(db) });
  return new OidcAdapter(db);
};

describe.skipIf(!pgUp)('oidc_adapter_state — real PG round-trips', () => {
  it('upsert→find returns the verbatim payload; re-upsert replaces (ON CONFLICT)', async () => {
    const a = await makeAdapter();
    const payload = { jti: 'g-1', kind: 'Grant', accountId: 'u-1', clientId: 'rp-1', openid: { scope: 'openid' } };
    await a.upsert('Grant', 'g-1', payload, undefined);
    expect(await a.find('Grant', 'g-1')).toEqual(payload);
    const updated = { ...payload, accountId: 'u-2' };
    await a.upsert('Grant', 'g-1', updated, undefined);
    expect(await a.find('Grant', 'g-1')).toEqual(updated);
  });

  it('CROSS-INSTANCE (restart proxy): a second adapter over the same table sees prior state', async () => {
    const a = await makeAdapter();
    await a.upsert('RefreshToken', 'rt-live', { grantId: 'g-2', rotation: 1 }, 3600);
    const b = await makeAdapter(); // = new process
    expect(await b.find('RefreshToken', 'rt-live')).toEqual({ grantId: 'g-2', rotation: 1 });
  });

  it('consume MARKS consumed (row survives with the epoch marker, provider parity)', async () => {
    const a = await makeAdapter();
    await a.upsert('AuthorizationCode', 'ac-m', { jti: 'ac-m', accountId: 'u-1' }, 60);
    await a.consume('AuthorizationCode', 'ac-m');
    const after = (await a.find('AuthorizationCode', 'ac-m')) as { consumed?: number };
    expect(typeof after.consumed).toBe('number');
    expect(after.jti).toBe('ac-m');
  });

  it('expired row is gone: find undefined + sweep reports physical deletion', async () => {
    const a = await makeAdapter();
    await a.upsert('AccessToken', 'at-x', { jti: 'at-x' }, -10); // already expired
    expect(await a.find('AccessToken', 'at-x')).toBeUndefined(); // lazy delete
    // physical row also gone?
    const q = await pool.query(
      "SELECT 1 FROM oidc_adapter_state WHERE kind='AccessToken' AND id='at-x'",
    );
    expect(q.rowCount).toBe(0);
  });

  it('revokeByGrantId is kind-scoped: kills only that kind\'s grant rows; Grant/Interaction rows survive (B1)', async () => {
    const a = await makeAdapter();
    await a.upsert('AccessToken', 'at-c', { grantId: 'g-c' }, 60);
    await a.upsert('RefreshToken', 'rt-c', { grantId: 'g-c' }, 60);
    await a.upsert('Interaction', 'i-c', { grantId: 'g-c', params: {} }, 3600);
    await a.upsert('Grant', 'g-c', { jti: 'g-c' }, undefined);
    await a.revokeByGrantId('AccessToken', 'g-c');
    await a.revokeByGrantId('RefreshToken', 'g-c');
    expect(await a.find('AccessToken', 'at-c')).toBeUndefined();
    expect(await a.find('RefreshToken', 'rt-c')).toBeUndefined();
    // B1 contract: an in-flight consent on the same grant must NOT die
    expect(await a.find('Interaction', 'i-c')).toMatchObject({ grantId: 'g-c' });
    expect(await a.find('Grant', 'g-c')).toBeDefined();
  });

  it('findByUserCode lower-cases both sides; Session uid index populated only for Session', async () => {
    const a = await makeAdapter();
    await a.upsert('Interaction', 'i-1', { userCode: 'QQ-QQ-QQ', params: {} }, 120);
    expect(await a.findByUserCode('Interaction', 'qq-qq-qq')).toMatchObject({ userCode: 'QQ-QQ-QQ' });
    await a.upsert('Session', 'ss-1', { uid: 'uid-7' }, 3600);
    expect(await a.findByUid('Session', 'uid-7')).toMatchObject({ uid: 'uid-7' });
    const q = await pool.query("SELECT uid FROM oidc_adapter_state WHERE kind='Interaction' AND id='i-1'");
    expect(q.rows[0].uid).toBeNull();
  });
});
