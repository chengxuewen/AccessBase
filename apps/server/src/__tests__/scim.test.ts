/**
 * SCIM 2.0 mount tests (Batch H Task 1).
 *
 * Mock style mirrors scim-token-isolation.test.ts (T0): ApiKeyManager mocked
 * with a Map keyed by sha256 hash; app.inject for the wire assertions.
 * Covers: 401 no-token, 403 wrong-scope (R1), 200 discovery with SCIM shapes
 * + scim+json content-type, scoped parser proof (POST /Users 501), app.ts
 * addContentTypeParser=0 invariant, PIT-056 hashed-lookup spy.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// --- Mock API key rows (keyed by sha256 hash, T0 pattern) ---

const DATA_KEY = 'ab_' + 'd'.repeat(32); // scopes: ['*']
const SCIM_KEY = 'ab_' + 'e'.repeat(32); // scopes: ['scim']
const REVOKED_KEY = 'ab_' + 'f'.repeat(32);

function makeKey(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'key-test',
    name: 'test-key',
    prefix: 'ab_dddd',
    scopes: ['*'],
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    tenantId: '00000000-0000-0000-0000-000000000001',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const keyStore = new Map<string, Record<string, unknown>>();
const findByHashSpy = vi.fn(async (hash: string) => keyStore.get(hash) ?? null);

function seedKeys(): void {
  keyStore.clear();
  const sha = (k: string) => createHash('sha256').update(k).digest('hex');
  keyStore.set(sha(DATA_KEY), makeKey({ id: 'key-data', scopes: ['*'] }));
  keyStore.set(sha(SCIM_KEY), makeKey({ id: 'key-scim', scopes: ['scim'], prefix: 'ab_eeee' }));
  keyStore.set(
    sha(REVOKED_KEY),
    makeKey({ id: 'key-revoked', scopes: ['scim'], revokedAt: new Date(), prefix: 'ab_ffff' }),
  );
}
seedKeys();

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    // Guard fast path: setup-guard's isSystemInitialized → findByEmail must
    // resolve a stub admin or the guard 503s (saml.test.ts precedent).
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn(async () => ({ id: 'admin-u1', email: 'admin@accessbase.local' })),
    })),
    ApiKeyManager: Object.assign(
      vi.fn().mockImplementation(() => ({ findByHash: findByHashSpy })),
      { isExpired: actual.ApiKeyManager.isExpired },
    ),
  };
});

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

const SCIM_BASE = '/api/v1/scim/v2';

describe('SCIM mount skeleton', () => {
  it('no token → 401 SCIM Error envelope with scim+json content-type', async () => {
    const res = await app.inject({ method: 'GET', url: `${SCIM_BASE}/ServiceProviderConfig` });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/scim+json');
    const body = res.json();
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(body.status).toBe('401');
  });

  it('revoked scim token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${SCIM_BASE}/ServiceProviderConfig`,
      headers: { authorization: `Bearer ${REVOKED_KEY}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("data-scope token (scopes ['*']) → 403 SCIM Error (R1: scope must include 'scim')", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${SCIM_BASE}/ServiceProviderConfig`,
      headers: { authorization: `Bearer ${DATA_KEY}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/scim+json');
    const body = res.json();
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(body.status).toBe('403');
  });

  it('PIT-056: bearer is hashed before lookup (spy assertion)', async () => {
    findByHashSpy.mockClear();
    await app.inject({
      method: 'GET',
      url: `${SCIM_BASE}/ServiceProviderConfig`,
      headers: { authorization: `Bearer ${SCIM_KEY}` },
    });
    expect(findByHashSpy).toHaveBeenCalledTimes(1);
    const expectedHash = createHash('sha256').update(SCIM_KEY).digest('hex');
    expect(findByHashSpy).toHaveBeenCalledWith(expectedHash);
  });

  describe('scim token (scopes ["scim"]) — discovery', () => {
    const AUTH = { authorization: `Bearer ${SCIM_KEY}` };

    it('GET /ServiceProviderConfig → 200 capability doc', async () => {
      const res = await app.inject({ method: 'GET', url: `${SCIM_BASE}/ServiceProviderConfig`, headers: AUTH });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/scim+json');
      const body = res.json();
      expect(body.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig']);
      expect(body.patch).toEqual({ supported: true });
      expect(body.filter).toMatchObject({ supported: true });
      expect(body.sort).toEqual({ supported: false });
      expect(body.etag).toEqual({ supported: false });
    });

    it('GET /Schemas → 200 ListResponse with User schema', async () => {
      const res = await app.inject({ method: 'GET', url: `${SCIM_BASE}/Schemas`, headers: AUTH });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/scim+json');
      const body = res.json();
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
      expect(body.totalResults).toBe(1);
      expect(body.Resources[0].id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
    });

    it('GET /ResourceTypes → 200 ListResponse with User resource', async () => {
      const res = await app.inject({ method: 'GET', url: `${SCIM_BASE}/ResourceTypes`, headers: AUTH });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/scim+json');
      const body = res.json();
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
      expect(body.Resources[0]).toMatchObject({ id: 'User', endpoint: '/Users' });
    });
  });

  it('POST /Users with application/scim+json body → parser runs, placeholder 501 with parsed body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${SCIM_BASE}/Users`,
      headers: { authorization: `Bearer ${SCIM_KEY}`, 'content-type': 'application/scim+json' },
      payload: JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'a@b.c' }),
    });
    // 501 = auth passed, scoped parser accepted the media type (no 415), T2 owns the real handler.
    expect(res.statusCode).toBe(501);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(res.json().schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
  });

  it('app.ts static invariant: zero global addContentTypeParser', () => {
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect((src.match(/addContentTypeParser/g) ?? []).length).toBe(0);
  });
});
