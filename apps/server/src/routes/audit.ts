import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import { createDb, auditLogs } from '@accessbase/identity/db';
import { config } from '../config.js';
import { requirePermission } from '../utils/permission.js';
import { toCsv } from '../utils/csv.js';

// ponytail: module-level db is fine here — route lifetime = app lifetime
let db: ReturnType<typeof createDb> | undefined;

/** Test seam: inject a mocked drizzle db (avoids touching PG in unit tests). */
export function setAuditDb(mock: ReturnType<typeof createDb>): void {
  db = mock;
}

function getDb() {
  if (!db) db = createDb(config.databaseUrl);
  return db;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function auditRoutes(app: FastifyInstance) {
  // All audit routes require authentication
  app.addHook('preHandler', app.authenticate);
  // R7: the route-level permission gate — list and export share it.
  app.addHook('preHandler', requirePermission());

  /** Shared list/export filter builder (action/actor/startDate/endDate). */
  function buildWhere(query: { action?: string; actor?: string; startDate?: string; endDate?: string }) {
    const conditions: SQL[] = [];
    if (query.action) conditions.push(ilike(auditLogs.action, `%${query.action}%`));
    if (query.actor) conditions.push(ilike(auditLogs.userId, `%${query.actor}%`));
    if (query.startDate && ISO_DATE.test(query.startDate)) {
      conditions.push(gte(auditLogs.createdAt, new Date(`${query.startDate}T00:00:00Z`)));
    }
    if (query.endDate && ISO_DATE.test(query.endDate)) {
      conditions.push(lte(auditLogs.createdAt, new Date(`${query.endDate}T23:59:59.999Z`)));
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }
  // GET /api/v1/audit-logs?page=&pageSize=&action=&actor=&startDate=&endDate=
  app.get(
    '/',
    {
      schema: {
        description: 'List audit logs (paginated, filterable)',
        tags: ['audit'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            action: { type: 'string' },
            actor: { type: 'string' },
            startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, action, actor, startDate, endDate } =
        request.query as {
          page?: number;
          pageSize?: number;
          action?: string;
          actor?: string;
          startDate?: string;
          endDate?: string;
        };

      const where = buildWhere({ action, actor, startDate, endDate });

      const database = getDb();
      const [countRow] = await database
        .select({ total: count() })
        .from(auditLogs)
        .where(where);

      const total = countRow?.total ?? 0;

      const data = await database
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(Number(pageSize))
        .offset((Number(page) - 1) * Number(pageSize));

      return {
        success: true,
        data: data.map((row) => ({
          id: row.id,
          action: row.action,
          actor: row.userId,
          resource: [row.resourceType, row.resourceId].filter(Boolean).join(' ') || undefined,
          status: row.responseStatus ?? undefined,
          ipAddress: row.ip ?? undefined,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
      };
    },
  );

  // GET /api/v1/audit-logs/export — full CSV download (list filters, no pagination).
  app.get(
    '/export',
    {
      schema: {
        description: 'Export audit logs as CSV (all rows matching list filters)',
        tags: ['audit'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            actor: { type: 'string' },
            startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const { action, actor, startDate, endDate } = request.query as {
        action?: string;
        actor?: string;
        startDate?: string;
        endDate?: string;
      };
      const where = buildWhere({ action, actor, startDate, endDate });
      const database = getDb();

      // ponytail: 50k-row safety cap on the OFFSET loop — raise if real exports hit it
      const PAGE = 500;
      const MAX_ROWS = 50_000;
      const headers = ['id', 'action', 'actor', 'resource', 'status', 'ipAddress', 'createdAt'];
      const csvRows: Record<string, unknown>[] = [];
      for (let page = 1; csvRows.length < MAX_ROWS; page++) {
        const batch = await database
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(desc(auditLogs.createdAt))
          .limit(PAGE)
          .offset((page - 1) * PAGE);
        if (batch.length === 0) break;
        for (const row of batch) {
          if (csvRows.length >= MAX_ROWS) break;
          csvRows.push({
            id: row.id,
            action: row.action,
            actor: row.userId,
            resource: [row.resourceType, row.resourceId].filter(Boolean).join(' ') || undefined,
            status: row.responseStatus ?? undefined,
            ipAddress: row.ip ?? undefined,
            createdAt: row.createdAt.toISOString(),
          });
        }
        if (batch.length < PAGE) break;
      }

      const csv = toCsv(headers, csvRows);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.send(csv);
    },
  );
}
