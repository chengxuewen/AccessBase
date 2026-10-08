/**
 * re-encrypt — close the *_OLD rotation window (multi-node batch R-B, registered debt).
 *
 * Scans every envelope ciphertext column and rewrites legacy (non-`v2:`) rows
 * in place: read with the current key + the rotation-window `*_OLD` fallback
 * using the SAME exported codecs the live read paths use (never a
 * re-implemented format — that is the drift trap), re-encrypt with the current
 * key, and UPDATE only when the stored value is not already `v2:`-prefixed.
 *
 * Columns (roster order is stable — the unit/integration tests assert it):
 *   users.totp_secret                  MFA  → crypto.encrypt/decrypt     (MFA_ENCRYPTION_KEY[_OLD])
 *   oidc_clients.secret_encrypted      OIDC → encryptSecret/decryptSecret (JWT_SECRET[_OLD])
 *   webhook_endpoints.secret_encrypted OIDC → same store as OIDC clients (dispatcher precedent)
 *
 * Modes:
 *   default (dry-run)  print the plan table (table, id, v1->v2 / v2-skip); ZERO writes.
 *   --commit           apply each planned UPDATE inside a per-row try/catch; a single
 *                      failing row is recorded and the rest still proceed.
 *
 * Keys are read from the environment AT CALL TIME, exactly like the readers, so the
 * CLI needs no build step — just env vars. Run it via tsx (the only TS runner in the
 * workspace), from apps/server so the ESM graph resolves cleanly:
 *
 *   DATABASE_URL=... JWT_SECRET=... MFA_ENCRYPTION_KEY=... \
 *     pnpm --filter @accessbase/server exec tsx ../../scripts/re-encrypt.ts [--commit]
 *
 * MODULE-LOADING NOTE: scripts/ sits under the CJS repo root (no `"type": "module"`),
 * so a top-level `import` of the identity graph compiles to `require()` and trips
 * @accessbase/logging's ESM-only `exports`. The identity modules are pulled in with
 * `await import()` (the app.ts production-wiring idiom), which forces the ESM loader.
 * The pure helpers — planRewrap / formatReport / rewrapAll with injected codecs —
 * import nothing from identity, so unit tests exercise them with zero DB and zero graph.
 */
import { pathToFileURL } from 'node:url';

/** The two envelope codec families. */
export type EnvelopeFamily = 'mfa' | 'oidc';

/** Decode a stored envelope to plaintext / encode plaintext into a `v2:` envelope. */
export interface EnvelopeCodec {
  decode(stored: string): string;
  encode(plaintext: string): string;
}

export type CodecBundle = Record<EnvelopeFamily, EnvelopeCodec>;

export interface ColumnSpec {
  readonly table: string;
  readonly column: string;
  readonly family: EnvelopeFamily;
}

/** Scan roster. DO NOT reorder: the unit/integration tests assert this order. */
export const ENVELOPE_COLUMNS: readonly ColumnSpec[] = [
  { table: 'users', column: 'totp_secret', family: 'mfa' },
  { table: 'oidc_clients', column: 'secret_encrypted', family: 'oidc' },
  { table: 'webhook_endpoints', column: 'secret_encrypted', family: 'oidc' },
] as const;

/**
 * Pure decision core: `v2:` prefix = already current → skip; anything else
 * (bare base64 legacy, explicit `v1:`) → rewrap. No key probing — the version
 * prefix alone decides (spec R-B: every new write is `v2:`, no legacy form is).
 */
export function planRewrap(stored: string): 'rewrap' | 'skip' {
  return stored.startsWith('v2:') ? 'skip' : 'rewrap';
}

/** Raw-SQL seam — same shape as the webhook dispatcher's WebhookQuery. */
export interface EnvelopeDb {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface PlanRow {
  readonly table: string;
  readonly id: string;
  readonly action: 'rewrap' | 'skip';
}

export interface FailureRow {
  readonly table: string;
  readonly id: string;
  readonly error: string;
}

export interface RewrapReport {
  readonly plan: PlanRow[];
  readonly failures: FailureRow[];
  /** UPDATEs actually issued (commit only; a failed row is excluded). */
  readonly updates: number;
  readonly commit: boolean;
}

export interface RewrapOptions {
  readonly commit: boolean;
  /** Override the real codecs (tests inject fakes; prod omits → ESM-loaded real ones). */
  readonly codecs?: CodecBundle;
}

interface ScannedRow {
  id: string;
  encrypted: string | null;
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

/**
 * The real codecs, dynamically imported so the identity graph loads through the
 * ESM loader (see module note). The current key is read per call; the `*_OLD`
 * fallback is resolved INSIDE crypto.decrypt / decryptSecret, so legacy rows
 * written under a retired key still decode here — which is the whole point.
 */
async function realCodecs(): Promise<CodecBundle> {
  const { encrypt, decrypt } = await import('../packages/identity/src/services/crypto.js');
  const { encryptSecret, decryptSecret } = await import(
    '../packages/identity/src/managers/OidcClientManager.js'
  );
  return {
    mfa: {
      decode: (stored) => decrypt(stored, readEnv('MFA_ENCRYPTION_KEY')),
      encode: (plaintext) => encrypt(plaintext, readEnv('MFA_ENCRYPTION_KEY')),
    },
    oidc: {
      decode: (stored) => decryptSecret(stored),
      encode: (plaintext) => encryptSecret(plaintext),
    },
  };
}

/**
 * The rewrap loop. Reads every column (even without commit) so the dry-run plan
 * covers the whole table set, then — only under `commit` — decodes/encodes and
 * UPDATEs the non-`v2:` rows. Each rewrite is isolated: one bad row never aborts
 * the rest, it lands in the failures list.
 */
export async function rewrapAll(db: EnvelopeDb, opts: RewrapOptions): Promise<RewrapReport> {
  const codecs = opts.codecs ?? (opts.commit ? await realCodecs() : undefined);
  const plan: PlanRow[] = [];
  const failures: FailureRow[] = [];
  let updates = 0;

  for (const spec of ENVELOPE_COLUMNS) {
    const rows = await db.query<ScannedRow>(
      `SELECT id, ${spec.column} AS encrypted FROM ${spec.table} WHERE ${spec.column} IS NOT NULL ORDER BY id`,
    );
    for (const row of rows) {
      const stored = row.encrypted;
      if (stored === null) continue; // belt — the WHERE already excludes NULLs

      const decision = planRewrap(stored);
      plan.push({ table: spec.table, id: row.id, action: decision });
      if (decision === 'skip' || !opts.commit) continue;

      const codec = (codecs as CodecBundle)[spec.family];
      try {
        const plaintext = codec.decode(stored);
        const rewrapped = codec.encode(plaintext);
        await db.query(`UPDATE ${spec.table} SET ${spec.column} = $1 WHERE id = $2`, [
          rewrapped,
          row.id,
        ]);
        updates += 1;
      } catch (err: unknown) {
        failures.push({
          table: spec.table,
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { plan, failures, updates, commit: opts.commit };
}

/** Open a real handle from a DATABASE_URL, run {@link rewrapAll}, close the pool. */
export async function run(
  dbUrl: string,
  opts: Omit<RewrapOptions, 'codecs'>,
): Promise<RewrapReport> {
  const { createDb } = await import('../packages/identity/src/db/index.js');
  const pool = createDb(dbUrl).$client;
  const handle: EnvelopeDb = {
    query: async <T>(text: string, params?: unknown[]): Promise<T[]> => {
      const r = await pool.query(text, params as never[] | undefined);
      return (r.rows ?? []) as T[];
    },
    close: async () => {
      await pool.end();
    },
  };
  try {
    return await rewrapAll(handle, opts);
  } finally {
    await handle.close();
  }
}

/** Aligned plan/failure render — no deps, deterministic for the operator. */
export function formatReport(report: RewrapReport): string {
  const lines: string[] = [
    report.commit ? 'APPLIED' : 'DRY-RUN (no writes; pass --commit to apply)',
    'TABLE'.padEnd(20) + 'ID'.padEnd(40) + 'ACTION',
  ];
  for (const row of report.plan) {
    const action = row.action === 'skip' ? 'v2-skip' : 'v1->v2';
    lines.push(row.table.padEnd(20) + row.id.padEnd(40) + action);
  }
  if (report.failures.length > 0) {
    lines.push('', 'FAILURES:');
    for (const f of report.failures) {
      lines.push(`  ${f.table} ${f.id}: ${f.error}`);
    }
  }
  const planned = report.plan.filter((r) => r.action === 'rewrap').length;
  lines.push(
    '',
    `rows=${report.plan.length} planned=${planned} skipped=${report.plan.length - planned}` +
      ` applied=${report.updates} failures=${report.failures.length}`,
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    console.error('DATABASE_URL is required');
    process.exitCode = 1;
    return;
  }
  try {
    const report = await run(dbUrl, { commit });
    // CLI operator-facing plan table belongs on stdout (the no-console rule only
    // allows warn/error; matches the sibling packages/migration/src/cli.ts idiom).
    // eslint-disable-next-line no-console
    console.log(formatReport(report));
    if (report.failures.length > 0) process.exitCode = 1;
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

// Run only when invoked directly; importing the module from tests must never
// dial a database. process.argv[1] is the vitest binary under the suite, so the
// path comparison is false there and main() stays dormant.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main();
}
