/**
 * 4A T2 — audit export destination route GATE locks (P-5=A). The guard stack
 * (apikey deny → platform belt → url gates) is the PC-3 fix: these tests
 * prove the leak paths are closed BEFORE any database access (db-free — the
 * guards run ahead of every query). Create-success round-trip = e2e/integration
 * ledger.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type * as identityModule from '@accessbase/identity';

// PermissionManager stubbed to ALLOW — the gates under test run AFTER the
// generic permission check (in-handler), so the route-level locks below are
// independent of RBAC state. PIT-082: spread the actual module, never proxy.
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof identityModule>();
  class PermissionManagerStub {
    async hasPermission(): Promise<boolean> {
      return true;
    }
  }
  return { ...actual, PermissionManager: PermissionManagerStub };
});

const { auditExportRoutes } = await import('../routes/audit-export.js');
const { DEFAULT_TENANT } = await import('../utils/constants.js');

interface Auth {
  type?: string;
  tenantId?: string;
}

async function buildApp(auth: Auth): Promise<FastifyInstance> {
  const app = Fastify();
  // The plugin now runs the real authenticate hook — decorate a no-op (the
  // onRequest fake below supplies the identity the guards read).
  app.decorate('authenticate', async () => {});
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user?: unknown }).user = { sub: 'u1', type: auth.type };
    (req as unknown as { tenantId?: string }).tenantId = auth.tenantId ?? DEFAULT_TENANT;
  });
  await app.register(auditExportRoutes);
  await app.ready();
  return app;
}

const PLATFORM = DEFAULT_TENANT;
const FOREIGN_TENANT = '00000000-0000-4000-8000-00000000dead';

async function appAt(apps: FastifyInstance[], i: number): Promise<FastifyInstance> {
  const a = apps[i];
  if (!a) throw new Error(`app ${i} missing`);
  return a;
}

describe('audit export destination gates (P-5=A / PC-3)', () => {
  const apps: FastifyInstance[] = [];
  beforeAll(async () => {
    apps.push(
      await buildApp({ type: 'apikey', tenantId: PLATFORM }),
      await buildApp({ type: undefined, tenantId: FOREIGN_TENANT }),
      await buildApp({ type: undefined, tenantId: PLATFORM }),
    );
  });
  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it('API keys can NEVER create an export channel (phished-key re-point guard)', async () => {
    const res = await (await appAt(apps, 0)).inject({
      method: 'POST',
      url: '/audit-export',
      payload: { url: 'https://siem.example/audit' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERM_002');
  });

  it('non-platform tenants can NEVER register destinations (PC-3 structural fix)', async () => {
    const res = await (await appAt(apps, 1)).inject({
      method: 'POST',
      url: '/audit-export',
      payload: { url: 'https://siem.example/audit' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('TENANT_PLATFORM_ONLY');
  });

  it('plaintext http destination rejected (F-14)', async () => {
    const res = await (await appAt(apps, 2)).inject({
      method: 'POST',
      url: '/audit-export',
      payload: { url: 'http://siem.example/audit' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUDIT_EXPORT_URL_HTTP');
  });

  it('denied-ip literal destination rejected (F-05 registration leg)', async () => {
    const res = await (await appAt(apps, 2)).inject({
      method: 'POST',
      url: '/audit-export',
      payload: { url: 'https://169.254.169.254/latest/meta-data' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUDIT_EXPORT_URL_DENIED');
  });

  it('missing url rejected before any storage touch', async () => {
    const res = await (await appAt(apps, 2)).inject({
      method: 'POST',
      url: '/audit-export',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUDIT_EXPORT_INVALID');
  });
});
