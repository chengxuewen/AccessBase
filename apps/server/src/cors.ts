import { config } from './config.js';

/**
 * Resolve the @fastify/cors `origin` option from config.corsOrigins.
 * Empty CORS_ORIGINS (dev): reflect request origin (origin: true).
 * Set (prod): whitelist callback — allow listed origins, reject others.
 */
export function resolveCorsOrigin() {
  if (!config.corsOrigins) return true;

  const whitelist = config.corsOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    cb(null, origin !== undefined && whitelist.includes(origin));
  };
}
