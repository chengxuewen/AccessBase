import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// Fake pool-owning db: execute succeeds, end flips a flag so leak assertions
// can prove the process-lifetime pool was actually ended.
function makeFakeDb() {
  const db = {
    execute: vi.fn().mockResolvedValue([]),
    end: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(),
    closer: () => db.end(),
  };
  return db;
}

const fakeDb = makeFakeDb();
const createDbSpy = vi.fn(() => fakeDb);
const closeDbSpy = vi.fn((db: unknown) => (db as { closer: () => Promise<void> }).closer());

vi.mock('@accessbase/identity/db', () => ({
  createDb: createDbSpy,
  closeDb: closeDbSpy,
}));

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

describe('L-M D1: /health/ready pools', () => {
  beforeEach(() => {
    createDbSpy.mockClear();
    closeDbSpy.mockClear();
  });

  let app: App;
  afterEach(async () => {
    await app?.close();
  });

  it('sequential probes share ONE pool (createDb called once)', async () => {
    app = await buildApp();
    const before = createDbSpy.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect([200, 503]).toContain(res.statusCode);
    }
    // redis may be down in test env (503) — irrelevant: the DB probe ran once
    expect(createDbSpy.mock.calls.length - before).toBe(1);
  });

  it('concurrent first probes share ONE pool (memoized promise)', async () => {
    app = await buildApp();
    const before = createDbSpy.mock.calls.length;
    await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: 'GET', url: '/health/ready' })),
    );
    expect(createDbSpy.mock.calls.length - before).toBe(1);
  });

  it('close ends the pool and resets the singleton (rebuild gets fresh pool, no ended-pool reuse)', async () => {
    app = await buildApp();
    const beforeProbe = createDbSpy.mock.calls.length;
    await app.inject({ method: 'GET', url: '/health/ready' });
    expect(createDbSpy.mock.calls.length - beforeProbe).toBe(1);

    const beforeClose = closeDbSpy.mock.calls.length;
    await app.close();
    expect(closeDbSpy.mock.calls.length - beforeClose).toBe(1);
    expect(closeDbSpy.mock.lastCall?.[0]).toBe(fakeDb);
    expect(fakeDb.end).toHaveBeenCalled();

    app = await buildApp();
    const beforeRebuild = createDbSpy.mock.calls.length;
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect([200, 503]).toContain(res.statusCode);
    expect(createDbSpy.mock.calls.length - beforeRebuild).toBe(1); // NEW pool
  });
});
