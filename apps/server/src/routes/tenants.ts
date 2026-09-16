import type { FastifyInstance } from 'fastify';
import { TenantManager } from '@accessbase/identity';
import { requirePermission } from '../utils/permission.js';

/**
 * Tenants CRUD routes — global resource (no tenant scoping; DEFAULT_TENANT
 * does not apply here). Default-tenant modify/delete and duplicate slugs both
 * surface as TENANT_PROTECTED-tagged errors from TenantManager → mapped to 409.
 */
export async function tenantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  const tenantManager = new TenantManager();

  /** Error → HTTP mapping shared by all handlers (brief contract). */
  function sendTenantError(reply: {
    status: (code: number) => { send: (payload: unknown) => void };
  }, err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.message.startsWith('TENANT_PROTECTED')) {
      return reply.status(409).send({
        success: false,
        error: { code: 'TENANT_PROTECTED', message: 'Tenant is protected or slug already exists' },
      });
    }
    if (error.message.includes('not found')) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      });
    }
    throw err;
  }

  // GET /api/v1/tenants — paginated list
  app.get(
    '/',
    {
      schema: {
        description: 'List tenants (paginated)',
        tags: ['tenants'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            search: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, search } = request.query as Record<string, string | undefined>;
      const result = await tenantManager.findAll({
        page: Number(page),
        pageSize: Number(pageSize),
        search,
      });
      return { success: true, data: result.data, total: result.total };
    },
  );

  // GET /api/v1/tenants/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get tenant by ID',
        tags: ['tenants'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const tenant = await tenantManager.findById(id);
      if (!tenant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Tenant not found' },
        });
      }
      return { success: true, data: tenant };
    },
  );

  // POST /api/v1/tenants
  app.post(
    '/',
    {
      schema: {
        description: 'Create a new tenant',
        tags: ['tenants'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'slug'],
          properties: {
            name: { type: 'string', minLength: 1 },
            slug: { type: 'string', minLength: 1, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { name, slug } = request.body as { name: string; slug: string };
      try {
        const tenant = await tenantManager.create({ name, slug });
        return reply.status(201).send({ success: true, data: tenant });
      } catch (err) {
        return sendTenantError(reply, err);
      }
    },
  );

  // PUT /api/v1/tenants/:id
  app.put<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Update tenant',
        tags: ['tenants'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            slug: { type: 'string', minLength: 1, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
            status: { type: 'string', enum: ['active', 'suspended'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, slug, status } = request.body as { name?: string; slug?: string; status?: string };
      try {
        const tenant = await tenantManager.update(id, { name, slug, status });
        return { success: true, data: tenant };
      } catch (err) {
        return sendTenantError(reply, err);
      }
    },
  );

  // DELETE /api/v1/tenants/:id — soft delete (suspends via manager)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Delete tenant (soft: suspends the tenant)',
        tags: ['tenants'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const tenant = await tenantManager.delete(id);
        return { success: true, data: tenant };
        // TENANT_PROTECTED → 409; not found → 404 (shared mapper)
      } catch (err) {
        return sendTenantError(reply, err);
      }
    },
  );
}
