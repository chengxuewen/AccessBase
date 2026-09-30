/**
 * routes/auth split (batch R2, DG-5 pure move): session surface —
 * me / logout / sessions×3 / refresh. Registration order inside the file
 * matches the original monolith.
 */
import type { FastifyInstance } from 'fastify';
import { getTenantManager, getUserManager } from '../../utils/managers.js';
import { DEFAULT_TENANT } from '../../utils/constants.js';
import { emitAuthEvent } from '../../utils/auth-events.js';
import { resolveIdleSeconds } from '../../utils/session-idle-wiring.js';
import type { AuthContext } from './context.js';

export async function meRoutes(app: FastifyInstance, ctx: AuthContext) {
  // GET /api/v1/auth/me
  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Get current user profile',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { sub: string; email: string };
      const userManager = await getUserManager();
      const user = await userManager.findById(payload.sub, request.tenantId ?? DEFAULT_TENANT);
      if (!user) {
        throw new Error('User not found');
      }
      // L' D4: session tenant exposure for the top-bar Tag. Uncached PK
      // SELECT (+1 per /me — accepted in the design). Any lookup error or
      // absent row degrades to { tenantName: undefined, tenantIsDefault: true }
      // so the Tag hides (fail-closed); /me must never 500 on the tenant row.
      // Note: Tenant.isDefault projection lands in T1 (parallel) — backend
      // equality against DEFAULT_TENANT is the stand-in (zero frontend literals).
      const tenantId = user.tenantId ?? DEFAULT_TENANT;
      let tenantName: string | undefined;
      let tenantIsDefault = true;
      try {
        const tenant = await (await getTenantManager()).findById(tenantId);
        if (tenant) {
          tenantName = tenant.name;
          tenantIsDefault = tenantId === DEFAULT_TENANT;
        }
      } catch (err) {
        request.log.warn({ err }, 'auth/me tenant label lookup failed — defaulting');
      }
      return {
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: await ctx.rolesOf(user.id, request.tenantId),
          permissions: await ctx.permissionsOf(user.id, request.tenantId),
          // users.mfaEnabled column is dead; totpEnabled is the live MFA state (MfaManager writes it)
          mfaEnabled: user.totpEnabled ?? false,
          emailVerified: user.emailVerified ?? false,
          tenantId,
          tenantName,
          tenantIsDefault,
        },
      };
    },
  );
}


export async function logoutRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/logout
  app.post(
    '/logout',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Logout revokes the DB session when a refresh token is supplied',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const body = request.body as { refreshToken?: string } | undefined;
      if (body?.refreshToken) {
        try {
          const session = await ctx.sessionManager.findSessionByToken(body.refreshToken);
          if (session) {
            await ctx.sessionManager.revokeSession(session.id);
          }
        } catch (err) {
          request.log.warn({ err }, 'Logout session revocation failed');
        }
      }
      const caller = request.user as { sub?: string; email?: string };
      // R1-T3: both branches (with or without refreshToken) end the caller's session intent
      emitAuthEvent({
        type: 'auth.logout',
        tenantId: request.tenantId ?? DEFAULT_TENANT,
        userId: caller.sub,
        email: caller.email ?? '',
        method: 'password',
      });
      return { success: true };
    },
  );
}


export async function revokeOthersRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/sessions/revoke-others — "logout other devices"
  app.post<{ Body: { refreshToken?: string } }>(
    '/sessions/revoke-others',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Revoke all other sessions, keeping the one matching the supplied refresh token',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { sub: string };
      const body = request.body as { refreshToken?: string } | undefined;
      let keepSessionId: string | null = null;
      if (body?.refreshToken) {
        try {
          const session = await ctx.sessionManager.findSessionByToken(body.refreshToken);
          keepSessionId = session?.id ?? null;
        } catch (err) {
          request.log.warn({ err }, 'revoke-others session lookup failed');
        }
      }
      if (keepSessionId) {
        await ctx.sessionManager.revokeOtherSessions(payload.sub, keepSessionId);
      } else {
        // No resolvable current session → revoke everything (fail-closed)
        await ctx.sessionManager.revokeAllUserSessions(payload.sub);
      }
      return { success: true };
    },
  );
}


export async function sessionsListRoutes(app: FastifyInstance, ctx: AuthContext) {
  // GET /api/v1/auth/sessions — active sessions for the current user (Phase 6d Task 4 Settings)
  app.get<{ Querystring: { refreshToken?: string } }>(
    '/sessions',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'List active sessions for the current user (each item flagged current:true for the caller\'s own session)',
      },
    },
    async (request) => {
      const payload = request.user as { sub: string };
      const sessions = await ctx.sessionManager.getUserSessions(payload.sub);
      // The access JWT carries no session claim; the client optionally passes its
      // refresh token (same pattern as /logout) to identify its own session.
      let currentSessionId: string | null = null;
      const { refreshToken } = request.query;
      if (refreshToken) {
        try {
          currentSessionId =
            (await ctx.sessionManager.findSessionByToken(refreshToken))?.id ?? null;
        } catch (err) {
          request.log.warn({ err }, 'sessions current lookup failed');
        }
      }
      return {
        success: true,
        data: sessions.map((s) => ({ ...s, current: s.id === currentSessionId })),
      };
    },
  );
}


export async function revokeSessionRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/sessions/revoke — revoke one session by id (Settings)
  app.post<{ Body: { sessionId?: string } }>(
    '/sessions/revoke',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Revoke a single session belonging to the current user',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string', minLength: 1 } },
        },
      },
    },
async (request) => {
      const { sessionId } = request.body;
      // JSON-schema required + minLength guarantee presence; guard satisfies noUncheckedIndexedAccess
      if (!sessionId) {
        return { success: false, error: { code: 'VALIDATION_001', message: 'sessionId required' } };
      }
await ctx.sessionManager.revokeSession(sessionId);
return { success: true };
},
  );
}


export async function refreshRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/refresh
  app.post(
    '/refresh',
    {
      schema: {
        description: 'Refresh access token',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      try {
        // Status gate BEFORE rotate: rejecting after rotate would strand a fresh
        // session row per attempt (old token consumed, new one never delivered).
        // The userId comes from the presented token's row — fetch its owner first.
        const presented = await ctx.sessionManager.findSessionByToken(refreshToken);
        const gateUserId = presented?.userId;
        if (gateUserId) {
          // findByIdAny (G fix H1): the session row's owner may live in ANY
          // tenant — tenant-scoped findById with DEFAULT_TENANT returned null
          // for non-default users, silently skipping both doors below.
          const user = await new (await import('@accessbase/identity'))
            .UserManager()
            .findByIdAny(gateUserId);
          if (user?.status && user.status !== 'active') {
            throw new Error('ACCOUNT_SUSPENDED');
          }
          // Tenant door (G/R1): refresh must not outlive a suspended tenant —
          // fail-closed before rotation (batch A user-status door precedent).
          await ctx.assertTenantActive(user);
        }

        // DB-backed rotation: validates hash, marks old used, detects replay.
        // SL-2: idle cutoff rides inside the guarded rotate WHERE (0 = off);
        // resolver failure degrades to default, never blocks refresh (G4).
        const { refreshToken: newRefreshToken, userId } =
          await ctx.sessionManager.rotateRefreshToken(refreshToken, {
              ip: request.ip,
              userAgent: request.headers['user-agent'] ?? '',
            },
            { idleCutoffSeconds: await resolveIdleSeconds() },
          );

        // findByIdAny (G fix L1): same tenant-blindness argument as the gate —
        // a non-default-tenant owner must resolve post-rotation, or a valid
        // refresh 401s AFTER consuming the presented token (stranded token).
        const user = await new (await import('@accessbase/identity'))
          .UserManager()
          .findByIdAny(userId);
        if (!user) throw new Error('User not found');
        const accessToken = app.jwt.sign(
          { sub: userId, email: user.email, status: user.status, tenantId: user.tenantId ?? DEFAULT_TENANT, tokenVersion: user.tokenVersion },
          { expiresIn: '15m' },
        );

        return {
          success: true,
          data: { accessToken, refreshToken: newRefreshToken, expiresIn: 900 },
        };
      } catch (err) {
        // Tenant door (G): map ahead of the generic invalid-token reply.
        if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_TENANT_001', message: 'Access denied' },
          });
        }
        const error = err instanceof Error ? err : new Error(String(err));
        request.log.warn({ msg: 'Refresh failed', reason: error.message });
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_003', message: 'Invalid refresh token' },
        });
      }
    },
  );
}
