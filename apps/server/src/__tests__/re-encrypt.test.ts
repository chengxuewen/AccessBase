/**
 * re-encrypt unit suite (multi-node R-B deferred-tool debt).
 *
 * Two layers, per the repo's dispatcher precedent (webhook-dispatcher.test.ts):
 *   1. planRewrap — the pure prefix decision (v2 → skip, bare/v1 → rewrap).
 *   2. rewrapAll   — the rewrap LOOP against a FAKE scriptable db, with INJECTED
 *      codecs so no identity graph / env keys are touched. This is the layer that
 *      proves: dry-run writes nothing; commit UPDATEs ONLY the v1 rows (never the
 *      v2 rows); a single failing row is recorded and does NOT abort the rest.
 *
 * The real codecs + a real DATABASE_URL round-trip live in
 * re-encrypt-integration.test.ts (real PG, skipIf down).
 */
import { describe, it, expect } from 'vitest';

import {
  planRewrap,
  rewrapAll,
  formatReport,
  ENVELOPE_COLUMNS,
  type EnvelopeDb,
  type CodecBundle,
} from '../../../../scripts/re-encrypt.js';

interface RecordedCall {
  sql: string;
  params?: unknown[];
}

/**
 * Fake db: SELECT routes to per-table scripted rows; UPDATE is recorded. Mirrors
 * the makeFake { query, close } shape the dispatcher tests use. Scan ORDER is
 * driven by rewrapAll over ENVELOPE_COLUMNS (stable), never by this db.
 */
function makeFakeDb(tableRows: Record<string, Array<{ id: string; encrypted: string | null }>>) {
  const calls: RecordedCall[] = [];
  const db: EnvelopeDb = {
    query: async <T>(text: string, params?: unknown[]): Promise<T[]> => {
      calls.push({ sql: text, params });
      if (text.startsWith('UPDATE')) return [] as unknown as T[];
      const spec = ENVELOPE_COLUMNS.find((c) => text.includes(`FROM ${c.table} `));
      if (!spec) return [] as unknown as T[];
      return (tableRows[spec.table] ?? []) as unknown as T[];
    },
    close: async () => {
      calls.push({ sql: '__CLOSE__' });
    },
  };
  const updates = () => calls.filter((c) => c.sql.startsWith('UPDATE'));
  return { db, calls, updates };
}

/** Reversible fake codec; `decode` throws on values containing 'FAIL'. */
function fakeCodecs(): CodecBundle {
  const codec = {
    decode: (stored: string) => {
      if (stored.includes('FAIL')) throw new Error('decrypt boom');
      return 'plain:' + stored;
    },
    encode: (plaintext: string) => 'v2:re>' + plaintext,
  };
  return { mfa: codec, oidc: codec };
}

describe('planRewrap (pure decision core)', () => {
  it('skips current v2 envelopes', () => {
    expect(planRewrap('v2:00:00:00:00:00')).toBe('skip');
  });
  it('rewraps explicit v1 envelopes', () => {
    expect(planRewrap('v1:aaa:bbb:ccc:ddd')).toBe('rewrap');
  });
  it('rewraps bare legacy envelopes (MFA family has no prefix)', () => {
    expect(planRewrap('Ui0HNFIWovZK5lI7wvB1Zx9+TcoR69uPyXt9FIfIW9UBNmXC8q')).toBe('rewrap');
  });
  it('treats the exact prefix only — a value merely containing v2: is rewrapped', () => {
    expect(planRewrap('xv2:not-a-prefix')).toBe('rewrap');
  });
});

describe('rewrapAll — dry-run issues zero UPDATEs', () => {
  it('plans every row but writes nothing', async () => {
    const { db, updates } = makeFakeDb({
      users: [
        { id: 'u1', encrypted: 'bare-legacy' },
        { id: 'u2', encrypted: 'v2:already:current' },
      ],
      oidc_clients: [{ id: 'o1', encrypted: 'v1:legacy' }],
      webhook_endpoints: [],
    });
    const report = await rewrapAll(db, { commit: false, codecs: fakeCodecs() });

    expect(updates()).toHaveLength(0);
    expect(report.updates).toBe(0);
    expect(report.commit).toBe(false);
    // plan covers both users rows + the one oidc row, in roster order
    expect(report.plan).toEqual([
      { table: 'users', id: 'u1', action: 'rewrap' },
      { table: 'users', id: 'u2', action: 'skip' },
      { table: 'oidc_clients', id: 'o1', action: 'rewrap' },
    ]);
  });
});

describe('rewrapAll — commit UPDATEs only the v1 rows', () => {
  it('rewrites every non-v2 row and leaves v2 rows untouched', async () => {
    const { db, updates } = makeFakeDb({
      users: [
        { id: 'u1', encrypted: 'bare-legacy' },
        { id: 'u2', encrypted: 'v2:already' },
        { id: 'u3', encrypted: 'v1:explicit-legacy' },
        { id: 'u4', encrypted: null }, // WHERE excludes NULLs; belt path
      ],
      oidc_clients: [
        { id: 'o1', encrypted: 'v2:done' },
        { id: 'o2', encrypted: 'v1:legacy' },
      ],
      webhook_endpoints: [{ id: 'w1', encrypted: 'bare' }],
    });

    const report = await rewrapAll(db, { commit: true, codecs: fakeCodecs() });

    // 4 v1/bare rows across the roster (u1,u3,o2,w1) → exactly 4 UPDATEs;
    // the v2 rows (u2,o1) and the null row (u4) never fire.
    expect(updates()).toHaveLength(4);
    expect(report.updates).toBe(4);
    expect(report.failures).toHaveLength(0);

    const updatedIds = updates().map((c) => c.params?.[1]);
    expect(new Set(updatedIds)).toEqual(new Set(['u1', 'u3', 'o2', 'w1']));
    // sanity: the bound rewrapped value is the v2 form (encode applied)
    const firstUpdate = updates()[0];
    expect(String(firstUpdate?.params?.[0])).toContain('v2:re>');
  });

  it('scan order matches ENVELOPE_COLUMNS (stable for downstream asserts)', async () => {
    const { db, calls } = makeFakeDb({ users: [], oidc_clients: [], webhook_endpoints: [] });
    await rewrapAll(db, { commit: true, codecs: fakeCodecs() });
    const selects = calls.filter((c) => c.sql.startsWith('SELECT')).map((c) => c.sql);
    expect(selects.map((s) => (s.match(/FROM (\w+)/) as RegExpMatchArray)[1])).toEqual([
      'users',
      'oidc_clients',
      'webhook_endpoints',
    ]);
  });
});

describe('rewrapAll — one failing row never aborts the rest', () => {
  it('records the failure and continues rewriting siblings + other tables', async () => {
    const { db, updates } = makeFakeDb({
      users: [
        { id: 'u-bad', encrypted: 'v1:FAIL-cannot-decrypt' },
        { id: 'u-good', encrypted: 'v1:fine' },
      ],
      oidc_clients: [{ id: 'o-good', encrypted: 'bare' }],
      webhook_endpoints: [],
    });

    const report = await rewrapAll(db, { commit: true, codecs: fakeCodecs() });

    // The boom row is isolated; the two good rows still UPDATE (one per table).
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toEqual({ table: 'users', id: 'u-bad', error: 'decrypt boom' });
    expect(updates()).toHaveLength(2);
    expect(report.updates).toBe(2);
    const updatedIds = updates().map((c) => c.params?.[1]);
    expect(updatedIds).toEqual(['u-good', 'o-good']);
  });
});

describe('formatReport', () => {
  it('renders header + per-row action + summary without leaking plaintext', async () => {
    const { db } = makeFakeDb({
      users: [{ id: 'u1', encrypted: 'bare-legacy' }],
      oidc_clients: [{ id: 'o1', encrypted: 'v2:skipme' }],
      webhook_endpoints: [],
    });
    const report = await rewrapAll(db, { commit: true, codecs: fakeCodecs() });
    const out = formatReport(report);
    expect(out).toContain('APPLIED');
    expect(out).toContain('v1->v2');
    expect(out).toContain('v2-skip');
    expect(out).toContain('applied=1');
    expect(out).not.toContain('bare-legacy'); // never echoes the stored ciphertext body
  });
});
