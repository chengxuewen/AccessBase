import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { filterByTenant } from './helpers/tenant-where.js';

interface IdentityService {
  UserManager: new (...args: unknown[]) => unknown;
  RoleManager: new (...args: unknown[]) => unknown;
}

// Drizzle chain mock. Real table defs (via importOriginal spread below) so
// tenant predicates render to inspectable SQL: awaiting a count chain yields
// [{ value: <tenant-filtered length> }]; the recent-activity chain yields
// tenant-filtered data rows. Unscoped SQL returns every fixture row, so the
// K-T1 tests are RED until the route applies the predicate.
const dbMock = {
  select: vi.fn(),
};

vi.mock('@accessbase/identity/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity/db')>()),
  createDb: vi.fn(() => dbMock),
}));

// identity is imported by app.ts (auth/users/roles routes); spread actual, mock managers
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  };
});

const { buildApp } = await import('../app.js');
const { users: usersTable, roles: rolesTable, sessions: sessionsTable, auditLogs: auditLogsTable } =
  await import('@accessbase/identity/db');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

// Per-test fixtures consumed by the drizzle chain mock
let userRows: Record<string, unknown>[] = [];
let roleRows: Record<string, unknown>[] = [];
let sessionRows: Record<string, unknown>[] = []; // join-result rows: carry users.tenantId
let auditRows: Record<string, unknown>[] = [];

function authedInject(options: { method: 'GET'; url: string }, claims: Record<string, unknown> = {}) {
  const token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', ...claims });
  return app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  dbMock.select.mockImplementation((selection?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      const rows =
        table === usersTable ? userRows :
        table === rolesTable ? roleRows :
        table === sessionsTable ? sessionRows :
        table === auditLogsTable ? auditRows :
        [];
      const isCount = selection === undefined || 'value' in selection;
      const node = (rs: Record<string, unknown>[]): unknown =>
        isCount
          ? Object.assign(Promise.resolve([{ value: rs.length }]), {
              where: (sql: unknown) => node(filterByTenant(rs, sql)),
              innerJoin: () => ({ where: (sql: unknown) => node(filterByTenant(rs, sql)) }),
            })
          : Object.assign(Promise.resolve(rs), {
              where: (sql: unknown) => node(filterByTenant(rs, sql)),
              orderBy: () => ({ limit: (n: number) => Promise.resolve(rs.slice(0, n)) }),
            });
      return node(rows);
    },
  }));
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/stats', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/stats' });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_001');
  });

  it('returns 200 with counts + audits shape', async () => {
    userRows = [{ id: 'u-1', tenantId: DEFAULT_TENANT }];
    roleRows = [{ id: 'r-1', tenantId: DEFAULT_TENANT }];
    sessionRows = [{ id: 's-1', tenantId: DEFAULT_TENANT }];
    auditRows = [
      {
        id: 'a-1',
        tenantId: DEFAULT_TENANT,
        userId: 'u-1',
        action: 'POST /api/v1/users',
        resourceType: 'user',
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    ];

    const res = await authedInject({ method: 'GET', url: '/api/v1/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      users: 1,
      roles: 1,
      activeSessions: 1,
      audits: 1,
    });
    expect(body.data.recentActivity).toHaveLength(1);
    expect(body.data.recentActivity[0]).toMatchObject({
      id: 'a-1',
      userId: 'u-1',
      action: 'POST /api/v1/users',
      resourceType: 'user',
    });
    expect(typeof body.data.recentActivity[0].createdAt).toBe('string');
  });

  it('limits recentActivity to 10 entries', async () => {
    auditRows = Array.from({ length: 15 }, (_, i) => ({
      id: `a-${i}`,
      tenantId: DEFAULT_TENANT,
      userId: 'u-1',
      action: `ACT_${i}`,
      resourceType: 'user',
      createdAt: new Date(Date.now() + i * 1000),
    }));

    const res = await authedInject({ method: 'GET', url: '/api/v1/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.recentActivity).toHaveLength(10);
  });
});

describe('GET /api/v1/stats tenant scoping (K-T1)', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  function tenantFixture() {
    userRows = [
      { id: 'u-a1', tenantId: TENANT_A },
      { id: 'u-a2', tenantId: TENANT_A },
      { id: 'u-b1', tenantId: TENANT_B },
      { id: 'u-d1', tenantId: DEFAULT_TENANT },
    ];
    roleRows = [
      { id: 'r-a', tenantId: TENANT_A },
      { id: 'r-b', tenantId: TENANT_B },
    ];
    sessionRows = [
      { id: 's-a', tenantId: TENANT_A },
      { id: 's-b', tenantId: TENANT_B },
    ];
    const base = {
      userId: 'u-x',
      action: 'TEST act',
      resourceType: null,
      createdAt: new Date('2026-09-18T00:00:00Z'),
    };
    auditRows = [
      { id: 'a-a', tenantId: TENANT_A, ...base },
      { id: 'a-b', tenantId: TENANT_B, ...base },
      { id: 'a-d', tenantId: DEFAULT_TENANT, ...base },
      { id: 'a-s', tenantId: 'system', ...base },
    ];
  }

  it('scopes all counts and recent activity to the requester tenant', async () => {
    tenantFixture();
    const res = await authedInject({ method: 'GET', url: '/api/v1/stats' }, { tenantId: TENANT_A });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ users: 2, roles: 1, activeSessions: 1, audits: 1 });
    expect(body.data.recentActivity.map((r: { id: string }) => r.id)).toEqual(['a-a']);
  });

  it('default tenant sees own rows plus system audit events only', async () => {
    tenantFixture();
    // No tenantId claim -> request.tenantId falls back to DEFAULT_TENANT.
    const res = await authedInject({ method: 'GET', url: '/api/v1/stats' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ users: 1, roles: 0, activeSessions: 0, audits: 2 });
    expect(body.data.recentActivity.map((r: { id: string }) => r.id)).toEqual(['a-d', 'a-s']);
  });
});
