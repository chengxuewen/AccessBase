/**
 * Fastify type augmentations for AccessBase
 */
import type { IdentityService } from './managers/index.js';
import type { HealthCheckServiceImpl } from '@accessbase/health-check';

declare module 'fastify' {
  interface FastifyInstance {
    identity: IdentityService;
    healthCheck: HealthCheckServiceImpl;
  }
}
