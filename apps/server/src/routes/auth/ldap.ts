/**
 * routes/auth split (batch R2, DG-5 pure move): LDAP sign-in lane (Batch D) —
 * public /ldap/login, provider auth + find-or-provision + token issuance.
 */
import type { FastifyInstance } from 'fastify';
import { getUserManager } from '../../utils/managers.js';
import { getOptionsManager } from '../options.js';
import { DEFAULT_TENANT } from '../../utils/constants.js';
import type { AuthContext } from './context.js';

export async function ldapLoginRoutes(app: FastifyInstance, ctx: AuthContext) {
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
                  enroll: { type: 'boolean' },
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
        // R1-T10 (DG-8a): first-federation provisioning from an authoritative
        // directory marks the asserted address verified — otherwise a TOTP-bound
        // LDAP user would die at the gated shared /mfa/verify arm.
        if (!existing) await userManager.markEmailVerified(user.id);

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
          const flowToken = await ctx.flowTokens.issue('mfa_verify', { userId: user.id }, 300);
          return {
            success: true,
            data: { mfaRequired: true, flowToken },
          };
        }

        const { accessToken, refreshToken } = await ctx.issueTokenPair(request, user);
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
              roles: await ctx.rolesOf(user.id),
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
