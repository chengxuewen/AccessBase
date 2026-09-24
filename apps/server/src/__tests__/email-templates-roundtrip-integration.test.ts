/**
 * Q4c-T4 round-trip probe (F19 / batch-B jsonb trap): the stored
 * email_tmpl_* option must survive a REAL options-table round-trip as an
 * OBJECT, not a JSON string — the value column is jsonb and drizzle returns
 * parsed objects. This file proves it against a scratch PostgreSQL database
 * (pattern per revocation-stack / tenant-revoke precedents; whole file skips
 * when PG is down). If this ever reports a string, the reader must normalize
 * at the options.get seam — the assertion here is the tripwire.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { OptionsManager } from '@accessbase/identity';
import type { DrizzleDB } from '@accessbase/identity/db';

process.env.NODE_ENV = 'test';

const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_email_tmpl_it';
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
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
let om: OptionsManager;
let db: DrizzleDB;

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
  const { OptionsManager } = await import('@accessbase/identity');
  const { createDb } = await import('@accessbase/identity/db');
  db = createDb(URL);
  om = new OptionsManager(db);
});

afterAll(async () => {
  const { closeDb } = await import('@accessbase/identity/db');
  await closeDb(db);
  await pool?.end();
  execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`]);
});

const suite = pgUp ? describe : describe.skip;

suite('email template options jsonb round-trip (real PG)', () => {
  it('set(object) → get returns OBJECT and renderEmailFor consumes the override', async () => {
    const value = {
      subject: { en: 'IT reset subject', zh: 'IT 重置主题' },
      html: { en: '<p>reset via {{link}}</p>', zh: '<p>通过 {{link}} 重置</p>' },
    };
    await om.set('email_tmpl_reset', value);

    const got = await om.get<unknown>('email_tmpl_reset', undefined, undefined);
    // THE probe assertion: object, not string (F19).
    expect(typeof got).toBe('object');
    expect(Array.isArray(got)).toBe(false);
    expect(got).toEqual(value);

    const { renderEmailFor } = await import('../utils/email-templates.js');
    const r = await renderEmailFor('reset', { link: 'https://x.test/r?a=1&b=2' }, om);
    expect(r.subject).toBe('IT reset subject');
    expect(r.html).toContain('reset via https://x.test/r?a=1&amp;b=2'); // stored arm's {{link}}, attr-correct escaping
  });

  it('pg stores it as a jsonb object (jsonb_typeof)', async () => {
    const res = await pool.query(
      `SELECT jsonb_typeof(value) AS t, value -> 'subject' ->> 'en' AS en FROM options WHERE key = 'email_tmpl_reset'`,
    );
    expect(res.rows[0]?.['t']).toBe('object');
    expect(res.rows[0]?.['en']).toBe('IT reset subject');
  });

  it('email_locale_default round-trips and drives the zh arm', async () => {
    await om.set('email_locale_default', 'zh');
    const { renderEmailFor } = await import('../utils/email-templates.js');
    const r = await renderEmailFor('reset', { link: 'https://x.test/r' }, om);
    expect(r.subject).toBe('IT 重置主题');
  });

  // Probe truth (F19): the options value column is jsonb and the reader
  // (node-pg + drizzle) JSON.parses it, so a real object round-trips as an
  // OBJECT (test 1). A non-object scalar stays non-object and the reader
  // must ignore it rather than crash. We pin with a plain string scalar.
  it('non-object scalar in the jsonb column is ignored by the reader (no crash)', async () => {
    await pool.query(
      `INSERT INTO options (key, value) VALUES ('email_tmpl_magic', to_jsonb('legacy plain string'::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    om.invalidate();
    await pool.query(`DELETE FROM options WHERE key = 'email_locale_default'`);
    const { renderEmailFor } = await import('../utils/email-templates.js');
    const r = await renderEmailFor('magic', { link: 'https://x.test/m' }, om);
    expect(r.subject).toBe('Your sign-in link'); // built-in default wins over junk
    // jsonb_typeof is the tripwire proving it was stored as a scalar, not object
    const chk = await pool.query(`SELECT jsonb_typeof(value) AS t FROM options WHERE key = 'email_tmpl_magic'`);
    expect(chk.rows[0]?.['t']).toBe('string');
  });

  it('partial override merges over defaults end-to-end', async () => {
    await pool.query(
      `INSERT INTO options (key, value) VALUES ('email_tmpl_verify', '{"subject":{"en":"Short verify"}}'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    om.invalidate();
    const { renderEmailFor } = await import('../utils/email-templates.js');
    const r = await renderEmailFor('verify', { link: 'https://x.test/v', name: 'It' }, om);
    expect(r.subject).toBe('Short verify');
    expect(r.html).toContain('Confirm your email address'); // default html kept
  });
});
