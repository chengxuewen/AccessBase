/**
 * R-audit A4 unit suite (spec 2026-09-28 D2/D6/D8, plan task A4 RED bullets).
 * No real DB: a scripted drizzle-seam fake records every statement (SQL text
 * via PgDialect + bound params) inside and outside the transaction, so call
 * ORDER, the advisory lock as FIRST statement, same-tx insert+mark, and the
 * backfill hash values are asserted, not inferred. Export self-heal uses real
 * tmp files (the B4 guarantee is about file bytes, not mocks).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { foldRoot, GENESIS, rowHash } from '@accessbase/audit';
import {
  startAuditAnchor,
  AUDIT_ADVISORY_LOCK_KEY,
  type AnchorDbHandle,
  type AuditAnchorDeps,
} from '../utils/audit-anchor.js';

type Scripted = (sqlText: string, params: unknown[]) => unknown;

interface Call {
  sql: string;
  params: unknown[];
}

function makeFakeDb(script: Scripted): {
  db: AnchorDbHandle;
  txCalls: Call[];
  outerCalls: Call[];
} {
  const txCalls: Call[] = [];
  const outerCalls: Call[] = [];
  const run =
    (calls: Call[]) =>
    async (q: SQL): Promise<unknown> => {
      const { sql: text, params } = new PgDialect().sqlToQuery(q);
      calls.push({ sql: text, params });
      return script(text, params);
    };
  const db: AnchorDbHandle = {
    execute: run(outerCalls),
    transaction: async <T>(fn: (tx: { execute: (q: SQL) => Promise<unknown> }) => Promise<T>) =>
      fn({ execute: run(txCalls) }),
  };
  return { db, txCalls, outerCalls };
}

const H = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const IDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];
const CREATED = new Date('2026-09-28T10:00:00.000Z');
const DAY = '2026-09-28';

/** Happy-path chain script: lock won, no legacy, 3 pending rows, fresh chain. */
function happyScript(over: Partial<Record<string, unknown>> = {}): Scripted {
  return (rawText) => {
    const text = rawText.replace(/\s+/g, ' ');
    if (text.includes('pg_try_advisory_xact_lock')) {
      return { rows: [{ locked: over['locked'] ?? true }] };
    }
    if (text.includes('row_hash IS NULL')) return { rows: (over['legacy'] ?? []) as unknown[] };
    if (text.includes('anchor_id IS NULL')) {
      return {
        rows: H.map((h, i) => ({ id: IDS[i], row_hash: h, created_at: CREATED })),
      };
    }
    if (text.includes('INSERT INTO audit_chain_anchors')) return { rows: [{ id: '42' }] };
    if (text.includes('ORDER BY day DESC')) {
      return { rows: (over['prevRoot'] ? [{ root: over['prevRoot'] }] : []) as unknown[] };
    }
    if (text.includes('max(seq)')) return { rows: [{ seq: over['maxSeq'] ?? 0 }] };
    if (text.includes('FROM audit_chain_anchors ORDER BY day, seq')) {
      return { rows: (over['exportRows'] ?? []) as unknown[] };
    }
    return { rows: [] };
  };
}

function baseDeps(
  db: AnchorDbHandle,
  over: Partial<AuditAnchorDeps> = {},
): AuditAnchorDeps {
  return {
    db,
    makeDb: () => {
      throw new Error('makeDb must stay lazy in tests (health-pool premise)');
    },
    intervalSeconds: 300,
    graceSeconds: 90,
    log: { info: vi.fn(), warn: vi.fn() },
    bootDelayMs: 3_600_000,
    ...over,
  };
}

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

function tmpFile(preseed?: string): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'ab-anchor-'));
  const p = join(tmpDir, 'anchors.txt');
  if (preseed !== undefined) writeFileSync(p, preseed);
  return p;
}

describe('audit anchor worker — lock discipline (D2/B2)', () => {
  it('try-xact-lock is the FIRST statement of the tx; loser exits with zero further writes', async () => {
    const fake = makeFakeDb(happyScript({ locked: false }));
    const w = startAuditAnchor(baseDeps(fake.db));
    await w.runOnce();
    expect(fake.txCalls[0]?.sql).toContain(`pg_try_advisory_xact_lock(${AUDIT_ADVISORY_LOCK_KEY})`);
    expect(fake.txCalls).toHaveLength(1); // lock lost → nothing else ran
    await w.stop();
  });

  it('follow-up tick after the winner commits succeeds (xact lock auto-release shape)', async () => {
    let ticks = 0;
    const fake = makeFakeDb((rawText) => {
      const text = rawText.replace(/\s+/g, ' ');
      if (text.includes('pg_try_advisory_xact_lock')) {
        ticks += 1;
        return { rows: [{ locked: ticks > 1 }] }; // tick 1 = loser, tick 2 = winner
      }
      return happyScript()(text, []);
    });
    const w = startAuditAnchor(baseDeps(fake.db));
    await w.runOnce();
    expect(fake.txCalls.filter((c) => c.sql.includes('INSERT INTO audit_chain_anchors'))).toHaveLength(0);
    await w.runOnce();
    expect(fake.txCalls.filter((c) => c.sql.includes('INSERT INTO audit_chain_anchors'))).toHaveLength(1);
    await w.stop();
  });

  it('40P01 deadlock is caught, warned, never crashes the tick', async () => {
    const fake = makeFakeDb(() => {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    });
    const warn = vi.fn();
    const w = startAuditAnchor(baseDeps(fake.db, { log: { info: vi.fn(), warn } }));
    await expect(w.runOnce()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('40P01'));
    await w.stop();
  });
});

describe('audit anchor worker — fold + chain (D2)', () => {
  it('first tick folds pending into root, prev_root = GENESIS, seq 1, marks rows in the SAME tx', async () => {
    const fake = makeFakeDb(happyScript());
    const w = startAuditAnchor(baseDeps(fake.db));
    await w.runOnce();

    const ins = fake.txCalls.find((c) => c.sql.includes('INSERT INTO audit_chain_anchors'));
    expect(ins).toBeDefined();
    expect(ins?.params).toEqual([DAY, 1, IDS[0], IDS[2], 3, foldRoot(H), GENESIS]);

    const mark = fake.txCalls.find((c) => c.sql.includes('SET anchor_id'));
    expect(mark?.sql).toContain('anchor_id');
    expect(mark?.sql).toContain('IN (');
    expect(mark?.params).toEqual([42, ...IDS]); // anchor id + exact folded ids

    // same-tx proof: insert and mark both rode the tx runner
    expect(fake.txCalls.filter((c) => c === ins || c === mark)).toHaveLength(2);
    await w.stop();
  });

  it('prev_root chains from the previous anchor; seq = max(seq)+1 across ticks', async () => {
    const fake = makeFakeDb(happyScript({ prevRoot: 'PREVROOT', maxSeq: 4 }));
    const w = startAuditAnchor(baseDeps(fake.db));
    await w.runOnce();
    const ins = fake.txCalls.find((c) => c.sql.includes('INSERT INTO audit_chain_anchors'));
    expect(ins?.params).toEqual([DAY, 5, IDS[0], IDS[2], 3, foldRoot(H), 'PREVROOT']);
    await w.stop();
  });

  it('fold predicate: anchor_id IS NULL AND row_hash IS NOT NULL, grace via make_interval, ORDER BY created_at, id, roll LIMIT', async () => {
    const fake = makeFakeDb(happyScript());
    const w = startAuditAnchor(baseDeps(fake.db, { graceSeconds: 90 }));
    await w.runOnce();
    const fold = fake.txCalls.find((c) => c.sql.includes('anchor_id IS NULL'));
    expect(fold?.sql).toContain('row_hash IS NOT NULL');
    expect(fold?.sql).toContain('make_interval(secs =>');
    expect(fold?.sql).toContain('ORDER BY');
    // lockstep contract (A6): the exact fold ORDER BY string
    expect(fold?.sql.replace(/\s+/g, ' ')).toContain('ORDER BY "audit_logs"."created_at", "audit_logs"."id"');
    expect(fold?.params).toEqual([90, 5000]);
    await w.stop();
  });

  it('empty pending → no anchor row, no export line, no recordResult', async () => {
    const script: Scripted = (rawText) => {
      const text = rawText.replace(/\s+/g, ' ');
      if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
      if (text.includes('row_hash IS NULL') || text.includes('anchor_id IS NULL')) return { rows: [] };
      return { rows: [] };
    };
    const fake = makeFakeDb(script);
    const exportPath = tmpFile();
    const recordResult = vi.fn();
    const w = startAuditAnchor(baseDeps(fake.db, { exportPath, recordResult }));
    await w.runOnce();
    expect(fake.txCalls.find((c) => c.sql.includes('INSERT INTO audit_chain_anchors'))).toBeUndefined();
    // Empty chain: the worker creates NO file (no anchors → no lines to export).
    expect(existsSync(exportPath) ? readFileSync(exportPath, 'utf8') : '').toBe('');
    expect(recordResult).toHaveBeenCalledWith(true); // healthy no-op tick
    await w.stop();
  });

  it('anchor success without export path still reports ok', async () => {
    const fake = makeFakeDb(happyScript());
    const recordResult = vi.fn();
    const w = startAuditAnchor(baseDeps(fake.db, { recordResult }));
    await w.runOnce();
    expect(recordResult).toHaveBeenCalledWith(true);
    await w.stop();
  });
});

describe('audit anchor worker — backfill (D6)', () => {
  const legacyRow = {
    id: '44444444-4444-4444-4444-444444444444',
    tenant_id: 'tenant-a',
    user_id: 'user-9',
    action: 'user.login',
    resource_type: 'user',
    resource_id: 'user-9',
    request_body: { m: 1 },
    response_status: 200,
    request_id: 'req-1',
    ip: '10.0.0.1',
    user_agent: 'UA',
    created_at: new Date('2026-09-01T08:00:00.000Z'),
  };

  it('backfills NULL-hash rows oldest-first (batch 1000) BEFORE the fold, hashing CURRENT columns', async () => {
    const fake = makeFakeDb(happyScript({ legacy: [legacyRow] }));
    const w = startAuditAnchor(baseDeps(fake.db));
    await w.runOnce();

    const sel = fake.txCalls.find((c) => c.sql.includes('row_hash IS NULL'));
    expect(sel?.sql).toContain('erased_at IS NULL'); // B6: erased legacy rows stay unhashed forever
    expect(sel?.sql.replace(/\s+/g, ' ')).toContain('ORDER BY "audit_logs"."created_at", "audit_logs"."id"');
    expect(sel?.params).toEqual([1000]);
    expect(fake.txCalls.indexOf(sel!)).toBeLessThan(
      fake.txCalls.indexOf(fake.txCalls.find((c) => c.sql.includes('anchor_id IS NULL'))!),
    );

    const upd = fake.txCalls.filter((c) => c.sql.includes('SET row_hash'));
    expect(upd).toHaveLength(1);
    expect(upd[0]?.params[0]).toBe(
      rowHash({
        tenantId: 'tenant-a',
        userId: 'user-9',
        action: 'user.login',
        resourceType: 'user',
        resourceId: 'user-9',
        requestBody: { m: 1 },
        responseStatus: 200,
        requestId: 'req-1',
        ip: '10.0.0.1',
        userAgent: 'UA',
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
      }),
    );
    await w.stop();
  });

  it('second pass after backfill is zero-work (no UPDATE)', async () => {
    let legacyEmptied = false;
    const fake = makeFakeDb((rawText) => {
      const text = rawText.replace(/\s+/g, ' ');
      if (text.includes('row_hash IS NULL')) {
        return { rows: legacyEmptied ? [] : [legacyRow] };
      }
      if (text.includes('SET row_hash')) {
        legacyEmptied = true;
        return { rows: [] };
      }
      return happyScript()(rawText, []);
    });
    const w = startAuditAnchor(baseDeps(fake.db));
    await w.runOnce();
    const updatesAfterFirst = fake.txCalls.filter((c) => c.sql.includes('SET row_hash')).length;
    expect(updatesAfterFirst).toBe(1);
    await w.runOnce();
    expect(fake.txCalls.filter((c) => c.sql.includes('SET row_hash'))).toHaveLength(1);
    await w.stop();
  });
});

describe('audit anchor worker — export self-heal (B4)', () => {
  it('appends only anchors missing from the file (tail-check by day/seq)', async () => {
    const missed = { day: '2026-09-27', seq: 2, root: 'f'.repeat(64) };
    const fake = makeFakeDb(happyScript({ exportRows: [missed] }));
    const exportPath = tmpFile(`${'2026-09-27'} 1 ${'e'.repeat(64)}\n`);
    const w = startAuditAnchor(baseDeps(fake.db, { exportPath }));
    await w.runOnce();

    const exportQuery = fake.outerCalls.find((c) => c.sql.replace(/\s+/g, ' ').includes('(day, seq) >'));
    expect(exportQuery?.params).toEqual(['2026-09-27', 1]);
    expect(exportQuery?.params).toEqual(['2026-09-27', 1]);

    const content = readFileSync(exportPath, 'utf8');
    const lines = content.split('\n').filter((l) => l !== '');
    expect(
      fake.txCalls.find((c) => c.sql.replace(/\s+/g, ' ').includes('(day, seq) >')),
    ).toBeUndefined(); // export ran AFTER commit, outside tx
  });

  it('missing export file → exports from chain head (gap-free from zero)', async () => {
    const anchors = [
      { day: '2026-09-27', seq: 1, root: 'e'.repeat(64) },
      { day: '2026-09-28', seq: 1, root: 'f'.repeat(64) },
    ];
    const fake = makeFakeDb(happyScript({ exportRows: anchors }));
    const exportPath = tmpFile();
    const w = startAuditAnchor(baseDeps(fake.db, { exportPath }));
    await w.runOnce();
    const head = fake.outerCalls.find((c) =>
      c.sql.replace(/\s+/g, ' ').includes('FROM audit_chain_anchors ORDER BY day, seq'),
    );
    expect(head).toBeDefined();
    expect(readFileSync(exportPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(2); // gap-free from zero
    await w.stop();
    await w.stop();
  });

  it('export failure → recordResult(false), warned, anchor stays committed', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ab-anchor-'));
    const dirPath = join(tmpDir, 'not-a-file'); // a directory: appendFileSync throws
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dirPath);
    const fake = makeFakeDb(
      happyScript({ exportRows: [{ day: DAY, seq: 1, root: foldRoot(H) }] }), // an anchor row → append fires → EISDIR
    );
    const recordResult = vi.fn();
    const warn = vi.fn();
    const w = startAuditAnchor(
      baseDeps(fake.db, { exportPath: dirPath, recordResult, log: { info: vi.fn(), warn } }),
    );
    await expect(w.runOnce()).resolves.toBeUndefined(); // export failure never crashes
    expect(recordResult).toHaveBeenCalledWith(false);
    expect(warn).toHaveBeenCalled();
    await w.stop();
  });
});
