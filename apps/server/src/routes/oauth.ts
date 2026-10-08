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
import { enforceHit, optionGetter } from '../utils/mfa-policy.js';
import { getRoleManager } from '../utils/managers.js';
import { logger } from '@accessbase/logging';
import { getTenantManager } from '../utils/managers.js';
import {
  PROVIDER_NAME_PATTERN,
  loadDynamicProviders,
  resolveRpEndSessionUrl,
  type DynamicProviderConfig,
} from '../utils/rp-end-session.js';

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
    user: { id: string; email: string; status?: string; tenantId?: string; tokenVersion?: number },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Tenant suspension gate (G/R1) — inside the helper so every issuance call
    // site inherits it. Tagged error → global handler renders 403 AUTH_TENANT_001.
    const tenantId = user.tenantId ?? DEFAULT_TENANT;
    // Fail-open on lookup error (auth.ts precedent): only a confirmed
    // suspended row blocks.
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
    // status claim rides along so authenticate can re-check it (P0; absent on legacy tokens → allowed)
    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email, status: user.status, tenantId: user.tenantId ?? DEFAULT_TENANT, tokenVersion: user.tokenVersion },
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
    tenantId?: string,
    /** §3.3 R4: generic providers UPSERT the link row on every login (built-ins: undefined). */
    genericCfg?: DynamicProviderConfig,
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
      if (user) {
        // R4 (spec §3.3): the early-return used to leave tokens + id_token stale
        // forever — generic logins refresh the link row on EVERY success.
        if (genericCfg) await upsertGenericLink(user.id, provider, profile, tokens, genericCfg);
        return user;
      }
      // dangling link (user deleted) — fall through to email match
    }

    if (profile.email) {
      const [userByEmail] = await db
        .select({ id: users.id, email: users.email, status: users.status, totpEnabled: users.totpEnabled, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.email, profile.email))
        .limit(1);
      if (userByEmail) {
        await saveLink(userByEmail.id, provider, profile, tokens, genericCfg);
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
        tenantId: tenantId ?? DEFAULT_TENANT,
        status: 'active',
        // R1-T10 (DG-8a): an address the external IdP asserted counts as
        // verified at first provisioning (synthetic fallback emails do not).
        emailVerified: Boolean(profile.email),
      })
      .returning({ id: users.id, email: users.email, status: users.status });
    if (!created) throw new Error('oauth_user_provision_failed');
    await saveLink(created.id, provider, profile, tokens, genericCfg);
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

  /** Persist a successful login's link: generic UPSERTs (R4), built-ins keep the plain insert. */
  async function saveLink(
    userId: string,
    provider: string,
    profile: NormalizedProfile,
    tokens: OAuth2Tokens,
    genericCfg?: DynamicProviderConfig,
  ): Promise<void> {
    if (genericCfg) {
      await upsertGenericLink(userId, provider, profile, tokens, genericCfg);
      return;
    }
    await linkAccount(userId, provider, profile, tokens);
  }

  /**
   * R4 fix (spec §3.3): every generic-provider login refreshes the link row —
   * upsert on unique(provider, providerAccountId). The userId update re-links
   * a dangling row when the email match lands on a different user. There is no
   * updatedAt column on oauth_accounts (schema.ts) — createdAt stays put.
   */
  async function upsertGenericLink(
    userId: string,
    provider: string,
    profile: NormalizedProfile,
    tokens: OAuth2Tokens,
    cfg: DynamicProviderConfig,
  ): Promise<void> {
    const idToken = genericIdToken(tokens, cfg);
    const fields = {
      userId,
      provider,
      providerAccountId: profile.providerAccountId,
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
      expiresAt: tokens.accessTokenExpiresAt(),
      idToken,
    };
    await db
      .insert(oauthAccounts)
      .values(fields)
      .onConflictDoUpdate({
        target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
        set: {
          userId: fields.userId,
          accessToken: fields.accessToken,
          refreshToken: fields.refreshToken,
          expiresAt: fields.expiresAt,
          idToken: fields.idToken,
        },
      });
  }

  /**
   * arctic OAuth2Tokens.idToken() THROWS when the response carries no
   * id_token (§2 fact) — attempt it only when the configured scope asks for
   * openid; anything else (scope absent, throw) stores null.
   */
  function genericIdToken(tokens: OAuth2Tokens, cfg: DynamicProviderConfig): string | null {
    const scopes = cfg.scope ? cfg.scope.split(/\s+/).filter(Boolean) : ['openid'];
    if (!scopes.includes('openid')) return null;
    try {
      return tokens.idToken();
    } catch {
      return null;
    }
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
        const user = await findOrCreateOAuthUser(
          provider,
          profile,
          tokens,
          request.tenantId,
          resolved.kind === 'generic' ? resolved.genericConfig : undefined,
        );
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
        // Q3E-E3: enforced-MFA pre-check (redirect channel — issuance at exchange)
        if (
          await enforceHit({
            getOption: optionGetter(getOptionsManager() as unknown as Parameters<typeof optionGetter>[0]),
            isSystemAdmin: async () =>
              (await (await getRoleManager()).getEffectiveRoles(user.id, user.tenantId ?? DEFAULT_TENANT)).some(
                (r) => r.isSystem === true,
              ),
            user,
          })
        ) {
          const exchangeCode = await flowTokens.issue(
            'oauth_exchange',
            { userId: user.id, mfaPending: true, enrollPending: true },
            EXCHANGE_TTL_SECONDS,
          );
          return reply.redirect(`/login?oauthCode=${encodeURIComponent(exchangeCode)}`);
        }
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
        // Tenant gate (G fix M2): mirror SAML — surface the code on the
        // browser redirect channel, never raw JSON down a navigation.
        if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
          return oauthError(reply, 'AUTH_TENANT_001');
        }
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
            | { mfaPending: true; userId: string; enrollPending?: boolean }
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
        if (payload.enrollPending) {
          // Q3E-E3: enforced-MFA — chain an mfa_enroll token (wizard, no session)
          const flowToken = await flowTokens.issue('mfa_enroll', { userId: payload.userId }, 300);
          return {
            success: true,
            data: { mfaRequired: true, enroll: true, flowToken },
          };
        }
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

  // GET /api/v1/auth/oauth/end-session-url?provider=<name> — §3.3 RP-initiated
  // logout hint. Shape/rate parity with /oauth/links (bearer, global limiter).
  app.get<{ Querystring: { provider?: string } }>(
    '/oauth/end-session-url',
    {
      preHandler: [app.authenticate],
      schema: {
        description: 'Resolve the generic OIDC end-session URL (id_token_hint) for the current user',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const name = request.query.provider ?? '';
      if (!PROVIDER_NAME_PATTERN.test(name)) {
        return reply.status(404).send({
          success: false,
          error: { code: 'AUTH_OAUTH_001', message: 'Unsupported OAuth provider' },
        });
      }
      if (isSupportedProvider(name)) {
        // A3 ruling: google/github end-session stays on the backlog
        return { success: true, data: { logoutUrl: null } };
      }
      const payload = request.user as { sub: string };
      const logoutUrl = await resolveRpEndSessionUrl(payload.sub, name);
      return { success: true, data: { logoutUrl } };
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
