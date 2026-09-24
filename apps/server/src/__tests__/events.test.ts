/**
 * Q4d GET /api/v1/events read-surface tests. Mirrors audit-logs.test.ts:
 * real table defs (only createDb faked) + filterByTenant inspects the actual
 * tenant predicate SQL, so the K-T1 read isolation is exercised, not mocked
 * away. The data-path chain adds a secondary id desc ordering (audit has one).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { filterByTenant } from './helpers/tenant-where.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const dbMock = { insert: vi.fn().mockReturnThis(), values: vi.fn(), select: vi.fn() };

vi.mock('@accessbase/identity/db', async (importOriginal) => ({
  // real table defs (tenant predicates render to inspectable SQL); only the
  // connection factory is faked. importOriginal() spread untyped to avoid the
  // consistent-type-imports lint on a typeof-import annotation.
  ...((await importOriginal()) as Record<string, unknown>),
  createDb: vi.fn(() => dbMock),
}));

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn().mockResolvedValue(true),
    })),
  };
});

const { buildApp } = await import('../app.js');
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

let rows: Record<string, unknown>[] = [];
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function authed(url: string, claims: Record<string, unknown> = {}) {
  const token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', ...claims });
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  dbMock.select.mockImplementation(() => ({
    from: () => ({
      where: (sql: unknown) => {
        const filtered = filterByTenant(rows, sql);
        return Object.assign(Promise.resolve([{ total: filtered.length }]), {
          // list path: where().orderBy().limit().offset(); detail path: where().limit(1)
          limit: () => Promise.resolve(filtered),
          orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve(filtered) }) }),
        });
      },
    }),
  }));
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

const ev = (id: number, tenantId: string, type: string) => ({
  id,
  tenantId,
  type,
  payload: { id: `res-${id}` },
  createdAt: new Date('2026-09-18T00:00:00Z'),
  fanoutCompleteAt: tenantId === DEFAULT_TENANT ? new Date('2026-09-18T01:00:00Z') : null,
});

describe('GET /api/v1/events', () => {
  it('401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/events' });
    expect(res.statusCode).toBe(401);
  });

  it('default caller sees DEFAULT + system buckets; projection has fanoutComplete + ISO time', async () => {
    rows = [
      ev(1, DEFAULT_TENANT, 'user.created'),
      ev(2, TENANT_A, 'role.changed'),
      ev(3, 'system', 'apikey.revoked'),
    ];
    const res = await authed('/api/v1/events?page=1&pageSize=10');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.total).toBe(2); // DEFAULT + system, not TENANT_A
    const ids = (body.data as Array<{ id: number }>).map((r) => r.id).sort();
    expect(ids).toEqual([1, 3]);
    const def = (body.data as Array<Record<string, unknown>>).find((r) => r.id === 1);
    expect(def).toBeDefined();
    expect(def).toMatchObject({ type: 'user.created', fanoutComplete: true });
    expect(typeof def?.createdAt).toBe('string');
    // payload is opaque object, never a JSON string (jsonb round-trip)
    expect(def?.payload).toEqual({ id: 'res-1' });
  });

  it('non-default tenant sees ONLY its own rows (no DEFAULT, no system, no sibling)', async () => {
    rows = [
      ev(1, DEFAULT_TENANT, 'user.created'),
      ev(2, TENANT_A, 'role.changed'),
      ev(4, TENANT_B, 'user.updated'),
      ev(3, 'system', 'apikey.revoked'),
    ];
    const res = await authed('/api/v1/events', { tenantId: TENANT_A });
    const body = res.json();
    expect(body.total).toBe(1);
    expect((body.data as Array<{ id: number }>)[0]?.id).toBe(2);
  });

  it('empty result set → total 0, data []', async () => {
    rows = [];
    const res = await authed('/api/v1/events');
    expect(res.json()).toMatchObject({ success: true, total: 0, data: [] });
  });

  it('rejects a malformed date filter with 400 (querystring schema)', async () => {
    const res = await authed('/api/v1/events?startDate=not-a-date');
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/events/:id', () => {
  it('returns the single event when the tenant owns it', async () => {
    rows = [ev(7, TENANT_A, 'group.changed')];
    const res = await authed('/api/v1/events/7', { tenantId: TENANT_A });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: 7, type: 'group.changed', fanoutComplete: false });
  });

  it('foreign id → 404 EVENT_NOT_FOUND (no existence leak across tenants)', async () => {
    rows = [ev(7, TENANT_A, 'group.changed')];
    const res = await authed('/api/v1/events/7', { tenantId: TENANT_B });
    // id path uses a tenant predicate; the mocked filterByTenant yields no row
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('EVENT_NOT_FOUND');
  });
});
