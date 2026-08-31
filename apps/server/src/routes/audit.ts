import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import { createDb, auditLogs } from '@accessbase/identity/db';
import { config } from '../config.js';

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

      const conditions: SQL[] = [];
      if (action) conditions.push(ilike(auditLogs.action, `%${action}%`));
      if (actor) conditions.push(ilike(auditLogs.userId, `%${actor}%`));
      if (startDate && ISO_DATE.test(startDate)) {
        conditions.push(gte(auditLogs.createdAt, new Date(`${startDate}T00:00:00Z`)));
      }
      if (endDate && ISO_DATE.test(endDate)) {
        conditions.push(lte(auditLogs.createdAt, new Date(`${endDate}T23:59:59.999Z`)));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

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
}
