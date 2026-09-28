/**
 * routes/auth split (batch R2, DG-5 pure move): credential surface —
 * login / register / verify-email pair. Registration order inside the file
 * matches the original monolith.
 */
import type { FastifyInstance } from 'fastify';
import {
  assertPasswordPolicy,
  hasEmailAlias,
  isEmailDomainAllowed,
  readPasswordPolicy,
} from '@accessbase/identity';
import { getRoleManager, getUserManager } from '../../utils/managers.js';
import { enrollGate, optionGetter } from '../../utils/mfa-policy.js';
import { checkCaptcha } from '../../utils/captcha.js';
import { routeTx } from '../../utils/tx.js';
import { config } from '../../config.js';
import { getOptionsManager } from '../options.js';
import { renderEmailFor } from '../../utils/email-templates.js';
import { DEFAULT_TENANT } from '../../utils/constants.js';
import { logger } from '@accessbase/logging';
import { emitAuthEvent } from '../../utils/auth-events.js';
import type { AuthContext, LoginBody, RegisterBody } from './context.js';
import {
  getSmtpMailer,
  resolvePublicOrigin,
  verifiedEmailRequired,
} from './shared.js';

export async function loginRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/login
  app.post<{ Body: LoginBody }>(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        description: 'Password login',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' },
                  refreshToken: { type: 'string' },
                  expiresIn: { type: 'number' },
                  // MFA step-up branch
                  passwordChangeRequired: { type: 'boolean' },
                  mfaRequired: { type: 'boolean' },
                  enroll: { type: 'boolean' },
                  flowToken: { type: 'string' },
                  // Wire carries `user` — undeclared props are stripped by fast-json-stringify
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      email: { type: 'string' },
                      name: { type: 'string' },
                      roles: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
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
      const { email, password } = request.body;

      if (await ctx.cidrGate(request, reply)) return;
      // IP blacklist then account lockout — both before any credential check
      if (await ctx.lockout.isIpBlacklisted(request.ip)) {
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_IP_001', message: 'Access denied' },
        });
      }
      if (await ctx.lockout.isLocked(email)) {
        // R1-T3: locked arm resolves no user row → request-tenant fallback attribution
        emitAuthEvent({
          type: 'auth.login.failure',
          tenantId: request.tenantId ?? DEFAULT_TENANT,
          email,
          method: 'password',
          reason: 'locked',
        });
        return reply.status(423).send({
          success: false,
          error: {
            code: 'AUTH_LOCKED_001',
            message: `Account temporarily locked due to failed attempts. Try again in ${Math.ceil(config.lockoutWindowSeconds / 60)} minutes.`,
          },
        });
      }

      // R1-T3: captured for failure-arm attribution (suspended row has a tenant, the throw doesn't)
      let loginRow: { id: string; tenantId?: string } | undefined;
      try {
        const userManager = await getUserManager();
        const user = await userManager.verifyPassword(email, password);
        loginRow = { id: user.id, tenantId: user.tenantId };

        // Q4a (spec rev.2 B1): armed password change precedes EVERY other arm
        // and issues no session. Field declared below (fast-json strips undeclared).
        if (user.mustChangePassword === true) {
          const flowToken = await ctx.flowTokens.issue('password_reset', { userId: user.id }, 1800);
          return {
            success: true,
            data: { passwordChangeRequired: true, flowToken },
          };
        }

        // MFA step-up: user with TOTP enabled gets a flow token, not a session
// Q3E-E3 enforced-MFA arm (rev.2: BEFORE step-up — unbound users never see a session)
{
  const enroll = await enrollGate({
    getOption: optionGetter(getOptionsManager() as unknown as Parameters<typeof optionGetter>[0]),
    issueEnroll: async (uid) => ctx.flowTokens.issue('mfa_enroll', { userId: uid }, 300),
    isSystemAdmin: async () =>
      (await (await getRoleManager()).getEffectiveRoles(user.id, user.tenantId ?? DEFAULT_TENANT)).some(
        (r) => r.isSystem === true,
      ),
    user,
  });
  if (enroll) return { success: true, data: enroll };
}
        if (user.totpEnabled) {
          const flowToken = await ctx.flowTokens.issue('mfa_verify', { userId: user.id }, 300);
          return {
            success: true,
            data: { mfaRequired: true, flowToken },
          };
        }

        // R1-T10 (DG-8a): verified-email terminal gate — no session, no lockout
        // feed (credentials were correct), no auth.login.failure row (not a
        // credential failure; reason space unchanged). 403 pattern mirrors AUTH_004.
        if (await verifiedEmailRequired(user)) {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_EMAIL_003', message: 'Email address not verified' },
          });
        }
        const { accessToken, refreshToken } = await ctx.issueTokenPair(request, user);
        // R1-T3: session delivered → success telemetry (fire-and-forget, never blocks the response)
        emitAuthEvent({
          type: 'auth.login.success',
          tenantId: user.tenantId ?? DEFAULT_TENANT,
          userId: user.id,
          email: user.email,
          method: 'password',
        });

        request.log.info({ email }, 'Login successful');
        await ctx.lockout.clear(email);

        return {
          success: true,
          data: {
            accessToken,
            refreshToken,
            expiresIn: 900,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              roles: await ctx.rolesOf(user.id, request.tenantId),
            },
          },
        };
    } catch (err) {
      // P0: suspended/pending accounts map to a distinct 403 — not a credential
      // failure, so it must not feed the lockout counter either.
      if (err instanceof Error && err.message === 'ACCOUNT_SUSPENDED') {
        emitAuthEvent({
          type: 'auth.login.failure',
          tenantId: loginRow?.tenantId ?? request.tenantId ?? DEFAULT_TENANT,
          userId: loginRow?.id,
          email,
          method: 'password',
          reason: 'suspended',
        });
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_004', message: 'Account suspended' },
        });
      }
      // Tenant gate (G): propagate before lockout counting (same family).
      if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
        emitAuthEvent({
          type: 'auth.login.failure',
          tenantId: request.tenantId ?? DEFAULT_TENANT,
          email,
          method: 'password',
          // Tenant-suspended login: not a credential failure and no per-row attribution
          reason: 'other',
        });
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_TENANT_001', message: 'Access denied' },
        });
      }
      await ctx.lockout.recordFailure(email);
        // R1-T3: wrong password AND unknown user both land here (verifyPassword throws alike)
        emitAuthEvent({
          type: 'auth.login.failure',
          tenantId: request.tenantId ?? DEFAULT_TENANT,
          email,
          method: 'password',
          reason: 'bad_credentials',
        });
        request.log.warn({ email }, 'Login failed');
        return reply.status(401).send({
          success: false,
          error: {
            code: 'AUTH_002',
            message: 'Invalid email or password',
          },
        });
      }
    },
  );
}


export async function registerRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/register
  app.post<{ Body: RegisterBody }>(
    '/register',
    {
      schema: {
        description: 'User registration',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'name', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            name: { type: 'string', minLength: 1 },
            // No minLength here: password policy (8+ / lower / upper / digit)
            // is enforced by the handler so all rejections share AUTH_REG_002.
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, name, password } = request.body;

      if (await ctx.cidrGate(request, reply)) return;
      const captchaErr = await checkCaptcha(request.body as unknown as Record<string, unknown>);
      if (captchaErr !== null) {
        return reply.status(400).send({
          success: false,
          error: { code: captchaErr, message: 'Complete the captcha challenge first' },
        });
      }

      // R1-T9 (DG-7): domain/alias policy ported verbatim from the retired
      // PasswordProvider — rejected at the door before any user write (the
      // route tests lock zero-inserts-on-rejection).
      if (!isEmailDomainAllowed(email, config.authAllowedDomains, config.authBlockedDomains)) {
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_033', message: 'Email domain is blocked' },
        });
      }
      if (hasEmailAlias(email, config.authBlockEmailAliases)) {
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_034', message: 'Email aliases are not allowed' },
        });
      }

      const userManager = await getUserManager();

      if (await userManager.findByEmail(email)) {
        return reply.status(409).send({
          success: false,
          error: { code: 'AUTH_REG_001', message: 'Email already registered' },
        });
      }

      // Policy is options-driven (C2); defaults reproduce the hardcoded
      // 8/lower/upper/digit rule exactly when nothing is configured.
      const om = getOptionsManager();
      const policy = await readPasswordPolicy(om.get.bind(om), 'register');
      const result = assertPasswordPolicy(password, policy, 'AUTH_REG_002');
      if (!result.ok) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'AUTH_REG_002',
            message: result.message,
          },
        });
      }

      // create() derives status from isActive (default active); pending is
      // achieved by create-then-changeStatus — dropping changeStatus would
      // silently register ACTIVE users.
      // Q2b: create + pending transition are ONE transaction — a crash between
      // them previously left a fully ACTIVE self-registered user (privilege arm
      // by timing; gap-audit D1).
      const user = await routeTx(async (tx) => {
        const created = await userManager.create(
          { email, name, password },
          request.tenantId ?? DEFAULT_TENANT,
          tx,
        );
        await userManager.changeStatus(created.id, 'pending', request.tenantId ?? DEFAULT_TENANT, tx);
        return created;
      });

      // Q1-b2: best-effort verification email. SMTP is optional — silent failure
      // here never fails registration; the user can self-request post-activation.
      void getSmtpMailer(getOptionsManager())
        .then(async (mailer) => {
          if (!mailer) return;
          const vtoken = await ctx.flowTokens.issue('email_verify', { userId: user.id }, 86400);
          const origin = await resolvePublicOrigin(request, getOptionsManager());
          const link = `${origin}/verify-email?token=${vtoken}`;
          const rendered = await renderEmailFor('verify', { link, name: user.name }, getOptionsManager());
          await mailer.send(user.email, rendered.subject, rendered.html);
        })
        .catch((err: unknown) => {
          request.log.warn({ err }, 'verify-email send at register failed (best-effort)');
        });

      request.log.info({ email }, 'Registration created pending user');

      return reply.status(201).send({
        success: true,
        data: { id: user.id, email: user.email, name: user.name, status: 'pending' },
      });
    },
  );
}


export async function verifyEmailRequestRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/verify-email/request — authenticated self-service (Q1-b2,
  // closes design A4). 503 when SMTP unconfigured: this route has an audience
  // (the logged-in user) who needs to know delivery is impossible — unlike the
  // silent log-only arms of forgot/magic which stay enumeration-shaped.
  app.post(
    '/verify-email/request',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        description: 'Send an email-verification link to the authenticated user',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const payload = request.user as { sub: string };
      const userManager = await getUserManager();
      const user = await userManager.findById(payload.sub, request.tenantId ?? DEFAULT_TENANT);
      if (!user) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_002', message: 'Invalid session' },
        });
      }
      const options = getOptionsManager();
      const mailer = await getSmtpMailer(options);
      if (!mailer) {
        return reply.status(503).send({
          success: false,
          error: { code: 'AUTH_EMAIL_002', message: 'Email delivery not configured' },
        });
      }
      const token = await ctx.flowTokens.issue('email_verify', { userId: user.id }, 86400);
      const origin = await resolvePublicOrigin(request, options);
      const link = `${origin}/verify-email?token=${token}`;
      mailer
        .send(user.email, 'Verify your email', `<p>Confirm your address: <a href="${link}">${link}</a></p>`)
        .catch((err: unknown) => {
          logger.warn({ err }, 'Verify-email delivery failed (degraded to log)');
        });
      return reply.status(202).send({
        success: true,
        data: { message: 'Verification email sent. Check your inbox.' },
      });
    },
  );
}


export async function verifyEmailConsumeRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/verify-email — PUBLIC consume (token-only). Note rev.2 F1:
  // publicity = ABSENCE of the per-route app.authenticate preHandler; the
  // identity PUBLIC_ROUTES lists are dead code and deliberately NOT touched.
  app.post<{ Body: { token: string } }>(
    '/verify-email',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        description: 'Consume an email-verification link token',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const consumed = await ctx.flowTokens.consume<{ userId: string }>(
        request.body.token,
        'email_verify',
      );
      if (!consumed?.userId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_EMAIL_001', message: 'Invalid or expired verification link' },
        });
      }
      const userManager = await getUserManager();
      await userManager.markEmailVerified(consumed.userId);
      return { success: true, data: { verified: true } };
    },
  );
}
