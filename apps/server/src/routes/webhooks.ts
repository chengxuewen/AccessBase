/**
 * Q4c webhook endpoints admin surface (/api/v1/webhooks, spec rev.2 §6).
 *
 * Tenant-scoped CRUD over webhook_endpoints + the deliveries ledger + ping.
 * Secrets: random key revealed EXACTLY once in create/rotate responses, stored
 * only as the AES-GCM envelope (encryptSecret precedent; list rows exclude
 * secretEncrypted at the projection level — OidcClientListRow discipline).
 * SSRF: registration runs the fail-closed literal guard AND the DNS-answer
 * re-check (webhook-url module); dispatch re-checks per attempt (§5.5).
 * Dupes are PRE-CHECK SELECTs (F16: repo has no 23505 lane), ping bypasses
 * fan-out by inserting the delivery row for :id only (R3).
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { encryptSecret } from '@accessbase/identity';
import {
  createDb,
  events,
  webhookDeliveries,
  webhookEndpoints,
  type WebhookEndpointRow,
} from '@accessbase/identity/db';
import { config } from '../config.js';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { requirePermission } from '../utils/permission.js';
import { assertWebhookUrl, resolveDeniedIps } from '../utils/webhook-url.js';

const EVENT_SUB_RE = /^[a-z]+\.[a-z_]+$/;

/** Public projection — NEVER carries secret material. */
interface WebhookEndpointView {
  id: string;
  url: string;
  description: string | null;
  subscribedEvents: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function view(r: WebhookEndpointRow): WebhookEndpointView {
  return {
    id: r.id,
    url: r.url,
    description: r.description ?? null,
    subscribedEvents: r.subscribedEvents,
    active: r.active,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const err = (code: string, message: string) => ({ success: false, error: { code, message } });

function parseSubscribed(raw: unknown): { value?: string[] } | { error: string } {
  if (raw === undefined) return { value: ['*'] };
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((x) => typeof x !== 'string')) {
    return { error: 'subscribedEvents must be a non-empty array of strings' };
  }
  const list = [...new Set(raw as string[])];
  for (const e of list) {
    if (e !== '*' && !EVENT_SUB_RE.test(e)) {
      return { error: `invalid subscription entry: ${String(e)} (expected '<type>.<name>' or '*')` };
    }
  }
  return { value: list };
}

/** URL pre-flight: literal fail-closed guard + DNS answer re-check. */
async function urlDenyReason(raw: string): Promise<string | null> {
  const lit = assertWebhookUrl(raw);
  if (!lit.ok) return lit.reason;
  const dns = await resolveDeniedIps(lit.hostname);
  return dns.ok ? null : dns.reason;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  // LAZY module-scoped pool: created on the first request touching this
  // surface. Eager creation would (a) inflate the health-pool createDb-count
  // premise in unrelated buildApp suites and (b) force every partial
  // '@accessbase/identity/db' mock to export closeDb (PIT-082 import-time
  // throw). Pool lives for the process, bounded by app-registration count —
  // routes/tenants.ts createDb precedent, same posture.
  let db: ReturnType<typeof createDb> | undefined;
  const useDb = () => (db ??= createDb(config.databaseUrl));

  const tenantOf = (request: { tenantId?: string }): string => request.tenantId ?? DEFAULT_TENANT;

  async function findOwned(id: string, tenantId: string): Promise<WebhookEndpointRow | undefined> {
    const [row] = await useDb()
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.tenantId, tenantId)))
      .limit(1);
    return row;
  }

  // GET /api/v1/webhooks — list + per-endpoint pending/dead counts (2 aggregates)
  app.get('/', async (request) => {
    const tenantId = tenantOf(request);
    const rows = await useDb()
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenantId))
      .orderBy(webhookEndpoints.createdAt);
    let counts = new Map<string, { pending: number; dead: number }>();
    if (rows.length > 0) {
      const agg = await useDb()
        .select({
          endpointId: webhookDeliveries.endpointId,
          pending: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'pending')::int`,
          dead: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'dead')::int`,
        })
        .from(webhookDeliveries)
        .where(inArray(webhookDeliveries.endpointId, rows.map((r) => r.id)))
        .groupBy(webhookDeliveries.endpointId);
      counts = new Map(agg.map((a) => [a.endpointId, { pending: a.pending, dead: a.dead }]));
    }
    return {
      success: true,
      data: rows.map((r) => ({
        ...view(r),
        pending: counts.get(r.id)?.pending ?? 0,
        dead: counts.get(r.id)?.dead ?? 0,
      })),
    };
  });

  // POST /api/v1/webhooks — create; plaintext secret revealed exactly once
  app.post('/', async (request, reply) => {
    const tenantId = tenantOf(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawUrl = body['url'];
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) return reply.status(400).send(err('WEBHOOK_INVALID', 'url is required'));
    const deny = await urlDenyReason(url);
    if (deny) return reply.status(400).send(err('WEBHOOK_URL_DENIED', deny));
    const sub = parseSubscribed(body['subscribedEvents']);
    if ('error' in sub) return reply.status(400).send(err('WEBHOOK_INVALID', sub.error));
    const rawDesc = body['description'];
    const description = typeof rawDesc === 'string' ? rawDesc.slice(0, 500) : null;
    const [dupe] = await useDb()
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.url, url)))
      .limit(1);
    if (dupe) return reply.status(409).send(err('WEBHOOK_EXISTS', 'A webhook with this URL already exists'));
    const secret = randomBytes(32).toString('base64url');
    const [row] = await useDb()
      .insert(webhookEndpoints)
      .values({
        tenantId,
        url,
        description,
        secretEncrypted: encryptSecret(secret),
        subscribedEvents: sub.value,
      })
      .returning();
    return reply
      .status(201)
      .send({ success: true, data: { ...view(row as WebhookEndpointRow), secret } });
  });

  // PUT /api/v1/webhooks/:id — partial update (url re-guarded; same secret)
  app.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const tenantId = tenantOf(request);
    const existing = await findOwned(request.params.id, tenantId);
    if (!existing) return reply.status(404).send(err('WEBHOOK_NOT_FOUND', 'Webhook not found'));
    const body = (request.body ?? {}) as Record<string, unknown>;
    const patch: Partial<WebhookEndpointRow> & { updatedAt: Date } = { updatedAt: new Date() };
    if (body['url'] !== undefined) {
      const rawUrl = body['url'];
      const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
      if (!url) return reply.status(400).send(err('WEBHOOK_INVALID', 'url must be a non-empty string'));
      const deny = await urlDenyReason(url);
      if (deny) return reply.status(400).send(err('WEBHOOK_URL_DENIED', deny));
      const [dupe] = await useDb()
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.url, url)))
        .limit(1);
      if (dupe && dupe.id !== existing.id) {
        return reply.status(409).send(err('WEBHOOK_EXISTS', 'A webhook with this URL already exists'));
      }
      patch.url = url;
    }
    if (body['subscribedEvents'] !== undefined) {
      const sub = parseSubscribed(body['subscribedEvents']);
      if ('error' in sub) return reply.status(400).send(err('WEBHOOK_INVALID', sub.error));
      patch.subscribedEvents = sub.value;
    }
    if (body['description'] !== undefined) {
      const rawDesc = body['description'];
      patch.description = typeof rawDesc === 'string' ? rawDesc.slice(0, 500) : null;
    }
    if (body['active'] !== undefined) {
      if (typeof body['active'] !== 'boolean') {
        return reply.status(400).send(err('WEBHOOK_INVALID', 'active must be a boolean'));
      }
      patch.active = body['active'];
    }
    const [row] = await useDb()
      .update(webhookEndpoints)
      .set(patch)
      .where(eq(webhookEndpoints.id, existing.id))
      .returning();
    return { success: true, data: view(row as WebhookEndpointRow) };
  });

  // DELETE /api/v1/webhooks/:id — deliveries cascade, events untouched
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const existing = await findOwned(request.params.id, tenantOf(request));
    if (!existing) return reply.status(404).send(err('WEBHOOK_NOT_FOUND', 'Webhook not found'));
    await useDb().delete(webhookEndpoints).where(eq(webhookEndpoints.id, existing.id));
    return { success: true, data: null };
  });

  // POST /api/v1/webhooks/:id/rotate-secret — new secret revealed once
  app.post<{ Params: { id: string } }>('/:id/rotate-secret', async (request, reply) => {
    const existing = await findOwned(request.params.id, tenantOf(request));
    if (!existing) return reply.status(404).send(err('WEBHOOK_NOT_FOUND', 'Webhook not found'));
    const secret = randomBytes(32).toString('base64url');
    await useDb()
      .update(webhookEndpoints)
      .set({ secretEncrypted: encryptSecret(secret), updatedAt: new Date() })
      .where(eq(webhookEndpoints.id, existing.id));
    return { success: true, data: { secret } };
  });

  // POST /api/v1/webhooks/:id/ping — webhook.test event + DIRECT delivery row
  // for :id only (R3: the type never fan-outs — §5.1 excludes it).
  app.post<{ Params: { id: string } }>('/:id/ping', async (request, reply) => {
    const tenantId = tenantOf(request);
    const existing = await findOwned(request.params.id, tenantId);
    if (!existing) return reply.status(404).send(err('WEBHOOK_NOT_FOUND', 'Webhook not found'));
    const [ev] = await useDb()
      .insert(events)
      .values({ tenantId, type: 'webhook.test', payload: { endpointId: existing.id, note: 'ping' } })
      .returning({ id: events.id });
    if (!ev) return reply.status(500).send(err('WEBHOOK_PING_FAILED', 'event insert returned no row'));
    await useDb()
      .insert(webhookDeliveries)
      .values({ eventId: ev.id, endpointId: existing.id })
      .onConflictDoNothing();
    return reply.status(202).send({ success: true, data: { deliveryQueued: true, eventId: ev.id } });
  });

  // GET /api/v1/webhooks/:id/deliveries — ledger for debugging (no bodies)
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/:id/deliveries',
    async (request, reply) => {
      const existing = await findOwned(request.params.id, tenantOf(request));
      if (!existing) return reply.status(404).send(err('WEBHOOK_NOT_FOUND', 'Webhook not found'));
      const raw = Number.parseInt(request.query.limit ?? '50', 10);
      const limit = Number.isNaN(raw) ? 50 : Math.min(Math.max(raw, 1), 100);
      const rows = await useDb()
        .select({
          id: webhookDeliveries.id,
          eventId: webhookDeliveries.eventId,
          status: webhookDeliveries.status,
          attempts: webhookDeliveries.attempts,
          lastError: webhookDeliveries.lastError,
          responseStatus: webhookDeliveries.responseStatus,
          deliveredAt: webhookDeliveries.deliveredAt,
          createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, existing.id))
        .orderBy(desc(webhookDeliveries.id))
        .limit(limit);
      return { success: true, data: rows };
    },
  );
}
