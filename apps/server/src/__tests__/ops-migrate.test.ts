/**
 * Batch L T1 — ops migration wiring (spec 2026-09-20-batch-l-opsp0 D1).
 *
 * Integration layer: spawn `scripts/migrate.sh` against THROWAWAY databases
 * on the local native PG (never the dev `accessbase` DB). skipIf PG probe
 * per H' convention (mfa-integration.test.ts idiom).
 *
 * Static layer: source-text locks on the callers (docker/entrypoint.sh,
 * scripts/deploy/start.sh, Dockerfile) — the broken `cli.js up` wiring must
 * be gone and the migrate invocation must not be swallowed by `|| true`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = path.join(ROOT, 'scripts/migrate.sh');
const CHAIN = path.join(ROOT, 'packages/migration/drizzle');
// psql lives in the pixi native env on dev boxes; prepend (harmless if absent).
const PATH_WITH_PSQL = `${path.join(ROOT, '.pixi/envs/native/bin')}:${process.env['PATH'] ?? '/usr/bin:/bin'}`;

// Native PG is trust-auth (scripts/native/pg-init.sh); connect to the
// maintenance DB `postgres` to create/drop throwaways.
const MAINT_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';

const probe = new pg.Client({ connectionString: MAINT_URL });
const pgAvailable = await (async () => {
  try { await probe.connect(); await probe.end(); return true; } catch { return false; }
})();

/** Run migrate.sh; returns { status, stdout, stderr }. */
function migrate(chainDir: string, databaseUrl: string) {
  return spawnSync('bash', [SCRIPT, chainDir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: PATH_WITH_PSQL, DATABASE_URL: databaseUrl },
  });
}

/** One throwaway DB per call; all dropped in afterAll. */
const createdDbs: string[] = [];
async function tmpDbUrl(): Promise<string> {
  const name = `tmp_migrate_test_${Date.now()}_${createdDbs.length}`;
  const admin = new pg.Client({ connectionString: MAINT_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  createdDbs.push(name);
  return `postgresql://accessbase:accessbase@localhost:5432/${name}`;
}

async function query(url: string, sql: string): Promise<unknown[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const res = await c.query(sql);
    return res.rows;
  } finally {
    await c.end();
  }
}

afterAll(async () => {
  if (!pgAvailable) return;
  for (const name of createdDbs) {
    const admin = new pg.Client({ connectionString: MAINT_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// Static wiring locks (no PG needed)
// ---------------------------------------------------------------------------

describe('migrate wiring static locks', () => {
  const entrypoint = readFileSync(path.join(ROOT, 'docker/entrypoint.sh'), 'utf8');
  const startSh = readFileSync(path.join(ROOT, 'scripts/deploy/start.sh'), 'utf8');
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

  it('callers no longer invoke the broken custom migration CLI', () => {
    expect(entrypoint).not.toContain('cli.js');
    expect(startSh).not.toContain('cli.js');
  });

  it('entrypoint calls migrate.sh with the in-image chain dir, not swallowed', () => {
    const line = entrypoint.split('\n').find((l) => l.includes('migrate.sh'));
    expect(line).toBeDefined();
    expect(line).toContain('/app/scripts/migrate.sh /app/packages/migration/drizzle');
    expect(line).not.toContain('|| true');
  });

  it('deploy start.sh calls migrate.sh with repo-root chain, aborting on failure', () => {
    const line = startSh.split('\n').find((l) => l.includes('migrate.sh'));
    expect(line).toBeDefined();
    expect(line).toContain('scripts/migrate.sh');
    expect(line).toContain('packages/migration/drizzle');
    expect(line).not.toContain('|| true');
    expect(line).toContain('exit 1');
  });

  it('Dockerfile copies migrate.sh into /app/scripts and HEALTHCHECK has start-period', () => {
    expect(dockerfile).toMatch(/COPY\s.*scripts\/migrate\.sh\s+\/app\/scripts\/migrate\.sh/);
    expect(dockerfile).toContain('--start-period=60s');
  });
});

// ---------------------------------------------------------------------------
// Argument contract (fails loud before touching PG)
// ---------------------------------------------------------------------------

describe('migrate.sh argument contract', () => {
  it('missing chain-dir argument exits 1', () => {
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...process.env, PATH: PATH_WITH_PSQL } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('chain-dir');
  });

  it('nonexistent chain dir exits 1 loud', () => {
    const r = migrate('/nonexistent/chain/dir', 'postgresql://unused@localhost:5432/unused');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('/nonexistent/chain/dir');
  });

  it('zero NNNN_*.sql files exits 1 loud (never stamp-empty)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'migrate-empty-'));
    try {
      const r = migrate(dir, 'postgresql://unused@localhost:5432/unused');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// PG integration
// ---------------------------------------------------------------------------

describe.skipIf(!pgAvailable)('migrate.sh against real PG', () => {
  it('fresh DB: applies full chain — 17 chain tables + 6 tracking rows', async () => {
    const url = await tmpDbUrl();
    const r = migrate(CHAIN, url);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);

    const tables = await query(url,
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'schema_migrations'");
    expect((tables[0] as { n: number }).n).toBe(17);

    const tracked = await query(url,
      "SELECT id FROM schema_migrations ORDER BY id");
    expect(tracked).toHaveLength(6);
    expect((tracked[0] as { id: string }).id).toMatch(/^0000_/);
  });

  it('legacy DB behind head: baseline stamps, warns chain-head sentinel, exits 0', async () => {
    const url = await tmpDbUrl();
    // Ad-hoc pre-chain users table WITHOUT the 0004 phone column.
    await query(url, 'CREATE TABLE users (id integer)');

    const r = migrate(CHAIN, url);
    expect(r.status).toBe(0);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toContain('stamped');
    expect(out).toContain('legacy DB behind chain head (0004) — run db:push to reconcile');
    // batch N review B2: per-file sentinels — the 0005 table probe fires too
    expect(out).toContain('legacy DB behind chain head (0005) — run db:push to reconcile');

    // Stamped, NOT applied: tracking holds 6 note='stamped' rows and the
    // users table is still the legacy ad-hoc one (no phone column, no chain tables).
    const rows = await query(url, "SELECT note FROM schema_migrations");
    expect(rows).toHaveLength(6);
    expect(rows.every((x) => (x as { note: string }).note === 'stamped')).toBe(true);
    const cols = await query(url,
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='users' AND column_name='phone'");
    expect((cols[0] as { n: number }).n).toBe(0);
    const tables = await query(url,
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");
    expect((tables[0] as { n: number }).n).toBe(2); // users + schema_migrations
  });

  it('broken SQL: exits 1 with the failing filename on stderr', async () => {
    const url = await tmpDbUrl();
    const dir = mkdtempSync(path.join(tmpdir(), 'migrate-bad-'));
    try {
      writeFileSync(path.join(dir, '9999_broken.sql'), 'THIS IS NOT SQL;\n');
      const r = migrate(dir, url);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('9999_broken.sql');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('idempotent: three consecutive runs exit 0, tracking stays 6 rows', async () => {
    const url = await tmpDbUrl();
    for (let i = 0; i < 3; i += 1) {
      const r = migrate(CHAIN, url);
      expect(r.status).toBe(0);
    }
    const rows = await query(url, 'SELECT count(*)::int AS n FROM schema_migrations');
    expect((rows[0] as { n: number }).n).toBe(6);
  });
});


// Batch P W2-2 (report F9): the prod image must boot from EMPTY data dirs —
// build-time initdb baked state that named volumes shadow (crash-loop on first
// compose.prod boot). Static locks: bake gone, runtime guard in place, scripts
// parse. Docker live behavior is NOT VERIFIED here (no daemon) — the entrypoint
// init block mirrors the previously build-proven commands exactly.
describe('container boot design (W2-2/F9)', () => {
  const dockerfileSrc = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf-8');
  const entrypointSrc = readFileSync(path.join(ROOT, 'docker/entrypoint.sh'), 'utf-8');

  it('Dockerfile no longer bakes initdb at build time', () => {
    expect(dockerfileSrc).not.toMatch(/RUN initdb/);
  });

  it('entrypoint performs idempotent runtime init before pg_ctl start', () => {
    const guard = entrypointSrc.indexOf('PG_VERSION');
    const start = entrypointSrc.indexOf('pg_ctl');
    expect(guard).toBeGreaterThan(-1);
    expect(entrypointSrc).toMatch(/initdb -D "\$PGDATA"/);
    expect(guard).toBeLessThan(start);
    // R3: loud fresh-init signal (image-upgrade-without-volume data-loss guard)
    expect(entrypointSrc).toMatch(/initializing EMPTY|fresh database/i);
  });

  it('entrypoint + migrate.sh + backup.sh + restore.sh pass bash -n', () => {
    for (const f of ['docker/entrypoint.sh', 'scripts/migrate.sh', 'scripts/backup.sh', 'scripts/restore.sh']) {
      const r = spawnSync('bash', ['-n', path.join(ROOT, f)], { encoding: 'utf8' });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });
});

// Batch P W2-3 (report F10): DATABASE_URL must never ride on a psql argv
// (process table leak at every container/deploy boot). A shared parser exports
// PG* env once; all three scripts source it.
describe('pg-url env parser (W2-3/F10)', () => {
  const LIB = path.join(ROOT, 'scripts/pg-url.sh');

  it('exports decoded PG* vars from a credential URL without touching argv', () => {
    const r = spawnSync('bash', ['-c', [
      `source ${JSON.stringify(LIB)}`,
      `ab_pgurl_export 'postgresql://u:p%40ss@db.example:6000/mydb?sslmode=require'`,
      'printf "%s\n" "$PGUSER" "$PGPASSWORD" "$PGHOST" "$PGPORT" "$PGDATABASE"',
    ].join('; ')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['u', 'p@ss', 'db.example', '6000', 'mydb']);
  });

  it('defaults port and keeps unencoded passwords verbatim', () => {
    const r = spawnSync('bash', ['-c', [
      `source ${JSON.stringify(LIB)}`,
      `ab_pgurl_export 'postgresql://accessbase:accessbase@localhost/accessbase'`,
      'printf "%s\n" "$PGHOST" "$PGPORT" "$PGDATABASE" "$PGPASSWORD"',
    ].join('; ')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['localhost', '5432', 'accessbase', 'accessbase']);
  });

  it('migrate.sh never passes the raw URL as a psql argument', () => {
    const src = readFileSync(path.join(ROOT, 'scripts/migrate.sh'), 'utf-8');
    expect(src).not.toMatch(/psql "[^"]*\$DATABASE_URL/);
    expect(src).toMatch(/ab_pgurl_export/);
  });

  it('Dockerfile ships BOTH migrate.sh and pg-url.sh (R1: image-absent lib bricks boot)', () => {
    const df = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf-8');
    expect(df).toMatch(/COPY[^&]*scripts\/migrate\.sh/);
    expect(df).toMatch(/COPY[^&]*scripts\/pg-url\.sh/);
  });
});
