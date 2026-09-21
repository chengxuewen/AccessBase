import { createHash, timingSafeEqual } from 'node:crypto';
import { register, collectDefaultMetrics, Histogram, Gauge } from 'prom-client';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';

/**
 * L-M D2: Prometheus /metrics surface.
 *
 * Cardinality: histogram labels are (method, route-PATTERN) via
 * request.routeOptions.url — NEVER the raw url (an open-URL probe would explode
 * prom-client memory); unmatched (404) requests bucket to 'unmatched'.
 *
 * Coverage: the duration/in-flight hooks live in THIS encapsulated scope,
 * registered AFTER the OIDC onRequest-hijack hook at the root — hijacked
 * /oidc replies never reach them. Documented blind spot (IdP server-to-server
 * traffic, not app load) beats the alternative: onResponse does not fire for
 * hijacked replies, so registering before the hijack would leak the in-flight
 * gauge upward forever.
 */

// process/event-loop/memory defaults, accessbase_-prefixed (spec D2)
collectDefaultMetrics({ prefix: 'accessbase_' });

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const httpDuration = new Histogram({
  name: 'accessbase_http_request_duration_seconds',
  help: 'HTTP request duration in seconds, by method and route pattern.',
  labelNames: ['method', 'route'] as const,
  buckets: DURATION_BUCKETS,
});

const httpInFlight = new Gauge({
  name: 'accessbase_http_requests_in_flight',
  help: 'In-flight HTTP requests handled by Fastify.',
});

const startedAt = new WeakMap<FastifyRequest, number>();

/** sha256 BOTH sides before timingSafeEqual ⇒ equal-length compare, no length oracle. */
function tokenMatches(presented: string): boolean {
  const expected = config.metricsToken;
  if (!expected) return true;
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

// fastify-plugin: WITHOUT this the hooks encapsulate to the plugin's own routes
// and the histogram would observe only /metrics itself — fp lifts scope so every
// non-hijacked request is measured (register AFTER the OIDC hijack hook at app.ts
// to keep the documented /oidc blind spot).
export const metricsRoutes = fp(metricsRoutesImpl);

async function metricsRoutesImpl(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    startedAt.set(request, performance.now());
    httpInFlight.inc();
  });

  app.addHook('onResponse', async (request) => {
    // Symmetry guard: a request short-circuited BEFORE our onRequest (e.g. the
    // rate-limit plugin's 429 — registered earlier at root) never incremented;
    // dec only what we own or the gauge drifts negative.
    const start = startedAt.get(request);
    if (start === undefined) return;
    httpInFlight.dec();
    const route = request.routeOptions.url || 'unmatched';
    httpDuration.observe(
      { method: request.method, route },
      (performance.now() - start) / 1000,
    );
  });

  // GET /metrics — Prometheus text scrape endpoint.
  app.get(
    '/metrics',
    {
      // v9 has no global skip list — route-level opt-out keeps scrapes out of
      // the shared 100/min human bucket (proxy-fronted deploys collapse keys).
      config: { rateLimit: false },
      schema: {
        description: 'Prometheus metrics (optional Bearer METRICS_TOKEN gate)',
        tags: ['metrics'],
        hide: true,
      },
    },
    async (request, reply) => {
      // @fastify/cors v9 ships no per-route cors:false typing — enforce the
      // no-browser rule directly: Prometheus never sends Origin, so any
      // Origin-bearing read is a drive-by web page (dead in dev where the
      // site allowlist reflects). 404, not 403: don't confirm the surface.
      if (request.headers.origin !== undefined) {
        return reply.status(404).send();
      }
      const expected = config.metricsToken;
      if (expected) {
        const header = request.headers.authorization ?? '';
        const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (!presented || !tokenMatches(presented)) {
          return reply.status(403).send({
            success: false,
            error: { code: 'METRICS_AUTH', message: 'Missing or invalid metrics token' },
          });
        }
      }
      reply.header('content-type', register.contentType);
      return register.metrics();
    },
  );
}
