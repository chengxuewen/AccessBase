/**
 * SAML SLO route battery — logout-coherence §3.2, REAL node-saml crypto.
 *
 * Where saml.test.ts mocks SamlProvider to own the channel semantics, this
 * file keeps the provider REAL (only managers/db/redis stay mocked) and signs
 * inbound messages with a THROWAWAY fixture IdP keypair via node-saml itself:
 * the round-trip genuinely verifies the redirect signature over the raw query
 * string (R10 base-string trap) and exercises the Redis/Map replay arms.
 * Live-IdP interop stays on the integration-day ledger (spec §8).
 *
 * Nets (spec §7): B1 unsigned GET -> SLO_FAILED + ZERO revoke; R2 replayed
 * identical signed LogoutRequest -> dedup hit -> SLO_FAILED; B2 LogoutResponse
 * arm -> never generates a response back (loop regression lock).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SamlProvider } from '@accessbase/identity';
import type { IdentityService, OptionsManager } from '@accessbase/identity';
import { logger } from '@accessbase/logging';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// --- throwaway fixture keypair (self-signed, test-only — never reuse) --------
const IDP_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0e3ctchCGhVtz4gBatJ17NPHEVWb7y+pp9hRDvjXlQhuu7tq
LojcYMJIapAsn1THvNTEvqS/6NAf7dPoAXJNF+lLuLsXWTre6fBB0DVacb/PMhg9
sqg7OHRduBlbkCcUBQV/wpZ4hjl+KI3Y6zJI5u/X0GM4IaPQNeZayUmL8TS1uNUL
101WBOzuNUFFDZKT+6o939F5kVFPv9X79VYuUiw0VtCAJ4tFWBVrrJj95ksQ068o
evU0bPR1DkDpWoHoPUiW3vJvCoaPskFlCg3sMj+oJIrdgi1RHnMPMkcbKaKCuIZ8
dDbCJ9fAZGjAGa3WLjBNoKsGL3S8qA3/f6976QIDAQABAoIBAEFa7xJ81O9v6m7o
paBPAz2GtPvVjiVJzmSduKaTm/Ie3PJ/J1BzdUB+W7MpTWsRJtnH17SOb9yYJsiQ
5zLEFfIyxEsvm9ZAuLNWA/dBFPZCw8uRtmuPalhqCd9Nra7UK6xgiOTYmY8YCQmx
F24pin6y/po2uXvnluOg4nS1++ZMdRD5IsgIG7BkuzW5scsoMwGFSXvVUs8BN8xj
cGYTsznKZ+m/Tgz/dg68SLD5k8tT66ITwrCv76ElL9nLNv6B5Y71Bdq4enSxqTKb
ltKIaAoz0I0BYmTbbhPBTs1n4uOgczJovCZ6e2b2aODwncz/uTcQA35JMqQDAZ1a
yI85WL0CgYEA9R3b5jIha4Im7jNkCtX3tZxpfC3SgS5/u7Z61N/hjccAJznkGFQ/
OgiK1iHqVVp0pfIx8fX/VBCEsq/a8AiG/6fhOod3RzZEJB0nffBf9fB9S2B+0Qf8
4iqqoeDKm9afpL9s1KmdY0qYIhNuAYkdEkmJ6iw2SiF3eYXHhppFuycCgYEA20AK
lAIPRjynkMiMxLb75NZfRXOgW0Qj9yoGozgVpCasgBfm3/K/E3OMJa4v+PMhJiKH
Wp/g+zxxjbVf4O6YZlu6ygt9wCmHUXF7gHaAK4y0kEYzINAwkn8AZJoDTO2p1aS7
3u79kuRNaOYL1j79XvD36b5ZpWq62s/pH1Jfum8CgYEAtoHGAu9enOrqy79uBPdu
GkZc8H4517/kkcL8UFZmXidHAO4E3OyVq0NDBM956JWSdyEPeSZ+N3yZIWb48HKY
+fBpLihBcr+AGxeuGQKKoNewoxg1NLTq4Qd9x0xV75Tth0CU6v9j1dNr1St8ZB5Q
jBY/XyIORkIG8G/gsWNa+k8CgYBKJfpt29R2mITC/lA9JvVBiw5lWplcxEq1iEz+
XjVTcpDcMTkve9ULKwS2qZYnx3Hqh7rm9zMLRIHSvwhR9d8sntEpC4HXvzO4Y3y1
EV5/W/Kk6FjaPA5xPOpRG5UKK0ZIrpGq74BqcTOMymAucNcXiL8PGgUPYG0ZGz9o
DF+7mQKBgETJ7UK+FqrDtxaRGOE1PPW//w2mQ6iVb49XB61flVQyGsNkSR+lYa+X
FieoH9dXA00kN+8MFYPSQUz7SMkbKcEQ7X9hRmVgfIzj6u9v60q13JukYBs83xmK
iSSJ5HO5sNT/F8AIrq+4WQYG0mIXEZZzv8qgoYOiD+OF8lc6zjlk
-----END RSA PRIVATE KEY-----
`;
const IDP_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDHTCCAgWgAwIBAgIUdSJ1diTIsH6JreZ2VQ63DwQGPzswDQYJKoZIhvcNAQEL
BQAwHjEcMBoGA1UEAwwTQWNjZXNzQmFzZSBUZXN0IElkUDAeFw0yNjEwMDgwMzE3
MDBaFw0zNjEwMDUwMzE3MDBaMB4xHDAaBgNVBAMME0FjY2Vzc0Jhc2UgVGVzdCBJ
ZFAwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDR7dy1yEIaFW3PiAFq
0nXs08cRVZvvL6mn2FEO+NeVCG67u2ouiNxgwkhqkCyfVMe81MS+pL/o0B/t0+gB
ck0X6Uu4uxdZOt7p8EHQNVpxv88yGD2yqDs4dF24GVuQJxQFBX/ClniGOX4ojdjr
Mkjm79fQYzgho9A15lrJSYvxNLW41QvXTVYE7O41QUUNkpP7qj3f0XmRUU+/1fv1
Vi5SLDRW0IAni0VYFWusmP3mSxDTryh69TRs9HUOQOlageg9SJbe8m8Kho+yQWUK
DewyP6gkit2CLVEecw8yRxspooK4hnx0NsIn18BkaMAZrdYuME2gqwYvdLyoDf9/
r3vpAgMBAAGjUzBRMB0GA1UdDgQWBBTk7rJW6f7IzfYXsA+lDfRx4VtIUjAfBgNV
HSMEGDAWgBTk7rJW6f7IzfYXsA+lDfRx4VtIUjAPBgNVHRMBAf8EBTADAQH/MA0G
CSqGSIb3DQEBCwUAA4IBAQBVLp9kYHtap9wENTYf8XC3LCi9QRB+VH4/iMkACMQP
ddISzzBCPtWbcUa5f4CQhJdJavaR8symzBibfjBBSDDxSOhdJm7O6jp9DzqFaMRd
XoZMszjB5Ae28fn8ydJzcSriZu34Sq9YvT/26ykdhxcYvbREEgjPWNwAklvqM8tR
2dYekYw8EryG9HXfNeC4NOWSvEqyP3VKxy8BAw4AhPAFIiC2jc2b9J2jOs2GJyQI
s4EcGY5/5c3FHjyeLUSV4LJscqmaYScZXPFvUfIhIMPhaa9IdI5GJmjsbRoAQ52r
oucJfDB7K1Uo1mT8yoyo5pkh0z90nCHt/EuHJy5YIkH6
-----END CERTIFICATE-----
`;

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const testUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'slo@test.local',
  name: 'SLO User',
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
  totpEnabled: false,
};

const sessionManagerMock = {
  issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
};

const dbWrites: Array<{ table: string; values: Record<string, unknown> }> = [];
const redisState = { client: null as FakeRedis | null };

/** Map-backed Redis stand-in with real SET ... NX semantics (dedup arm). */
class FakeRedis {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ...opts: unknown[]): Promise<'OK' | null> {
    const nx = opts.some((o) => typeof o === 'string' && o.toUpperCase() === 'NX');
    if (nx && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

vi.mock('../utils/redis.js', () => ({
  getRedis: async () => redisState.client as never,
}));

vi.mock('@accessbase/identity/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const DRIZZLE_NAME = Symbol.for('drizzle:Name');
  const fakeDb = {
    insert: (table: Record<symbol, unknown>) => ({
      values: (vals: Record<string, unknown>) => {
        dbWrites.push({ table: String(table[DRIZZLE_NAME] ?? 'unknown'), values: vals });
        return Promise.resolve([]);
      },
    }),
    select: () => ({ from: () => ({ where: () => [] }) }),
  };
  return { ...actual, createDb: vi.fn(() => fakeDb), closeDb: vi.fn(async () => {}) };
});

// NOTE: NO SamlProvider override here — the real class + real node-saml run.
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn(async (email: string) => {
        if (email === 'admin@accessbase.local') return { ...testUser, email };
        return email === testUser.email ? testUser : null;
      }),
      create: vi.fn(),
      markEmailVerified: vi.fn(async () => {}),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([]),
      getEffectiveRoles: vi.fn().mockResolvedValue([]),
    })),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
    FlowTokenService: vi.fn().mockImplementation(() => ({
      issue: vi.fn(async () => 'unused'),
      consume: vi.fn(async () => null),
    })),
  };
});

const optionsStore = new Map<string, unknown>();
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : (optionsStore.has(key) ? optionsStore.get(key) : defaultValue),
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');
const { _resetSloDedupForTest, buildSamlProvider } = await import('../utils/saml-logout.js');
const { inflateRawSync } = await import('node:zlib');

/** Pull the LogoutRequest message ID out of a generated SLO URL (cache-key proof). */
function extractRequestId(logoutUrl: string): string {
  const b64 = new URL(logoutUrl).searchParams.get('SAMLRequest') ?? '';
  const xml = inflateRawSync(Buffer.from(b64, 'base64')).toString('utf-8');
  return xml.match(/ID="([^"]+)"/)?.[1] ?? '';
}

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  dbWrites.length = 0;
  redisState.client = null;
  sessionManagerMock.revokeAllUserSessions.mockClear();
  _resetSloDedupForTest();
  optionsStore.clear();
  // Every SLO crypto path must stay deterministic and log-honest.
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** SP-facing options: the fixture cert is what our SP verifies inbound sigs with. */
function enableSamlReal(): void {
  optionsStore.set('saml_enabled', 'true');
  optionsStore.set('saml_entry_point', 'https://idp.example.com/sso');
  optionsStore.set('saml_idp_cert', IDP_CERT_PEM);
  optionsStore.set('saml_logout_url', 'https://idp.example.com/slo');
}

/**
 * The IdP stand-in: a real SamlProvider carrying the fixture signing key.
 * logoutUrl/logoutResponseUrl wrap node-saml getLogoutUrlAsync /
 * getLogoutResponseUrlAsync, and signRequest fires whenever a privateKey is
 * configured — so every generated redirect carries Signature+SigAlg (B1).
 */
function makeCounterparty(): SamlProvider {
  return new SamlProvider({
    enabled: true,
    entryPoint: 'http://localhost/api/v1/auth/saml/slo',
    idpCert: IDP_CERT_PEM,
    entityId: 'https://idp.example.com',
    callbackUrl: 'http://localhost/api/v1/auth/saml/slo',
    privateKey: IDP_KEY_PEM,
  });
}

/** Query string AFTER '?' — what the route must hand node-saml verbatim (R10). */
function rawQuery(url: string): string {
  return url.slice(url.indexOf('?') + 1);
}

async function getSlo(query: string): Promise<{ statusCode: number; location: string }> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/auth/saml/slo?${query}` });
  return { statusCode: res.statusCode, location: String(res.headers['location']) };
}

async function signedLogoutRequestQuery(): Promise<string> {
  const idp = makeCounterparty();
  return rawQuery(await idp.logoutUrl(testUser.email, 'idx-9'));
}

describe('GET /api/v1/auth/saml/slo — LogoutRequest arm (real crypto)', () => {
  it('signed request -> revokes ALL sessions, emits auth.logout(saml), 302 LogoutResponse to the IdP SLO', async () => {
    enableSamlReal();
    const query = await signedLogoutRequestQuery();

    const res = await getSlo(query);

    expect(res.statusCode).toBe(302);
    expect(res.location).toContain('https://idp.example.com/slo'); // saml_logout_url destination
    expect(res.location).toContain('SAMLResponse=');
    // (RelayState echo is locked in the mock harness — saml.test.ts POST arm.)
    expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledTimes(1);
    expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith(testUser.id);
    const event = dbWrites.find((w) => w.table === 'events');
    expect(event?.values).toMatchObject({
      type: 'auth.logout',
      tenantId: testUser.tenantId,
      payload: { email: testUser.email, method: 'saml', userId: testUser.id },
    });
  });

  it('B1: unsigned GET (Signature+SigAlg stripped) -> SLO_FAILED 302 + ZERO revoke calls', async () => {
    enableSamlReal();
    const query = (await signedLogoutRequestQuery())
      .split('&')
      .filter((t) => !t.startsWith('Signature=') && !t.startsWith('SigAlg='))
      .join('&');

    const res = await getSlo(query);

    expect(res.statusCode).toBe(302);
    expect(res.location).toBe('/login?error=SLO_FAILED');
    expect(sessionManagerMock.revokeAllUserSessions).not.toHaveBeenCalled();
    expect(dbWrites.some((w) => w.table === 'events')).toBe(false);
  });

  it('forged signature (foreign keypair) -> SLO_FAILED + zero revoke', async () => {
    enableSamlReal();
    // Same params, broken signature (2048-bit-sized base64 blob that will never verify).
    const query = (await signedLogoutRequestQuery()).replace(
      /Signature=[^&]+/,
      'Signature=' + encodeURIComponent('A'.repeat(342)),
    );
    const res = await getSlo(query);
    expect(res.statusCode).toBe(302);
    expect(res.location).toBe('/login?error=SLO_FAILED');
    expect(sessionManagerMock.revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it('R2: replayed identical signed request -> dedup hit -> SLO_FAILED, revoke stays single', async () => {
    enableSamlReal();
    const query = await signedLogoutRequestQuery();

    const first = await getSlo(query);
    const second = await getSlo(query);

    expect(first.location).toContain('SAMLResponse=');
    expect(second.statusCode).toBe(302);
    expect(second.location).toBe('/login?error=SLO_FAILED');
    expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledTimes(1);
  });

  it('R2/redis arm: shared SETNX dedup claims across instances (multi-node path)', async () => {
    enableSamlReal();
    redisState.client = new FakeRedis();
    const query = await signedLogoutRequestQuery();

    const first = await getSlo(query);
    const second = await getSlo(query);

    expect(first.location).toContain('SAMLResponse=');
    expect(second.location).toBe('/login?error=SLO_FAILED');
    expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledTimes(1);
    // The claim key must carry the spec shape ab:saml:sreq:<RequestID>.
    expect([...redisState.client.store.keys()].some((k) => k.startsWith('ab:saml:sreq:'))).toBe(true);
  });

  it('unknown principal -> still answers LogoutResponse, zero revoke, zero event', async () => {
    enableSamlReal();
    const idp = makeCounterparty();
    const res = await getSlo(rawQuery(await idp.logoutUrl('ghost@test.local', null)));

    expect(res.statusCode).toBe(302);
    expect(res.location).toContain('https://idp.example.com/slo');
    expect(res.location).toContain('SAMLResponse=');
    expect(sessionManagerMock.revokeAllUserSessions).not.toHaveBeenCalled();
    expect(dbWrites.some((w) => w.table === 'events')).toBe(false);
  });

  it('not configured -> uniform SLO_FAILED (never JSON on the browser channel)', async () => {
    const res = await getSlo(await signedLogoutRequestQuery());
    expect(res.statusCode).toBe(302);
    expect(res.location).toBe('/login?error=SLO_FAILED');
  });
});

describe('GET /api/v1/auth/saml/slo — LogoutResponse arm (SP-initiated completion)', () => {
  it('signed LogoutResponse answering OUR issued LogoutRequest -> 302 /login, never echoes back; foreign InResponseTo rejected', async () => {
    enableSamlReal();
    // The §3.6 Redis seam is what makes the round-trip provable at all: the SP
    // instance that ISSUED the request and the per-request instance VALIDATING
    // the response are different objects — only shared cache state lets the
    // InResponseTo check pass cross-instance.
    redisState.client = new FakeRedis();
    const sp = await buildSamlProvider('localhost');
    const issuedUrl = await sp.logoutUrl(testUser.email, 'idx-9');
    const issuedId = extractRequestId(issuedUrl);
    expect(issuedId.length).toBeGreaterThan(0);
    const idp = makeCounterparty();

    const res = await getSlo(rawQuery(await idp.logoutResponseUrl({ id: issuedId, nameId: 'ignored' }, '')));

    expect(res.statusCode).toBe(302);
    expect(res.location).toBe('/login');
    // Loop-killer: our own redirect must carry NO SAML message of its own.
    expect(res.location).not.toContain('SAMLRequest');
    expect(res.location).not.toContain('SAMLResponse');

    // A response answering a request we never issued fails the InResponseTo
    // cache lookup -> uniform SLO_FAILED (validator genuinely applies).
    const forged = await getSlo(
      rawQuery(await idp.logoutResponseUrl({ id: '_never-issued', nameId: 'ignored' }, '')),
    );
    expect(forged.location).toBe('/login?error=SLO_FAILED');
  });

  it('unsigned LogoutResponse GET is rejected route-side too (B1 uniform GET gate)', async () => {
    enableSamlReal();
    const idp = makeCounterparty();
    const query = rawQuery(await idp.logoutResponseUrl({ id: '_req-abc', nameId: 'ignored' }, ''))
      .split('&')
      .filter((t) => !t.startsWith('Signature=') && !t.startsWith('SigAlg='))
      .join('&');

    const res = await getSlo(query);
    expect(res.statusCode).toBe(302);
    expect(res.location).toBe('/login?error=SLO_FAILED');
  });
});

describe('POST /api/v1/auth/saml/slo — parser + dispatch', () => {
  it('POST without a SAML body -> uniform SLO_FAILED', async () => {
    enableSamlReal();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/saml/slo',
      payload: 'junk=1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['location'])).toBe('/login?error=SLO_FAILED');
  });
});
