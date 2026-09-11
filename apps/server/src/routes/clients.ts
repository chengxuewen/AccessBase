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

const ALLOWED_GRANT_TYPES = new Set(['authorization_code', 'client_credentials']);
const ALLOWED_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);

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

      const result = await getClientManager().create({
        name: name.trim(),
        redirectUris,
        grantTypes,
        scope: scopeTokens.join(' '),
        tokenAuthMethod,
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
