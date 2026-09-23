import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { createDb, closeDb, type DrizzleDB } from '@accessbase/identity/db';
import { config } from '../config.js';
import { isDraining } from '../utils/drain.js';
import { getRedis } from '../utils/redis.js';

/**
 * L-M D1: ONE readiness pool per process, memoized through a promise so two
 * concurrent first probes cannot double-createDb (the async-import race the
 * per-request createDb had). onClose ENDS the pool and RESETS both refs so a
 * later buildApp() (vitest same-file rebuild) gets a fresh pool instead of an
 * ended one. Creation/connection failures keep the historical 'down' shape.
 */
let readyDb: DrizzleDB | undefined;
let readyDbP: Promise<DrizzleDB> | undefined;
function getReadyDb(): Promise<DrizzleDB> {
  readyDbP ??= Promise.resolve(createDb(config.databaseUrl)).then((db) => {
    readyDb = db;
    return db;
  });
  return readyDbP;
}

export async function healthRoutes(app: FastifyInstance) {
  app.addHook('onClose', async () => {
    if (readyDb) await closeDb(readyDb);
    readyDb = undefined;
    readyDbP = undefined;
  });

  // GET /health/live — Liveness probe (is the process alive?)
  app.get(
    '/live',
    {
      schema: {
        description: 'Liveness probe',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    },
  );

  // GET /health/ready — Readiness probe (can the app serve traffic?)
  app.get(
    '/ready',
    {
      schema: {
        description: 'Readiness probe',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              checks: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
                  redis: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      // Q2a(F): shed traffic while the shutdown close-chain runs (drain.ts).
      if (isDraining()) {
        return reply.status(503).send({ status: 'draining' });
      }
      const redis = await getRedis();
      let redisStatus = 'down';
      if (redis) {
        try {
          await redis.ping();
          redisStatus = 'ok';
        } catch {
          redisStatus = 'down';
        }
      }

      let dbStatus = 'down';
      try {
        await (await getReadyDb()).execute(sql`SELECT 1`);
        dbStatus = 'ok';
      } catch {
        dbStatus = 'down';
      }

      const checks = {
        database: dbStatus,
        redis: redisStatus,
      };

      const allHealthy = Object.values(checks).every((s) => s === 'ok');

      return reply.status(allHealthy ? 200 : 503).send({
        status: allHealthy ? 'ok' : 'degraded',
        checks,
      });
    },
  );

  // GET /health/startup — Startup probe (has initialization finished?)
  app.get(
    '/startup',
    {
      schema: {
        description: 'Startup probe',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    },
    async () => {
      return { status: 'ok', uptime: process.uptime() };
    },
  );
}
