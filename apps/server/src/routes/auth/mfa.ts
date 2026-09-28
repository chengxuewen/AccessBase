/**
 * routes/auth split (batch R2, DG-5 pure move): MFA lane — setup / enable /
 * verify / disable, incl. the Q3E enroll-wizard dual channels inside
 * setup/enable (Phase 6b Task 3 block).
 */
import type { FastifyInstance } from 'fastify';
import { getMfaManager } from '../../utils/mfa-manager.js';
import { getUserManager } from '../../utils/managers.js';
import { DEFAULT_TENANT } from '../../utils/constants.js';
import { emitAuthEvent } from '../../utils/auth-events.js';
import type { AuthContext } from './context.js';
import { verifiedEmailRequired } from './shared.js';

// ---- MFA endpoints (Phase 6b Task 3) ----

export async function mfaSetupRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/mfa/setup — generate TOTP secret + recovery codes
  app.post(
    '/mfa/setup',
    {
      // Q3E-E3 rev.2 F-B3: dual channel — flowToken present = enroll wizard (NO
      // bearer); absent = authenticated panel. The decorator is invoked
      // MANUALLY in the bearer branch so its P0/tenant/Q3A gates stay intact
      // (raw jwtVerify would bypass them — forbidden).
      schema: {
        description: 'Start TOTP MFA setup: returns otpauth URL, QR and one-time recovery codes',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { flowToken?: string };
      if (typeof body.flowToken === 'string' && body.flowToken !== '') {
        const enrolled = await ctx.flowTokens.consume<{ userId: string }>(body.flowToken, 'mfa_enroll');
        if (!enrolled) {
          return reply.status(401).send({
            success: false,
            error: { code: 'AUTH_MFA_004', message: 'Invalid or expired enrollment session — sign in again' },
          });
        }
        const um = await getUserManager();
        const wizard = await um.findByIdAny(enrolled.userId);
        if (!wizard || wizard.status !== 'active') {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_004', message: 'Account suspended' },
          });
        }
        try {
          const result = await getMfaManager().setup(wizard.id, wizard.email);
          // chain a FRESH enroll token for the confirm step (single-use burn)
          const chained = await ctx.flowTokens.issue('mfa_enroll', { userId: wizard.id }, 300);
          return { success: true, data: { ...result, flowToken: chained } };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'MFA setup failed';
          return reply.status(400).send({
            success: false,
            error: { code: 'AUTH_MFA_002', message },
          });
        }
      }
      await app.authenticate(request, reply);
      if (ctx.replySent(reply)) return reply;
      const payload = request.user as { sub: string; email: string };
      try {
        const result = await getMfaManager().setup(payload.sub, payload.email);
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'MFA setup failed';
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_MFA_002', message },
        });
      }
    },
  );
}


export async function mfaEnableRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/mfa/enable — confirm setup with a live TOTP code
  app.post<{ Body: { code: string } }>(
    '/mfa/enable',
    {
      schema: {
        description: 'Confirm MFA enable with a TOTP code',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', minLength: 6, maxLength: 8 },
            flowToken: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const flowToken = (request.body as { flowToken?: string }).flowToken;
      if (typeof flowToken === 'string' && flowToken !== '') {
        // wizard channel: consume the chained token, re-assert active (rev.2 F-B4),
        // then hand out the REAL session via issueTokenPair (full claim table).
        const enrolled = await ctx.flowTokens.consume<{ userId: string }>(flowToken, 'mfa_enroll');
        if (!enrolled) {
          return reply.status(401).send({
            success: false,
            error: { code: 'AUTH_MFA_004', message: 'Invalid or expired enrollment session — sign in again' },
          });
        }
        const um = await getUserManager();
        const wizard = await um.findByIdAny(enrolled.userId);
        if (!wizard) {
          return reply.status(401).send({
            success: false,
            error: { code: 'AUTH_MFA_004', message: 'Invalid or expired enrollment session — sign in again' },
          });
        }
        if (wizard.status !== 'active') {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_004', message: 'Account suspended' },
          });
        }
        try {
          await getMfaManager().enable(wizard.id, request.body.code);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid TOTP code';
          return reply.status(400).send({
            success: false,
            error: { code: 'AUTH_MFA_003', message },
          });
        }
        const issued = await ctx.issueTokenPair(request, wizard);
        // R1-T3: enforced-MFA enroll wizard completion — its own method label
        emitAuthEvent({
          type: 'auth.login.success',
          tenantId: wizard.tenantId ?? DEFAULT_TENANT,
          userId: wizard.id,
          email: wizard.email,
          method: 'admin-wizard',
        });
        return { success: true, data: issued };
      }
      await app.authenticate(request, reply);
      if (ctx.replySent(reply)) return reply;
      const payload = request.user as { sub: string };
      try {
        await getMfaManager().enable(payload.sub, request.body.code);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid TOTP code';
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_MFA_003', message },
        });
      }
    },
  );
}


export async function mfaVerifyRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/mfa/verify — complete MFA login step-up
  app.post<{ Body: { flowToken: string; code: string } }>(
    '/mfa/verify',
    {
      schema: {
        description: 'Verify MFA challenge and exchange flow token for a session',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['flowToken', 'code'],
          properties: {
            flowToken: { type: 'string' },
            code: { type: 'string', minLength: 1 },
          },
        },
        response: {
          401: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { flowToken, code } = request.body;
      const payload = await ctx.flowTokens.consume<{ userId: string }>(flowToken, 'mfa_verify');
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MFA_001', message: 'Invalid or expired MFA challenge' },
        });
      }

      const mfa = getMfaManager();
      const totpOk = (await mfa.verify(payload.userId, code)).success;
      const recoveryOk = totpOk ? false : (await mfa.verifyRecoveryCode(payload.userId, code)).success;
      if (!totpOk && !recoveryOk) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MFA_001', message: 'Invalid MFA code' },
        });
      }

      try {
        // userId round-trips through flow token payload (never trust client identity)
        const userManager = await getUserManager();
        const user = await userManager.findById(
          payload.userId,
          request.tenantId ?? DEFAULT_TENANT,
        );
        if (!user) {
          return reply.status(401).send({
            success: false,
            error: { code: 'AUTH_MFA_001', message: 'User not found' },
          });
        }
        // R1-T10 (DG-8a, re-review note 1): the gate covers BOTH terminal arms —
        // a password-arm-only check would leak unverified TOTP users step-up.
        if (await verifiedEmailRequired(user)) {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_EMAIL_003', message: 'Email address not verified' },
          });
        }
        const { accessToken, refreshToken } = await ctx.issueTokenPair(request, {
          id: user.id,
          email: user.email,
          status: user.status,
          tenantId: user.tenantId,
        });
        // R1-T3: step-up resolved into a real session → success telemetry on the totp lane
        emitAuthEvent({
          type: 'auth.login.success',
          tenantId: user.tenantId ?? DEFAULT_TENANT,
          userId: user.id,
          email: user.email,
          method: 'totp',
        });
        return {
          success: true,
          data: { accessToken, refreshToken, expiresIn: 900 },
        };
      } catch (err) {
        // Tenant gate (G): propagate ahead of the generic MFA failure mapping.
        if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_TENANT_001', message: 'Access denied' },
          });
        }
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MFA_001', message: 'MFA verification failed' },
        });
      }
    },
  );
}


export async function mfaDisableRoutes(app: FastifyInstance, _ctx: AuthContext) {
  // POST /api/v1/auth/mfa/disable — verify password, then wipe MFA
  app.post<{ Body: { password: string } }>(
    '/mfa/disable',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Disable MFA after password re-verification',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const payload = request.user as { sub: string; email: string };
      try {
        const userManager = await getUserManager();
        await userManager.verifyPassword(payload.email, request.body.password);
        await getMfaManager().disable(payload.sub);
        return { success: true };
      } catch {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MFA_004', message: 'Password verification failed' },
        });
      }
    },
  );
}
