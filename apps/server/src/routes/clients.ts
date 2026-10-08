/**
 * OIDC client registry CRUD routes (/api/v1/clients).
 *
 * Client secrets are stored encrypted (AES-256-GCM) and returned as
 * plaintext ONCE at creation / rotation time — never in list/get responses.
 */
import type { FastifyInstance } from 'fastify';
import { OidcClientManager } from '@accessbase/identity';
import { config } from '../config.js';
import { requirePermission } from '../utils/permission.js';

const ALLOWED_GRANT_TYPES = new Set([
  'authorization_code',
  'client_credentials',
  // Q3B (RFC 8628): device flow — provider feature enabled in oidc/provider.ts.
  'urn:ietf:params:oauth:grant-type:device_code',
]);
const ALLOWED_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);

// T-PKJ (logout-coherence §3.5): tokenAuthMethod whitelist — oidc-provider's
// default clientAuthMethods (defaults.js:3119) accept exactly these four.
const ALLOWED_TOKEN_AUTH_METHODS = new Set([
  'client_secret_basic',
  'client_secret_post',
  'private_key_jwt',
  'none',
]);

// B5 gate: `none` passes client auth unconditionally (client_auth.js:193/225) —
// the provider does NOT refuse it on self-asserting grants, so anyone could
// mint tokens. Reject the combination at registration.
const ANONYMOUS_FORBIDDEN_GRANTS = new Set([
  'client_credentials',
  'urn:ietf:params:oauth:grant-type:device_code',
]);

// B6: kty-scoped PUBLIC JWK member allowlist. Any other member
// (d/p/q/dp/dq/qi/oth/k/x5c/…) rejects — private material must never land
// in oidc_clients.jwks.
const PUBLIC_JWK_MEMBERS: Record<string, readonly string[]> = {
  RSA: ['kty', 'n', 'e'],
  EC: ['kty', 'crv', 'x', 'y'],
  OKP: ['kty', 'crv', 'x'],
};

function usableJwks(value: unknown): { keys: unknown[] } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const keys = (value as { keys?: unknown }).keys;
  return Array.isArray(keys) && keys.length > 0 ? { keys } : undefined;
}

function isPublicJwk(key: unknown): boolean {
  if (typeof key !== 'object' || key === null || Array.isArray(key)) return false;
  const record = key as Record<string, unknown>;
  const allowed =
    typeof record['kty'] === 'string' ? PUBLIC_JWK_MEMBERS[record['kty']] : undefined;
  if (!allowed) return false;
  const members = Object.keys(record);
  return members.length === allowed.length && members.every((m) => allowed.includes(m));
}

let clientManager: OidcClientManager | undefined;

/** Test seam: inject a mocked OidcClientManager. */
export function setClientManager(mock: OidcClientManager): void {
  clientManager = mock;
}

/** Test seam: drop injected instance so a fresh lazy singleton can be built. */
export function resetClientManager(): void {
  clientManager = undefined;
}

function getClientManager(): OidcClientManager {
  clientManager ??= new OidcClientManager(config.databaseUrl);
  return clientManager;
}

/** Validate a redirect URI: must be https, or http://localhost (dev only). */
function isValidRedirectUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0) return false;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') return true;
    return false;
  } catch {
    return false;
  }
}

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  // POST /clients — create a new OIDC client
  app.post(
    '/clients',
    {
      schema: {
        description: 'Register a new OIDC client (secret returned once)',
        tags: ['clients'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const name = typeof body['name'] === 'string' ? body['name'] : undefined;
      const redirectUris = Array.isArray(body['redirectUris']) ? body['redirectUris'] : undefined;
      const grantTypes = Array.isArray(body['grantTypes']) ? body['grantTypes'] : undefined;
      const scope = typeof body['scope'] === 'string' ? body['scope'] : undefined;
      const tokenAuthMethod = typeof body['tokenAuthMethod'] === 'string' ? body['tokenAuthMethod'] : undefined;
      // Q3D: optional back-channel logout endpoint — http(s) only, else dropped.
      const bcRaw = body['backchannelLogoutUri'];
      const backchannelLogoutUri =
        typeof bcRaw === 'string' && /^https?:\/\//.test(bcRaw) ? bcRaw : undefined;

      // Validate required fields
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_001', message: 'name is required' },
        });
      }
      if (!redirectUris || redirectUris.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_002', message: 'redirectUris must be a non-empty array' },
        });
      }
      if (!redirectUris.every(isValidRedirectUri)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_003', message: 'redirectUris must use https (or http://localhost for dev)' },
        });
      }
      if (!grantTypes || grantTypes.length === 0 || !grantTypes.every((g: unknown) => ALLOWED_GRANT_TYPES.has(g as string))) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_004', message: 'grantTypes must be one of: authorization_code, client_credentials' },
        });
      }
      if (!scope || scope.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_005', message: 'scope is required' },
        });
      }
      const scopeTokens = scope.split(/\s+/).filter(Boolean);
      if (!scopeTokens.every((s: string) => ALLOWED_SCOPES.has(s))) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_006', message: 'scope contains disallowed values; allowed: openid profile email offline_access' },
        });
      }

      // T-PKJ: auth-method whitelist, none/self-asserting gate, jwks hygiene.
      if (tokenAuthMethod !== undefined && !ALLOWED_TOKEN_AUTH_METHODS.has(tokenAuthMethod)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_008', message: 'tokenAuthMethod must be one of: client_secret_basic, client_secret_post, private_key_jwt, none' },
        });
      }
      if (
        tokenAuthMethod === 'none' &&
        grantTypes.some((g: unknown) => ANONYMOUS_FORBIDDEN_GRANTS.has(g as string))
      ) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CLIENT_009', message: 'tokenAuthMethod "none" cannot be combined with client_credentials or device_code grants' },
        });
      }
      let jwksForCreate: { keys: unknown[] } | undefined;
      if (tokenAuthMethod === 'private_key_jwt' || body['jwks'] !== undefined) {
        const usable = usableJwks(body['jwks']);
        if (!usable) {
          return reply.status(400).send({
            success: false,
            error: { code: 'CLIENT_010', message: 'private_key_jwt requires jwks with a non-empty keys array' },
          });
        }
        if (!usable.keys.every(isPublicJwk)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'CLIENT_011', message: 'jwks may only contain public key members (RSA: kty/n/e, EC: kty/crv/x/y, OKP: kty/crv/x)' },
          });
        }
        jwksForCreate = usable;
      }

      const result = await getClientManager().create({
        name: name.trim(),
        redirectUris,
        grantTypes,
        scope: scopeTokens.join(' '),
        tokenAuthMethod,
        ...(backchannelLogoutUri ? { backchannelLogoutUri } : {}),
        ...(jwksForCreate ? { jwks: jwksForCreate } : {}),
      });

      const { secretEncrypted: _secretEncrypted, ...safeClient } = result.client;

      return reply.status(201).send({
        success: true as const,
        data: {
          ...safeClient,
          clientSecret: result.plaintextSecret,
        },
      });
    },
  );

  // GET /clients — list all clients (no secret material)
  app.get(
    '/clients',
    {
      schema: {
        description: 'List registered OIDC clients (no secrets)',
        tags: ['clients'],
        security: [{ bearerAuth: [] }],
      },
    },
    async () => {
      const clients = await getClientManager().list();
      return { success: true as const, data: clients };
    },
  );

  // POST /clients/:clientId/rotate-secret — rotate client secret
  app.post<{ Params: { clientId: string } }>(
    '/clients/:clientId/rotate-secret',
    {
      schema: {
        description: 'Rotate client secret (new secret returned once)',
        tags: ['clients'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['clientId'],
          properties: { clientId: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params;
      const existing = await getClientManager().get(clientId);
      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CLIENT_007', message: 'Client not found' },
        });
      }

      const newSecret = await getClientManager().rotateSecret(clientId);
      return { success: true as const, data: { clientId, clientSecret: newSecret } };
    },
  );

  // DELETE /clients/:clientId — remove a client
  app.delete<{ Params: { clientId: string } }>(
    '/clients/:clientId',
    {
      schema: {
        description: 'Delete an OIDC client',
        tags: ['clients'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['clientId'],
          properties: { clientId: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params;
      const existing = await getClientManager().get(clientId);
      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CLIENT_007', message: 'Client not found' },
        });
      }
      await getClientManager().remove(clientId);
      return reply.status(204).send();
    },
  );
}
