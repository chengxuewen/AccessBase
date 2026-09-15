import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

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

// In-memory API key store consumed by the mocked ApiKeyManager
interface MockKey {
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

const store = new Map<string, MockKey>();
let counter = 0;

// Mutable permission verdict for requirePermission
const allow = { value: true };
const hasPermission = vi.fn(async () => allow.value);

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    // D113: setup guard queries the users table — mock admin as existing
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({ hasPermission })),
    ApiKeyManager: vi.fn().mockImplementation(() => ({
      create: vi.fn(async (name: string, scopes: string[], tenantId: string, expiresAt?: Date) => {
        const id = `key-${++counter}`;
        const plaintext = `ab_plaintext${counter}${'0123456789abcdef0123456789ab'.slice(counter)}`.slice(0, 35);
        const row: MockKey = {
          id,
          name,
          prefix: plaintext.slice(0, 8),
          hash: `hash-${id}`,
          scopes,
          expiresAt: expiresAt ?? null,
          lastUsedAt: null,
          revokedAt: null,
          tenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
store.set(id, row);
        const { hash: _hash, ...safe } = row;
      return { ...safe, plaintext };
      }),
      list: vi.fn(async () =>
        [...store.values()].map(({ hash: _h, ...rest }) => rest),
      ),
      revoke: vi.fn(async (id: string) => {
        store.delete(id);
      }),
    })),
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

beforeEach(() => {
  store.clear();
  counter = 0;
  allow.value = true;
  hasPermission.mockClear();
});

describe('POST /api/v1/auth/api-keys', () => {
  it('creates a key → 201 + one-time plaintext, no hash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { name: 'CI key' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.plaintext).toBe('string');
    expect(body.data.plaintext).toMatch(/^ab_[a-z0-9]{32}$/);
    expect(body.data.name).toBe('CI key');
    expect(body.data).not.toHaveProperty('hash');
  });

  it('400 when name is missing/blank', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { name: '  ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('APIKEY_001');
  });

  it('403 PERM_001 when apikeys:write is denied', async () => {
    allow.value = false;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { name: 'CI key' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERM_001');
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'apikeys:write',
      '00000000-0000-0000-0000-000000000001',
    );
  });
});

describe('GET /api/v1/auth/api-keys', () => {
  it('lists keys without hash material', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { name: 'k1' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/api-keys', headers: AUTH() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toHaveProperty('prefix');
    expect(body.data[0]).not.toHaveProperty('hash');
    expect(JSON.stringify(body)).not.toContain('plaintext');
  });

  it('403 PERM_001 when apikeys:read is denied', async () => {
    allow.value = false;

    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/api-keys', headers: AUTH() });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERM_001');
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'apikeys:read',
      '00000000-0000-0000-0000-000000000001',
    );
  });
});

describe('DELETE /api/v1/auth/api-keys/:id', () => {
  it('revokes → 200 envelope', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { ...AUTH(), 'content-type': 'application/json' },
      payload: { name: 'to-revoke' },
    });
    const id = created.json().data.id as string;

    const res = await app.inject({ method: 'DELETE', url: `/api/v1/auth/api-keys/${id}`, headers: AUTH() });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(store.has(id)).toBe(false);
  });

  it('403 PERM_001 when apikeys:delete is denied (resolved via prefix truncation)', async () => {
    allow.value = false;

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/api-keys/key-1',
      headers: AUTH(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERM_001');
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'apikeys:delete',
      '00000000-0000-0000-0000-000000000001',
    );
  });
});

describe('dual-registration static checks (conventions Phase 8a discipline)', () => {
  it('authorize.ts routePermissions maps all 3 api-key routes', () => {
    const src = readFileSync('packages/identity/src/hooks/authorize.ts', 'utf8');
    expect(src).toContain("'GET:/api/v1/auth/api-keys': 'apikeys:read'");
    expect(src).toContain("'POST:/api/v1/auth/api-keys': 'apikeys:write'");
    expect(src).toContain("'DELETE:/api/v1/auth/api-keys': 'apikeys:delete'");
  });

  it('seed contains the 3 apikeys entries AND RESOURCES has apikeys', () => {
    const src = readFileSync('apps/server/src/routes/permissions-seed.ts', 'utf8');
    expect(src).toContain("name: 'apikeys:read'");
    expect(src).toContain("name: 'apikeys:write'");
    expect(src).toContain("name: 'apikeys:delete'");
    expect(src).toMatch(/RESOURCES = \[[^\]]*'apikeys'/);
  });
});
