/**
 * Fastify type augmentation: the `authenticate` preHandler is decorated at
 * runtime in app.ts but was never declared, so every `app.authenticate`
 * usage surfaced as a TS2339 (baseline noise across routes).
 */
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}

// Side-effect-free type-only module; keep import used:
export type { FastifyInstance };
