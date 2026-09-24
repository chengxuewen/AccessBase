import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { SessionManager, RoleManager, FlowTokenService, MfaManager, getRedisClient, LockoutService, PermissionManager, Mailer, assertPasswordPolicy, readPasswordPolicy, SmsProviderImpl } from '@accessbase/identity';
import type { SmsConfig, SmsProvider } from '@accessbase/identity';
import { getRedis } from '../utils/redis.js';
import { getTenantManager, getUserManager } from '../utils/managers.js';
import { routeTx } from '../utils/tx.js';
import { config } from '../config.js';
import { getOptionsManager } from './options.js';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { logger } from '@accessbase/logging';


interface LoginBody {
  email: string;
  password: string;
}

interface RegisterBody {
  email: string;
  name: string;
  password: string;
}
// H′3: loud one-time warn when the magic-link origin falls back to the request
// Host (attacker-controllable). Module latch = once per process; exported reset
// is a test seam only (latch would otherwise fire in the first fallthrough test).
let hostFallbackWarned = false;
export function _resetHostFallbackWarnForTest(): void {
  hostFallbackWarned = false;
}

/** Q1-b2: shared SMTP option set → Mailer (forgot/magic precedent, env>option>default). */
async function getSmtpMailer(
  options: ReturnType<typeof getOptionsManager>,
): Promise<Mailer | null> {
  const host = await options.get('smtp_host', process.env['SMTP_HOST'], '');
  const port = Number(
    await options.get('smtp_port', process.env['SMTP_PORT'] ? Number(process.env['SMTP_PORT']) : undefined, 587),
  );
  const smtpUser = await options.get('smtp_user', process.env['SMTP_USER'], '');
  const pass = await options.get('smtp_password', process.env['SMTP_PASSWORD'], '');
  const from = await options.get('smtp_from', process.env['SMTP_FROM'], '');
  return host ? Mailer.fromConfig({ host, port, user: smtpUser, pass, from }) : null;
}

/** Q1-b2: magic-link R3 three-arm origin chain (site.url > forwarded host when
 * TRUST_PROXY > request host with the module warn latch). */
async function resolvePublicOrigin(
  request: { headers: { [k: string]: string | string[] | undefined }; protocol: string },
  options: ReturnType<typeof getOptionsManager>,
): Promise<string> {
  const siteUrl = await options.get('site.url', process.env['SITE_URL'], '');
  if (siteUrl) return siteUrl;
  const forwardedHost = config.trustProxy
    ? (request.headers['x-forwarded-host'] as string | undefined)
    : undefined;
  const proto = request.headers['x-forwarded-proto'] ?? request.protocol;
  if (forwardedHost) return `${proto}://${forwardedHost}`;
  if (!hostFallbackWarned) {
    hostFallbackWarned = true;
    logger.warn(
      'verify-email origin falling back to request Host — production MUST set SITE_URL',
    );
  }
  return `${proto}://${request.headers['host'] ?? ''}`;
}

export async function authRoutes(app: FastifyInstance) {
  const sessionManager = new SessionManager(undefined, await getRedis());
  const roleManager = new RoleManager();
  // One manager per app registration — same convention as permissionRoutes.
  const permissionManager = new PermissionManager();

  const lockout = new LockoutService({
    redis: config.nodeEnv === 'test' ? undefined : safeRedis(),
    maxFailures: config.lockoutMaxFailures,
    windowSeconds: config.lockoutWindowSeconds,
  });
  const flowTokens = new FlowTokenService(
    config.nodeEnv === 'test' ? undefined : safeRedis(),
  );
  // Constructed lazily: MFA_ENCRYPTION_KEY is only required when MFA endpoints are used
  const getMfaManager = () => new MfaManager(requireMfaKey());

  function safeRedis() {
    try {
      return getRedisClient();
    } catch {
      return undefined;
    }
  }

  // Tenant suspension gate: shared process singleton (Q2a — was a closure-local holder).

  /**
   * SMS OTP delivery config (options key → env fallback, mailer precedent).
   * Credentials are env-only: secrets never enter the options table.
   * Returns null when no provider is selected (SMS disabled).
   */
  async function readSmsConfig(options: { get<T>(key: string, envValue: T | undefined, defaultValue: T): Promise<T> }): Promise<SmsConfig | null> {
    const provider = await options.get('sms_provider', process.env['SMS_PROVIDER'], '');
    if (!provider) return null;
    const signName = await options.get('sms_sign_name', process.env['SMS_SIGN_NAME'], '');
    const templateCode = await options.get('sms_template_code', process.env['SMS_TEMPLATE_CODE'], '');
    return {
      provider: provider as SmsConfig['provider'],
      signName: signName || undefined,
      templateCode: templateCode || undefined,
      accessKeyId: process.env['ALIBABA_CLOUD_ACCESS_KEY_ID'] || undefined,
      accessKeySecret: process.env['ALIBABA_CLOUD_ACCESS_KEY_SECRET'] || undefined,
      accountSid: process.env['TWILIO_ACCOUNT_SID'] || undefined,
      authToken: process.env['TWILIO_AUTH_TOKEN'] || undefined,
      fromNumber: process.env['TWILIO_FROM_NUMBER'] || undefined,
    };
  }

  /**
   * Tenant suspension gate (G/R1) — fail-closed check run INSIDE issueTokenPair
   * so every issuance path (login/ldap/webauthn/oauth/saml/magic/mfa/
   * change-password) inherits it. Throws a tagged error that the global error
   * handler renders as 403 {code:'AUTH_TENANT_001'}; callers with swallowing
   * catch blocks rethrow it (see catch sites in this file).
   */
  async function assertTenantActive(user?: { tenantId?: string } | null): Promise<void> {
    const tenantId = user?.tenantId ?? DEFAULT_TENANT;
    // Fail-open on lookup ERROR (log + allow): only a confirmed suspended row
    // blocks. Mirrors the rate-limit skipOnError fail-open discipline — a PG
    // blip must not 403/500 every login. DB-down already fails login earlier.
    let tenant;
    try {
      tenant = await (await getTenantManager()).findById(tenantId);
    } catch (err) {
      logger.warn({ err }, 'Tenant status lookup failed — allowing (fail-open)');
      tenant = null;
    }
    if (tenant && tenant.status === 'suspended') {
      const err: Error & { code?: string; statusCode?: number } = new Error('Access denied');
      err.code = 'AUTH_TENANT_001';
      err.statusCode = 403;
      throw err;
    }
  }

  function requireMfaKey(): string {
    if (!config.mfaEncryptionKey) {
      throw new Error('MFA_ENCRYPTION_KEY not configured (32-byte hex required for TOTP)');
    }
    return config.mfaEncryptionKey;
  }

  /** Issue access JWT + refresh token — shared by login (non-MFA) and /mfa/verify */
  async function issueTokenPair(
    request: { ip: string; headers: Record<string, unknown> },
    user: { id: string; email: string; status?: string; tenantId?: string },
  ) {
    await assertTenantActive(user);
    const accessToken = app.jwt.sign(
      // status claim rides along so authenticate can re-check it (P0; absent on legacy tokens → allowed)
      { sub: user.id, email: user.email, status: user.status, tenantId: user.tenantId ?? DEFAULT_TENANT },
      { expiresIn: '15m' },
    );
    const { refreshToken } = await sessionManager.issueRefreshToken(
      crypto.randomUUID(),
      user.id,
      {
        ip: request.ip,
        userAgent:
          (request.headers['user-agent'] as string | undefined) ?? 'unknown',
      },
    );
    return { accessToken, refreshToken };
  }

  /**
   * Real [{id,name}] role list for a user (login + /me share this projection).
   * tenantId comes from the request context; callers on public issuance paths
   * omit it and the default-tenant fallback applies.
   */
  async function rolesOf(userId: string, tenantId?: string): Promise<{ id: string; name: string }[]> {
    const roles = await roleManager.getUserRoles(userId, tenantId ?? DEFAULT_TENANT);
    return roles.map((r) => ({ id: r.id, name: r.name }));
  }
  /** Effective 'resource:action' codes for /auth/me (frontend menu/route gating) */
  async function permissionsOf(userId: string, tenantId?: string): Promise<string[]> {
    const perms = await permissionManager.getUserEffectivePermissions(userId, tenantId ?? DEFAULT_TENANT);
    return perms.map((p) => `${p.resource}:${p.action}`);
  }


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
                  mfaRequired: { type: 'boolean' },
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

      // IP blacklist then account lockout — both before any credential check
      if (await lockout.isIpBlacklisted(request.ip)) {
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_IP_001', message: 'Access denied' },
        });
      }
      if (await lockout.isLocked(email)) {
        return reply.status(423).send({
          success: false,
          error: {
            code: 'AUTH_LOCKED_001',
            message: `Account temporarily locked due to failed attempts. Try again in ${Math.ceil(config.lockoutWindowSeconds / 60)} minutes.`,
          },
        });
      }

      try {
        const userManager = await getUserManager();
        const user = await userManager.verifyPassword(email, password);

        // MFA step-up: user with TOTP enabled gets a flow token, not a session
        if (user.totpEnabled) {
          const flowToken = await flowTokens.issue('mfa_verify', { userId: user.id }, 300);
          return {
            success: true,
            data: { mfaRequired: true, flowToken },
          };
        }

        const { accessToken, refreshToken } = await issueTokenPair(request, user);

        request.log.info({ email }, 'Login successful');
        await lockout.clear(email);

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
              roles: await rolesOf(user.id, request.tenantId),
            },
          },
        };
    } catch (err) {
      // P0: suspended/pending accounts map to a distinct 403 — not a credential
      // failure, so it must not feed the lockout counter either.
      if (err instanceof Error && err.message === 'ACCOUNT_SUSPENDED') {
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_004', message: 'Account suspended' },
        });
      }
      // Tenant gate (G): propagate before lockout counting (same family).
      if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_TENANT_001', message: 'Access denied' },
        });
      }
      await lockout.recordFailure(email);
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
          const vtoken = await flowTokens.issue('email_verify', { userId: user.id }, 86400);
          const origin = await resolvePublicOrigin(request, getOptionsManager());
          const link = `${origin}/verify-email?token=${vtoken}`;
          await mailer.send(
            user.email,
            'Verify your email',
            `<p>Confirm your address: <a href="${link}">${link}</a></p>`,
          );
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
      const token = await flowTokens.issue('email_verify', { userId: user.id }, 86400);
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
      const consumed = await flowTokens.consume<{ userId: string }>(
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
          roles: await rolesOf(user.id, request.tenantId),
          permissions: await permissionsOf(user.id, request.tenantId),
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
          const session = await sessionManager.findSessionByToken(body.refreshToken);
          if (session) {
            await sessionManager.revokeSession(session.id);
          }
        } catch (err) {
          request.log.warn({ err }, 'Logout session revocation failed');
        }
      }
      return { success: true };
    },
  );
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
          const session = await sessionManager.findSessionByToken(body.refreshToken);
          keepSessionId = session?.id ?? null;
        } catch (err) {
          request.log.warn({ err }, 'revoke-others session lookup failed');
        }
      }
      if (keepSessionId) {
        await sessionManager.revokeOtherSessions(payload.sub, keepSessionId);
      } else {
        // No resolvable current session → revoke everything (fail-closed)
        await sessionManager.revokeAllUserSessions(payload.sub);
      }
      return { success: true };
    },
  );
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
      const sessions = await sessionManager.getUserSessions(payload.sub);
      // The access JWT carries no session claim; the client optionally passes its
      // refresh token (same pattern as /logout) to identify its own session.
      let currentSessionId: string | null = null;
      const { refreshToken } = request.query;
      if (refreshToken) {
        try {
          currentSessionId =
            (await sessionManager.findSessionByToken(refreshToken))?.id ?? null;
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
await sessionManager.revokeSession(sessionId);
return { success: true };
},
  );

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
        const presented = await sessionManager.findSessionByToken(refreshToken);
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
          await assertTenantActive(user);
        }

        // DB-backed rotation: validates hash, marks old used, detects replay
        const { refreshToken: newRefreshToken, userId } =
          await sessionManager.rotateRefreshToken(refreshToken, {
            ip: request.ip,
            userAgent: request.headers['user-agent'] ?? '',
          });

        // findByIdAny (G fix L1): same tenant-blindness argument as the gate —
        // a non-default-tenant owner must resolve post-rotation, or a valid
        // refresh 401s AFTER consuming the presented token (stranded token).
        const user = await new (await import('@accessbase/identity'))
          .UserManager()
          .findByIdAny(userId);
        if (!user) throw new Error('User not found');
        const accessToken = app.jwt.sign(
          { sub: userId, email: user.email, status: user.status, tenantId: user.tenantId ?? DEFAULT_TENANT },
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

  // ---- Password management (Phase 6b Task 4) ----

  // AUDIT FIX security.md 19.12 baseline (min 12 + 4 classes) is now the
  // 'password-change' callsite default of the options-driven policy (C2);
  // failures keep the 400 VALIDATION_001 + 'newPassword: ...' contract.
  function policyErrorMessage(message: string): string {
    return `newPassword: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
  }

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
        await sessionManager.revokeAllUserSessions(payload.sub);
        const user = await userManager.findById(
          payload.sub,
          request.tenantId ?? DEFAULT_TENANT,
        );
        if (!user) throw new Error('User not found');
        const { accessToken, refreshToken } = await issueTokenPair(request, { id: user.id, email: user.email, status: user.status, tenantId: user.tenantId });
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
      const options = getOptionsManager();
      const userManager = await getUserManager();
      const user = await userManager.findByEmail(email);
      if (user) {
        const token = await flowTokens.issue('password_reset', { userId: user.id }, 1800);
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
          mailer.send(email, 'Reset your password', `<p>Click to reset: <a href="${link}">${link}</a></p>`).catch((err: unknown) => {
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

  // POST /api/v1/auth/magic/request — passwordless sign-in link (F2).
  // Enumeration-safe: identical 202 body whether or not the account exists.
  // R7: per-IP rate limit only (no email+IP keyGenerator — no in-repo precedent).
  app.post<{ Body: { email: string } }>(
    '/magic/request',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        description: 'Request a magic sign-in link. Always succeeds regardless of account existence.',
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
      const options = getOptionsManager();
      const userManager = await getUserManager();
      const user = await userManager.findByEmail(email);
      if (user && user.status === 'active') {
        const token = await flowTokens.issue('magic_login', { userId: user.id, email: user.email }, 900);
        // R8: identical SMTP keys to forgot-password — no second config source.
        const host = await options.get('smtp_host', process.env['SMTP_HOST'], '');
        const port = Number(await options.get('smtp_port', process.env['SMTP_PORT'] ? Number(process.env['SMTP_PORT']) : undefined, 587));
        const smtpUser = await options.get('smtp_user', process.env['SMTP_USER'], '');
        const pass = await options.get('smtp_password', process.env['SMTP_PASSWORD'], '');
        const from = await options.get('smtp_from', process.env['SMTP_FROM'], '');
        const mailer = host ? Mailer.fromConfig({ host, port, user: smtpUser, pass, from }) : null;
        if (mailer) {
          // H′3 origin chain: options site.url → env SITE_URL → request origin.
          // Raw Host arm is attacker-controllable → loud one-time warn on fallthrough
          // (production MUST set SITE_URL); x-forwarded-host only wins with TRUST_PROXY.
          const siteUrl = await options.get('site.url', process.env['SITE_URL'], '');
          let origin: string;
          if (siteUrl) {
            origin = siteUrl;
          } else {
            // x-forwarded-host only wins when TRUST_PROXY is set (H′3).
            const forwardedHost = config.trustProxy
              ? (request.headers['x-forwarded-host'] as string | undefined)
              : undefined;
            const proto = request.headers['x-forwarded-proto'] ?? request.protocol;
            if (forwardedHost) {
              origin = `${proto}://${forwardedHost}`;
            } else {
              origin = `${proto}://${request.headers.host ?? ''}`;
              if (!hostFallbackWarned) {
                hostFallbackWarned = true;
                logger.warn(
                  'magic-link origin falling back to request Host — production MUST set SITE_URL (poisoning risk)',
                );
              }
            }
          }
          const link = `${origin}/login/magic?token=${token}`;
          // Async: response returns immediately — SMTP RTT is an enumeration timing side-channel (batch F review)
          mailer.send(email, 'Your sign-in link', `<p>Click to sign in: <a href="${link}">${link}</a></p>`).catch((err: unknown) => {
            logger.warn({ err }, 'Magic link delivery failed (degraded to log)');
          });
        } else {
          // Never log the token — it grants a full session.
          logger.warn('magic link: SMTP not configured, link not sent');
        }
      }
      return reply.status(202).send({
        success: true,
        data: { message: 'If an account exists, a sign-in link has been sent.' },
      });
    },
  );

  // POST /api/v1/auth/magic/consume — exchange a magic link token for a session.
  // R13 failure order: bad token → deleted user → email mismatch all return the
  // same generic 401 (token is already burned by consume); suspended is 403.
  app.post<{ Body: { token: string } }>(
    '/magic/consume',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        description: 'Consume a magic sign-in link token (or receive an MFA step-up).',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1 } },
        },
        response: {
          // R2 lesson: declare the FULL union or fast-json-stringify strips fields.
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  // mfa step-up arm
                  mfaRequired: { type: 'boolean' },
                  flowToken: { type: 'string' },
                  // token-pair arm
                  accessToken: { type: 'string' },
                  refreshToken: { type: 'string' },
                  expiresIn: { type: 'number' },
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      email: { type: 'string' },
                      name: { type: 'string' },
                      // R2: declare item fields or fast-json-stringify strips them.
                      roles: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                          },
                        },
                      },
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
          403: {
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
      const payload = await flowTokens.consume<{ userId: string; email: string }>(
        request.body.token,
        'magic_login',
      );
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MAGIC_001', message: 'Invalid or expired sign-in link' },
        });
      }
      const userManager = await getUserManager();
      const user = await userManager.findById(payload.userId, request.tenantId ?? DEFAULT_TENANT);
      if (!user || user.email !== payload.email) {
        // Token already burned above — same generic 401 (R13).
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MAGIC_001', message: 'Invalid or expired sign-in link' },
        });
      }
      if (user.status !== 'active') {
        request.log.warn({ userId: user.id }, 'Magic link consume rejected: account suspended');
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_004', message: 'Account suspended' },
        });
      }
      // MFA step-up: six-way uniform {userId}/300s/mfa_verify.
      if (user.totpEnabled) {
        const flowToken = await flowTokens.issue('mfa_verify', { userId: user.id }, 300);
        return {
          success: true,
          data: { mfaRequired: true, flowToken },
        };
      }
      const { accessToken, refreshToken } = await issueTokenPair(request, user);
      request.log.info({ userId: user.id }, 'Magic link sign-in successful');
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
            roles: await rolesOf(user.id),
          },
        },
      };
    },
  );

  // POST /api/v1/auth/sms-otp/request — passwordless OTP delivery (Batch I).
  // Enumeration-safe: identical 202 body regardless of account/config state.
  // R2: no lockout anywhere in the SMS flow (burn-first FlowToken + rate limit
  // carry brute-force protection; phone lockout would be a cross-user DoS).
  app.post<{ Body: { phone: string } }>(
    '/sms-otp/request',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        description: 'Request an SMS OTP sign-in code. Always succeeds regardless of account existence.',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['phone'],
          // R6: double-escaped in TS source (backslash-plus in the regex).
          properties: { phone: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' } },
        },
        // Q1-b1: declare the 202 shape incl. token (R2 batch-E lesson —
        // fast-json-stringify strips undeclared fields once a schema exists).
        response: {
          202: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  token: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { phone } = request.body;
      const options = getOptionsManager();
      const smsConfig = await readSmsConfig(options);
      const smsProvider: SmsProvider | null = smsConfig ? SmsProviderImpl.fromConfig(smsConfig) : null;
      // Q1-b1 wire-chain fix: ALL arms issue a token and return it (the client
      // needs it at verify time). Non-eligible arms carry userId:null (dummy;
      // verify burns them to a generic 401 before any lookup). Constant-shape
      // 202 = the same enumeration immunity as before, now with a usable token.
      const code = randomInt(100000, 1000000).toString();
      let userId: string | null = null;
      if (!smsProvider) {
        logger.warn('sms-otp request: SMS provider not configured, code not sent');
      } else {
        const userManager = await getUserManager();
        const user = await userManager.findByPhone(phone);
        if (user && user.status === 'active') {
          userId = user.id;
          // Async: response returns immediately — gateway RTT is an enumeration timing side-channel (magic-link precedent)
          smsProvider.send({ to: phone, code }).catch((err: unknown) => {
            logger.warn({ err }, 'SMS delivery failed (degraded to log)');
          });
        }
      }
      const token = await flowTokens.issue('sms_otp', { userId, phone, code }, 300);
      return reply.status(202).send({
        success: true,
        data: { message: 'If an account exists, a verification code has been sent.', token },
      });
    },
  );

  // GET /api/v1/auth/sms/status — public enabled-gate probe for the login
  // surface (saml/status pattern; strict gate hides the SMS UI when unconfigured).
  app.get(
    '/sms/status',
    {
      schema: {
        description: 'Whether SMS OTP sign-in is configured (public gate probe).',
        tags: ['auth'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: { enabled: { type: 'boolean' } } },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const enabled = (await readSmsConfig(getOptionsManager())) !== null;
      return reply.send({ success: true, data: { enabled } });
    },
  );

  // POST /api/v1/auth/sms-otp/verify — exchange an OTP for a session.
  // R3 exact mirror of magic consume with two corrections: findByIdAny (public
  // route has no tenant context — refresh-gate precedent) and phone-match
  // re-validation. R2: zero lockout — failures only 401/403, never 423.
  app.post<{ Body: { token: string; code: string } }>(
    '/sms-otp/verify',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        description: 'Verify an SMS OTP code (or receive an MFA step-up).',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['token', 'code'],
          properties: {
            token: { type: 'string', minLength: 1 },
            code: { type: 'string', pattern: '^\\d{6}$' },
          },
        },
        response: {
          // R2 batch-E lesson: declare the FULL union or fast-json-stringify strips fields.
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  // mfa step-up arm
                  mfaRequired: { type: 'boolean' },
                  flowToken: { type: 'string' },
                  // token-pair arm
                  accessToken: { type: 'string' },
                  refreshToken: { type: 'string' },
                  expiresIn: { type: 'number' },
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      email: { type: 'string' },
                      name: { type: 'string' },
                      roles: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                          },
                        },
                      },
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
          403: {
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
      const payload = await flowTokens.consume<{ userId: string | null; phone: string; code: string }>(
        request.body.token,
        'sms_otp',
      );
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_SMS_001', message: 'Invalid or expired verification code' },
        });
      }
      // Q1-b1/F5: dummy tokens (constant-shape arms) die here — burn happened
      // above, no DB lookup, byte-identical generic 401.
      if (!payload.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_SMS_001', message: 'Invalid or expired verification code' },
        });
      }
      const userManager = await getUserManager();
      const user = await userManager.findByIdAny(payload.userId);
      if (!user || user.phone !== payload.phone || payload.code !== request.body.code) {
        // Token already burned above — same generic 401 (magic R13 order).
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_SMS_001', message: 'Invalid or expired verification code' },
        });
      }
      if (user.status !== 'active') {
        request.log.warn({ userId: user.id }, 'SMS OTP verify rejected: account suspended');
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_004', message: 'Account suspended' },
        });
      }
      // MFA step-up: uniform {userId}/300s/mfa_verify (magic consume mirror).
      if (user.totpEnabled) {
        const flowToken = await flowTokens.issue('mfa_verify', { userId: user.id }, 300);
        return {
          success: true,
          data: { mfaRequired: true, flowToken },
        };
      }
      const { accessToken, refreshToken } = await issueTokenPair(request, user);
      request.log.info({ userId: user.id }, 'SMS OTP sign-in successful');
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
            roles: await rolesOf(user.id),
          },
        },
      };
    },
  );

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
      const payload = await flowTokens.consume<{ userId: string }>(request.body.token, 'password_reset');
      if (!payload) {
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_RESET_001', message: 'Invalid or expired reset token' },
        });
      }
      try {
        const userManager = await getUserManager();
        await userManager.resetPassword(payload.userId, request.body.newPassword);
        await sessionManager.revokeAllUserSessions(payload.userId);
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

  // ---- MFA endpoints (Phase 6b Task 3) ----

  // POST /api/v1/auth/mfa/setup — generate TOTP secret + recovery codes
  app.post(
    '/mfa/setup',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Start TOTP MFA setup: returns otpauth URL, QR and one-time recovery codes',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
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

  // POST /api/v1/auth/mfa/enable — confirm setup with a live TOTP code
  app.post<{ Body: { code: string } }>(
    '/mfa/enable',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Confirm MFA enable with a TOTP code',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 6, maxLength: 8 } },
        },
      },
    },
    async (request, reply) => {
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
      const payload = await flowTokens.consume<{ userId: string }>(flowToken, 'mfa_verify');
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
        const { accessToken, refreshToken } = await issueTokenPair(request, {
          id: user.id,
          email: user.email,
          status: user.status,
          tenantId: user.tenantId,
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

  // POST /api/v1/auth/ldap/login — public (same shape as /login, no preHandler).
  // LDAP sign-in: read config from options/env → provider.authenticate →
  // find-or-provision the real User row here (route layer owns provisioning,
  // R3; provider claims are NOT a User row) → issueTokenPair with status claim.
  interface LdapLoginBody {
    username: string;
    password: string;
  }
  app.post<{ Body: LdapLoginBody }>(
    '/ldap/login',
    {
      // Parity with local login brute-force protection (final review MED).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        description: 'LDAP login',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1 },
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
                  mfaRequired: { type: 'boolean' },
                  flowToken: { type: 'string' },
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
        },
      },
    },
    async (request, reply) => {
      const om = getOptionsManager();
      const get = async (key: string, envKey: string, def: unknown) =>
        om.get(key, process.env[envKey], def);

      // R6: LDAP off by default; enabled + url are both required.
      const enabled = String(await get('ldap_enabled', 'LDAP_ENABLED', 'false')) === 'true';
      const url = String(await get('ldap_url', 'LDAP_URL', ''));
      if (!enabled || !url) {
        return reply.status(503).send({
          success: false,
          error: { code: 'AUTH_063', message: 'LDAP authentication is not available' },
        });
      }
      // Options→LdapConfig mapping (R5: existing field names, zero renames).
      const { LdapProvider } = await import('@accessbase/identity');
      const provider = new LdapProvider({
        enabled,
        url,
        searchBase: String(await get('ldap_base_dn', 'LDAP_BASE_DN', '')),
        bindDN: String(await get('ldap_bind_dn', 'LDAP_BIND_DN', '')),
        bindPassword: String(await get('ldap_bind_password', 'LDAP_BIND_PASSWORD', '')),
        searchFilter: String(await get('ldap_user_filter', 'LDAP_USER_FILTER', '(uid={username})')),
        attributeMapping: { uid: 'uid', mail: 'mail', cn: 'cn', department: 'department' },
        autoProvision: true,
        syncAttributes: true,
        encryptionScheme: '',
        fallbackToLocal: false,
      });

      const result = await provider.authenticate({
        username: request.body.username,
        password: request.body.password,
      });

      if (!result.success || !result.user) {
        const code = result.error?.code ?? 'AUTH_064';
        // R2/R6: 503 unconfigured/unreachable, 401 credential failure (generic
        // message — no LDAP detail leak), 500 attribute-sync/unexpected failure.
        if (code === 'AUTH_063') {
          return reply.status(503).send({
            success: false,
            error: { code, message: 'LDAP service unavailable' },
          });
        }
        if (code === 'AUTH_065') {
          request.log.error({ code }, 'LDAP attribute sync failed');
          return reply.status(500).send({
            success: false,
            error: { code, message: 'LDAP authentication failed' },
          });
        }
        request.log.warn({ code }, 'LDAP login rejected');
        return reply.status(401).send({
          success: false,
          error: { code, message: 'Invalid credentials' },
        });
      }

      const claims = result.user as unknown as {
        dn: string;
        email?: string;
        name?: string;
      };
      // R3: claims carry no id/tenantId/tokenVersion — only dn/email/name are
      // read. A real row comes from find-or-provision below.
      const email = claims.email ?? '';
      const name = claims.name ?? '';
      if (!email) {
        request.log.error({ dn: claims.dn }, 'LDAP entry has no mapped email');
        return reply.status(500).send({
          success: false,
          error: { code: 'AUTH_065', message: 'LDAP authentication failed' },
        });
      }

      try {
        const userManager = await getUserManager();
        // Find-or-provision: email is globally unique; existing rows are
        // reused (link semantics), absent ones provisioned into the default
        // tenant with a null passwordHash (local login stays impossible).
        const existing = await userManager.findByEmail(email);
        const user = existing ?? (await userManager.create({ email, name }, request.tenantId ?? DEFAULT_TENANT));

        // Final review HIGH: a suspended/pending existing account must not
        // obtain an LDAP session — mirror oauth.ts/webauthn.ts 403 AUTH_004.
        // Only the existing row is gated; the provision branch always
        // creates with status 'active'.
        if (existing && existing.status !== 'active') {
          request.log.warn({ userId: existing.id }, 'LDAP login rejected: account suspended');
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_004', message: 'Account suspended' },
          });
        }

        // MFA step-up: TOTP-enabled user gets a flow token, not a session
        if (user.totpEnabled) {
          const flowToken = await flowTokens.issue('mfa_verify', { userId: user.id }, 300);
          return {
            success: true,
            data: { mfaRequired: true, flowToken },
          };
        }

        const { accessToken, refreshToken } = await issueTokenPair(request, user);
        request.log.info({ email }, 'LDAP login successful');
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
              roles: await rolesOf(user.id),
            },
          },
        };
      } catch (err) {
        // Tenant gate (G): propagate ahead of the generic LDAP failure mapping.
        if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_TENANT_001', message: 'Access denied' },
          });
        }
        request.log.error({ err }, 'LDAP provisioning/token issuance failed');
        return reply.status(500).send({
          success: false,
          error: { code: 'AUTH_065', message: 'LDAP authentication failed' },
        });
      }
    },
  );

}
