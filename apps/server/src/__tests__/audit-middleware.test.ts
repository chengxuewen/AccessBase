/**
 * Audit middleware integration test — explicit opt-in wiring.
 *
 * buildApp({ auditStorage }) injects an in-memory AuditStorage so the middleware
 * runs in test env (default test-env skip kept for other suites).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AuditLog, AuditStorage } from '@accessbase/audit';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// D113: the setup guard now queries the users table via UserManager on every request.
// Mock it (admin exists → guard passes; login POST reaches the audit middleware).
vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  UserManager: vi.fn().mockImplementation(() => ({
    findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
  })),
}));

// In-memory AuditStorage — captures what AuditLogger hands off.
class MemoryAuditStorage implements AuditStorage {
  readonly entries: AuditLog[] = [];
  async write(entries: AuditLog[]): Promise<void> {
    this.entries.push(...entries);
  }
}

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

describe('audit middleware (integration, injected storage)', () => {
  let app: App;
  const storage = new MemoryAuditStorage();

  beforeAll(async () => {
    app = await buildApp({ auditStorage: storage as never });
  });

  afterAll(async () => {
    await app.close();
  });

  it('captures an audit entry for a write request to /api/v1/auth/login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'wrong-password' },
    });

    // Login route exists (200/401/403/429 acceptable); audit entry must exist regardless.
    expect([200, 401, 403, 429]).toContain(res.statusCode);


    // audit onResponse hook writes synchronously (async disabled) — tiny settle window.
    await new Promise((r) => setTimeout(r, 20));

    const audited = storage.entries[storage.entries.length - 1];

    expect(audited).toBeDefined();
    expect(audited?.action).toBe('CREATE'); // POST → CREATE via middleware mapping
    expect(typeof audited?.responseStatus).toBe('number');
    expect(typeof audited?.requestId).toBe('string');
    expect(audited?.requestId).toMatch(/^[0-9a-f-]{36}$/); // uuid v4 from genReqId
  });

  it('does not audit GET requests (write-only middleware)', async () => {
    storage.entries.length = 0;
    await app.inject({ method: 'GET', url: '/health/live' });
    await new Promise((r) => setTimeout(r, 50));
    expect(storage.entries.length).toBe(0);
  });
});
