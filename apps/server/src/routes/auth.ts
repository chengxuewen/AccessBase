import type { FastifyInstance } from 'fastify';
import { SessionManager, RoleManager, FlowTokenService, MfaManager, getRedisClient, LockoutService, PermissionManager, Mailer, assertPasswordPolicy, readPasswordPolicy } from '@accessbase/identity';
import { getRedis } from '../utils/redis.js';
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

  function requireMfaKey(): string {
    if (!config.mfaEncryptionKey) {
      throw new Error('MFA_ENCRYPTION_KEY not configured (32-byte hex required for TOTP)');
    }
    return config.mfaEncryptionKey;
  }

  /** Issue access JWT + refresh token — shared by login (non-MFA) and /mfa/verify */
  async function issueTokenPair(
    request: { ip: string; headers: Record<string, unknown> },
    user: { id: string; email: string; status?: string },
  ) {
    const accessToken = app.jwt.sign(
      // status claim rides along so authenticate can re-check it (P0; absent on legacy tokens → allowed)
      { sub: user.id, email: user.email, status: user.status },
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

  /** Real [{id,name}] role list for a user (login + /me share this projection) */
  async function rolesOf(userId: string): Promise<{ id: string; name: string }[]> {
    const roles = await roleManager.getUserRoles(userId, DEFAULT_TENANT);
    return roles.map((r) => ({ id: r.id, name: r.name }));
  }
  /** Effective 'resource:action' codes for /auth/me (frontend menu/route gating) */
  async function permissionsOf(userId: string): Promise<string[]> {
    const perms = await permissionManager.getUserEffectivePermissions(userId, DEFAULT_TENANT);
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
        const userManager = new (await import('@accessbase/identity')).UserManager();
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
              roles: await rolesOf(user.id),
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

      const userManager = new (await import('@accessbase/identity')).UserManager();

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
      const user = await userManager.create(
        { email, name, password },
        DEFAULT_TENANT,
      );
      await userManager.changeStatus(user.id, 'pending', DEFAULT_TENANT);

      request.log.info({ email }, 'Registration created pending user');

      return reply.status(201).send({
        success: true,
        data: { id: user.id, email: user.email, name: user.name, status: 'pending' },
      });
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
      const userManager = new (await import('@accessbase/identity')).UserManager();
      const user = await userManager.findById(payload.sub, DEFAULT_TENANT);
      if (!user) {
        throw new Error('User not found');
      }
      return {
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: await rolesOf(user.id),
          permissions: await permissionsOf(user.id),
          // users.mfaEnabled column is dead; totpEnabled is the live MFA state (MfaManager writes it)
          mfaEnabled: user.totpEnabled ?? false,
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
          const user = await new (await import('@accessbase/identity')).UserManager().findById(
            gateUserId,
            DEFAULT_TENANT,
          );
          if (user?.status && user.status !== 'active') {
            throw new Error('ACCOUNT_SUSPENDED');
          }
        }

        // DB-backed rotation: validates hash, marks old used, detects replay
        const { refreshToken: newRefreshToken, userId } =
          await sessionManager.rotateRefreshToken(refreshToken, {
            ip: request.ip,
            userAgent: request.headers['user-agent'] ?? '',
          });

        // Claim source for the new access token (post-rotate owner re-check is
        // the same user; gate above already rejected suspended owners).
        const user = await new (await import('@accessbase/identity')).UserManager().findById(
          userId,
          DEFAULT_TENANT,
        );
        if (!user) throw new Error('User not found');
        const accessToken = app.jwt.sign(
          { sub: userId, email: user.email, status: user.status },
          { expiresIn: '15m' },
        );

        return {
          success: true,
          data: { accessToken, refreshToken: newRefreshToken, expiresIn: 900 },
        };
      } catch (err) {
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
        const userManager = new (await import('@accessbase/identity')).UserManager();
        await userManager.changePassword(payload.sub, request.body.oldPassword, request.body.newPassword);
        // Force re-auth everywhere, then hand the current client a fresh session
        await sessionManager.revokeAllUserSessions(payload.sub);
        const user = await userManager.findById(
          payload.sub,
          DEFAULT_TENANT,
        );
        if (!user) throw new Error('User not found');
        const { accessToken, refreshToken } = await issueTokenPair(request, { id: user.id, email: user.email, status: user.status });
        return { success: true, data: { accessToken, refreshToken, expiresIn: 900 } };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Password change failed';
        if (message === 'PASSWORD_REUSED') {
          return reply.status(400).send({
            success: false,
            error: { code: 'PASSWORD_REUSED', message: 'Password was used recently' },
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
      const userManager = new (await import('@accessbase/identity')).UserManager();
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
          await mailer.send(email, 'Reset your password', `<p>Click to reset: <a href="${link}">${link}</a></p>`).catch((err: unknown) => {
            logger.warn({ err }, 'Reset email delivery failed (degraded to log)');
          });
        } else {
          // Credential-in-log rule: the full reset token authorizes a password
          // change, so it may only hit logs in development. Outside development
          // log an 8-char prefix — enough to correlate, useless to an attacker.
          const loggedToken =
            config.nodeEnv === 'development' ? token : token.slice(0, 8) + '…';
          request.log.info({ email, token: loggedToken }, 'Password reset URL: /reset-password?token=' + loggedToken);
        }
      }
      return reply.send({ success: true });
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
        const userManager = new (await import('@accessbase/identity')).UserManager();
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
        const userManager = new (await import('@accessbase/identity')).UserManager();
        const user = await userManager.findById(
          payload.userId,
          DEFAULT_TENANT,
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
        });
        return {
          success: true,
          data: { accessToken, refreshToken, expiresIn: 900 },
        };
      } catch {
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
        const userManager = new (await import('@accessbase/identity')).UserManager();
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
