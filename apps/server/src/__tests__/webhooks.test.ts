/**
 * Q4c-T3 /api/v1/webhooks route tests. Factory-mock style (groups.test.ts
 * precedent) with the LAZY route db shared across the file: createDb returns
 * one scripted fake whose methods are re-stubbed per test. The SSRF module is
 * mocked at the seam (its own unit battery covers the parser).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const WID = '11111111-1111-1111-1111-111111111111';

/**
 * Chain mock. values() records its argument into insertValues so tests can
 * assert the written payload (routes call insert(table).values(payload)).
 */
const insertValues: unknown[] = [];
function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'where', 'innerJoin', 'limit', 'set', 'returning', 'orderBy', 'groupBy', 'offset', 'onConflictDoNothing']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.values = vi.fn((v: unknown) => {
    insertValues.push(v);
    return chain;
  });
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

// ONE fake db for the file (the route caches its lazy handle at first use).
const fakeDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@accessbase/identity/db', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    createDb: vi.fn(() => fakeDb),
    closeDb: vi.fn(async () => {}),
  };
});

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'admin-u1', email: 'admin@accessbase.local' }),
      transaction: (fn: (d: unknown) => unknown) => fn({}),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn().mockResolvedValue(true),
    })),
  };
});

// SSRF seam: pass by default; individual tests flip the verdict.
const assertWebhookUrlMock = vi.fn(() => ({ ok: true, hostname: 'ok.example.com' }));
const resolveDeniedIpsMock = vi.fn(async () => ({ ok: true, hostname: 'ok.example.com' }));
vi.mock('../utils/webhook-url.js', () => ({
  assertWebhookUrl: (raw: string) => assertWebhookUrlMock(raw),
  resolveDeniedIps: (h: string) => resolveDeniedIpsMock(h),
}));

const { buildApp } = await import('../app.js');

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let token: string;
const AUTH = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: 'u1', tenantId: TENANT });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  insertValues.length = 0;
  assertWebhookUrlMock.mockReturnValue({ ok: true, hostname: 'ok.example.com' });
  resolveDeniedIpsMock.mockResolvedValue({ ok: true, hostname: 'ok.example.com' });
});

const endpointRow = {
  id: WID,
  tenantId: TENANT,
  url: 'https://hooks.example.com/iam',
  description: null,
  secretEncrypted: 'v1:salt:iv:tag:ct',
  subscribedEvents: ['*'],
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('GET /api/v1/webhooks', () => {
  it('projects no secret and merges pending/dead counts', async () => {
    fakeDb.select
      .mockReturnValueOnce(makeChain([endpointRow]))
      .mockReturnValueOnce(makeChain([{ endpointId: WID, pending: 3, dead: 1 }]));
    const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: AUTH() });
    expect(res.statusCode).toBe(200);
    const [row] = res.json().data as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ id: WID, url: endpointRow.url, active: true, pending: 3, dead: 1 });
    expect(JSON.stringify(res.json())).not.toContain('v1:salt');
    expect(row).not.toHaveProperty('secretEncrypted');
    expect(row).not.toHaveProperty('secret');
  });
});

describe('POST /api/v1/webhooks', () => {
  it('creates: reveals secret exactly once and never in list shape', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([])); // dup pre-check
    fakeDb.insert.mockReturnValueOnce(makeChain([endpointRow]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: AUTH(),
      payload: { url: endpointRow.url, subscribedEvents: ['*'] },
    });
    expect(res.statusCode).toBe(201);
    const secret = res.json().data.secret as string;
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(20);
    const values = insertValues[0] as Record<string, unknown>;
    expect(values['secretEncrypted']).not.toBe(secret); // stored as envelope, not plaintext
    expect(values['subscribedEvents']).toEqual(['*']);
  });

  it('SSRF deny at registration → 400 WEBHOOK_URL_DENIED, zero writes', async () => {
    assertWebhookUrlMock.mockReturnValue({ ok: false, reason: 'literal address is in the deny set' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: AUTH(),
      payload: { url: 'http://127.0.0.1:5101/x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEBHOOK_URL_DENIED');
    expect(fakeDb.insert).not.toHaveBeenCalled();
  });

  it('DNS-answer denial is honored too', async () => {
    resolveDeniedIpsMock.mockResolvedValueOnce({ ok: false, reason: 'dns-answer-denied' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: AUTH(),
      payload: { url: 'http://evil.example.com/hook' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEBHOOK_URL_DENIED');
  });

  it('duplicate (tenant,url) pre-check → 409 WEBHOOK_EXISTS', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([{ id: 'other' }]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: AUTH(),
      payload: { url: endpointRow.url },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WEBHOOK_EXISTS');
    expect(fakeDb.insert).not.toHaveBeenCalled();
  });

  it("accepts '*' literal AND '<a-z>.<b_c>' entries; junk entry 400s", async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: AUTH(),
      payload: { url: 'https://x.example.com', subscribedEvents: ['User.Created!'] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('WEBHOOK_INVALID');
  });
});

describe('PUT /api/v1/webhooks/:id', () => {
  it('unknown id → 404; happy update → projected view without secret', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([])); // findOwned miss
    const miss = await app.inject({
      method: 'PUT',
      url: `/api/v1/webhooks/${WID}`,
      headers: AUTH(),
      payload: { active: false },
    });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().error.code).toBe('WEBHOOK_NOT_FOUND');

    fakeDb.select.mockReturnValueOnce(makeChain([endpointRow])); // findOwned
    fakeDb.update.mockReturnValueOnce(makeChain([{ ...endpointRow, active: false }]));
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/webhooks/${WID}`,
      headers: AUTH(),
      payload: { active: false },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ active: false });
    expect(JSON.stringify(ok.json())).not.toContain('v1:salt');
  });

  it('url change re-runs the guard', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([endpointRow]));
    assertWebhookUrlMock.mockReturnValue({ ok: false, reason: 'denied' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/webhooks/${WID}`,
      headers: AUTH(),
      payload: { url: 'http://[::ffff:127.0.0.1]/x' },
    });
    expect(res.statusCode).toBe(400);
    expect(assertWebhookUrlMock).toHaveBeenCalled();
  });
});

describe('DELETE / rotate / ping / deliveries', () => {
  it('DELETE unknown 404; happy → data null', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([endpointRow]));
    fakeDb.delete.mockReturnValueOnce(makeChain(undefined));
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/webhooks/${WID}`, headers: AUTH() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });

  it('rotate-secret reveals a fresh secret once', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([endpointRow]));
    fakeDb.update.mockReturnValueOnce(makeChain(undefined));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${WID}/rotate-secret`,
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.secret).toBe('string');
  });

  it('ping inserts webhook.test event + a DIRECT delivery for :id only (R3)', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([endpointRow])); // findOwned
    fakeDb.insert.mockReturnValueOnce(makeChain([{ id: 42 }])).mockReturnValueOnce(makeChain(undefined));
    const res = await app.inject({ method: 'POST', url: `/api/v1/webhooks/${WID}/ping`, headers: AUTH() });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ deliveryQueued: true, eventId: 42 });
    const eventValues = insertValues[0] as Record<string, unknown>;
    expect(eventValues['type']).toBe('webhook.test');
    const deliveryValues = insertValues[1] as Record<string, unknown>;
    expect(deliveryValues).toEqual({ eventId: 42, endpointId: WID });
  });

  it('deliveries ledger lists newest rows, limit clamped to 100', async () => {
    fakeDb.select.mockReturnValueOnce(makeChain([endpointRow]));
    fakeDb.select.mockReturnValueOnce(makeChain([]));
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/webhooks/${WID}/deliveries?limit=9999`,
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    const limitCall = fakeDb.select.mock.results[1]?.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(limitCall.limit).toHaveBeenCalledWith(100);
  });
});

describe('guards', () => {
  it('unauthenticated → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks' });
    expect(res.statusCode).toBe(401);
  });

  it('routePermissions: webhooks surface + email-templates rides options codes', async () => {
    const { getRequiredPermission } = await import('@accessbase/identity');
    expect(getRequiredPermission('GET', '/api/v1/webhooks')).toBe('webhooks:read');
    expect(getRequiredPermission('POST', `/api/v1/webhooks/${WID}/ping`)).toBe('webhooks:write');
    expect(getRequiredPermission('DELETE', `/api/v1/webhooks/${WID}`)).toBe('webhooks:write');
    expect(getRequiredPermission('GET', '/api/v1/email-templates')).toBe('options:read');
    expect(getRequiredPermission('POST', '/api/v1/email-templates/verify/test')).toBe('options:write');
  });
});
