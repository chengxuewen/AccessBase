/**
 * Batch P W2-1 (report F6): /oidc/* lives in Fastify's route-less (404) space
 * via the onRequest provider hijack, so @fastify/rate-limit never engages
 * there (spec §1 minimal repro). This file pins the coarse per-IP guard that
 * replaces that gap. Harness per PIT-078: env stubs + top-level dynamic import
 * and ONE shared app instance (metrics default-collector registry is
 * module-global — a second buildApp in the same worker double-registers).
 * inject uses EXPLICIT remoteAddresses (R6): per-IP buckets must be exercised
 * by design, never by accident of the 127.0.0.1 default.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';

vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('JWT_SECRET', 'test-secret');
vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
vi.stubEnv('REDIS_URL', ''); // force the guard's deterministic in-memory path
vi.stubEnv('OIDC_IP_RATE_PER_MIN', '3');

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));
// Global limiter mocked out: any 429 below provably comes from the OIDC guard.
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));

import type { AuditStorage } from '@accessbase/audit';

const noopAudit: AuditStorage = { write: async () => undefined };

const { buildApp } = await import('../app.js');
const app = await buildApp({ auditStorage: noopAudit });
await app.ready();

afterAll(async () => {
  await app.close();
});

const tokenPost = (ip: string) =>
  app.inject({
    method: 'POST',
    url: '/oidc/token',
    remoteAddress: ip,
    payload: 'grant_type=client_credentials',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

describe('oidc hijack-space rate guard (W2-1)', () => {
  it('caps per-IP /oidc/token at the limit; first hits reach the provider; 429 is provider-shaped', async () => {
    const ip = '12.34.56.78';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await tokenPost(ip)).statusCode);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(3);
    expect([400, 401].includes(codes[0] ?? 0)).toBe(true);

    const denied = await tokenPost(ip);
    expect(denied.statusCode).toBe(429);
    expect(denied.headers['retry-after']).toBeDefined();
    expect(denied.json<{ error: string }>()).toMatchObject({ error: 'invalid_request' });
  });

  it('discovery is exempt, other IPs unaffected, exhausted bucket does not leak across IPs', async () => {
    const flooded = '12.34.99.1';
    for (let i = 0; i < 5; i++) await tokenPost(flooded);
    for (let i = 0; i < 5; i++) {
      const d = await app.inject({
        method: 'GET',
        url: '/oidc/.well-known/openid-configuration',
        remoteAddress: flooded,
      });
      expect(d.statusCode).not.toBe(429);
    }
    const other = await tokenPost('10.9.8.7');
    expect(other.statusCode).not.toBe(429);
  });

  it('interaction routes (real Fastify routes, globally limited) are NOT counted by the guard', async () => {
    const ip = '12.34.77.2';
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/oidc/interaction/anything',
        remoteAddress: ip,
        payload: {},
      });
      expect(res.statusCode).not.toBe(429);
    }
    // Same IP still reaches the provider on hijack space (bucket untouched by the 6 above).
    const through = await tokenPost(ip);
    expect(through.statusCode).not.toBe(429);
  });
});
