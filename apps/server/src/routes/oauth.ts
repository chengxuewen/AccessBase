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
import { GitHub, Google, OAuth2Client, generateState, generateCodeVerifier, CodeChallengeMethod, type OAuth2Tokens } from 'arctic';
import { and, eq } from 'drizzle-orm';
import { createDb, oauthAccounts, users } from '@accessbase/identity/db';
import type { DrizzleDB } from '@accessbase/identity/db';
import { SessionManager, FlowTokenService, getRedisClient, TenantManager } from '@accessbase/identity';
import { randomBytes } from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { config } from '../config.js';
import { getOptionsManager } from './options.js';
import { logger } from '@accessbase/logging';

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

/** Valid dynamic provider name (also the options-key suffix for its secret). */
const PROVIDER_NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Non-sensitive fields of a dynamic provider (secret lives in its own option key, R7). */
interface DynamicProviderConfig {
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  scope?: string;
}

/** A provider resolved for the authorize/callback flow. */
interface ResolvedProvider {
  kind: 'github' | 'google' | 'generic';
  client: GitHub | Google | OAuth2Client;
  /** Present only for kind 'generic'. */
  genericConfig?: DynamicProviderConfig & { clientSecret: string };
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


/**
 * Dynamic providers from options: `oauth_providers` holds the non-sensitive
 * JSON (R7); each secret lives in its own `oauth_<name>_client_secret` key
 * (matches SENSITIVE_KEY_PATTERN → masked in GET /v1/options). Malformed
 * JSON / invalid name / missing fields skip that provider with a warn —
 * built-ins and startup are never affected.
 */
async function loadDynamicProviders(): Promise<Record<string, DynamicProviderConfig & { clientSecret: string }>> {
  const options = getOptionsManager();
  const raw = await options.get<unknown>('oauth_providers', process.env['OAUTH_PROVIDERS'], '');
  let parsed: unknown;
  if (typeof raw === 'string') {
    if (raw === '') return {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('oauth: oauth_providers option is not valid JSON — dynamic providers skipped');
      return {};
    }
  } else {
    // jsonb object path: the options value column is jsonb, so the natural
    // Settings→Options flow (UI JSON.parse → PUT object) stores an object and
    // OptionsManager.get() returns it already parsed — never JSON.parse it again.
    parsed = raw;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('oauth: oauth_providers option is not an object — dynamic providers skipped');
    return {};
  }
  const out: Record<string, DynamicProviderConfig & { clientSecret: string }> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PROVIDER_NAME_PATTERN.test(name)) {
      logger.warn(`oauth: dynamic provider name '${name}' is invalid — skipped`);
      continue;
    }
    const c = (value ?? {}) as Partial<DynamicProviderConfig>;
    if (
      typeof c.authUrl !== 'string' || c.authUrl === '' ||
      typeof c.tokenUrl !== 'string' || c.tokenUrl === '' ||
      typeof c.userinfoUrl !== 'string' || c.userinfoUrl === '' ||
      typeof c.clientId !== 'string' || c.clientId === ''
    ) {
      logger.warn(`oauth: dynamic provider '${name}' is missing required fields — skipped`);
      continue;
    }
    // tokenUrl carries the client secret — plaintext http transport is rejected.
    const httpsUrl = (u: string) => u.startsWith('https://');
    const clientSecretRaw = await options.get<unknown>(`oauth_${name}_client_secret`, undefined, '');
    // Secret option values may arrive as a jsonb string (UI sends a quoted
    // JSON string) or as a bare value — coerce only real strings through.
    const clientSecret = typeof clientSecretRaw === 'string' ? clientSecretRaw : '';
    if (
      (c.scope !== undefined && typeof c.scope !== 'string') ||
      !httpsUrl(c.authUrl) || !httpsUrl(c.tokenUrl) || !httpsUrl(c.userinfoUrl)
    ) {
      logger.warn(`oauth: dynamic provider '${name}' has invalid fields (scope must be a string, URLs must be https) — skipped`);
      continue;
    }
    if (clientSecret === '') {
      logger.warn(`oauth: dynamic provider '${name}' has no oauth_${name}_client_secret option — skipped`);
      continue;
    }
    out[name] = {
      authUrl: c.authUrl,
      tokenUrl: c.tokenUrl,
      userinfoUrl: c.userinfoUrl,
      clientId: c.clientId,
      scope: c.scope,
      clientSecret,
    };
  }
  return out;
}

/** Built-in github/google first (env creds), else dynamic options entry. */
async function resolveProvider(name: string): Promise<ResolvedProvider | null> {
  if (isSupportedProvider(name) && providerConfigured(name)) {
    return { kind: name, client: getProvider(name) };
  }
  if (!PROVIDER_NAME_PATTERN.test(name)) return null;
  const dynamic = await loadDynamicProviders();
  const dyn = dynamic[name];
  if (!dyn) return null;
  return {
    kind: 'generic',
    client: new OAuth2Client(
      dyn.clientId,
      dyn.clientSecret,
      `${config.oauthRedirectBase}/api/v1/auth/oauth/${name}/callback`,
    ),
    genericConfig: dyn,
  };
}

/** Public: names of all resolvable providers (built-ins with env creds + dynamic). */
async function listResolvedProviders(): Promise<string[]> {
  const out: string[] = SUPPORTED_PROVIDERS.filter((name) => providerConfigured(name));
  const dynamic = await loadDynamicProviders();
  for (const name of Object.keys(dynamic)) {
    if (!out.includes(name)) out.push(name);
  }
  return out;
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

/** Built-in providers keep their native profile fetch; generic uses userinfoUrl. */
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

/** Generic OIDC: userinfoUrl → { sub, email?, name? } (same shape as Google userinfo). */
async function fetchGenericProfile(
  provider: string,
  userinfoUrl: string,
  accessToken: string,
): Promise<NormalizedProfile> {
  const res = await fetch(userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`${provider}_profile_fetch_failed`);
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
    user: { id: string; email: string; status?: string; tenantId?: string },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Tenant suspension gate (G/R1) — inside the helper so every issuance call
    // site inherits it. Tagged error → global handler renders 403 AUTH_TENANT_001.
    const tenantId = user.tenantId ?? DEFAULT_TENANT;
    // Fail-open on lookup error (auth.ts precedent): only a confirmed
    // suspended row blocks.
    let tenant;
    try {
      tenant = await new TenantManager().findById(tenantId);
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
    // status claim rides along so authenticate can re-check it (P0; absent on legacy tokens → allowed)
    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email, status: user.status, tenantId: user.tenantId ?? DEFAULT_TENANT },
      { expiresIn: '15m' },
    );
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

  /** Find by (provider, providerAccountId) → user; else link/create by email.
   * R18a: provider is any registry name (built-in or dynamic). */
  async function findOrCreateOAuthUser(
    provider: string,
    profile: NormalizedProfile,
    tokens: OAuth2Tokens,
  ): Promise<{ id: string; email: string; status: string; totpEnabled?: boolean; tenantId?: string }> {
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
        .select({ id: users.id, email: users.email, status: users.status, totpEnabled: users.totpEnabled, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, existingLink.userId))
        .limit(1);
      if (user) return user;
      // dangling link (user deleted) — fall through to email match
    }

    if (profile.email) {
      const [userByEmail] = await db
        .select({ id: users.id, email: users.email, status: users.status, totpEnabled: users.totpEnabled, tenantId: users.tenantId })
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
        tenantId: DEFAULT_TENANT,
        status: 'active',
      })
      .returning({ id: users.id, email: users.email, status: users.status });
    if (!created) throw new Error('oauth_user_provision_failed');
    await linkAccount(created.id, provider, profile, tokens);
    // Freshly provisioned users have no TOTP secret — totpEnabled omitted (false)
    return created;
  }

  async function linkAccount(
    userId: string,
    provider: string,
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
      const resolved = await resolveProvider(provider);
      // R17: name not in the registry (unknown / invalid charset / dynamic
      // skipped for malformed options) → 404; known built-in without env
      // creds → 503 (existing semantics preserved).
      if (!resolved) {
        if (isSupportedProvider(provider)) {
          return reply.status(503).send({
            success: false,
            error: { code: 'AUTH_OAUTH_002', message: 'OAuth provider not configured' },
          });
        }
        return reply.status(404).send({
          success: false,
          error: { code: 'AUTH_OAUTH_001', message: 'Unsupported OAuth provider' },
        });
      }

      const state = generateState();
      const cookieOpts = cookieOptions();
      reply.setCookie(STATE_COOKIE, state, cookieOpts);

      let authorizationURL: URL;
      if (resolved.kind === 'github') {
        // D109: no PKCE for GitHub OAuth Apps — state-cookie CSRF protection only
        authorizationURL = (resolved.client as GitHub).createAuthorizationURL(state, ['user:email']);
      } else if (resolved.kind === 'google') {
        const codeVerifier = generateCodeVerifier();
        reply.setCookie(VERIFIER_COOKIE, codeVerifier, cookieOpts);
        authorizationURL = (resolved.client as Google).createAuthorizationURL(state, codeVerifier, [
          'openid',
          'profile',
          'email',
        ]);
      } else {
        // Generic OIDC: always PKCE (state + verifier cookies reused)
        const codeVerifier = generateCodeVerifier();
        reply.setCookie(VERIFIER_COOKIE, codeVerifier, cookieOpts);
        const cfg = resolved.genericConfig!;
        const scopes = cfg.scope ? cfg.scope.split(/\s+/).filter(Boolean) : ['openid'];
        authorizationURL = (resolved.client as OAuth2Client).createAuthorizationURLWithPKCE(
          cfg.authUrl,
          state,
          CodeChallengeMethod.S256,
          codeVerifier,
          scopes,
        );
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
      const resolved = await resolveProvider(provider);
      if (!resolved) return oauthError(reply, 'unsupported_provider');
      if (!code || !state) return oauthError(reply, 'invalid_request');

      const savedState = request.cookies?.[STATE_COOKIE];
      if (!savedState || savedState !== state) return oauthError(reply, 'state_mismatch');

      reply.clearCookie(STATE_COOKIE, { path: '/' });
      reply.clearCookie(VERIFIER_COOKIE, { path: '/' });

      try {
        const verifier = request.cookies?.[VERIFIER_COOKIE] ?? '';
        const tokens =
          resolved.kind === 'github'
            ? await (resolved.client as GitHub).validateAuthorizationCode(code)
            : resolved.kind === 'google'
              ? await (resolved.client as Google).validateAuthorizationCode(code, verifier)
              : await (resolved.client as OAuth2Client).validateAuthorizationCode(
                  resolved.genericConfig!.tokenUrl,
                  code,
                  verifier,
                );

        const profile =
          resolved.kind === 'generic'
            ? await fetchGenericProfile(provider, resolved.genericConfig!.userinfoUrl, tokens.accessToken())
            : await fetchProviderProfile(provider as SupportedProvider, tokens.accessToken());
        const user = await findOrCreateOAuthUser(provider, profile, tokens);
        // P0 (final review C1): a suspended/pending account must not obtain an
        // OAuth session even with a valid provider link — mirror the login
        // handler's 403 AUTH_004. Only existing users can be non-active; the
        // provision branch above always creates with status 'active'.
        if (user.status !== 'active') {
          request.log.warn({ userId: user.id }, 'OAuth login blocked: account not active');
          return reply.status(403).send({
            success: false,
            error: { code: 'AUTH_004', message: 'Account suspended' },
          });
        }
        // Batch E Task 2: TOTP-enabled user gets the MFA step-up — the callback
        // issues ONLY the oauth_exchange code whose payload carries mfaPending
        // (no token pair on the redirect chain); the exchange endpoint does the
        // mfa_verify issuance at exchange time (R6).
        if (user.totpEnabled) {
          const exchangeCode = await flowTokens.issue(
            'oauth_exchange',
            { userId: user.id, mfaPending: true },
            EXCHANGE_TTL_SECONDS,
          );
          return reply.redirect(`/login?oauthCode=${encodeURIComponent(exchangeCode)}`);
        }
        const { accessToken, refreshToken } = await issueTokenPair(request, user);
        const exchangeCode = await flowTokens.issue(
          'oauth_exchange',
          { accessToken, refreshToken, user: { id: user.id, email: user.email } },
          EXCHANGE_TTL_SECONDS,
        );
        return reply.redirect(`/login?oauthCode=${encodeURIComponent(exchangeCode)}`);
      } catch (err) {
        // Tenant gate (G): propagate ahead of the redirect mapping.
        if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') throw err;
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
        ? await flowTokens.consume<
            | { mfaPending: true; userId: string }
            | {
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
      // Batch E Task 2: MFA step-up — issue the mfa_verify flow token NOW
      // (exchange-time issuance, R6); the SPA completes via /auth/mfa/verify.
      if ('mfaPending' in payload) {
        const flowToken = await flowTokens.issue('mfa_verify', { userId: payload.userId }, 300);
        return {
          success: true,
          data: { mfaRequired: true, flowToken },
        };
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

  // GET /api/v1/auth/oauth/providers — public, names only (no creds/URLs)
  app.get(
    '/oauth/providers',
    {
      schema: {
        description: 'List configured OAuth provider names for the login page',
        tags: ['auth'],
      },
    },
    async () => {
      const providers = await listResolvedProviders();
      return { success: true, data: { providers } };
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
