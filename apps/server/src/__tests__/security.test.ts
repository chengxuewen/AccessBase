import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      verifyPassword: vi.fn().mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'admin@test.local',
      }),
    })),
  };
});

const { buildApp, setSetupComplete } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  // Setup guard blocks everything except whitelisted paths until setup is complete.
  // Rate-limit and envelope tests need setup complete to reach the routes.
  setSetupComplete(true);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('Rate limit (real @fastify/rate-limit, unmocked)', () => {
  it('returns 429 on the 11th login request within one minute', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@test.local', password: 'wrong-password' },
      });
      statuses.push(res.statusCode);
    }
    // First 10 requests pass the limit (400 from validation, not 429)
    expect(statuses.slice(0, 10)).not.toContain(429);
    // 11th request hits the rate limit
    expect(statuses[10]).toBe(429);
  });
});

describe('Helmet headers (real @fastify/helmet, unmocked)', () => {
  it('sets x-frame-options on responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('CORS whitelist', () => {
  it('rejects unknown origin (no ACAO header) when CORS_ORIGINS is set', async () => {
    // Set whitelist and reset module cache to re-evaluate config
    process.env.CORS_ORIGINS = 'http://localhost:5173';
    vi.resetModules();
    const { resolveCorsOrigin } = await import('../cors.js');
    const originFn = resolveCorsOrigin();
    expect(typeof originFn).toBe('function');

    // The callback should reject evil origin
    let allowed = false;
    (originFn as (origin: string | undefined, cb: (err: null, allow: boolean) => void) => void)(
      'http://evil.com',
      (_err, allow) => { allowed = allow; },
    );
    expect(allowed).toBe(false);

    // The callback should allow whitelisted origin
    let allowedWhitelisted = false;
    (originFn as (origin: string | undefined, cb: (err: null, allow: boolean) => void) => void)(
      'http://localhost:5173',
      (_err, allow) => { allowedWhitelisted = allow; },
    );
    expect(allowedWhitelisted).toBe(true);
  });

  it('reflects all origins in dev fallback (CORS_ORIGINS empty)', async () => {
    delete process.env.CORS_ORIGINS;
    vi.resetModules();
    const { resolveCorsOrigin } = await import('../cors.js');
    const originFn = resolveCorsOrigin();
    expect(originFn).toBe(true); // dev fallback: origin:true reflects all
  });
});

describe('Error envelope enrichment', () => {
  it('404 responses include success, error.code, error.message, timestamp, requestId, path', async () => {
    const testUrl = '/api/v1/nonexistent-route-' + Date.now();
    const res = await app.inject({ method: 'GET', url: testUrl });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBeDefined();
    expect(typeof body.timestamp).toBe('string');
    expect(body.requestId).toBeDefined();
    expect(body.path).toBe(testUrl);
  });
});
