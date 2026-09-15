import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// In-memory key store keyed by sha256(token) — dual-read looks keys up by hash.
const keyStore = new Map<string, MockKeyRow>();

interface MockKeyRow {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

const VALID_KEY = 'ab_' + 'a'.repeat(32);
const REVOKED_KEY = 'ab_' + 'b'.repeat(32);
const EXPIRED_KEY = 'ab_' + 'c'.repeat(32);

function makeRow(overrides: Partial<MockKeyRow>): MockKeyRow {
  return {
    id: 'key-1',
    name: 'test',
    prefix: 'ab_aaaa',
    hash: '',
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

beforeAll(() => {
  keyStore.set(
    createHash('sha256').update(VALID_KEY).digest('hex'),
    makeRow({ hash: createHash('sha256').update(VALID_KEY).digest('hex') }),
  );
  keyStore.set(
    createHash('sha256').update(REVOKED_KEY).digest('hex'),
    makeRow({ id: 'key-2', hash: createHash('sha256').update(REVOKED_KEY).digest('hex'), revokedAt: new Date() }),
  );
  keyStore.set(
    createHash('sha256').update(EXPIRED_KEY).digest('hex'),
    makeRow({
      id: 'key-3',
      hash: createHash('sha256').update(EXPIRED_KEY).digest('hex'),
      expiresAt: new Date(Date.now() - 1000),
    }),
  );
});

// Mutable permission verdict for requirePermission (must stay mutable for the
// authorization-through case: allow.value = true).
const allow = { value: true };
const hasPermission = vi.fn(async () => allow.value);

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    // D113: setup guard queries the users table — mock admin as existing
UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
})),
    PermissionManager: vi.fn().mockImplementation(() => ({ hasPermission })),
    // SessionManager: the dual-read authenticate path never touches it, but
    // keep the mock symmetric with sibling suites.
    SessionManager: vi.fn().mockImplementation(() => ({
      findSessionByToken: vi.fn().mockResolvedValue(null),
    })),
    // Preserve the isExpired static — app.ts authenticate relies on it while
    // the constructor mock replaces instance methods only.
    ApiKeyManager: Object.assign(
      vi.fn().mockImplementation(() => ({
        findByHash: vi.fn(async (hash: string) => keyStore.get(hash) ?? null),
      })),
      { isExpired: actual.ApiKeyManager.isExpired },
    ),
  };
});

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', email: 'guard@test.local' });
});

afterAll(async () => {
  await app.close();
});

const AUTH = () => ({ authorization: `Bearer ${token}` });
const KEY_AUTH = (plaintext: string) => ({ authorization: `Bearer ${plaintext}` });

beforeEach(() => {
  allow.value = true;
  hasPermission.mockClear();
});

describe('authenticate dual-read (ab_ prefix → ApiKeyManager)', () => {
  it('valid ab_ key on GET /api/v1/users → 200 (R4: authorization through)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: KEY_AUTH(VALID_KEY) });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it('valid ab_ key skips requirePermission DB check (apikey branch early-return)', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/users', headers: KEY_AUTH(VALID_KEY) });
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('revoked ab_ key → 401 AUTH_001', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: KEY_AUTH(REVOKED_KEY) });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_001');
    expect(res.json().error.message).toBe('Invalid API key');
  });

  it('expired ab_ key → 401 AUTH_001', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: KEY_AUTH(EXPIRED_KEY) });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_001');
  });

  it('unknown ab_ key → 401 AUTH_001', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: KEY_AUTH('ab_' + 'f'.repeat(32)),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_001');
  });

  it('garbage non-ab_ token → 401 AUTH_001 unchanged (JWT path)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: KEY_AUTH('garbage-token') });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_001');
    expect(res.json().error.message).toBe('Missing or invalid token');
  });

  it('valid JWT still authenticates (non-ab_ path byte-identical)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: AUTH() });

    expect(res.statusCode).toBe(200);
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'users:read',
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('authenticate uses ApiKeyManager.findByHash for ab_ tokens (static: prefix check precedes jwtVerify)', () => {
    const src = readFileSync('apps/server/src/app.ts', 'utf8');
    expect(src).toMatch(/startsWith\(['"`]ab_/);
    expect(src).toContain('findByHash');
    expect(src).toContain("type: 'apikey'");
    expect(src).toContain("scopes: ['*']");
  });
});
