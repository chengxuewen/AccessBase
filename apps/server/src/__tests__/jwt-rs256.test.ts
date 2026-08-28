import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Generate test RSA key fixtures (gitignored) BEFORE app import so config sees the paths
const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(fixturesDir, { recursive: true });
const privatePath = resolve(fixturesDir, 'test-private.pem');
const publicPath = resolve(fixturesDir, 'test-public.pem');
if (!existsSync(privatePath) || !existsSync(publicPath)) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(privatePath, privateKey);
  writeFileSync(publicPath, publicKey);
}
process.env.JWT_PRIVATE_KEY_PATH = privatePath;
process.env.JWT_PUBLIC_KEY_PATH = publicPath;

// Mock plugins that require fastify@5 but fastify@4 is installed
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      verifyPassword: vi.fn().mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'admin@test.local',
      }),
      findById: vi.fn().mockResolvedValue({ id: 'u1', email: 'e', name: 'n', status: 'active' }),
    })),
  };
});

const { buildApp, setSetupComplete } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  setSetupComplete(true);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('JWT RS256 (key paths configured)', () => {
  it('issues a token signed with RS256 that the protected route accepts', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@test.local', password: 'x' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().data.accessToken;

    // Decode header without verification
    const decoded = app.jwt.decode(token, { complete: true });
    expect(decoded.header.alg).toBe('RS256');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a tampered token with 401', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@test.local', password: 'x' },
    });
    const token = login.json().data.accessToken;
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
    const tampered = parts.join('.');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
