import type { FastifyInstance } from 'fastify';
import { and, count, desc, gt, isNull } from 'drizzle-orm';
import { createDb, users, roles, sessions, auditLogs } from '@accessbase/identity/db';
import { config } from '../config.js';

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
    async () => {
      const database = getDb();

      const [userCount] = await database.select({ value: count() }).from(users);
      const [roleCount] = await database.select({ value: count() }).from(roles);
      const [activeSessionCount] = await database
        .select({ value: count() })
        .from(sessions)
        .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
      const [auditCount] = await database.select({ value: count() }).from(auditLogs);
      const recent = await database
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
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