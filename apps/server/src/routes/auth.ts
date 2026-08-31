import type { FastifyInstance } from 'fastify';
import { SessionManager, FlowTokenService, MfaManager, getRedisClient } from '@accessbase/identity';
import { config } from '../config.js';
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
  const sessionManager = new SessionManager();
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
    user: { id: string; email: string },
  ) {
    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email },
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
              roles: [],
            },
          },
        };
      } catch {
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
            password: { type: 'string', minLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, name } = request.body;

      // TODO: Use @accessbase/identity UserManager when implemented
      request.log.info({ email, name }, 'Registration attempt');

      return reply.status(501).send({
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Identity package not yet wired',
        },
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
      const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
      const user = await userManager.findById(payload.sub, DEFAULT_TENANT);
      if (!user) {
        throw new Error('User not found');
      }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: [],
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
        // DB-backed rotation: validates hash, marks old used, detects replay
        const { refreshToken: newRefreshToken, userId } =
          await sessionManager.rotateRefreshToken(refreshToken, {
            ip: request.ip,
            userAgent: request.headers['user-agent'] ?? '',
          });

        const accessToken = app.jwt.sign({ sub: userId }, { expiresIn: '15m' });

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
          '00000000-0000-0000-0000-000000000001',
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
