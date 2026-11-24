/**
 * 4A T2 — audit export destination CRUD (/api/v1/audit-export, spec rev.4
 * §3 T2; ruling P-5=A). PLATFORM-LEVEL by construction: NO tenantId exists —
 * the cross-tenant export leak (panel run 2 PC-3) is structurally impossible,
 * not merely gated.
 *
 * Gate stack per handler (sec M-2, in order):
 *   1. requirePermission preHandler (routePermissions → options:write — the
 *      runtime-configuration writer code; a dedicated audit_export:write code
 *      + seed/partition ripple is ledgered, options:write carries the same
 *      "platform operator changes runtime wiring" semantics).
 *   2. inline APIKEY deny — '*' keys pass the generic gate but must never
 *      create export channels (a phished key could re-point the audit stream).
 *   3. inline platform belt (TENANT_PLATFORM_ONLY, audit-verify precedent).
 *   4. url gates: https STRICT (F-14) + fail-closed SSRF structural check;
 *      the DNS leg + connect-pin re-run at DELIVERY time (exporter F-05).
 * Secret: random 32 bytes, v2 envelope at rest, plaintext revealed EXACTLY
 * once at create/rotate (webhook precedent).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { createDb, auditExportDestinations } from '@accessbase/identity/db';
import { encryptSecret } from '@accessbase/identity';
import { config } from '../config.js';
import { requirePermission } from '../utils/permission.js';
import { assertWebhookUrl } from '../utils/webhook-url.js';
import { DEFAULT_TENANT } from '../utils/constants.js';

// module-level db is fine here — route lifetime = app lifetime (audit.ts:10)
const db = createDb(config.databaseUrl);

function err(code: string, message: string): { success: false; error: { code: string; message: string } } {
  return { success: false, error: { code, message } };
}

/** Belt + lane guards, run FIRST in every handler. Returns an error reply or
 * null when the caller may proceed. */
function guard(
  request: FastifyRequest,
): { ok: false; status: number; body: { success: false; error: { code: string; message: string } } } | { ok: true } {
  const user = (request as { user?: { type?: string } }).user;
  if (user?.type === 'apikey') {
    return {
      ok: false,
      status: 403,
      body: err('PERM_002', 'API keys cannot manage audit export destinations'),
    };
  }
  if ((request.tenantId ?? DEFAULT_TENANT) !== DEFAULT_TENANT) {
    return {
      ok: false,
      status: 403,
      body: err(
        'TENANT_PLATFORM_ONLY',
        'Audit export destinations are restricted to the platform (default) tenant',
      ),
    };
  }
  return { ok: true };
}

/** https-strict + fail-closed structural SSRF check (F-14/F-05 registration
 * leg); DNS + connect legs re-run at delivery time in the exporter. */
function gateUrl(raw: string): { ok: true; url: string } | { ok: false; code: string; message: string } {
  if (!raw.startsWith('https://')) {
    return { ok: false, code: 'AUDIT_EXPORT_URL_HTTP', message: 'url must use https' };
  }
  const verdict = assertWebhookUrl(raw);
  if (!verdict.ok) {
    return { ok: false, code: 'AUDIT_EXPORT_URL_DENIED', message: `url rejected: ${verdict.reason}` };
  }
  // Host normalization (sec L-2): https://Example.com vs example.com must not
  // dodge the unique(url) constraint.
  const u = new URL(raw);
  u.hostname = u.hostname.toLowerCase();
  return { ok: true, url: u.toString() };
}

export async function auditExportRoutes(app: FastifyInstance): Promise<void> {
  // Machine/jwt authentication FIRST — the guards below read request.user,
  // which only exists after authenticate runs (users.ts per-plugin precedent).
  app.addHook('preHandler', app.authenticate);

  // POST /audit-export — create; plaintext secret revealed exactly once.
  app.post(
    '/audit-export',
    { preHandler: [requirePermission()] },
    async (request, reply) => {
      const g = guard(request);
      if (!g.ok) return reply.status(g.status).send(g.body);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const rawUrl = body['url'];
      const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
      if (!url) return reply.status(400).send(err('AUDIT_EXPORT_INVALID', 'url is required'));
      const gated = gateUrl(url);
      if (!gated.ok) return reply.status(400).send(err(gated.code, gated.message));
      const description =
        typeof body['description'] === 'string' ? (body['description'] as string).slice(0, 500) : null;
      const [dupe] = await db
        .select({ id: auditExportDestinations.id })
        .from(auditExportDestinations)
        .where(eq(auditExportDestinations.url, gated.url))
        .limit(1);
      if (dupe) {
        return reply.status(409).send(err('AUDIT_EXPORT_EXISTS', 'This destination URL already exists'));
      }
      const secret = randomBytes(32).toString('base64url');
      const [row] = await db
        .insert(auditExportDestinations)
        .values({ url: gated.url, description, secretEncrypted: encryptSecret(secret) })
        .returning();
      if (!row) {
        return reply
          .status(500)
          .send(err('AUDIT_EXPORT_CREATE_FAILED', 'Failed to create destination'));
      }
      const { secretEncrypted: _secret, ...safe } = row;
      return reply.status(201).send({ success: true as const, data: { ...safe, secret } });
    },
  );

  // GET /audit-export — list; NO secret material, ever.
  app.get(
    '/audit-export',
    { preHandler: [requirePermission()] },
    async (request, reply) => {
      const g = guard(request);
      if (!g.ok) return reply.status(g.status).send(g.body);
      const rows = await db
        .select({
          id: auditExportDestinations.id,
          url: auditExportDestinations.url,
          description: auditExportDestinations.description,
          active: auditExportDestinations.active,
          lastDeliveredSeq: auditExportDestinations.lastDeliveredSeq,
          skippedSeq: auditExportDestinations.skippedSeq,
          createdAt: auditExportDestinations.createdAt,
          updatedAt: auditExportDestinations.updatedAt,
        })
        .from(auditExportDestinations)
        .orderBy(desc(auditExportDestinations.createdAt));
      return reply.send({
        success: true as const,
        data: rows.map((r) => ({
          ...r,
          skippedCount: Array.isArray(r.skippedSeq) ? r.skippedSeq.length : 0,
          skippedSeq: undefined,
        })),
      });
    },
  );

  // POST /audit-export/:id/rotate — new secret, revealed exactly once.
  app.post<{ Params: { id: string } }>(
    '/audit-export/:id/rotate',
    { preHandler: [requirePermission()] },
    async (request, reply) => {
      const g = guard(request);
      if (!g.ok) return reply.status(g.status).send(g.body);
      const secret = randomBytes(32).toString('base64url');
      const [row] = await db
        .update(auditExportDestinations)
        .set({ secretEncrypted: encryptSecret(secret), updatedAt: new Date() })
        .where(eq(auditExportDestinations.id, request.params.id))
        .returning();
      if (!row) return reply.status(404).send(err('AUDIT_EXPORT_NOT_FOUND', 'Destination not found'));
      const { secretEncrypted: _secret, ...safe } = row;
      return reply.send({ success: true as const, data: { ...safe, secret } });
    },
  );

  // DELETE /audit-export/:id
  app.delete<{ Params: { id: string } }>(
    '/audit-export/:id',
    { preHandler: [requirePermission()] },
    async (request, reply) => {
      const g = guard(request);
      if (!g.ok) return reply.status(g.status).send(g.body);
      const [row] = await db
        .delete(auditExportDestinations)
        .where(eq(auditExportDestinations.id, request.params.id))
        .returning({ id: auditExportDestinations.id });
      if (!row) return reply.status(404).send(err('AUDIT_EXPORT_NOT_FOUND', 'Destination not found'));
      return reply.send({ success: true as const, data: { id: row.id } });
    },
  );
}
