import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// Mutable permission verdict shared by the mocked PermissionManager:
//   true  → requirePermission passes through to the handler
//   false → requirePermission replies 403 PERM_001
const allow = { value: true };
const hasPermission = vi.fn(async () => allow.value);

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    })),
    PermissionManager: vi.fn().mockImplementation(() => ({ hasPermission })),
  };
});

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: '550e8400-e29b-41d4-a716-446655440000', email: 'guard@test.local' });
});

afterAll(async () => {
  await app.close();
});

const AUTH = () => ({ authorization: `Bearer ${token}` });

describe('requirePermission preHandler', () => {
  it('403 envelope when permission is denied', async () => {
    allow.value = false;
    hasPermission.mockClear();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/550e8400-e29b-41d4-a716-446655440000',
      headers: AUTH(),
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PERM_001');
    expect(body.error.message).toBe('Insufficient permissions');
    // nested id resolved to the users root mapping → users:delete
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'users:delete',
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('passes through to the handler when permission is granted', async () => {
    allow.value = true;
    hasPermission.mockClear();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: AUTH(),
    });

    expect(res.statusCode).toBe(200);
    expect(hasPermission).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'users:read',
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('skips enforcement for unmapped paths (no hasPermission call)', async () => {
    allow.value = false;
    hasPermission.mockClear();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
      headers: AUTH(),
    });

    expect(res.statusCode).not.toBe(403);
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('still returns 401 without a token (authenticate runs first)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/roles' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_001');
  });
});

describe('startup side-effect containment (post-review fix)', () => {
  it('buildApp factory carries no permission-seed import (no PG dial in tests)', () => {
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect(src).not.toMatch(/permissions-seed|ensureSeedForAdmin|selfHealSeed/);
  });

  it('production entry owns the self-heal call', () => {
    const src = readFileSync(resolve(__dirname, '../index.ts'), 'utf-8');
    expect(src).toMatch(/selfHealSeed\(config\.databaseUrl\)/);
  });
});
