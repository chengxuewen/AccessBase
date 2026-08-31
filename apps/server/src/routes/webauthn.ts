/**
 * WebAuthn/Passkey routes (Phase 6d Task 3)
 *
 * Flows:
 * - register/options (auth): generateRegistrationOptions + excludeCredentials from
 *   stored rows; challenge handed to the client as a single-use FlowToken
 *   ('webauthn_reg:<userId>', 300s) — D107 hand-off pattern, challenge never
 *   server-side session-scoped.
 * - register/verify (auth): consume token → verifyRegistrationResponse → store
 *   credential (publicKey base64, counter, transports JSON).
 * - login/options (public): discoverable credentials (usernameless, D108) —
 *   generateAuthenticationOptions without allowCredentials; challenge handed as
 *   FlowToken ('webauthn_login', 300s).
 * - login/verify (public): consume token → find credential by response.id →
 *   verifyAuthenticationResponse → counter regression check (AUTH_WEBAUTHN_003) →
 *   update counter/lastUsedAt → issue session (same shape as password login).
 * - GET/DELETE /credentials (auth): passkey management for Settings.
 *
 * MFA interplay: NONE — WebAuthn login bypasses TOTP step-up (same known
 * limitation as OAuth login; a passkey with UV is itself a possession+inherence factor).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import { createDb, webauthnCredentials, users } from '@accessbase/identity/db';
import type { DrizzleDB } from '@accessbase/identity/db';
import { SessionManager, FlowTokenService, getRedisClient } from '@accessbase/identity';
import { config } from '../config.js';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

const CHALLENGE_TTL_SECONDS = 300;

interface RegistrationInfoCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
}

function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const KNOWN: readonly string[] = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'];
    const list = parsed.map(String).filter((t): t is AuthenticatorTransportFuture => KNOWN.includes(t));
    return list.length > 0 ? list : undefined;
  } catch {
    return undefined;
  }
}

export async function webauthnRoutes(app: FastifyInstance) {
  const db: DrizzleDB = createDb(config.databaseUrl);
  const sessionManager = new SessionManager();
  const flowTokens = new FlowTokenService(
    config.nodeEnv === 'test' ? undefined : safeRedis(),
  );

  function safeRedis() {
    try {
      return getRedisClient();
    } catch {
      return undefined;
    }
  }

  function authError(
    reply: FastifyReply,
    status: number,
    code: string,
    message: string,
  ): void {
    void reply.status(status).send({
      success: false,
      error: { code, message },
    });
  }

  /** Issue access JWT + refresh token (same claims/shape as login). */
  async function issueTokenPair(
    request: { ip: string; headers: Record<string, unknown> },
    user: { id: string; email: string },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '15m' });
    const { refreshToken } = await sessionManager.issueRefreshToken(
      crypto.randomUUID(),
      user.id,
      {
        ip: request.ip,
        userAgent: (request.headers['user-agent'] as string | undefined) ?? 'unknown',
      },
    );
    return { accessToken, refreshToken };
  }

  // POST /api/v1/auth/webauthn/register/options (auth required)
  app.post(
    '/webauthn/register/options',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Generate WebAuthn registration options (passkey enrollment)',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { sub: string; email: string; name?: string };
      const existing = await db
        .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, payload.sub));

      const options = await generateRegistrationOptions({
        rpName: config.webauthn.rpName,
        rpID: config.webauthn.rpId,
        userName: payload.email,
        userDisplayName: payload.name ?? payload.email,
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        excludeCredentials: existing.map((c) => ({
          id: c.credentialId,
          transports: parseTransports(c.transports),
        })),
      });

      const flowToken = await flowTokens.issue(
        `webauthn_reg:${payload.sub}`,
        { challenge: options.challenge },
        CHALLENGE_TTL_SECONDS,
      );
      return { success: true, data: { options, flowToken } };
    },
  );

  // POST /api/v1/auth/webauthn/register/verify (auth required)
  app.post(
    '/webauthn/register/verify',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Verify WebAuthn registration response and store the credential',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const payload = request.user as { sub: string };
      const { flowToken, response } = request.body as {
        flowToken?: string;
        response?: unknown;
      };

      const consumed = flowToken
        ? await flowTokens.consume<{ challenge: string }>(
            flowToken,
            `webauthn_reg:${payload.sub}`,
          )
        : null;
      if (!consumed) {
        return authError(reply, 400, 'AUTH_WEBAUTHN_001', 'Invalid, expired, or replayed registration token');
      }

      const verification = await verifyRegistrationResponse({
        response: response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge: consumed.challenge,
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpId,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return authError(reply, 400, 'AUTH_WEBAUTHN_001', 'Registration verification failed');
      }

      const info = verification.registrationInfo;
      const credential: RegistrationInfoCredential = info.credential;
      await db.insert(webauthnCredentials).values({
        userId: payload.sub,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
      });

      return { success: true, data: { verified: true } };
    },
  );

  // POST /api/v1/auth/webauthn/login/options (public — discoverable/usernameless)
  app.post(
    '/webauthn/login/options',
    {
      schema: {
        description: 'Generate WebAuthn authentication options (discoverable credentials, D108)',
        tags: ['auth'],
      },
    },
    async () => {
      const options = await generateAuthenticationOptions({
        rpID: config.webauthn.rpId,
        userVerification: 'preferred',
        // no allowCredentials → discoverable credentials (usernameless)
      });
      const flowToken = await flowTokens.issue(
        'webauthn_login',
        { challenge: options.challenge },
        CHALLENGE_TTL_SECONDS,
      );
      return { success: true, data: { options, flowToken } };
    },
  );

  // POST /api/v1/auth/webauthn/login/verify (public)
  app.post(
    '/webauthn/login/verify',
    {
      schema: {
        description: 'Verify WebAuthn assertion and establish a session',
        tags: ['auth'],
      },
    },
    async (request, reply) => {
      const { flowToken, response } = request.body as {
        flowToken?: string;
        response?: { id?: string };
      };

      const consumed = flowToken
        ? await flowTokens.consume<{ challenge: string }>(flowToken, 'webauthn_login')
        : null;
      if (!consumed) {
        return authError(reply, 401, 'AUTH_WEBAUTHN_004', 'Invalid, expired, or replayed challenge token');
      }
      if (!response?.id) {
        return authError(reply, 401, 'AUTH_WEBAUTHN_004', 'Malformed assertion response');
      }

      const [row] = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.credentialId, response.id))
        .limit(1);
      if (!row) {
        return authError(reply, 401, 'AUTH_WEBAUTHN_002', 'Unknown credential');
      }

      const verification = await verifyAuthenticationResponse({
        response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: consumed.challenge,
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpId,
        credential: {
          id: row.credentialId,
          publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64')),
          counter: row.counter,
          transports: parseTransports(row.transports),
        },
      });
      if (!verification.verified) {
        return authError(reply, 401, 'AUTH_WEBAUTHN_002', 'WebAuthn verification failed');
      }

      // Counter regression = cloned authenticator signal
      const newCounter = verification.authenticationInfo.newCounter;
      if (row.counter > 0 && newCounter > 0 && newCounter <= row.counter) {
        return authError(reply, 400, 'AUTH_WEBAUTHN_003', 'Counter regression detected (possible cloned authenticator)');
      }

      await db
        .update(webauthnCredentials)
        .set({ counter: newCounter, lastUsedAt: new Date() })
        .where(eq(webauthnCredentials.id, row.id));

      const [user] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      if (!user) {
        return authError(reply, 401, 'AUTH_WEBAUTHN_002', 'Unknown credential');
      }

      const { accessToken, refreshToken } = await issueTokenPair(request, user);
      return {
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn: 900,
          user: { id: user.id, email: user.email, name: user.name },
        },
      };
    },
  );

  // GET /api/v1/auth/webauthn/credentials (auth) — safe shape for Settings UI
  app.get(
    '/webauthn/credentials',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'List passkey credentials for the current user',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { sub: string };
      const rows = await db
        .select({
          id: webauthnCredentials.id,
          transports: webauthnCredentials.transports,
          createdAt: webauthnCredentials.createdAt,
          lastUsedAt: webauthnCredentials.lastUsedAt,
        })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, payload.sub));
      return {
        success: true,
        data: rows.map((r) => ({ ...r, transports: parseTransports(r.transports) ?? [] })),
      };
    },
  );

  // DELETE /api/v1/auth/webauthn/credentials/:id (auth) — owner-scoped
  app.delete<{ Params: { id: string } }>(
    '/webauthn/credentials/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Delete a passkey credential owned by the current user',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const payload = request.user as { sub: string };
      const deleted = await db
        .delete(webauthnCredentials)
        .where(
          and(
            eq(webauthnCredentials.id, request.params.id),
            eq(webauthnCredentials.userId, payload.sub),
          ),
        )
        .returning({ id: webauthnCredentials.id });
      if (deleted.length === 0) {
        return authError(reply, 404, 'AUTH_WEBAUTHN_005', 'Credential not found');
      }
      return { success: true };
    },
  );
}
