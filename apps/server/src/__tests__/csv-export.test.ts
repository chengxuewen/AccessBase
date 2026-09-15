/**
 * Batch C Task 5 — CSV export module + audit/users export endpoints.
 *
 * toCsv contract per addendum #5: RFC4180 quoting + formula-injection guard
 * for cells starting with =+-@. Export endpoints ride the EXISTING permission
 * mappings (GET:/api/v1/audit-logs → audit:read, GET:/api/v1/users → users:read
 * via prefix truncation) — no new mapping keys. R7: audit routes gain the
 * previously missing requirePermission gate.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

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

// Audit db seam (same shape as audit-logs.test.ts): awaiting where() yields a
// count row (setup-guard seam), chaining orderBy/limit/offset yields data rows.
const auditRows: Record<string, unknown>[] = [];
const dbMock = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  select: vi.fn(() => ({
    from: () => ({
      where: () =>
        Object.assign(Promise.resolve([{ total: 1 }]), {
          orderBy: () => ({
            limit: () => ({ offset: () => Promise.resolve(auditRows) }),
          }),
        }),
    }),
  })),
};

vi.mock('@accessbase/identity/db', () => ({
  createDb: vi.fn(() => dbMock),
  auditLogs: {},
}));

// Mutable permission verdict + manager mocks
const allow = { value: true };
const mockFindAll = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 500, totalPages: 0 });
const mockGetUserRoles = vi.fn().mockResolvedValue([]);

vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  UserManager: vi.fn().mockImplementation(() => ({
    findAll: mockFindAll,
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
  })),
  RoleManager: vi.fn().mockImplementation(() => ({
    getUserRoles: mockGetUserRoles,
  })),
  PermissionManager: vi.fn().mockImplementation(() => ({
    hasPermission: vi.fn(async () => allow.value),
  })),
}));

import { toCsv } from '../utils/csv.js';

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

function authedGet(url: string) {
  const token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', email: 'admin@test.local' });
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('toCsv', () => {
  it('serializes headers verbatim and one row per line (CRLF, RFC4180)', () => {
    expect(toCsv(['a', 'b'], [{ a: '1', b: '2' }, { a: '3', b: '4' }])).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('quotes cells containing comma, quote, or newline and doubles inner quotes', () => {
    expect(toCsv(['x'], [{ x: 'a,"b"' }])).toBe('x\r\n"a,""b"""');
    expect(toCsv(['x'], [{ x: 'line1\nline2' }])).toBe('x\r\n"line1\nline2"');
  });

  it('prefixes cells starting with =, +, -, or @ with a single quote (injection guard)', () => {
    const out = toCsv(['c'], [{ c: '=cmd' }, { c: '+1' }, { c: '-1' }, { c: '@x' }, { c: 'safe' }]);
    expect(out).toBe('c\r\n\'=cmd\r\n\'+1\r\n\'-1\r\n\'@x\r\nsafe');
  });

  it('emits only the header row for empty rows and empty string for nullish cells', () => {
    expect(toCsv(['h1', 'h2'], [])).toBe('h1,h2');
    expect(toCsv(['h1', 'h2'], [{ h1: null }])).toBe('h1,h2\r\n,');
  });
});

describe('GET /api/v1/audit-logs/export', () => {
  it('403 PERM_001 without audit:read (R7: audit routes require the permission gate)', async () => {
    allow.value = false;
    const res = await authedGet('/api/v1/audit-logs/export');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERM_001');
    allow.value = true;
  });

  it('streams CSV with download headers and list-shaped mapped columns', async () => {
    auditRows.length = 0;
    auditRows.push(
      {
        id: 'a-1',
        action: 'POST /api/v1/users',
        userId: 'u-1',
        resourceType: 'user',
        resourceId: 'u-9',
        ip: '10.0.0.1',
        responseStatus: 201,
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    );

    const res = await authedGet('/api/v1/audit-logs/export');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.body.split('\r\n');
    expect(lines[0]).toBe('id,action,actor,resource,status,ipAddress,createdAt');
    expect(lines[1]).toBe('a-1,POST /api/v1/users,u-1,user u-9,201,10.0.0.1,2026-08-31T00:00:00.000Z');
  });
});

describe('GET /api/v1/users/export', () => {
  it('403 PERM_001 when users:read is denied', async () => {
    allow.value = false;
    const res = await authedGet('/api/v1/users/export');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERM_001');
    allow.value = true;
  });

  it('returns CSV with flattened user fields and comma-joined role names', async () => {
    mockFindAll.mockResolvedValue({
      data: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          email: 'test@example.com',
          name: 'Test User',
          isActive: true,
          totpEnabled: false,
          status: 'active',
          tenantId: '00000000-0000-0000-0000-000000000001',
          tokenVersion: 0,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 500,
      totalPages: 1,
    });
    mockGetUserRoles.mockResolvedValue([
      { id: '550e8400-e29b-41d4-a716-4466554400aa', name: 'admin' },
      { id: '550e8400-e29b-41d4-a716-4466554400bb', name: 'auditor' },
    ]);

    const res = await authedGet('/api/v1/users/export');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="users-\d{4}-\d{2}-\d{2}\.csv"$/);
    // Export rides the existing list query path, OFFSET pages of 500
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 500 }),
      '00000000-0000-0000-0000-000000000001',
    );
    const lines = res.body.split('\r\n');
    expect(lines[0]).toBe('id,email,name,status,isActive,totpEnabled,tenantId,roles,createdAt,updatedAt');
    // 'admin,auditor' contains commas → RFC4180-quoted as one cell
    expect(lines[1]).toBe(
      '550e8400-e29b-41d4-a716-446655440001,test@example.com,Test User,active,true,false,' +
        '00000000-0000-0000-0000-000000000001,"admin,auditor",2026-01-01T00:00:00.000Z,2026-01-01T00:00:00.000Z',
    );
  });
});
