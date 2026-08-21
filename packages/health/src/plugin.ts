import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { HealthCheckOptions } from './types.js';
import { HealthCheckServiceImpl } from './service.js';
import { MemoryHealthChecker } from './checkers.js';

/**
 * Fastify health check plugin
 *
 * Registers three endpoints:
 * - GET /health/live — liveness probe (always 200 if server is running)
 * - GET /health/ready — readiness probe (200 if all readiness checks pass, 503 otherwise)
 * - GET /health/startup — startup probe (200 once service is started)
 */
const healthCheckPlugin: FastifyPluginAsync<HealthCheckOptions> = async (fastify, opts) => {
  const basePath = opts.path ?? '/health';
  const detailed = opts.detailed ?? false;
  const service = new HealthCheckServiceImpl(opts.version);

  // Register built-in memory checker
  service.register(new MemoryHealthChecker());

  // Register custom checkers
  if (opts.checkers) {
    for (const checker of opts.checkers) {
      service.register(checker);
    }
  }

  // Remove trailing slash from basePath
  const normalizedPath = basePath.replace(/\/$/, '');

  // GET /health — full health report
  fastify.get(normalizedPath, async (_request, reply) => {
    if (detailed) {
      const report = await service.checkAll();
      const statusCode = report.status === 'unhealthy' ? 503 : 200;
      return reply.code(statusCode).send(report);
    }
    return reply.code(200).send({ status: 'ok' });
  });

  // GET /health/live — liveness probe
  fastify.get(`${normalizedPath}/live`, async (_request, reply) => {
    // Liveness: if the process is running, it's alive
    return reply.code(200).send({ status: 'ok', uptime: service.getUptime() });
  });

  // GET /health/ready — readiness probe
  fastify.get(`${normalizedPath}/ready`, async (_request, reply) => {
    const report = await service.checkAll();
    const statusCode = report.status === 'unhealthy' ? 503 : 200;
    return reply.code(statusCode).send({
      status: report.status,
      checks: report.checks.map((c) => ({ name: c.name, status: c.status })),
    });
  });

  // GET /health/startup — startup probe
  fastify.get(`${normalizedPath}/startup`, async (_request, reply) => {
    // Startup probe: returns 200 once the app considers itself started
    return reply.code(200).send({ status: 'ok', version: service.getVersion() });
  });

  // Decorate fastify instance with health service
  fastify.decorate('healthCheck', service);
}

export const fastifyHealthCheck = fp(healthCheckPlugin, {
  name: '@accessbase/health',
  fastify: '4.x',
});

