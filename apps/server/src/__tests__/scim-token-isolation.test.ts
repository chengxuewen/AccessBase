import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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

// --- Mock API key rows (keyed by sha256 hash) ---

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

const DATA_KEY = 'ab_' + 'd'.repeat(32); // scopes: ['*']
const SCIM_KEY = 'ab_' + 'e'.repeat(32); // scopes: ['scim']

function makeKey(overrides: Partial<MockKeyRow>): MockKeyRow {
  return {
    id: 'key-test',
    name: 'test-key',
    prefix: 'ab_dddd',
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

const keyStore = new Map<string, MockKeyRow>();
const dataHash = createHash('sha256').update(DATA_KEY).digest('hex');
const scimHash = createHash('sha256').update(SCIM_KEY).digest('hex');
keyStore.set(dataHash, makeKey({ id: 'key-data', hash: dataHash, scopes: ['*'] }));
keyStore.set(scimHash, makeKey({ id: 'key-scim', hash: scimHash, scopes: ['scim'], prefix: 'ab_eeee' }));

// --- Identity mock ---

const hasPermission = vi.fn(async () => true);

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();

  // Mock user rows keyed by ID (used by /me handler's findById)
  const mockUsers = new Map<string, { id: string; email: string; name: string; totpEnabled: boolean }>([
    ['key-data', { id: 'key-data', email: 'data@test.local', name: 'Data User', totpEnabled: false }],
    ['key-scim', { id: 'key-scim', email: 'scim@test.local', name: 'SCIM User', totpEnabled: false }],
  ]);

  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'admin-u1', email: 'admin@test.local' }),
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      findById: vi.fn(async (id: string) => mockUsers.get(id) ?? null),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn(async () => []),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission,
      getUserEffectivePermissions: vi.fn(async () => []),
    })),
    SessionManager: vi.fn().mockImplementation(() => ({
      findSessionByToken: vi.fn().mockResolvedValue(null),
    })),
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
let jwtToken: string;

beforeAll(async () => {
  app = await buildApp();
  jwtToken = app.jwt.sign({ sub: 'admin-u1', email: 'admin@test.local' });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue(true);
});

const KEY_AUTH = (plaintext: string) => ({ authorization: `Bearer ${plaintext}` });

describe('SCIM token scope isolation', () => {
  describe('data key (scopes: ["*"]) — regression', () => {
    it('GET /api/v1/users → 200', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: KEY_AUTH(DATA_KEY),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('GET /api/v1/auth/me → 200', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: KEY_AUTH(DATA_KEY),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  describe('scim key (scopes: ["scim"]) — new enforcement', () => {
    it('GET /api/v1/users → 403 PERM_003 (scope denied)', async () => {
      // RED before wiring: currently returns 200 (apikey branch bypasses permission).
      // After wiring: requirePermission denies scim-only keys on data routes.
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: KEY_AUTH(SCIM_KEY),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('PERM_003');
      expect(res.json().error.message).toBe('Insufficient token scope');
    });

    it('GET /api/v1/auth/me → 200 (self-service exempt from requirePermission)', async () => {
      // /me only uses authenticate (no requirePermission) — both scopes pass.
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: KEY_AUTH(SCIM_KEY),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('hasPermission is NOT called for apikey requests (scope check short-circuits)', async () => {
      // Scim key hits scope check BEFORE requirePermission would call hasPermission.
      await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: KEY_AUTH(SCIM_KEY),
      });
      expect(hasPermission).not.toHaveBeenCalled();
    });
  });
});
