import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { getRedis } from '../utils/redis.js';

export async function healthRoutes(app: FastifyInstance) {
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

      const dbStatus = await (async () => {
        try {
          const { createDb } = await import('@accessbase/identity/db');
          const { sql } = await import('drizzle-orm');
          await createDb(config.databaseUrl).execute(sql`SELECT 1`);
          return 'ok';
        } catch {
          return 'down';
        }
      })();

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
