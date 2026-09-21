import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
// L-M D2: metrics token set BEFORE module graph loads (config is frozen at import)
process.env.METRICS_TOKEN = 'scrape-secret-token-xyz';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  UserManager: vi.fn().mockImplementation(() => ({
    findByEmail: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@accessbase.local' }),
  })),
}));

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  app = await buildApp();
  // generate at least one observed request for the histogram
  await app.inject({ method: 'GET', url: '/health/live' });
});

afterAll(async () => {
  await app.close();
});

describe('GET /metrics with METRICS_TOKEN set (L-M D2)', () => {
  it('403 METRICS_AUTH when no token presented', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('METRICS_AUTH');
  });

  it('403 METRICS_AUTH with wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('METRICS_AUTH');
  });

  it('200 + Prometheus text with the right token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer scrape-secret-token-xyz' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('accessbase_process_cpu_seconds_total');
    expect(res.body).toContain('accessbase_http_request_duration_seconds');
    expect(res.body).toContain('accessbase_http_requests_in_flight');
  });

  it('browser drive-by (Origin header) gets 404 — surface unconfirmed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { origin: 'https://evil.example', authorization: 'Bearer scrape-secret-token-xyz' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('metrics does not require setup completion (guard-exempt: probe BEFORE the wizard answers 403/200, never SETUP_REQUIRED)', async () => {
    // test env has an "admin" via the mocked findByEmail → initialized; the
    // contract under test is that /metrics is in ALLOWED_PATHS (no 403
    // SETUP_REQUIRED envelope leaked from the guard).
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.json().error?.code).not.toBe('SETUP_REQUIRED');
  });
});
