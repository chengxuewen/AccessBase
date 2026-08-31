import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Fastify type augmentations for AccessBase
 */
import type { IdentityService } from './managers/index.js';
import type { HealthCheckServiceImpl } from '@accessbase/health';

declare module 'fastify' {
  interface FastifyInstance {
    identity: IdentityService;
    healthCheck: HealthCheckServiceImpl;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
