/**
 * SCIM 2.0 mount tests (Batch H Task 1).
 *
 * Mock style mirrors scim-token-isolation.test.ts (T0): ApiKeyManager mocked
 * with a Map keyed by sha256 hash; app.inject for the wire assertions.
 * Covers: 401 no-token, 403 wrong-scope (R1), 200 discovery with SCIM shapes
 * + scim+json content-type, scoped parser proof (POST /Users 501), app.ts
 * addContentTypeParser=0 invariant, PIT-056 hashed-lookup spy.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OptionsManager } from '@accessbase/identity';

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

// --- Mutable seams for T2 CRUD tests ---

/** Mock user rows keyed by email (lowercased). One user per test via unique emails. */
interface MockUser {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'suspended' | 'pending';
  tenantId: string;
  totpEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

function makeUser(overrides: Partial<MockUser> & { email: string }): MockUser {
  return {
    id: `u-${Math.random().toString(36).slice(2, 10)}`,
    name: overrides.email.split('@')[0] ?? overrides.email,
    status: 'active',
    tenantId: DEFAULT_TENANT,
    totpEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const userStore = new Map<string, MockUser>();

const userManagerMock = {
  /** R8 probe: records every lookup argument; PIT-056 asserts normalization. */
  findByEmail: vi.fn(async (email: string) => userStore.get(email.toLowerCase()) ?? null),
  // H1 seam: reads return a FRESH clone — handlers must not rely on object
  // aliasing between findById and changeStatus/update (the real manager +
  // PG hands out independent row snapshots per call).
  findById: vi.fn(async (id: string, tenantId: string) => {
    const stored = [...userStore.values()].find((u) => u.id === id && u.tenantId === tenantId);
    return stored ? { ...stored } : null;
  }),
  findAll: vi.fn(
    async (
      params: { page?: number; pageSize?: number; search?: string; emailExact?: string },
      tenantId: string,
    ) => {
      let rows = [...userStore.values()].filter((u) => u.tenantId === tenantId);
      // J-T1 two-key faithful model of the real findAll (PIT-055):
      // emailExact wins over search (else-if in UserManager); the substring
      // branch mirrors `email ILIKE %s% OR name ILIKE %s%`.
      if (params.emailExact) {
        rows = rows.filter((u) => u.email.toLowerCase() === params.emailExact);
      } else if (params.search) {
        const needle = params.search.toLowerCase();
        rows = rows.filter(
          (u) => u.email.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle),
        );
      }
      const total = rows.length;
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return {
        data: rows.slice(start, start + pageSize),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  ),
  create: vi.fn(async (input: { email: string; name: string }, tenantId: string) => {
    const user = makeUser({ email: input.email, name: input.name, tenantId });
    userStore.set(user.email.toLowerCase(), user);
    return user;
  }),
  update: vi.fn(
    async (id: string, data: { name?: string }, tenantId: string): Promise<MockUser> => {
      const user = [...userStore.values()].find((u) => u.id === id && u.tenantId === tenantId);
      if (!user) throw new Error('User not found');
      if (data.name !== undefined) user.name = data.name;
      user.updatedAt = new Date();
      return { ...user };
    },
  ),
  changeStatus: vi.fn(
    async (id: string, status: 'active' | 'suspended' | 'pending', tenantId: string): Promise<MockUser> => {
      const user = [...userStore.values()].find((u) => u.id === id && u.tenantId === tenantId);
      if (!user) throw new Error('User not found');
      user.status = status;
      user.updatedAt = new Date();
      return { ...user };
    },
  ),
};

const sessionManagerMock = {
  revokeAllUserSessions: vi.fn(async () => {}),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    // Guard fast path: setup-guard's isSystemInitialized → findByEmail must
    // resolve a stub admin or the guard 503s (saml.test.ts precedent).
    UserManager: vi.fn().mockImplementation(() => userManagerMock),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
    ApiKeyManager: Object.assign(
      vi.fn().mockImplementation(() => ({ findByHash: findByHashSpy })),
      { isExpired: actual.ApiKeyManager.isExpired },
    ),
  };
});

// Password-policy read path: scim.ts reads via getOptionsManager().get — inject
// an env-first stub so POST /Users never dials the fake PG (ldap-login precedent).
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (_key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : defaultValue,
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  resetUserStore(); // guard fast path needs the admin stub before the first request
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

  it('POST /Users with application/scim+json body → parser runs (create, 201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${SCIM_BASE}/Users`,
      headers: { authorization: `Bearer ${SCIM_KEY}`, 'content-type': 'application/scim+json' },
      payload: JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'parser-proof@b.c', name: { formatted: 'Parser Proof' } }),
    });
    // 201 = scoped parser accepted the media type (no 415) and the real
    // provisioning handler ran (T1 placeholder was 501).
    expect(res.statusCode).toBe(201);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(res.json().schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
  });

  it('app.ts static invariant: zero global addContentTypeParser', () => {
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect((src.match(/addContentTypeParser/g) ?? []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2: User provisioning CRUD (filter + pagination + lifecycle)
// ---------------------------------------------------------------------------

/**
 * Admin stub seeded in every reset: setup-guard's queryAdminExists does a
 * findByEmail('admin@accessbase.local') fast path — without it the guard
 * falls into the role-JOIN query and 503s on the fake PG (T1 stub precedent).
 */
const ADMIN_STUB = makeUser({ email: 'admin@accessbase.local', name: 'Admin', id: 'admin-u1' });

function resetUserStore(): void {
  userStore.clear();
  userStore.set(ADMIN_STUB.email, { ...ADMIN_STUB });
  userManagerMock.findByEmail.mockClear();
  userManagerMock.findById.mockClear();
  userManagerMock.findAll.mockClear();
  userManagerMock.create.mockClear();
  userManagerMock.update.mockClear();
  userManagerMock.changeStatus.mockClear();
  sessionManagerMock.revokeAllUserSessions.mockClear();
}

const AUTH = { authorization: `Bearer ${SCIM_KEY}`, 'content-type': 'application/scim+json' };

describe('SCIM user provisioning (T2)', () => {
  beforeEach(() => resetUserStore());

  describe('POST /Users', () => {
    it('happy path → 201 + Location + User resource (id/userName/meta/emails) + scim+json', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${SCIM_BASE}/Users`,
        headers: AUTH,
        payload: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'New.User@Example.COM',
          name: { formatted: 'New User' },
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['content-type']).toContain('application/scim+json');
      const body = res.json();
      expect(body.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
      expect(body.id).toBeTruthy();
      expect(body.userName).toBe('new.user@example.com'); // R8 normalized
      expect(body.name).toEqual({ formatted: 'New User' });
      expect(body.emails).toEqual([{ value: 'new.user@example.com', primary: true }]);
      expect(body.active).toBe(true);
      expect(body.meta).toMatchObject({ resourceType: 'User', location: `/api/v1/scim/v2/Users/${body.id}` });
      expect(res.headers.location).toBe(`/api/v1/scim/v2/Users/${body.id}`);
    });

    it('PIT-056: duplicate provision → 409 uniqueness, findByEmail called with LOWERCASED userName (R8)', async () => {
      userStore.set('dup@example.com', makeUser({ email: 'dup@example.com' }));
      const res = await app.inject({
        method: 'POST',
        url: `${SCIM_BASE}/Users`,
        headers: AUTH,
        payload: JSON.stringify({ userName: '  DUP@Example.COM  ' }),
      });
      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.scimType).toBe('uniqueness');
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
      // R8 probe: trim + lowercase BEFORE the manager call.
      expect(userManagerMock.findByEmail).toHaveBeenCalledWith('dup@example.com');
    });

    it('R9: name absent → name falls back to userName', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${SCIM_BASE}/Users`,
        headers: AUTH,
        payload: JSON.stringify({ userName: 'noname@x.io' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name.formatted).toBe('noname@x.io');
    });

    it('password fails policy → 400 invalidValue (no user created)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${SCIM_BASE}/Users`,
        headers: AUTH,
        payload: JSON.stringify({ userName: 'weak@x.io', password: 'short' }),
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.scimType).toBe('invalidValue');
      expect(userStore.has('weak@x.io')).toBe(false); // not provisioned
    });

    it('missing userName → 400 invalidValue', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${SCIM_BASE}/Users`,
        headers: AUTH,
        payload: JSON.stringify({ name: { formatted: 'X' } }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().scimType).toBe('invalidValue');
    });
  });

  describe('GET /Users — filter', () => {
    it('PIT-056: filter userName eq → 200 ListResponse, findAll receives LOWERCASED value (R8 push-down)', async () => {
      userStore.set('hit@x.io', makeUser({ email: 'hit@x.io' }));
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?filter=${encodeURIComponent('userName eq "HIT@X.IO"')}`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
      expect(body.totalResults).toBe(1);
      expect(body.Resources[0].userName).toBe('hit@x.io');
      // R8 probe: the normalized value reached the manager layer.
      expect(userManagerMock.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ emailExact: 'hit@x.io' }),
        DEFAULT_TENANT,
      );
    });

    it('J-T1: userName eq kills substring over-match and name false-hit (exact email only)', async () => {
      // Row 1: the true match. Row 2: email contains the needle as a
      // substring AND name equals the queried userName verbatim — the old
      // ILIKE push-down matched both; exact-email equality matches only row 1.
      userStore.set('hit@x.io', makeUser({ email: 'hit@x.io' }));
      userStore.set(
        'partial-hit@x.io-in-name',
        makeUser({ email: 'partial-hit@x.io-in-name', name: 'HIT@X.IO' }),
      );
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?filter=${encodeURIComponent('userName eq "HIT@X.IO"')}`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalResults).toBe(1);
      expect(body.Resources[0].userName).toBe('hit@x.io');
    });

    it('filter id eq → direct lookup by id', async () => {
      const u = makeUser({ email: 'byid@x.io' });
      userStore.set(u.email, u);
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?filter=${encodeURIComponent(`id eq "${u.id}"`)}`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalResults).toBe(1);
      expect(body.Resources[0].id).toBe(u.id);
      expect(userManagerMock.findById).toHaveBeenCalledWith(u.id, DEFAULT_TENANT);
    });

    it('unsupported filter attribute → 400 invalidFilter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?filter=${encodeURIComponent('unsupported eq "x"')}`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().scimType).toBe('invalidFilter');
    });

    it('malformed filter syntax → 400 invalidFilter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?filter=${encodeURIComponent('userName eq')}`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().scimType).toBe('invalidFilter');
    });
  });

  describe('GET /Users — pagination (PIT-056 mapping probe)', () => {
    it('startIndex=1&count=10 → manager sees page=1, pageSize=10 (1-based passthrough)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?startIndex=1&count=10`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      expect(userManagerMock.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 10 }),
        DEFAULT_TENANT,
      );
      const body = res.json();
      expect(body.startIndex).toBe(1);
      expect(body.itemsPerPage).toBe(userStore.size); // admin stub present, page of 10 fits all
    });

    it('startIndex=0 (invalid) clamps to 1; count beyond cap clamps to 200 (SPC maxResults)', async () => {
      await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?startIndex=0&count=9999`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(userManagerMock.findAll).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, pageSize: 200 }),
        DEFAULT_TENANT,
      );
    });

    it('defaults: no query → page=1 pageSize=100', async () => {
      await app.inject({ method: 'GET', url: `${SCIM_BASE}/Users`, headers: { authorization: `Bearer ${SCIM_KEY}` } });
      expect(userManagerMock.findAll).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, pageSize: 100 }),
        DEFAULT_TENANT,
      );
    });

    it('H2: startIndex=11&count=10 → manager sees page=2 (row offset → page mapping)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users?startIndex=11&count=10`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      expect(userManagerMock.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 10 }),
        DEFAULT_TENANT,
      );
      expect(res.json().startIndex).toBe(11); // echo = requested (clamped) value
    });
  });

  describe('GET /Users/:id', () => {
    it('found → 200 User resource', async () => {
      const u = makeUser({ email: 'one@x.io' });
      userStore.set(u.email, u);
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users/${u.id}`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: u.id, userName: 'one@x.io', active: true });
    });

    it('not found → 404 scimType notFound', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/Users/00000000-0000-0000-0000-00000000dead`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().scimType).toBe('notFound');
    });
  });

  describe('PUT /Users/:id', () => {
    it('happy path → 200 with replaced name', async () => {
      const u = makeUser({ email: 'put@x.io', name: 'Old Name' });
      userStore.set(u.email, u);
      const res = await app.inject({
        method: 'PUT',
        url: `${SCIM_BASE}/Users/${u.id}`,
        headers: AUTH,
        payload: JSON.stringify({ userName: 'put@x.io', name: { formatted: 'Replaced' } }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name.formatted).toBe('Replaced');
      expect(userManagerMock.update).toHaveBeenCalled();
    });

    it('PIT-056: userName mismatch → 400 invalidValue, update NOT called', async () => {
      const u = makeUser({ email: 'imm@x.io' });
      userStore.set(u.email, u);
      const res = await app.inject({
        method: 'PUT',
        url: `${SCIM_BASE}/Users/${u.id}`,
        headers: AUTH,
        payload: JSON.stringify({ userName: 'other@x.io', name: { formatted: 'X' } }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().scimType).toBe('invalidValue');
      expect(userManagerMock.update).not.toHaveBeenCalled();
      expect(userManagerMock.changeStatus).not.toHaveBeenCalled();
    });

    it('active:false → changeStatus(suspended) + revokeAllUserSessions (batch A parity)', async () => {
      const u = makeUser({ email: 'deact@x.io' });
      userStore.set(u.email, u);
      const res = await app.inject({
        method: 'PUT',
        url: `${SCIM_BASE}/Users/${u.id}`,
        headers: AUTH,
        payload: JSON.stringify({ userName: 'deact@x.io', active: false }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(false);
      expect(userManagerMock.changeStatus).toHaveBeenCalledWith(u.id, 'suspended', DEFAULT_TENANT);
      expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith(u.id);
    });

    it('H1 regression: active:false (no name field) → response reflects FRESH suspended state', async () => {
      const u = makeUser({ email: 'stale@x.io', name: 'Same Name' });
      userStore.set(u.email, u);
      const res = await app.inject({
        method: 'PUT',
        url: `${SCIM_BASE}/Users/${u.id}`,
        headers: AUTH,
        payload: JSON.stringify({ userName: 'stale@x.io', active: false }),
      });
      expect(res.statusCode).toBe(200);
      // Pre-fix this echoed the pre-change snapshot (active:true): the
      // aliased mock let `current` absorb the changeStatus mutation.
      expect(res.json().active).toBe(false);
      expect(userManagerMock.changeStatus).toHaveBeenCalledWith(u.id, 'suspended', DEFAULT_TENANT);
    });
  });

  describe('DELETE /Users/:id', () => {
    it('PIT-056: → 204 empty + changeStatus(suspended) + revokeAllUserSessions called', async () => {
      const u = makeUser({ email: 'gone@x.io' });
      userStore.set(u.email, u);
      const res = await app.inject({
        method: 'DELETE',
        url: `${SCIM_BASE}/Users/${u.id}`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(userManagerMock.changeStatus).toHaveBeenCalledWith(u.id, 'suspended', DEFAULT_TENANT);
      expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith(u.id);
    });

    it('missing user → 404 notFound, no session revocation', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `${SCIM_BASE}/Users/00000000-0000-0000-0000-00000000dead`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().scimType).toBe('notFound');
      expect(sessionManagerMock.revokeAllUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('M1 scoped error handler', () => {
    it('invalid JSON body → 400 SCIM Error invalidSyntax (not the global envelope)', async () => {

    const res = await app.inject({
      method: 'POST',
      url: `${SCIM_BASE}/Users`,
      headers: AUTH,
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/scim+json');
    const body = res.json();
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(body.scimType).toBe('invalidSyntax');
    expect(body.status).toBe('400');
    });
  });

  // Task 3: PATCH /Users/:id (RFC 7644 §3.5.2) — parity-mapped Manager calls (R7)

  // ---------------------------------------------------------------------------

  describe('PATCH /Users/:id (T3)', () => {

    beforeEach(() => resetUserStore());

    function patchBody(operations: unknown): string {

      return JSON.stringify({

        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],

        Operations: operations,

      });

    }

    it('PIT-056: replace active=false → 200 + changeStatus(suspended, tenant) + revokeAllUserSessions', async () => {

      const u = makeUser({ email: 'patch-off@x.io' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'replace', path: 'active', value: false }]),

      });

      expect(res.statusCode).toBe(200);

      expect(res.headers['content-type']).toContain('application/scim+json');

      expect(res.json().active).toBe(false);

      expect(userManagerMock.changeStatus).toHaveBeenCalledWith(u.id, 'suspended', DEFAULT_TENANT);

      expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith(u.id);

    });

    it('replace active=true (on suspended user) → changeStatus(active), NO session revocation', async () => {

      const u = makeUser({ email: 'patch-on@x.io', status: 'suspended' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'replace', path: 'active', value: true }]),

      });

      expect(res.statusCode).toBe(200);

      expect(res.json().active).toBe(true);

      expect(userManagerMock.changeStatus).toHaveBeenCalledWith(u.id, 'active', DEFAULT_TENANT);

      expect(sessionManagerMock.revokeAllUserSessions).not.toHaveBeenCalled();

    });

    it('replace name → update called with {name: value}, response reflects it', async () => {

      const u = makeUser({ email: 'patch-name@x.io', name: 'Before' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'replace', path: 'name', value: 'After' }]),

      });

      expect(res.statusCode).toBe(200);

      expect(res.json().name.formatted).toBe('After');

      expect(userManagerMock.update).toHaveBeenCalledWith(u.id, { name: 'After' }, DEFAULT_TENANT);

    });

    it('name.formatted sub-path → update({name: value})', async () => {

      const u = makeUser({ email: 'patch-nf@x.io', name: 'Before' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'replace', path: 'name.formatted', value: 'Sub Path' }]),

      });

      expect(res.statusCode).toBe(200);

      expect(res.json().name.formatted).toBe('Sub Path');

      expect(userManagerMock.update).toHaveBeenCalledWith(u.id, { name: 'Sub Path' }, DEFAULT_TENANT);

    });

    it('multi-attr Operations → BOTH changeStatus AND update called (sequential, array order)', async () => {

      const u = makeUser({ email: 'patch-multi@x.io', name: 'Before' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([

          { op: 'replace', path: 'active', value: false },

          { op: 'replace', path: 'name', value: 'Multi Renamed' },

        ]),

      });

      expect(res.statusCode).toBe(200);

      expect(res.json().active).toBe(false);

      expect(res.json().name.formatted).toBe('Multi Renamed');

      expect(userManagerMock.changeStatus).toHaveBeenCalledWith(u.id, 'suspended', DEFAULT_TENANT);

      expect(userManagerMock.update).toHaveBeenCalledWith(u.id, { name: 'Multi Renamed' }, DEFAULT_TENANT);

      expect(sessionManagerMock.revokeAllUserSessions).toHaveBeenCalledWith(u.id);

      // R7 sequential execution: changeStatus (index 0) before update (index 1).

      const statusIdx = userManagerMock.changeStatus.mock.invocationCallOrder[0] as number;

      const updateIdx = userManagerMock.update.mock.invocationCallOrder[0] as number;

      expect(statusIdx).toBeLessThan(updateIdx);

    });

    it('unknown attribute (title) → 400 invalidPath, no manager writes (R7)', async () => {

      const u = makeUser({ email: 'patch-title@x.io' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'replace', path: 'title', value: 'CEO' }]),

      });

      expect(res.statusCode).toBe(400);

      expect(res.json().scimType).toBe('invalidPath');

      expect(userManagerMock.update).not.toHaveBeenCalled();

      expect(userManagerMock.changeStatus).not.toHaveBeenCalled();

    });

    it('remove active → 400 invalidPath (active is required)', async () => {

      const u = makeUser({ email: 'patch-rmact@x.io' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'remove', path: 'active' }]),

      });

      expect(res.statusCode).toBe(400);

      expect(res.json().scimType).toBe('invalidPath');

      expect(userManagerMock.changeStatus).not.toHaveBeenCalled();

    });

    it('replace/remove emails → 400 invalidPath (email immutable, PUT parity)', async () => {

      const u = makeUser({ email: 'patch-eml@x.io' });

      userStore.set(u.email, u);

      for (const op of ['replace', 'remove']) {

        const res = await app.inject({

          method: 'PATCH',

          url: `${SCIM_BASE}/Users/${u.id}`,

          headers: AUTH,

          payload: patchBody([{ op, path: 'emails', value: op === 'replace' ? [{ value: 'x@y.io' }] : undefined }]),

        });

        expect(res.statusCode).toBe(400);

        expect(res.json().scimType).toBe('invalidPath');

      }

      expect(userManagerMock.update).not.toHaveBeenCalled();

    });

    it("unknown op ('append') → 400 invalidPath", async () => {

      const u = makeUser({ email: 'patch-op@x.io' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'append', path: 'name', value: 'X' }]),

      });

      expect(res.statusCode).toBe(400);

      expect(res.json().scimType).toBe('invalidPath');

    });

    it("capitalized op ('Replace', Azure AD style) → 200 (case-insensitive)", async () => {

      const u = makeUser({ email: 'patch-cap@x.io', name: 'Before' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'Replace', path: 'name', value: 'Cased' }]),

      });

      expect(res.statusCode).toBe(200);

      expect(res.json().name.formatted).toBe('Cased');

    });

    it('user not found → 404 scimType notFound, no writes', async () => {

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/00000000-0000-0000-0000-00000000dead`,

        headers: AUTH,

        payload: patchBody([{ op: 'replace', path: 'active', value: false }]),

      });

      expect(res.statusCode).toBe(404);

      expect(res.json().scimType).toBe('notFound');

      expect(userManagerMock.changeStatus).not.toHaveBeenCalled();

    });

    it('missing Operations → 400 invalidValue', async () => {

      const u = makeUser({ email: 'patch-noop@x.io' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: JSON.stringify({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'] }),

      });

      expect(res.statusCode).toBe(400);

      expect(res.json().scimType).toBe('invalidValue');

    });

    it('empty Operations array → 400 invalidValue', async () => {

      const u = makeUser({ email: 'patch-empty@x.io' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([]),

      });

      expect(res.statusCode).toBe(400);

      expect(res.json().scimType).toBe('invalidValue');

    });

    it('not a PatchOp body (no schemas/Operations shape) → 400 invalidValue', async () => {

      const u = makeUser({ email: 'patch-shape@x.io' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: JSON.stringify({ active: false }),

      });

      expect(res.statusCode).toBe(400);

      expect(res.json().scimType).toBe('invalidValue');

    });

    it('T2 H1 carry-over: active=false with NO other writes → response reflects FRESH suspended state', async () => {

      const u = makeUser({ email: 'patch-fresh@x.io', name: 'Same Name' });

      userStore.set(u.email, u);

      const res = await app.inject({

        method: 'PATCH',

        url: `${SCIM_BASE}/Users/${u.id}`,

        headers: AUTH,

        payload: patchBody([{ op: 'replace', path: 'active', value: false }]),

      });

      expect(res.statusCode).toBe(200);

      // Regression lock: a pre-write snapshot would echo active:true here.

      expect(res.json().active).toBe(false);

      expect(userManagerMock.findById).toHaveBeenCalledTimes(2); // pre-check + fresh re-read

    });

  });

  describe('L1 ServiceProviderConfig carry-overs', () => {
    it('SPC declares bulk block (RFC 7644 §5 required)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/ServiceProviderConfig`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.json().bulk).toEqual({ supported: false, maxOperations: 0, maxPayloadSize: 0 });
    });

    it('SPC filter.maxResults = actual page cap (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${SCIM_BASE}/ServiceProviderConfig`,
        headers: { authorization: `Bearer ${SCIM_KEY}` },
      });
      expect(res.json().filter).toEqual({ supported: true, maxResults: 200 });
    });
  });

  // K-T2 R2: suspend guard funnelled through UserManager.changeStatus — the
  // SCIM surface must surface the refusal as an RFC 7644 Error envelope
  // via the scoped error handler, never a raw-text 500.
  describe('last-admin guard surface (K-T2)', () => {
    it('PATCH active=false on sole admin → SCIM-shaped error with LAST_ADMIN_GUARD detail', async () => {
      const u = makeUser({ email: 'last-admin@x.io' });
      userStore.set(u.email, u);
      userManagerMock.changeStatus.mockRejectedValueOnce(
        new Error('LAST_ADMIN_GUARD: cannot suspend the last active administrator of the tenant'),
      );
      const res = await app.inject({
        method: 'PATCH',
        url: `${SCIM_BASE}/Users/${u.id}`,
        headers: AUTH,
        payload: JSON.stringify({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'active', value: false }],
        }),
      });
      expect(res.headers['content-type']).toContain('application/scim+json');
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
      expect(body.detail).toContain('LAST_ADMIN_GUARD');
    });
  });

});
