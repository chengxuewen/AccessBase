/**
 * Q4d events history read surface (GET /api/v1/events) — closes the Q4c
 * deferred "GET /events history UI" loop: the outbox is written at every
 * manager funnel and fanned out by the dispatcher, but until now had no
 * observation path beyond the per-endpoint deliveries ledger.
 *
 * Read isolation mirrors audit.ts exactly (K-T1: non-default tenants see
 * only their own rows; default sees [DEFAULT, 'system'] — events never carry
 * 'system' today but the arm keeps the two surfaces' semantics identical).
 * Gated by the EXISTING audit:read code (routePermissions map) — no new
 * permission code for a compliance read sibling of audit-logs.
 */
import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, ilike, inArray, lte, type SQL } from 'drizzle-orm';
import { createDb, events, type EventRow } from '@accessbase/identity/db';
import { config } from '../config.js';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { requirePermission } from '../utils/permission.js';

// ponytail: module-level db is fine here — route lifetime = app lifetime
// (audit.ts precedent). Test seam below avoids touching PG in unit tests.
let db: ReturnType<typeof createDb> | undefined;

/** Test seam: inject a mocked drizzle db (avoids touching PG in unit tests). */
export function setEventsDb(mock: ReturnType<typeof createDb> | undefined): void {
  db = mock;
}

function getDb() {
  if (!db) db = createDb(config.databaseUrl);
  return db;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface EventQuery {
  type?: string;
  startDate?: string;
  endDate?: string;
}

function buildWhere(query: EventQuery, tenantId: string): SQL {
  const conditions: SQL[] = [
    ...(tenantId === DEFAULT_TENANT
      ? [inArray(events.tenantId, [tenantId, 'system'])]
      : [eq(events.tenantId, tenantId)]),
  ];
  if (query.type) conditions.push(ilike(events.type, `%${query.type}%`));
  if (query.startDate && ISO_DATE.test(query.startDate)) {
    conditions.push(gte(events.createdAt, new Date(`${query.startDate}T00:00:00Z`)));
  }
  if (query.endDate && ISO_DATE.test(query.endDate)) {
    conditions.push(lte(events.createdAt, new Date(`${query.endDate}T23:59:59.999Z`)));
  }
  return and(...conditions) as SQL;
}

/** Wire projection — payload stays an opaque object (funnels guarantee it
 * carries only non-secret projections, but this route never re-serializes
 * secrets into a new surface beyond what the emitting side already chose). */
function view(row: EventRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
    fanoutComplete: row.fanoutCompleteAt !== null,
  };
}

export async function eventRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  // GET /api/v1/events?page=&pageSize=&type=&startDate=&endDate=
  app.get(
    '/',
    {
      schema: {
        description: 'List domain events (paginated, filterable)',
        tags: ['events'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            type: { type: 'string' },
            startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, type, startDate, endDate } = request.query as {
        page?: number;
        pageSize?: number;
        type?: string;
        startDate?: string;
        endDate?: string;
      };
      const where = buildWhere({ type, startDate, endDate }, request.tenantId ?? DEFAULT_TENANT);
      const database = getDb();

      const [countRow] = await database.select({ total: count() }).from(events).where(where);
      const total = countRow?.total ?? 0;

      const rows = await database
        .select()
        .from(events)
        .where(where)
        .orderBy(desc(events.createdAt), desc(events.id))
        .limit(Number(pageSize))
        .offset((Number(page) - 1) * Number(pageSize));

      return { success: true, data: rows.map(view), total };
    },
  );

  // GET /api/v1/events/:id — single event drill (payload verbatim)
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get one event by id',
        tags: ['events'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^\\d+$' } },
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      // Tenant predicate stays eq-level: a foreign id must 404, never leak.
      const tenantId = request.tenantId ?? DEFAULT_TENANT;
      const where =
        tenantId === DEFAULT_TENANT
          ? (and(eq(events.id, id), inArray(events.tenantId, [tenantId, 'system'])) as SQL)
          : (and(eq(events.id, id), eq(events.tenantId, tenantId)) as SQL);
      const [row] = await getDb()
        .select()
        .from(events)
        .where(where)
        .limit(1);
      if (!row) {
        return reply
          .status(404)
          .send({ success: false, error: { code: 'EVENT_NOT_FOUND', message: 'Event not found' } });
      }
      return { success: true, data: view(row) };
    },
  );
}
