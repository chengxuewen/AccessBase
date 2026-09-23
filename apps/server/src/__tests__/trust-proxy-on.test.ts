/**
 * Batch P W1-5 (positive half): TRUST_PROXY=true must actually reach Fastify.
 * Before the fix the config value existed but the framework was built without
 * `trustProxy`, so request.ip was always the socket peer — in containerized
 * deployments every client collapses onto the proxy address (rate limit /
 * lockout / audit IP all degrade). config.ts evaluates env at module load and
 * vitest hoists static imports, so the env is stubbed before a DYNAMIC import
 * of the app graph. One buildApp per file (metrics default-collector registry
 * is module-global; double registration throws within a single worker).
 */
import { describe, it, expect, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
vi.stubEnv('TRUST_PROXY', 'true');

const noopAudit = { write: async () => undefined };

describe('trustProxy wired (TRUST_PROXY=true)', () => {
  it('honors X-Forwarded-For', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp({ auditStorage: noopAudit });
    app.get('/health/ip-probe', (request) => ({ ip: request.ip }));
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/health/ip-probe',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(res.json<{ ip: string }>().ip).toBe('203.0.113.7');
    await app.close();
  });
});
