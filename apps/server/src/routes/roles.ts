import type { FastifyInstance } from 'fastify';
import { RoleManager } from '@accessbase/identity';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

export async function roleRoutes(app: FastifyInstance) {
  // All role routes require authentication
  app.addHook('preHandler', (app as any).authenticate);

  // Reuse single RoleManager instance per route module
  const roleManager = new RoleManager();

  // GET /api/v1/roles
  app.get(
    '/',
    {
      schema: {
        description: 'List roles (paginated)',
        tags: ['roles'],
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
      const { page = 1, pageSize = 20, search } = request.query as {
        page?: number;
        pageSize?: number;
        search?: string;
      };
      const result = await roleManager.findAll(
        { page: Number(page), pageSize: Number(pageSize), search },
        DEFAULT_TENANT,
      );
      return { success: true, data: result.data, total: result.total };
    },
  );

  // GET /api/v1/roles/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get role by ID',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const role = await roleManager.findById(request.params.id, DEFAULT_TENANT);
      if (!role) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Role not found' },
        });
      }
      return { success: true, data: role };
    },
  );

  // POST /api/v1/roles
  app.post(
    '/',
    {
      schema: {
        description: 'Create a new role',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            parentId: { type: 'string', format: 'uuid' },
            permissionIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, description, parentId, permissionIds } = request.body as {
        name: string;
        description?: string;
        parentId?: string;
        permissionIds?: string[];
      };
      const role = await roleManager.create(
        { name, description, parentId, permissionIds },
        DEFAULT_TENANT,
      );
      return reply.status(201).send({ success: true, data: role });
    },
  );

  // PUT /api/v1/roles/:id
  app.put<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Update role',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            permissionIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, description, permissionIds } = request.body as {
        name?: string;
        description?: string;
        permissionIds?: string[];
      };
      const role = await roleManager.update(id, { name, description, permissionIds }, DEFAULT_TENANT);
      return { success: true, data: role };
    },
  );

  // DELETE /api/v1/roles/:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Delete role',
        tags: ['roles'],
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
      await roleManager.delete(id, DEFAULT_TENANT);
      return { success: true };
    },
  );
}
