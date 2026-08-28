import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { roleRoutes } from './routes/roles.js';
import { healthRoutes } from './routes/health.js';
import { setupRoutes } from './routes/setup.js';
import { setupGuard, setSetupComplete } from './middleware/setup-guard.js';
import { resolveCorsOrigin } from './cors.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';

export { setSetupComplete };

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // --- Plugins ---

  await app.register(cors, {
    origin: resolveCorsOrigin(),
    credentials: true,
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'AccessBase API',
        description: 'AccessBase 基石层 API 文档',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${config.port}`, description: '开发环境' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // --- Security middleware ---
  await app.register(helmet);

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });


  await app.register(fastifyJwt, config.jwtPrivateKeyPath && config.jwtPublicKeyPath
    ? await (async () => {
        const { readFileSync } = await import('node:fs');
        const privateKey = readFileSync(resolve(config.jwtPrivateKeyPath), 'utf-8');
        const publicKey = readFileSync(resolve(config.jwtPublicKeyPath), 'utf-8');
        return {
          secret: { public: publicKey, private: privateKey },
          sign: { algorithm: 'RS256' as const, expiresIn: '15m' },
        };
      })()
    : {
        secret: config.jwtSecret,
        sign: { expiresIn: '15m' },
      });

  // --- Auth decorator ---

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({
        success: false,
        error: { code: 'AUTH_001', message: 'Missing or invalid token' },
      });
    }
  });

  // --- Error envelope enrichment (security.md 19.13 / D52) ---
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const payload: Record<string, unknown> = {
      success: false,
      error: {
        code: error.code ?? `HTTP_${statusCode}`,
        message: statusCode >= 500 ? 'Internal server error' : error.message,
      },
      timestamp: new Date().toISOString(),
      requestId: request.id,
      path: request.url,
    };
    if (statusCode < 500) request.log.info({ err: error }, 'Request error');
    else request.log.error({ err: error }, 'Internal error');
    return reply.status(statusCode).send(payload);
  });
  

  // --- Setup Guard Middleware (must be registered before other routes) ---
  app.addHook('onRequest', setupGuard);

  // --- Routes ---
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(setupRoutes, { prefix: '/api/v1/setup' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(roleRoutes, { prefix: '/api/v1/roles' });

  // --- L0 package registration (when packages are implemented) ---
  // await app.register(identityPlugin)
  // await app.register(auditPlugin)
  // await app.register(healthCheckPlugin)
  // await app.register(i18nPlugin)


  // --- Static file serving (deploy mode) ---
  if (existsSync(resolve(config.staticDir))) {
    await app.register(fastifyStatic, {
      root: resolve(config.staticDir),
      prefix: '/',
      index: ['index.html'],
      decorateReply: true,
      wildcard: false,
    });
  }
  // --- SPA fallback / 404 envelope (works with or without static files) ---
  app.setNotFoundHandler(async (request, reply) => {
    if (
      request.url.startsWith('/api/') ||
      request.url.startsWith('/health') ||
      request.url.startsWith('/docs')
    ) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
        timestamp: new Date().toISOString(),
        requestId: request.id,
        path: request.url,
      });
    }
    // SPA fallback: serve index.html for non-API routes
    if (existsSync(resolve(config.staticDir))) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
      timestamp: new Date().toISOString(),
      requestId: request.id,
      path: request.url,
    });
  });

  return app;
}
