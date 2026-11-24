/**
 * 4A T1 — CAEP drainer unit battery (spec rev.4 §3 T1). Scripted query seam:
 * every classification path + jti-stable retry + mechanism-independence
 * source lock. Real-PG delivery integration rides the ops scratch-DB harness
 * (owed ledger — see plan T1 gates).
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createPublicKey, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jwtVerify } from 'jose';
import { startCaepDispatcher, type CaepDispatcherDeps } from '../utils/caep-dispatcher.js';
import { CAEP_EVENT_TYPES } from '@accessbase/identity';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ISSUER = 'https://idp.example/oidc';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

interface ClaimRow {
  id: number;
  attempts: number;
  tenant_id: string;
  client_id: string | null;
  event_type: string;
  subject_id: string;
  jti: string;
  url: string | null;
}

function claimedRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    id: 1,
    attempts: 1,
    tenant_id: '00000000-0000-4000-8000-000000000001',
    client_id: '00000000-0000-4000-8000-000000000002',
    event_type: CAEP_EVENT_TYPES.suspended,
    subject_id: '00000000-0000-4000-8000-000000000003',
    jti: randomUUID(),
    url: 'https://receiver.example/caep',
    ...overrides,
  };
}

interface Harness {
  dispatcher: { runOnce: () => Promise<void> };
  bodies: Array<{ url: string; body: string }>;
  stamps: Array<{ text: string; params: unknown[] }>;
}

function harness(
  claimResponses: ClaimRow[][],
  opts: {
    fetch?: (url: string, init: Record<string, unknown>) => Promise<{ status: number }>;
    dnsLookup?: CaepDispatcherDeps['dnsLookup'];
  } = {},
): Harness {
  const bodies: Array<{ url: string; body: string }> = [];
  const stamps: Array<{ text: string; params: unknown[] }> = [];
  let tick = 0;
  const deps: CaepDispatcherDeps = {
    query: {
      query: async (text: string, params?: unknown[]) => {
        if (text.includes('WITH claimed')) {
          const rows = claimResponses[Math.min(tick, claimResponses.length - 1)] ?? [];
          tick += 1;
          return rows;
        }
        stamps.push({ text, params: params ?? [] });
        return [];
      },
    },
    issuer: ISSUER,
    signingKeyPem: () => PRIV_PEM,
    fetchImpl: async (url, init) => {
      const body = String(init['body']);
      bodies.push({ url, body });
      if (opts.fetch) return opts.fetch(url, init);
      return { status: 200 };
    },
    dnsLookup: opts.dnsLookup,
    logger: { info: () => undefined, warn: () => undefined },
    // The unref'd timer must NEVER race the direct runOnce() driver — boot far
    // in the future; ticks are driven synchronously by the test.
    bootDelayMs: 60_000,
    intervalMs: 60_000,
  };
  const dispatcher = startCaepDispatcher(deps);
  return { dispatcher, bodies, stamps };
}

const deadStamp = (stamps: Harness['stamps']): { reason: string; detail: string } => {
  const last = stamps.at(-1);
  if (!last) throw new Error('expected at least one stamp');
  expect(last.text).toContain(`"status"='dead'`);
  return { reason: String(last.params[1]), detail: String(last.params[2]) };
};

describe('CAEP drainer classification (P-8 / F-05 / F-14)', () => {
  it('orphaned row (client deleted) → dead with preserved evidence, NO fetch (P-8)', async () => {
    const row = claimedRow({ client_id: null, url: null });
    const h = harness([[row]]);
    await h.dispatcher.runOnce();
    const d = deadStamp(h.stamps);
    expect(d.reason).toBe('client deleted');
    expect(h.bodies).toHaveLength(0);
  });

  it('denied IP literal URL → dead ssrf-denied-url, NO fetch (F-05 structural leg)', async () => {
    const row = claimedRow({ url: 'http://127.0.0.1:9999/caep' });
    const h = harness([[row]]);
    await h.dispatcher.runOnce();
    const d = deadStamp(h.stamps);
    expect(d.reason).toBe('ssrf-denied-url');
    expect(h.bodies).toHaveLength(0);
  });

  it('hostname resolving into the deny-set → dead ssrf-denied-dns, NO fetch (F-05 DNS leg)', async () => {
    const row = claimedRow({ url: 'https://rebind.example/caep' });
    const h = harness([[row]], {
      dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
    });
    await h.dispatcher.runOnce();
    const d = deadStamp(h.stamps);
    expect(d.reason).toBe('ssrf-denied-dns');
    expect(h.bodies).toHaveLength(0);
  });

  it('happy path: signs, POSTs secevent+jwt, stamps delivered (wire shape on the body)', async () => {
    const row = claimedRow();
    const h = harness([[row]], {
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    await h.dispatcher.runOnce();
    expect(h.bodies).toHaveLength(1);
    const delivered = h.bodies[0];
    if (!delivered) throw new Error('expected one delivered body');
    const { payload, protectedHeader } = await jwtVerify(
      delivered.body,
      createPublicKey(PRIV_PEM),
    );
    expect(protectedHeader.typ).toBe('secevent+jwt');
    expect(protectedHeader.kid).toBe('set-signing');
    expect(payload.aud).toBe(row.client_id);
    expect(payload.jti).toBe(row.jti);
    expect(payload.txn).toBe(String(row.id));
    expect(Object.keys(payload.events as object)).toEqual([row.event_type]);
    const last = h.stamps.at(-1);
    if (!last) throw new Error('expected a delivered stamp');
    expect(last.text).toContain(`"status"='delivered'`);
  });

  it('retry keeps the SAME jti (at-least-once dedup key never rotates)', async () => {
    const row = claimedRow({ attempts: 1 });
    let calls = 0;
    const h = harness([[row, ].map((r) => ({ ...r })), [{ ...row, attempts: 2 }]], {
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error('ECONNREFUSED');
        return { status: 200 };
      },
    });
    await h.dispatcher.runOnce();
    await h.dispatcher.runOnce();
    expect(h.bodies.length).toBeGreaterThanOrEqual(2);
    const firstBody = h.bodies[0];
    const secondBody = h.bodies[1];
    if (!firstBody || !secondBody) throw new Error('expected two delivered bodies');
    const jti1 = (await jwtVerify(firstBody.body, createPublicKey(PRIV_PEM))).payload.jti;
    const jti2 = (await jwtVerify(secondBody.body, createPublicKey(PRIV_PEM))).payload.jti;
    expect(jti1).toBe(row.jti);
    expect(jti2).toBe(row.jti);
  });

  it('attempt cap: a row already at 10 attempts dead-letters (max attempts)', async () => {
    const row = claimedRow({ attempts: 10 });
    const h = harness([[row]], {
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await h.dispatcher.runOnce();
    const d = deadStamp(h.stamps);
    expect(d.reason).toBe('max attempts');
  });
});

describe('mechanism independence (F-08 source lock — runtime dual-table proof = real-PG integration)', () => {
  const src = readFileSync(
    path.join(HERE, '../utils/caep-dispatcher.ts'),
    'utf-8',
  );
  it('drainer speaks ONLY to caep_deliveries — never the webhook engine', () => {
    expect(src).toContain('caep_deliveries');
    expect(src).not.toContain('webhook_deliveries');
    expect(src).not.toContain('webhooks_enabled');
    expect(src).not.toContain('WITH age');
  });
});
