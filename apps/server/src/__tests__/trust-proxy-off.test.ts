/**
 * Batch P W1-5 (negative half): TRUST_PROXY unset/false (default) keeps
 * X-Forwarded-For out of request.ip — spoofing protection intact for
 * deployments without a sanitizing reverse proxy.
 */
import { describe, it, expect, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
vi.stubEnv('TRUST_PROXY', 'false');

const noopAudit = { write: async () => undefined };

describe('trustProxy off by default (W1-5 opt-in preserved)', () => {
  it('ignores X-Forwarded-For when TRUST_PROXY=false', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp({ auditStorage: noopAudit });
    app.get('/health/ip-probe', (request) => ({ ip: request.ip }));
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/health/ip-probe',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(res.json<{ ip: string }>().ip).not.toBe('203.0.113.7');
    await app.close();
  });
});
