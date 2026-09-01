import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

interface IdentityService {
  UserManager: new (...args: unknown[]) => unknown;
  RoleManager: new (...args: unknown[]) => unknown;
}

// Drizzle chain mock. Table objects are distinct sentinels so the route's
// .from(table) can be dispatched per-table.
const dbMock = {
  select: vi.fn(),
  users: { __table: 'users' },
  roles: { __table: 'roles' },
  sessions: { __table: 'sessions' },
  auditLogs: { __table: 'auditLogs' },
};

vi.mock('@accessbase/identity/db', () => ({
  createDb: vi.fn(() => dbMock),
  users: dbMock.users,
  roles: dbMock.roles,
  sessions: dbMock.sessions,
  auditLogs: dbMock.auditLogs,
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
const { setStatsDb } = await import('../routes/stats.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

// Per-test fixtures consumed by the drizzle chain mock
let userRows: Record<string, unknown>[] = [];
let roleRows: Record<string, unknown>[] = [];
let sessionRows: Record<string, unknown>[] = [];
let auditCountRows: Record<string, unknown>[] = []; // count() rows for audit total
let auditRows: Record<string, unknown>[] = []; // recent activity rows

function authedInject(options: { method: 'GET'; url: string }) {
  const token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000' });
  return app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  dbMock.select.mockImplementation((selection: Record<string, unknown>) => ({
    from: (table: { __table?: string }) => {
      const key = table.__table ?? 'auditLogs';
      if (key === 'users' || key === 'roles') {
        return Promise.resolve(key === 'users' ? userRows : roleRows);
      }
      // auditLogs: count query (selection has 'value') vs recent query
      if (key === 'auditLogs' && 'value' in selection) {
        return Promise.resolve(auditCountRows);
      }
      const rows = key === 'sessions' ? sessionRows : auditRows;
      return key === 'sessions'
        ? { where: () => Promise.resolve(rows) }
        : { orderBy: () => ({ limit: (n: number) => Promise.resolve(rows.slice(0, n)) }) };
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
    userRows = [{ value: 1 }]; // drizzle count() rows
    roleRows = [{ value: 1 }];
    sessionRows = [{ value: 1 }];
    auditCountRows = [{ value: 1 }]; // audit total
    auditRows = [
      {
        id: 'a-1',
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
