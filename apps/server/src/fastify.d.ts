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
  // Set by the authenticate decorator (app.ts): JWT branch reads the token's
  // tenantId claim (falling back to DEFAULT_TENANT for legacy tokens); the
  // API-key branch carries the key row's tenantId with no default fallback.
  interface FastifyRequest {
    tenantId?: string;
  }
}

// Side-effect-free type-only module; keep import used:
export type { FastifyInstance };
