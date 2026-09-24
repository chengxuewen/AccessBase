/**
 * Q4c-T2 dispatcher unit suite (spec rev.2 §8, invariants 2/4/6/8/10).
 * No real DB, no real network: a scripted `query` seam records every call
 * (SQL text + bound params) so we assert call ORDER and params, and the
 * fetch/decrypt seams are spies. This is the layer that proves the §5 tick
 * contract; the claim-disjointness proof lives in the real-PG integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  startWebhookDispatcher,
  nextAttemptAt,
  CLAIM_SQL,
  TERMINALIZE_SQL,
  type WebhookDispatcherDeps,
  type WebhookQuery,
} from '../utils/webhook-dispatcher.js';

interface FakeState {
  claimed: Array<{ id: number; event_id: number; endpoint_id: string; attempts: number }>;
  endpoints: Array<{ id: string; url: string; secret_encrypted: string }>;
  events: Array<{ id: number; type: string; payload: unknown; created_at: Date | string }>;
}

interface Call {
  sql: string;
  params?: unknown[];
}

function makeFake(state: FakeState): { query: WebhookQuery; calls: Call[] } {
  const calls: Call[] = [];
  const query: WebhookQuery['query'] = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
    calls.push({ sql: text, params });
    if (text === CLAIM_SQL) return state.claimed as unknown as T[];
    if (text.includes('FROM webhook_endpoints WHERE id = ANY')) return state.endpoints as unknown as T[];
    if (text.includes('FROM events WHERE id = ANY')) return state.events as unknown as T[];
    return [] as unknown as T[];
  };
  return { query: { query }, calls };
}

function baseDeps(over: Partial<WebhookDispatcherDeps> & { state: FakeState }) {
  const { state, ...rest } = over;
  const fake = makeFake(state);
  const deps: WebhookDispatcherDeps = {
    query: fake.query,
    webhooksEnabled: () => true,
    decrypt: (b) => `dec(${b})`,
    fetchImpl: async () => ({ status: 200 }),
    logger: { info: vi.fn(), warn: vi.fn() },
    defaultTenantId: 'tenant-default',
    ...rest,
  };
  return { deps, calls: fake.calls };
}

const EP = '11111111-1111-1111-1111-111111111111';
const EMPTY: FakeState = { claimed: [], endpoints: [], events: [] };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('step 0 — retention prune', () => {
  it('prune runs FIRST, before the kill-switch check (invariant 8)', async () => {
    const { deps, calls } = baseDeps({ state: EMPTY, webhooksEnabled: () => false, retentionDays: 3 });
    await startWebhookDispatcher(deps).runOnce();
    expect(calls[0]?.sql).toContain('DELETE FROM events');
    expect(calls[0]?.params).toEqual([3]);
    // disabled ⇒ fan-out / claim never ran
    expect(calls.find((c) => c.sql.includes('INSERT INTO webhook_deliveries'))).toBeUndefined();
    expect(calls.find((c) => c.sql === CLAIM_SQL)).toBeUndefined();
  });

  it('prune default retention is 7 days', async () => {
    const { deps, calls } = baseDeps({ state: EMPTY });
    await startWebhookDispatcher(deps).runOnce();
    expect(calls[0]?.params).toEqual([7]);
  });
});

describe('step 1 — fan-out + vacuous terminalization', () => {
  it('fan-out excludes webhook.test and pins the default-tenant live arm', async () => {
    const { deps, calls } = baseDeps({ state: EMPTY });
    await startWebhookDispatcher(deps).runOnce();
    const fan = calls.find((c) => c.sql.includes('INSERT INTO webhook_deliveries'));
    expect(fan?.sql).toContain("e.type <> 'webhook.test'");
    expect(fan?.sql).toContain("t.status = 'active' OR w.tenant_id = $1");
    expect(fan?.params).toEqual(['tenant-default']);
  });

  it('terminalization UPDATE fires even with zero claims (vacuous rule)', async () => {
    const { deps, calls } = baseDeps({ state: EMPTY });
    await startWebhookDispatcher(deps).runOnce();
    const term = calls.filter((c) => c.sql === TERMINALIZE_SQL);
    expect(term.length).toBeGreaterThanOrEqual(1); // step 1 ran it once; no second (no claims)
    expect(term.length).toBe(1);
  });

  it('terminalization re-runs AFTER outcomes when deliveries were claimed', async () => {
    const { deps, calls } = baseDeps({
      state: {
        claimed: [{ id: 1, event_id: 10, endpoint_id: EP, attempts: 1 }],
        endpoints: [{ id: EP, url: 'http://8.8.8.8/hook', secret_encrypted: 'S' }],
        events: [{ id: 10, type: 'user.created', payload: { a: 1 }, created_at: '2026-01-01T00:00:00.000Z' }],
      },
    });
    await startWebhookDispatcher(deps).runOnce();
    expect(calls.filter((c) => c.sql === TERMINALIZE_SQL).length).toBe(2);
  });
});

describe('step 2/3 — claim lease + signed POST', () => {
  it('claim CTE is the canonical §5.2 text (surrogate id, LIMIT 25, SKIP LOCKED, 60s lease)', async () => {
    const { deps } = baseDeps({ state: EMPTY });
    const d = startWebhookDispatcher(deps);
    await d.runOnce();
    expect(CLAIM_SQL).toContain('LIMIT 25');
    expect(CLAIM_SQL).toContain('FOR UPDATE SKIP LOCKED');
    expect(CLAIM_SQL).toContain('make_interval(secs => 60)');
    expect(CLAIM_SQL).toContain('RETURNING d.id, d.event_id, d.endpoint_id, d.attempts');
  });

  it('decrypt is called ONCE per endpoint even across multiple deliveries (R4)', async () => {
    const decrypt = vi.fn(() => 'plain');
    const { deps } = baseDeps({
      decrypt,
      state: {
        claimed: [
          { id: 1, event_id: 10, endpoint_id: EP, attempts: 1 },
          { id: 2, event_id: 11, endpoint_id: EP, attempts: 1 },
        ],
        endpoints: [{ id: EP, url: 'http://8.8.8.8/h', secret_encrypted: 'BLOB' }],
        events: [
          { id: 10, type: 'user.created', payload: {}, created_at: 'x' },
          { id: 11, type: 'user.updated', payload: {}, created_at: 'y' },
        ],
      },
    });
    await startWebhookDispatcher(deps).runOnce();
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledWith('BLOB');
  });

  it('signature header is the exact HMAC-SHA256 of the sent body under the decrypted secret', async () => {
    const secret = 'topsecret';
    const fetchImpl = vi.fn(async () => ({ status: 200 }));
    const { deps } = baseDeps({
      decrypt: () => secret,
      fetchImpl,
      // hostname endpoint ⇒ the dispatch-time re-check runs the resolver leg —
      // inject a PUBLIC answer so no unit ever dials real DNS (invariant 6).
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      state: {
        claimed: [{ id: 1, event_id: 42, endpoint_id: EP, attempts: 1 }],
        endpoints: [{ id: EP, url: 'https://hooks.example/x', secret_encrypted: 'B' }],
        events: [{ id: 42, type: 'user.created', payload: { email: 'a@b.c' }, created_at: '2026-05-01T10:00:00.000Z' }],
      },
    });
    await startWebhookDispatcher(deps).runOnce();
    const call = fetchImpl.mock.calls[0];
    const url = call?.[0] as string;
    const init = call?.[1] as { body: string; headers: Record<string, string>; method: string; redirect: string };
    expect(url).toBe('https://hooks.example/x');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual'); // 3xx must not be followed
    // Body shape §5.3.
    expect(JSON.parse(init.body)).toEqual({
      id: 42,
      type: 'user.created',
      createdAt: '2026-05-01T10:00:00.000Z',
      data: { email: 'a@b.c' },
    });
    const expected = `sha256=${createHmac('sha256', secret).update(init.body).digest('hex')}`;
    expect(init.headers['x-accessbase-signature']).toBe(expected);
    expect(init.headers['x-accessbase-type']).toBe('user.created');
    expect(init.headers['x-accessbase-event']).toBe('42');
    expect(init.headers['user-agent']).toBe('AccessBase-Webhooks/1');
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('SSRF-denied endpoint URL fails the delivery WITHOUT calling fetch (last_error=ssrf-denied)', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 }));
    const { deps, calls } = baseDeps({
      fetchImpl,
      state: {
        claimed: [{ id: 7, event_id: 1, endpoint_id: EP, attempts: 1 }],
        endpoints: [{ id: EP, url: 'http://169.254.169.254/latest', secret_encrypted: 'B' }],
        events: [{ id: 1, type: 'user.created', payload: {}, created_at: 'z' }],
      },
    });
    await startWebhookDispatcher(deps).runOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
    const outcome = calls.find((c) => c.sql.includes('SET status = $1'));
    expect(outcome?.params?.[0]).toBe('pending'); // attempts 1 < 10
    expect(outcome?.params?.[1]).toBe('ssrf-denied');
  });

  it('hostname resolving to loopback is denied at dispatch time via the injected DNS seam', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 }));
    const dnsLookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);
    const { deps } = baseDeps({
      fetchImpl,
      dnsLookup: dnsLookup as WebhookDispatcherDeps['dnsLookup'],
      state: {
        claimed: [{ id: 1, event_id: 1, endpoint_id: EP, attempts: 1 }],
        endpoints: [{ id: EP, url: 'http://evil.example/hook', secret_encrypted: 'B' }],
        events: [{ id: 1, type: 'user.created', payload: {}, created_at: 'z' }],
      },
    });
    await startWebhookDispatcher(deps).runOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('step 4 — outcome + backoff + dead', () => {
  function outcomeParams(calls: Call[]) {
    return calls.find((c) => c.sql.includes('SET status = $1'))?.params;
  }

  it('2xx stamps delivered + response_status', async () => {
    const { deps, calls } = baseDeps({
      fetchImpl: async () => ({ status: 204 }),
      state: {
        claimed: [{ id: 1, event_id: 1, endpoint_id: EP, attempts: 1 }],
        endpoints: [{ id: EP, url: 'http://8.8.8.8/h', secret_encrypted: 'B' }],
        events: [{ id: 1, type: 'user.created', payload: {}, created_at: 'z' }],
      },
    });
    await startWebhookDispatcher(deps).runOnce();
    const p = outcomeParams(calls);
    expect(p?.[0]).toBe('delivered');
    expect(p?.[1]).toBeNull(); // last_error cleared
    expect(p?.[2]).toBe(204);
  });

  it('3xx (redirect, manual) is a FAILURE → pending + http-3xx error', async () => {
    const { deps, calls } = baseDeps({
      fetchImpl: async () => ({ status: 302 }),
      state: {
        claimed: [{ id: 1, event_id: 1, endpoint_id: EP, attempts: 2 }],
        endpoints: [{ id: EP, url: 'http://8.8.8.8/h', secret_encrypted: 'B' }],
        events: [{ id: 1, type: 'user.created', payload: {}, created_at: 'z' }],
      },
    });
    await startWebhookDispatcher(deps).runOnce();
    const p = outcomeParams(calls);
    expect(p?.[0]).toBe('pending');
    expect(p?.[1]).toBe('http-302');
  });

  it('4xx/5xx failure stays pending until attempts reaches 10 → dead', async () => {
    const state = {
      claimed: [{ id: 1, event_id: 1, endpoint_id: EP, attempts: 10 }],
      endpoints: [{ id: EP, url: 'http://8.8.8.8/h', secret_encrypted: 'B' }],
      events: [{ id: 1, type: 'user.created', payload: {}, created_at: 'z' }],
    };
    const { deps, calls } = baseDeps({ fetchImpl: async () => ({ status: 500 }), state });
    await startWebhookDispatcher(deps).runOnce();
    expect(outcomeParams(calls)?.[0]).toBe('dead');
  });

  it('fetch rejection does NOT escape the tick and stamps an error (next tick survives)', async () => {
    const { deps, calls } = baseDeps({
      fetchImpl: async () => {
        throw new Error('socket hang up');
      },
      state: {
        claimed: [{ id: 1, event_id: 1, endpoint_id: EP, attempts: 3 }],
        endpoints: [{ id: EP, url: 'http://8.8.8.8/h', secret_encrypted: 'B' }],
        events: [{ id: 1, type: 'user.created', payload: {}, created_at: 'z' }],
      },
    });
    const d = startWebhookDispatcher(deps);
    await expect(d.runOnce()).resolves.toBeUndefined();
    const p = outcomeParams(calls);
    expect(p?.[0]).toBe('pending');
    expect(String(p?.[1])).toContain('socket hang up');
    // a second tick still runs
    await expect(d.runOnce()).resolves.toBeUndefined();
  });

  it('a DB error inside the tick is swallowed + logged, never thrown', async () => {
    const warn = vi.fn();
    const boom: WebhookQuery = {
      query: async (text) => {
        if (text.includes('INSERT INTO webhook_deliveries')) throw new Error('deadlock');
        return [];
      },
    };
    const d = startWebhookDispatcher({
      query: boom,
      webhooksEnabled: () => true,
      decrypt: () => 's',
      fetchImpl: async () => ({ status: 200 }),
      logger: { info: vi.fn(), warn },
    });
    await expect(d.runOnce()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('backoff math — 30s · 2^(attempts-1), capped', () => {
  it('successive attempts double from 30s', () => {
    const t = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(nextAttemptAt(1, t).getTime() - t).toBe(30_000);
    expect(nextAttemptAt(2, t).getTime() - t).toBe(60_000);
    expect(nextAttemptAt(3, t).getTime() - t).toBe(120_000);
    expect(nextAttemptAt(4, t).getTime() - t).toBe(240_000);
  });
  it('caps at 2^9 (attempts 10 and beyond)', () => {
    const t = 0;
    expect(nextAttemptAt(10, t).getTime()).toBe(30_000 * 2 ** 9);
    expect(nextAttemptAt(15, t).getTime()).toBe(30_000 * 2 ** 9);
  });
});
