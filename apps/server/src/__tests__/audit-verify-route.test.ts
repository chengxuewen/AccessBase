/**
 * R-audit Task A6: GET /api/v1/audit-logs/verify route tests (spec D7).
 *
 * Belt: non-default tenant → 403 TENANT_PLATFORM_ONLY (tenants.ts inline
 * pattern); default tenant → 200 envelope (chainOk:false is STILL 200 —
 * health-report posture); malformed window → 400. The verify service is
 * mocked — its logic lives in audit-verify.test.ts; here we lock the route
 * wiring (belt, validation, envelope passthrough).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const verifyMock = vi.fn();
vi.mock('../utils/audit-verify.js', () => ({
  verifyAuditChain: (...args: unknown[]) => verifyMock(...args),
  DEFAULT_MAX_ROWS: 100_000,
}));

const dbMock = { select: vi.fn() };

vi.mock('@accessbase/identity/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity/db')>()),
  createDb: vi.fn(() => dbMock),
}));

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
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

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

const TENANT_B = '22222222-2222-2222-2222-222222222222';

function authedInject(url: string, claims: Record<string, unknown> = {}) {
  const token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', ...claims });
  return app.inject({
    method: 'GET',
    url,
    remoteAddress: '10.255.9.1', // PIT-083: dedicated bucket, not the shared 127.0.0.1 one
    headers: { authorization: `Bearer ${token}` },
  });
}

const GREEN_REPORT = {
  from: '2026-09-01',
  to: '2026-09-28',
  rowsChecked: 5,
  rowsErased: 0,
  erasedLegacyUnhashed: 0,
  legacyPreChain: 2,
  anchorsChecked: 1,
  prunedAnchors: 0,
  prunedFrom: null,
  unanchoredRows: 0,
  chainOk: true,
  firstFailure: null,
  partial: false,
  durationMs: 3,
};

beforeAll(async () => {
  verifyMock.mockResolvedValue(GREEN_REPORT);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/audit-logs/verify', () => {
  it('platform belt: non-default tenant → 403 TENANT_PLATFORM_ONLY, service never called', async () => {
    verifyMock.mockClear();
    const res = await authedInject('/api/v1/audit-logs/verify', { tenantId: TENANT_B });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('TENANT_PLATFORM_ONLY');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('default tenant → 200 envelope passthrough (health-report posture)', async () => {
    const res = await authedInject('/api/v1/audit-logs/verify');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.chainOk).toBe(true);
    expect(body.data.anchorsChecked).toBe(1);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    const opts = verifyMock.mock.calls[0]?.[1] as { from: string; to: string };
    // defaults: last 30 days
    const from = new Date(opts.from);
    const to = new Date(opts.to);
    const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
    expect(spanDays).toBeGreaterThanOrEqual(29);
    expect(spanDays).toBeLessThanOrEqual(30);
  });

  it('chainOk:false is STILL 200 with the failure in the envelope', async () => {
    verifyMock.mockResolvedValueOnce({
      ...GREEN_REPORT,
      chainOk: false,
      firstFailure: { day: '2026-09-28', seq: 1, kind: 'row-mismatch', rowId: 'r-9' },
    });
    const res = await authedInject('/api/v1/audit-logs/verify?from=2026-09-28&to=2026-09-28');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.chainOk).toBe(false);
    expect(res.json().data.firstFailure.kind).toBe('row-mismatch');
  });

  it('malformed from/to → 400', async () => {
    const res = await authedInject('/api/v1/audit-logs/verify?from=not-a-date&to=2026-09-28');
    expect(res.statusCode).toBe(400);
  });

  it('window > 90 days → 400', async () => {
    const res = await authedInject(
      '/api/v1/audit-logs/verify?from=2026-01-01&to=2026-09-28',
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_001');
  });

  it('to < from (inverted window) → 400', async () => {
    const res = await authedInject(
      '/api/v1/audit-logs/verify?from=2026-09-28&to=2026-09-01',
    );
    expect(res.statusCode).toBe(400);
  });

  it('routePermissions resolves audit:read via the prefix mechanism (static)', async () => {
    const { getRequiredPermission } = await import('@accessbase/identity');
    expect(getRequiredPermission('GET', '/api/v1/audit-logs/verify')).toBe('audit:read');
  });
});
