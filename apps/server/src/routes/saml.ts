/**
 * SAML 2.0 SP login routes (Batch F Task 2)
 *
 * Mirrors the OAuth exchange channel (oauth.ts): the IdP POSTs the assertion
 * to ACS, which NEVER returns JSON — it always 302s to /login carrying either
 * a single-use saml_exchange flowToken (samlCode) or an error code
 * (samlError). The SPA exchanges the code over AJAX; tokens never ride the
 * redirect chain (R1). RelayState is never consumed (R2 — it is not signed;
 * using it as a redirect target would be an open redirect).
 *
 * Errors redirect to /login?samlError=<code> — browser navigation, no stack
 * traces (anti-enumeration, same style as oauthError).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SessionManager, RoleManager, FlowTokenService, getRedisClient, TenantManager } from '@accessbase/identity';
import { config } from '../config.js';
import { getOptionsManager } from './options.js';
import { enforceHit, optionGetter } from '../utils/mfa-policy.js';
import { getRoleManager } from '../utils/managers.js';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { getTenantManager, getUserManager } from '../utils/managers.js';
import { logger } from '@accessbase/logging';
import { emitAuthEvent } from '../utils/auth-events.js';
import { buildSamlProvider, claimSamlRequestId, resolveSamlLogoutUrl, upsertSamlLink } from '../utils/saml-logout.js';

const EXCHANGE_TTL_SECONDS = 60;

export async function samlRoutes(app: FastifyInstance) {
  // Scoped to this plugin encapsulation context: only ACS (urlencoded) needs
  // it; the exchange endpoint's JSON parser is inherited from the root. app.ts
  // must NOT gain any global addContentTypeParser (static invariant in tests).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  const sessionManager = new SessionManager();
  const roleManager = new RoleManager();
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

  function samlError(reply: { redirect: (url: string) => unknown }, code: string): void {
    void reply.redirect(`/login?samlError=${encodeURIComponent(code)}`);
  }

  /** The enabled gate: all three keys must be non-empty. */
  async function samlConfigured(): Promise<boolean> {
    const om = getOptionsManager();
    const get = async (key: string, envKey: string, def: unknown) =>
      om.get(key, process.env[envKey], def);
    const enabled = String(await get('saml_enabled', 'SAML_ENABLED', 'false')) === 'true';
    const entryPoint = String(await get('saml_entry_point', 'SAML_ENTRY_POINT', ''));
    const idpCert = String(await get('saml_idp_cert', 'SAML_IDP_CERT', ''));
    return enabled && entryPoint !== '' && idpCert !== '';
  }

  // Provider construction lives in utils/saml-logout.ts (single source — also
  // powers resolveSamlLogoutUrl outside this plugin). §3.6 (R6 precondition):
  // the Redis CacheProvider is injected there, so per-request construction
  // shares request-id state across instances/nodes.


  /** Issue access JWT + refresh token — same claims/shape as login (auth.ts:54-84). */
  async function issueTokenPair(
    request: { ip: string; headers: Record<string, unknown> },
    user: { id: string; email: string; status?: string; tenantId?: string; tokenVersion?: number },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Tenant suspension gate (G/R1) — inside the helper so every issuance call
    // site inherits it. ACS's browser-channel invariant (never JSON) maps this
    // to a samlError redirect at the catch site below; the exchange channel
    // surfaces it via the global handler as 403 AUTH_TENANT_001.
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

  /** Real [{id,name}] role list for a user (login projection parity). */
  async function rolesOf(userId: string, tenantId?: string): Promise<{ id: string; name: string }[]> {
    const roles = await roleManager.getUserRoles(userId, tenantId ?? DEFAULT_TENANT);
    return roles.map((r) => ({ id: r.id, name: r.name }));
  }

  // GET /api/v1/auth/saml/status — login-page probe: is SAML configured? (R12)
  app.get(
    '/saml/status',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        description: 'Report whether SAML SP login is enabled',
        tags: ['auth'],
      },
    },
    async () => ({
      success: true,
      data: { enabled: await samlConfigured() },
    }),
  );

  // GET /api/v1/auth/saml/login — start SP-initiated flow: 302 to the IdP
  app.get(
    '/saml/login',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        description: 'Begin SAML SP-initiated login (redirect to the IdP)',
        tags: ['auth'],
      },
    },
    async (request, reply) => {
      if (!(await samlConfigured())) {
        return reply.status(503).send({
          success: false,
          error: { code: 'AUTH_SAML_001', message: 'SAML authentication is not available' },
        });
      }
      const provider = await buildSamlProvider(request.hostname);
      const loginUrl = await provider.loginUrl('', request.hostname);
      return reply.redirect(loginUrl);
    },
  );

  // GET /api/v1/auth/saml/logout — SP-initiated logout URL for the caller
  // (§3.1). Bearer lane, keyed by JWT sub (the authenticated principal — no
  // cross-tenant path). No saml link -> {logoutUrl: null}: the SPA (and the
  // §3.4 /auth/logout composer) treat null as "nothing IdP-side to do".
  app.get(
    '/saml/logout',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        description: 'Get the IdP single-logout URL for the authenticated SAML principal',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!(await samlConfigured())) {
        return reply.status(503).send({
          success: false,
          error: { code: 'AUTH_SAML_001', message: 'SAML authentication is not available' },
        });
      }
      const caller = request.user as { sub?: string };
      const logoutUrl = caller.sub ? await resolveSamlLogoutUrl(caller.sub) : null;
      return { success: true, data: { logoutUrl } };
    },
  );

  // GET+POST /api/v1/auth/saml/slo — the IdP-facing single-logout endpoint (§3.2).
  // THREE arms discriminated on container shape (saml.js:650-654: message type
  // lives in SAMLRequest vs SAMLResponse, never in a validate() return field):
  //  1. LogoutRequest (IdP-initiated): signed-only redirect binding enforced
  //     ROUTE-side (B1 — node-saml's hasValidSignatureForRedirect returns true
  //     when Signature is ABSENT, saml.js:658-679, and the POST validator
  //     enforces on its own), replay-deduped by us (R2 — node-saml only caches
  //     IDs WE generated), then A1 kill-all + auth.logout(saml) + LogoutResponse.
  //  2. LogoutResponse (SP-initiated completion): validate, land /login, and
  //     NEVER echo a message back (B2 loop lock).
  //  3. Failure arm: uniform 302 /login?error=SLO_FAILED, warn-log only — the
  //     browser channel never returns JSON and never distinguishes causes.
  // Audit-excluded in app.ts alongside ACS (R10 family: multi-KB SAML bodies).
  const sloHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const sloFail = (reason: string) => {
      request.log.warn({ reason }, 'SAML SLO rejected');
      return reply.redirect('/login?error=SLO_FAILED');
    };
    if (!(await samlConfigured())) {
      return sloFail('AUTH_SAML_001');
    }
    const isGet = request.method === 'GET';
    const container = isGet
      ? (request.query as Record<string, string>)
      : ((request.body ?? {}) as Record<string, string>);
    if (!container['SAMLRequest'] && !container['SAMLResponse']) {
      return sloFail('no-saml-message');
    }
    // B1: unsigned redirect-binding messages are forgeable — node-saml would
    // silently ACCEPT them, so the gate is route-side (both GET arms). POST
    // binding needs nothing here: its validators enforce the XML signature.
    if (isGet && !(container['Signature'] && container['SigAlg'])) {
      return sloFail('unsigned-redirect');
    }
    const provider = await buildSamlProvider(request.hostname);
    const queryIndex = request.url.indexOf('?');
    const result = await provider.validateSlo(
      isGet
        ? {
            binding: 'redirect',
            query: request.query as Record<string, unknown>,
            // R10: signature base string = the RAW query after '?', never the
            // path-prefixed url.
            originalQuery: queryIndex >= 0 ? request.url.slice(queryIndex + 1) : '',
          }
        : { binding: 'post', container },
    );
    if ('error' in result) {
      return sloFail(result.message);
    }
    if (result.kind === 'response') {
      // Arm 2: SP-initiated round complete. Land the browser — generating any
      // SAML message here would loop the exchange (B2).
      return reply.redirect('/login');
    }
    // Arm 1 (LogoutRequest). Claim AFTER validation (the ID is only trustworthy
    // once the signature passes — an unauthenticated body must not poison the
    // dedup store) and BEFORE any mutation.
    const requestId = result.profile.id;
    if (!requestId) {
      return sloFail('missing-request-id');
    }
    if (!(await claimSamlRequestId(requestId))) {
      return sloFail('replayed-request');
    }
    const user = await getUserManager().then((um) => um.findByEmail(result.profile.nameId));
    if (user) {
      // A1 ruling: kill every session of the asserted principal. Email is
      // globally unique (schema), so the resolution is tenant-straddle-proof.
      await sessionManager.revokeAllUserSessions(user.id);
      emitAuthEvent({
        type: 'auth.logout',
        tenantId: user.tenantId ?? DEFAULT_TENANT,
        userId: user.id,
        email: result.profile.nameId,
        method: 'saml',
      });
    }
    return reply.redirect(
      await provider.logoutResponseUrl(result.profile, container['RelayState'] ?? ''),
    );
  };

  app.get(
    '/saml/slo',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        description: 'SAML single logout endpoint (IdP-initiated LogoutRequest + SP-initiated LogoutResponse return)',
        tags: ['auth'],
      },
    },
    sloHandler,
  );
  app.post(
    '/saml/slo',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        description: 'SAML single logout endpoint, POST binding (same three arms as GET)',
        tags: ['auth'],
      },
    },
    sloHandler,
  );

  // POST /api/v1/auth/saml/acs — IdP assertion consumer. ALWAYS 302 (R1);
  // RelayState is never consumed (R2). Audit-excluded in app.ts (R10 — the
  // multi-KB SAMLResponse body must not land in audit_logs).
  app.post(
    '/saml/acs',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        description: 'SAML assertion consumer service (browser redirect channel)',
        tags: ['auth'],
      },
    },
    async (request, reply) => {
      if (!(await samlConfigured())) {
        return samlError(reply, 'AUTH_SAML_001');
      }
      const provider = await buildSamlProvider(request.hostname);
      const body = (request.body ?? {}) as Record<string, string>;
      const identity = await provider.validateResponse(body);
      if ('error' in identity || identity.email === '') {
        request.log.warn('SAML ACS rejected assertion');
        return samlError(reply, 'AUTH_SAML_002');
      }

      try {
        const userManager = await getUserManager();
        // Find-or-provision (LDAP auth.ts:960-976 parity): reuse the row by
        // globally-unique email; provision into the default tenant.
        const existing = await userManager.findByEmail(identity.email);
        const user = existing ?? (await userManager.create(
          { email: identity.email, name: identity.displayName ?? '' },
          request.tenantId ?? DEFAULT_TENANT,
        ));
        // R1-T10 (DG-8a): first-federation provisioning from an authoritative IdP
        // marks the asserted address verified (LDAP-site parity).
        if (!existing) await userManager.markEmailVerified(user.id);

        // Suspended/pending accounts get no session — AUTH_004 on the browser channel.
        if (existing && existing.status !== 'active') {
          request.log.warn({ userId: existing.id }, 'SAML login rejected: account suspended');
          return samlError(reply, 'AUTH_004');
        }

        // §3.1 link persistence: nameID + SessionIndex into oauth_accounts so the
        // SP-initiated logout / §3.4 composer can resolve this principal later.
        // Fail-soft by design (upsertSamlLink swallows LOUD, B7) — never breaks login.
        await upsertSamlLink(user.id, identity.nameId, identity.sessionIndex ?? null);

        const totpEnabled = 'totpEnabled' in user ? Boolean(user.totpEnabled) : false;
        // Dual-variant payload (R1, mirror oauth.ts:475-487): MFA users get ONLY
        // the code with mfaPending; everyone else gets the token pair inside it.
        let code: string;
        // Q3E-E3: enforced-MFA pre-check for not-yet-bound users (dual-variant
        // payload gains enrollPending; issuance happens at the exchange arm)
        if (!totpEnabled) {
          const hit = await enforceHit({
            getOption: optionGetter(getOptionsManager() as unknown as Parameters<typeof optionGetter>[0]),
            isSystemAdmin: async () =>
              (await (await getRoleManager()).getEffectiveRoles(user.id, user.tenantId ?? DEFAULT_TENANT)).some(
                (r) => r.isSystem === true,
              ),
            user: { totpEnabled: false },
          });
          if (hit) {
            code = await flowTokens.issue('saml_exchange', { userId: user.id, mfaPending: true, enrollPending: true }, EXCHANGE_TTL_SECONDS);
            return reply.redirect(`/login?samlCode=${encodeURIComponent(code)}`);
          }
        }
        if (totpEnabled) {
          code = await flowTokens.issue('saml_exchange', { userId: user.id, mfaPending: true }, EXCHANGE_TTL_SECONDS);
        } else {
          const { accessToken, refreshToken } = await issueTokenPair(request, user);
          code = await flowTokens.issue(
            'saml_exchange',
            {
              accessToken,
              refreshToken,
              user: { id: user.id, email: user.email, name: user.name, roles: await rolesOf(user.id, request.tenantId) },
            },
            EXCHANGE_TTL_SECONDS,
          );
        }
        return reply.redirect(`/login?samlCode=${encodeURIComponent(code)}`);
      } catch (err) {
        // Tenant gate (G): browser channel never returns JSON — map to a
        // redirect carrying the same code (samlError convention).
        if (err instanceof Error && 'code' in err && err.code === 'AUTH_TENANT_001') {
          request.log.warn('SAML login rejected: tenant suspended');
          return samlError(reply, 'AUTH_TENANT_001');
        }
        // R1 fold: AUTH_SAML_003 (500 provisioning) absorbed here — ACS uses a
        // two-exit model: AUTH_SAML_001 (config/unavailable) and AUTH_SAML_002
        // (sign-in/provisioning failure).  No separate 500 code needed.
        request.log.error({ err }, 'SAML provisioning/token issuance failed');
        return samlError(reply, 'AUTH_SAML_002');
      }
    },
  );

  // POST /api/v1/auth/saml/exchange — SPA AJAX channel: consume the code,
  // return either the mfa step-up or the login-shaped token pair. The 200
  // schema declares the FULL union (R2 lesson: fast-json-stringify strips
  // undeclared fields — an arm-only schema would silently drop the other
  // variant's keys).
  app.post<{ Body: { code?: string } }>(
    '/saml/exchange',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        description: 'Exchange SAML one-time code for session tokens (or MFA step-up)',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1 } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  // mfa step-up arm
                  mfaRequired: { type: 'boolean' },
                enroll: { type: 'boolean' },
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
                user: { id: string; email: string; name: string; roles: { id: string; name: string }[] };
              }
          >(code, 'saml_exchange')
        : null;
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_SAML_002', message: 'SAML sign-in failed' },
        });
      }
      if ('mfaPending' in payload) {
        if (payload.enrollPending) {
          // Q3E-E3: enforced-MFA — chain an mfa_enroll token (wizard, no session)
          const enrollToken = await flowTokens.issue('mfa_enroll', { userId: payload.userId }, 300);
          return { success: true, data: { mfaRequired: true, enroll: true, flowToken: enrollToken } };
        }
        // MFA step-up issued AT EXCHANGE TIME (R1, mirror oauth.ts:529-535).
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

  // GET /api/v1/auth/saml/metadata — SP metadata for IdP-side registration
  app.get(
    '/saml/metadata',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        description: 'SAML SP metadata XML',
        tags: ['auth'],
      },
    },
    async (request, reply) => {
      if (!(await samlConfigured())) {
        return reply.status(503).send({
          success: false,
          error: { code: 'AUTH_SAML_001', message: 'SAML authentication is not available' },
        });
      }
      const provider = await buildSamlProvider(request.hostname);
      const xml = await provider.metadataXml();
      return reply.type('application/xml').send(xml);
    },
  );
}
