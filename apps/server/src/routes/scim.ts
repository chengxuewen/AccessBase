/**
 * SCIM 2.0 protocol mount skeleton (Batch H Task 1).
 *
 * Mounted at /api/v1/scim/v2. S2S provisioning protocol: IdPs (Azure AD,
 * Okta, Google Workspace) authenticate with an API key scoped to ['scim']
 * (R1/R2) — NOT the shared JWT authenticate decorator. Auth is a
 * plugin-scoped preHandler that reads the bearer directly via
 * ApiKeyManager.findByHash; valid keys inject key.tenantId into
 * request.tenantId (R3) so downstream handlers never fall back to
 * DEFAULT_TENANT.
 *
 * ALL responses use the SCIM error/list shape ({schemas: [...], ...}) —
 * never our {success,data} envelope (RFC 7644 wire contract).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SafeApiKey } from '@accessbase/identity';
import { ApiKeyManager, hashApiKey } from '@accessbase/identity';
import { getApiKeyManager } from './api-keys.js';

const SCIM_MEDIA_TYPE = 'application/scim+json';

const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** RFC 7644 §3.12 error envelope. */
function scimError(
  reply: FastifyReply,
  status: number,
  scimType: string | undefined,
  detail: string,
): void {
  reply.status(status).header('content-type', SCIM_MEDIA_TYPE).send({
    schemas: [ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  });
}

/** Content type on every SCIM response, SCIM shape or not. */
function scimSend(reply: FastifyReply, status: number, body: Record<string, unknown>): void {
  reply.status(status).header('content-type', SCIM_MEDIA_TYPE).send(body);
}

export async function scimRoutes(app: FastifyInstance): Promise<void> {
  // R5: scoped parser, registered UNCONDITIONALLY — Fastify 4 has no
  // application/scim+json parser, so Azure AD's constant media type would 415.
  // Scoped to this plugin's encapsulation context (saml.ts:27 precedent);
  // app.ts must NOT gain any global addContentTypeParser (static invariant).
  app.addContentTypeParser(
    SCIM_MEDIA_TYPE,
    { parseAs: 'string' },
    (_req, body, done: (err: Error | null, result?: unknown) => void) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (e) {
        done(e as Error);
      }
    },
  );

  // Plugin-scoped bearer auth (spec H2): ab_ API keys only; the key's scopes
  // must include 'scim'. Injects key.tenantId (R3). JWTs and missing headers
  // get a SCIM-shaped 401.
  // NOTE: hooks must return undefined. Returning `reply` from an async
  // preHandler makes Fastify 4 treat the settled Reply as the handler's
  // resolution — the request then never completes (inject hang).
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    if (!bearer) {
      scimError(reply, 401, undefined, 'Authentication required: provide a Bearer token');
      return;
    }
    const key: SafeApiKey | null = await getApiKeyManager().findByHash(hashApiKey(bearer));
    if (!key || key.revokedAt !== null || ApiKeyManager.isExpired(key.expiresAt)) {
      scimError(reply, 401, undefined, 'Invalid or revoked token');
      return;
    }
    // ApiKeyRow.scopes is an untyped jsonb (unknown) — narrow before use.
    const scopes = Array.isArray(key.scopes) ? (key.scopes as string[]) : [];
    if (!scopes.includes('scim')) {
      scimError(reply, 403, undefined, "Token scope does not permit SCIM provisioning (requires 'scim')");
      return;
    }
    request.tenantId = key.tenantId;
  });

  // --- Discovery endpoints (RFC 7644 §4/§5) — static docs, no DB ---

  app.get('/ServiceProviderConfig', async (_req, reply) => {
    scimSend(reply, 200, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
      patch: { supported: true },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'AccessBase API key (scopes: ["scim"]) passed as a bearer token',
          primary: true,
        },
      ],
      meta: {
        resourceType: 'ServiceProviderConfig',
        location: '/api/v1/scim/v2/ServiceProviderConfig',
      },
    });
  });

  app.get('/Schemas', async (_req, reply) => {
    scimSend(reply, 200, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [
        {
          id: 'urn:ietf:params:scim:schemas:core:2.0:User',
          name: 'User',
          description: 'User Account',
          attributes: [
            { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'externalId', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'name', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', subAttributes: [
              { name: 'familyName', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
              { name: 'givenName', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            ] },
            { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', subAttributes: [
              { name: 'value', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
              { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            ] },
          ],
          meta: { resourceType: 'Schema', location: '/api/v1/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User' },
        },
      ],
      startIndex: 1,
      itemsPerPage: 1,
    });
  });

  app.get('/ResourceTypes', async (_req, reply) => {
    scimSend(reply, 200, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [
        {
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'User Account',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
          schemaExtensions: [],
          meta: { resourceType: 'ResourceType', location: '/api/v1/scim/v2/ResourceTypes/User' },
        },
      ],
      startIndex: 1,
      itemsPerPage: 1,
    });
  });

  // POST /Users placeholder — T2 owns the real implementation. Proves the
  // scoped parser (request.body is a parsed object, not a string) and the
  // auth chain end to end.
  app.post('/Users', async (_req, reply) => {
    scimSend(reply, 501, {
      schemas: [ERROR_SCHEMA],
      status: '501',
      detail: 'SCIM User provisioning not yet implemented',
    });
  });
}
