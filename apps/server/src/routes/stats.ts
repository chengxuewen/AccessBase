import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { createDb, users, roles, sessions, auditLogs } from '@accessbase/identity/db';
import { config } from '../config.js';
import { DEFAULT_TENANT } from '../utils/constants.js';

// ponytail: module-level db is fine here — route lifetime = app lifetime
let db: ReturnType<typeof createDb> | undefined;

/** Test seam: inject a mocked drizzle db (avoids touching PG in unit tests). */
export function setStatsDb(mock: ReturnType<typeof createDb>): void {
  db = mock;
}

function getDb() {
  if (!db) db = createDb(config.databaseUrl);
  return db;
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // Auth-scoped (any authenticated user can view deployment stats — simplest per plan)
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/stats',
    {
      schema: {
        description: 'Dashboard statistics',
        tags: ['stats'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const database = getDb();
      // K-T1 read isolation: every count and the recent feed are scoped to the
      // requester tenant. Audit rows follow the list/export rule (default
      // tenant additionally sees the 'system' bucket); sessions reach a
      // tenant only through their owning user (innerJoin on users).
      const tenantId = request.tenantId ?? DEFAULT_TENANT;
      const auditScope =
        tenantId === DEFAULT_TENANT
          ? inArray(auditLogs.tenantId, [tenantId, 'system'])
          : eq(auditLogs.tenantId, tenantId);

      const [userCount] = await database
        .select({ value: count() })
        .from(users)
        .where(eq(users.tenantId, tenantId));
      const [roleCount] = await database
        .select({ value: count() })
        .from(roles)
        .where(eq(roles.tenantId, tenantId));
      const [activeSessionCount] = await database
        .select({ value: count() })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(
          and(
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date()),
            eq(users.tenantId, tenantId),
          ),
        );
      const [auditCount] = await database
        .select({ value: count() })
        .from(auditLogs)
        .where(auditScope);
      const recent = await database
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(auditScope)
        .orderBy(desc(auditLogs.createdAt))
        .limit(10);

      return {
        success: true as const,
        data: {
          users: userCount?.value ?? 0,
          roles: roleCount?.value ?? 0,
          activeSessions: activeSessionCount?.value ?? 0,
          audits: auditCount?.value ?? 0,
          recentActivity: recent.map((row) => ({
            id: row.id,
            userId: row.userId,
            action: row.action,
            resourceType: row.resourceType,
            createdAt: row.createdAt.toISOString(),
          })),
        },
      };
    },
  );
}