/**
 * OAuth social login routes (Phase 6d Task 1)
 *
 * Providers: GitHub (classic OAuth App, state-only — D109 PKCE exemption),
 * Google (PKCE via arctic). Callback mints a single-use FlowToken
 * ('oauth_exchange', 60s) that the SPA exchanges over AJAX for a session —
 * tokens never ride the redirect (anti-interception, D107 pattern).
 *
 * Errors redirect to /login?oauthError=<reason> — no stack traces (anti-enumeration).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { GitHub, Google, generateState, generateCodeVerifier, type OAuth2Tokens } from 'arctic';
import { and, eq } from 'drizzle-orm';
import { createDb, oauthAccounts, users } from '@accessbase/identity/db';
import type { DrizzleDB } from '@accessbase/identity/db';
import { SessionManager, FlowTokenService, getRedisClient } from '@accessbase/identity';
import { randomBytes } from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { config } from '../config.js';

const SUPPORTED_PROVIDERS = ['github', 'google'] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const STATE_COOKIE = 'oauth_state';
const VERIFIER_COOKIE = 'oauth_verifier';
const COOKIE_MAX_AGE_SECONDS = 10 * 60;
const EXCHANGE_TTL_SECONDS = 60;

interface NormalizedProfile {
  providerAccountId: string;
  email: string;
  name: string;
}

function isSupportedProvider(p: string): p is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

function getProvider(name: SupportedProvider): GitHub | Google {
  switch (name) {
    case 'github':
      // GitHub OAuth Apps do not support PKCE (D109) — redirectURI null
      return new GitHub(config.oauth.github.clientId, config.oauth.github.clientSecret, null);
    case 'google':
      return new Google(
        config.oauth.google.clientId,
        config.oauth.google.clientSecret,
        `${config.oauthRedirectBase}/api/v1/auth/oauth/google/callback`,
      );
  }
}

function providerConfigured(name: SupportedProvider): boolean {
  const creds =
    name === 'github'
      ? config.oauth.github
      : config.oauth.google;
  return creds.clientId !== '' && creds.clientSecret !== '';
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/** GitHub: /user (+ /user/emails when no public email). Google: userinfo endpoint. */
async function fetchProviderProfile(provider: SupportedProvider, accessToken: string): Promise<NormalizedProfile> {
  if (provider === 'github') {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('github_profile_fetch_failed');
    const profile = (await res.json()) as { id: number; login: string; name: string | null; email: string | null };
    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        email = emails.find((e) => e.primary && e.verified)?.email ?? null;
      }
    }
    return {
      providerAccountId: String(profile.id),
      email: email ?? '',
      name: profile.name ?? profile.login,
    };
  }
  // Google
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('google_profile_fetch_failed');
  const profile = (await res.json()) as { sub: string; email?: string; name?: string };
  return {
    providerAccountId: profile.sub,
    email: profile.email ?? '',
    name: profile.name ?? profile.email ?? profile.sub,
  };
}

export async function oauthRoutes(app: FastifyInstance) {
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

  function oauthError(reply: FastifyReply, reason: string): void {
    void reply.redirect(`/login?oauthError=${encodeURIComponent(reason)}`);
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

  /** Find by (provider, providerAccountId) → user; else link/create by email. */
  async function findOrCreateOAuthUser(
    provider: SupportedProvider,
    profile: NormalizedProfile,
    tokens: OAuth2Tokens,
  ): Promise<{ id: string; email: string }> {
    const [existingLink] = await db
      .select({ userId: oauthAccounts.userId })
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerAccountId, profile.providerAccountId),
        ),
      )
      .limit(1);

    if (existingLink) {
      const [user] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, existingLink.userId))
        .limit(1);
      if (user) return user;
      // dangling link (user deleted) — fall through to email match
    }

    if (profile.email) {
      const [userByEmail] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, profile.email))
        .limit(1);
      if (userByEmail) {
        await linkAccount(userByEmail.id, provider, profile, tokens);
        return userByEmail;
      }
    }

    // Provision: unusable random password (bcrypt of 48 random bytes)
    const randomPassword = randomBytes(48).toString('hex');
    const [created] = await db
      .insert(users)
      .values({
        email: profile.email || `${profile.providerAccountId}@${provider}.oauth.invalid`,
        name: profile.name,
        passwordHash: await bcryptjs.hash(randomPassword, 12),
        tenantId: '00000000-0000-0000-0000-000000000001',
        status: 'active',
      })
      .returning({ id: users.id, email: users.email });
    if (!created) throw new Error('oauth_user_provision_failed');
    await linkAccount(created.id, provider, profile, tokens);
    return created;
  }

  async function linkAccount(
    userId: string,
    provider: SupportedProvider,
    profile: NormalizedProfile,
    tokens: OAuth2Tokens,
  ): Promise<void> {
    await db.insert(oauthAccounts).values({
      userId,
      provider,
      providerAccountId: profile.providerAccountId,
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
      expiresAt: tokens.accessTokenExpiresAt(),
    });
  }

  // GET /api/v1/auth/oauth/:provider/authorize
  app.get<{ Params: { provider: string } }>(
    '/oauth/:provider/authorize',
    async (request, reply) => {
      const { provider } = request.params;
      if (!isSupportedProvider(provider)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_OAUTH_001', message: 'Unsupported OAuth provider' },
        });
      }
      if (!providerConfigured(provider)) {
        return reply.status(503).send({
          success: false,
          error: { code: 'AUTH_OAUTH_002', message: 'OAuth provider not configured' },
        });
      }

      const arcticProvider = getProvider(provider);
      const state = generateState();
      const cookieOpts = cookieOptions();
      reply.setCookie(STATE_COOKIE, state, cookieOpts);

      let authorizationURL: URL;
      if (provider === 'github') {
        // D109: no PKCE for GitHub OAuth Apps — state-cookie CSRF protection only
        authorizationURL = (arcticProvider as GitHub).createAuthorizationURL(state, ['user:email']);
      } else {
        const codeVerifier = generateCodeVerifier();
        reply.setCookie(VERIFIER_COOKIE, codeVerifier, cookieOpts);
        authorizationURL = (arcticProvider as Google).createAuthorizationURL(state, codeVerifier, [
          'openid',
          'profile',
          'email',
        ]);
      }
      return reply.redirect(authorizationURL.toString());
    },
  );

  // GET /api/v1/auth/oauth/:provider/callback
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/oauth/:provider/callback',
    async (request, reply) => {
      const { code, state, error: providerError } = request.query;
      const { provider } = request.params as { provider: string };

      if (providerError) return oauthError(reply, providerError);
      if (!isSupportedProvider(provider)) return oauthError(reply, 'unsupported_provider');
      if (!code || !state) return oauthError(reply, 'invalid_request');

      const savedState = request.cookies?.[STATE_COOKIE];
      if (!savedState || savedState !== state) return oauthError(reply, 'state_mismatch');

      reply.clearCookie(STATE_COOKIE, { path: '/' });
      reply.clearCookie(VERIFIER_COOKIE, { path: '/' });

      try {
        const arcticProvider = getProvider(provider);
        const tokens =
          provider === 'github'
            ? await (arcticProvider as GitHub).validateAuthorizationCode(code)
            : await (arcticProvider as Google).validateAuthorizationCode(
                code,
                request.cookies?.[VERIFIER_COOKIE] ?? '',
              );

        const profile = await fetchProviderProfile(provider, tokens.accessToken());
        const user = await findOrCreateOAuthUser(provider, profile, tokens);
        const { accessToken, refreshToken } = await issueTokenPair(request, user);
        const exchangeCode = await flowTokens.issue(
          'oauth_exchange',
          { accessToken, refreshToken, user: { id: user.id, email: user.email } },
          EXCHANGE_TTL_SECONDS,
        );
        return reply.redirect(`/login?oauthCode=${encodeURIComponent(exchangeCode)}`);
      } catch (err) {
        request.log.warn({ err }, 'OAuth callback failed');
        return oauthError(reply, 'exchange_failed');
      }
    },
  );

  // POST /api/v1/auth/oauth/exchange
  app.post<{ Body: { code?: string } }>(
    '/oauth/exchange',
    {
      schema: {
        description: 'Exchange OAuth one-time code for session tokens',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { code } = request.body;
      const payload = code
        ? await flowTokens.consume<{
            accessToken: string;
            refreshToken: string;
            user: { id: string; email: string };
          }>(code, 'oauth_exchange')
        : null;
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_OAUTH_003', message: 'Invalid or expired exchange code' },
        });
      }
      return {
        success: true,
        data: {
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          expiresIn: 900,
          user: payload.user,
        },
      };
    },
  );

  // GET /api/v1/auth/oauth/links — linked providers for the current user
  app.get(
    '/oauth/links',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'List OAuth providers linked to the current user',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { sub: string };
      const rows = await db
        .select({ provider: oauthAccounts.provider, providerAccountId: oauthAccounts.providerAccountId })
        .from(oauthAccounts)
        .where(eq(oauthAccounts.userId, payload.sub));
      return { success: true, data: rows };
    },
  );

  // DELETE /api/v1/auth/oauth/:provider — unlink
  app.delete<{ Params: { provider: string } }>(
    '/oauth/:provider',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Unlink an OAuth provider from the current user',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { provider } = request.params;
      if (!isSupportedProvider(provider)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_OAUTH_001', message: 'Unsupported OAuth provider' },
        });
      }
      const payload = request.user as { sub: string };
      const deleted = await db
        .delete(oauthAccounts)
        .where(and(eq(oauthAccounts.userId, payload.sub), eq(oauthAccounts.provider, provider)))
        .returning({ id: oauthAccounts.id });
      if (deleted.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'AUTH_OAUTH_004', message: 'No linked account for this provider' },
        });
      }
      return { success: true };
    },
  );
}
