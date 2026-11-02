/**
 * Q3D back-channel logout RECEIVER route (spec 2026-10-12 §3.1).
 *
 * IdP-facing S2S surface — mounted under oauthRoutes (prefix /api/v1/auth):
 *   POST /api/v1/auth/oauth/backchannel-logout
 *
 * Deviations from house defaults (conventions addendum, spec M4):
 * - urlencoded body via ROUTE-SCOPED parser (never global — saml.ts:31
 *   precedent, static invariant in tests);
 * - BCL spec-shape 400/500 bodies + 200 empty (NOT the {success,data}
 *   envelope) via ROUTE-SCOPED setErrorHandler (scim.ts:187 precedent);
 * - rate bucket 30/min per IP (token signature is the real auth);
 * - audit-excluded in app.ts (token material — same posture as ACS/SLO).
 */
import type { FastifyInstance } from 'fastify';
import type { DbLike } from '@accessbase/identity/db';
import { SessionManager } from '@accessbase/identity';
import { createDb, closeDb } from '@accessbase/identity/db';
import { loadDynamicProviders } from '../utils/rp-end-session.js';
import { processBackchannelLogout } from '../utils/backchannel-logout.js';
import { getRedis } from '../utils/redis.js';

/**
 * Module-level lazy singleton (users.ts addendum #5 precedent): per-request
 * `new SessionManager()` would pile up pg Pools.
 */
// Module-level lazy tx pool (users.ts SessionManager precedent): one pool per
// process for the effects transaction. Deliberately NOT routeTx/UserManager —
// the memo singleton is process-global and grabs whatever DATABASE_URL was
// current at its FIRST construction, which mis-routes under multi-env test
// workers; this module owns its pool for its own route.
let txDb: ReturnType<typeof createDb> | null = null;
async function effectsTx<T>(fn: (tx: DbLike) => Promise<T>): Promise<T> {
  txDb ??= createDb();
  return txDb.transaction(fn);
}

/** Test/onClose seam: release this module's pool (users.ts SessionManager parity). */
export async function closeBackchannelLogoutPool(): Promise<void> {
  if (txDb) {
    await closeDb(txDb).catch(() => undefined);
    txDb = null;
  }
}

let sessionManagerSingleton: SessionManager | null = null;
function getSessionManager(): SessionManager {
  sessionManagerSingleton ??= new SessionManager();
  return sessionManagerSingleton;
}

/** authst DEL arm — the delAuthStateKeys half of the token-version pairing (A2). */
async function delAuthStateKeys(userIds: string[]): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis || userIds.length === 0) return;
    await redis.del(...userIds.map((u) => `authst:${u}`));
  } catch {
    /* TTL backstop covers */
  }
}

export async function backchannelLogoutRoutes(app: FastifyInstance) {
  // Scoped urlencoded parser (saml.ts precedent): only this plugin's routes
  // parse forms; app.ts must NEVER gain a global addContentTypeParser.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  // Scoped error handler: BCL spec-shape responses only — the global
  // {success,data} envelope must never leak onto this machine route (M4/R5).
  app.setErrorHandler((err, _request, reply) => {
    void err; // request.log already carried it; no internals to the caller
    void reply.status(500).header('cache-control', 'no-store').send({
      error: 'invalid_request',
      error_description: 'back-channel logout failed',
    });
  });

  app.post<{ Body: { logout_token?: string } }>(
    '/oauth/backchannel-logout',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          properties: { logout_token: { type: 'string', maxLength: 8192 } },
        },
      },
    },
    async (request, reply) => {
      const token = typeof request.body?.logout_token === 'string' ? request.body.logout_token : '';
      const providers = await loadDynamicProviders();
      const sessionManager = getSessionManager();

      // Effects ride one tx (spec §3.3: revoke+bump+nulling all-or-nothing).
      const outcome = await effectsTx((tx: DbLike) =>
        processBackchannelLogout(token, {
          db: tx,
          providers,
          revokeAllUserSessions: (userId: string) => sessionManager.revokeAllUserSessions(userId),
          delAuthStateKeys,
          emitEvent: (input) => {
            // Fire-and-forget telemetry (spec §3.3.5): payload ids only, never
            // the raw token. Deliberately NOT on the tx handle — a floating
            // INSERT on the tx client was observed to poison the COMMIT path
            // (live-fire I1: rowCount=1 yet no persistence). authDb() is the
            // sanctioned telemetry pool (auth-events.ts family, tenantId
            // 'system' = platform lane); its own catch = sanctioned swallow.
            void (async () => {
              const { emitEvent: emit } = await import('@accessbase/identity');
              const { authDb } = await import('../utils/managers.js');
              await emit(authDb(), {
                tenantId: 'system',
                type: 'auth.backchannel_logout',
                payload: { userId: input.userId, provider: input.provider, jti: input.jti },
              });
            })().catch(() => {
              /* telemetry never fails the response (sanctioned lane) */
            });
          },
          logger: request.log,
        }),
      );

      if (outcome.kind === 'ok') {
        return reply.status(200).header('cache-control', 'no-store').send();
      }
      const status = outcome.detail === 'logout processing failed' ? 500 : 400;
      return reply
        .status(status)
        .header('cache-control', 'no-store')
        .send({ error: 'invalid_request', error_description: outcome.detail });
    },
  );
}
