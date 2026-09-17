/**
 * API key CRUD routes (/api/v1/auth/api-keys).
 *
 * Plaintext is revealed exactly once in the create response; list returns
 * hash-free rows (one-time reveal precedent, same as OIDC client secrets).
 */
import type { FastifyInstance } from 'fastify';
import { ApiKeyManager } from '@accessbase/identity';
import { config } from '../config.js';
import { requirePermission } from '../utils/permission.js';
import { DEFAULT_TENANT } from '../utils/constants.js';

let apiKeyManager: ApiKeyManager | undefined;

/** Test seam: inject a mocked ApiKeyManager. */
export function setApiKeyManager(mock: ApiKeyManager): void {
  apiKeyManager = mock;
}

/** Test seam: drop the injected instance so a fresh lazy singleton can be built. */
export function resetApiKeyManager(): void {
  apiKeyManager = undefined;
}

export function getApiKeyManager(): ApiKeyManager {
  apiKeyManager ??= new ApiKeyManager(config.databaseUrl);
  return apiKeyManager;
}

export async function apiKeysRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  // POST / — create a key (plaintext returned once)
  app.post(
    '/',
    {
      schema: {
        description: 'Create an API key (plaintext revealed once)',
        tags: ['api-keys'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
      if (!name) {
        return reply.status(400).send({
          success: false,
          error: { code: 'APIKEY_001', message: 'name is required' },
        });
      }
      const scopes = Array.isArray(body['scopes'])
        ? body['scopes'].filter((s): s is string => typeof s === 'string')
        : ['*'];
      const expiresAt =
        typeof body['expiresAt'] === 'string' ? new Date(body['expiresAt']) : undefined;
      const payload = request.user as { sub: string };
      const created = await getApiKeyManager().create(
        name,
        scopes,
        request.tenantId ?? DEFAULT_TENANT,
        expiresAt,
      );
      return reply.status(201).send({ success: true as const, data: created });
    },
  );

  // GET / — list keys (no hash material)
  app.get(
    '/',
    {
      schema: {
        description: 'List API keys (no secret material)',
        tags: ['api-keys'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const keys = await getApiKeyManager().list(request.tenantId ?? DEFAULT_TENANT);
      return { success: true as const, data: keys };
    },
  );

  // DELETE /:id — revoke
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Revoke an API key',
        tags: ['api-keys'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const payload = request.user as { sub: string };
      await getApiKeyManager().revoke(id, request.tenantId ?? DEFAULT_TENANT);
      return { success: true as const, data: { id, revoked: true } };
    },
  );
}
