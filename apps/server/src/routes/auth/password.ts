/**
 * routes/auth split (batch R2, DG-5 pure move): password lane —
 * change-password / forgot-password / reset-password (Phase 6b Task 4 block).
 * The passwordless lane registers BETWEEN forgot and reset in the façade —
 * exactly where the monolith had it.
 */
import type { FastifyInstance } from 'fastify';
import {
  Mailer,
  assertPasswordPolicy,
  readPasswordPolicy,
} from '@accessbase/identity';
import { getUserManager } from '../../utils/managers.js';
import { checkCaptcha } from '../../utils/captcha.js';
import { getOptionsManager } from '../options.js';
import { renderEmailFor } from '../../utils/email-templates.js';
import { DEFAULT_TENANT } from '../../utils/constants.js';
import { logger } from '@accessbase/logging';
import type { AuthContext } from './context.js';
import { policyErrorMessage } from './shared.js';

// ---- Password management (Phase 6b Task 4) ----

export async function changePasswordRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/change-password
  app.post<{ Body: { oldPassword: string; newPassword: string } }>(
    '/change-password',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Change password: verifies old, rejects last-5 reuse, revokes other sessions',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const payload = request.user as { sub: string };
      const om = getOptionsManager();
      const policy = await readPasswordPolicy(om.get.bind(om), 'password-change');
      const result = assertPasswordPolicy(request.body.newPassword, policy);
      if (!result.ok) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_001', message: policyErrorMessage(result.message) },
        });
      }
      try {
        const userManager = await getUserManager();
        await userManager.changePassword(payload.sub, request.body.oldPassword, request.body.newPassword);
        // Force re-auth everywhere, then hand the current client a fresh session
        await ctx.sessionManager.revokeAllUserSessions(payload.sub);
        const user = await userManager.findById(
          payload.sub,
          request.tenantId ?? DEFAULT_TENANT,
        );
        if (!user) throw new Error('User not found');
        const { accessToken, refreshToken } = await ctx.issueTokenPair(request, { id: user.id, email: user.email, status: user.status, tenantId: user.tenantId });
        return { success: true, data: { accessToken, refreshToken, expiresIn: 900 } };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Password change failed';
        if (message === 'PASSWORD_REUSED') {
          return reply.status(400).send({
            success: false,
            error: { code: 'PASSWORD_REUSED', message: 'Password was used recently' },
          });
        }
        if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_TENANT_001', message: 'Access denied' },
          });
        }
        request.log.warn({ err }, 'Password change failed');
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_002', message: 'Invalid credentials' },
        });
      }
    },
  );
}


export async function forgotPasswordRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/forgot-password — always 200 (anti-enumeration)
  app.post<{ Body: { email: string } }>(
    '/forgot-password',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        description: 'Request password reset. Always succeeds regardless of account existence.',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body;

      if (await ctx.cidrGate(request, reply)) return;
      const captchaErr = await checkCaptcha(request.body as unknown as Record<string, unknown>);
      if (captchaErr !== null) {
        return reply.status(400).send({
          success: false,
          error: { code: captchaErr, message: 'Complete the captcha challenge first' },
        });
      }
      const options = getOptionsManager();
      const userManager = await getUserManager();
      const user = await userManager.findByEmail(email);
      if (user) {
        const token = await ctx.flowTokens.issue('password_reset', { userId: user.id }, 1800);
        // Options table SMTP config (env>option>default built into OptionsManager.get);
        // no host → fromConfig returns null → log-only fallback, behavior unchanged.
        const host = await options.get('smtp_host', process.env['SMTP_HOST'], '');
        const port = Number(await options.get('smtp_port', process.env['SMTP_PORT'] ? Number(process.env['SMTP_PORT']) : undefined, 587));
        const smtpUser = await options.get('smtp_user', process.env['SMTP_USER'], '');
        const pass = await options.get('smtp_password', process.env['SMTP_PASSWORD'], '');
        const from = await options.get('smtp_from', process.env['SMTP_FROM'], '');
        const mailer = host ? Mailer.fromConfig({ host, port, user: smtpUser, pass, from }) : null;
        if (mailer) {
          const link = `${process.env['FRONTEND_ORIGIN'] ?? ''}/reset-password?token=${token}`;
          // Async: response returns immediately — SMTP RTT is an enumeration timing side-channel (batch F review)
          const rendered = await renderEmailFor('reset', { link, name: user.name }, options);
          mailer.send(email, rendered.subject, rendered.html).catch((err: unknown) => {
            logger.warn({ err }, 'Reset email delivery failed (degraded to log)');
          });
        } else {
          // Credential-in-log rule (W1-6/N1): full reset tokens NEVER hit logs,
          // on any env — the former development branch made stdout a credential
          // store on deployments that forgot NODE_ENV (default: development).
          // 8-char prefix correlates with the request, useless to an attacker;
          // dev workflows needing the raw token read it from redis (flow:*) or
          // tests, not from logs.
          const loggedToken = token.slice(0, 8) + '…';
          request.log.info({ email, token: loggedToken }, 'Password reset URL: /reset-password?token=' + loggedToken);
        }
      }
      return reply.send({ success: true });
    },
  );
}


export async function resetPasswordRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/reset-password
  app.post<{ Body: { token: string; newPassword: string } }>(
    '/reset-password',
    {
      schema: {
        description: 'Reset password with a flow token from forgot-password',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['token', 'newPassword'],
          properties: {
            token: { type: 'string' },
            newPassword: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const om = getOptionsManager();
      const policy = await readPasswordPolicy(om.get.bind(om), 'password-change');
      const result = assertPasswordPolicy(request.body.newPassword, policy);
      if (!result.ok) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_001', message: policyErrorMessage(result.message) },
        });
      }
      const payload = await ctx.flowTokens.consume<{ userId: string }>(request.body.token, 'password_reset');
      if (!payload) {
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_RESET_001', message: 'Invalid or expired reset token' },
        });
      }
      try {
        const userManager = await getUserManager();
        await userManager.resetPassword(payload.userId, request.body.newPassword);
        await ctx.sessionManager.revokeAllUserSessions(payload.userId);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Password reset failed';
        if (message === 'PASSWORD_REUSED') {
          return reply.status(400).send({
            success: false,
            error: { code: 'PASSWORD_REUSED', message: 'Password was used recently' },
          });
        }
        request.log.warn({ err }, 'Password reset failed');
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_RESET_002', message: 'Password reset failed' },
        });
      }
    },
  );
}
