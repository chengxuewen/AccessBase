import type { FastifyInstance } from 'fastify';
import { RoleManager } from '@accessbase/identity';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { requirePermission } from '../utils/permission.js';
import { sendConflictError } from '../utils/conflict-mapper.js';


export async function roleRoutes(app: FastifyInstance) {
  // All role routes require authentication
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

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
        request.tenantId ?? DEFAULT_TENANT,
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
      const role = await roleManager.findById(request.params.id, request.tenantId ?? DEFAULT_TENANT);
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
      try {
        const role = await roleManager.create(
          { name, description, parentId, permissionIds },
          request.tenantId ?? DEFAULT_TENANT,
        );
        return reply.status(201).send({ success: true, data: role });
      } catch (err) {
        // L′ X1: funnel refusals from the create path (PERMISSION_NOT_BINDABLE /
        // ROLE_PROTECTED / cycle) share the PUT handler's 409/404 mapping.
        const conflict = sendConflictError(reply, err);
        if (conflict) return conflict;
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Role not found' },
          });
        }
        if (message.toLowerCase().includes('cycle')) {
          return reply.status(409).send({
            success: false,
            error: { code: 'ROLE_INHERITANCE_CYCLE', message: 'Role inheritance forms a cycle' },
          });
        }
        throw err;
      }
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
            // L'-T5: nullable parent — explicit null clears inheritance, an absent
            // key leaves the parent untouched.
            parentId: { type: ['string', 'null'], format: 'uuid' },
            permissionIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body as {
        name?: string;
        description?: string;
        parentId?: string | null;
        permissionIds?: string[];
      };
      const tenantId = request.tenantId ?? DEFAULT_TENANT;
      try {
        // Inheritance changes go through setParent (same-tenant + cycle + isSystem
        // guards live in the manager funnel) BEFORE any field write, so a rejected
        // parent cannot leave a half-applied update behind.
        if ('parentId' in body) {
          await roleManager.setParent(id, body.parentId ?? null, tenantId);
        }
        const role = await roleManager.update(
          id,
          { name: body.name, description: body.description, permissionIds: body.permissionIds },
          tenantId,
        );
        return { success: true, data: role };
      } catch (err) {
        // K-T2: ROLE_PROTECTED/LAST_ADMIN_GUARD manager tags → 409 envelope.
        const conflict = sendConflictError(reply, err);
        if (conflict) return conflict;
        // Manager funnel "not found" refusals (missing role / missing parent role)
        // surface as the same NOT_FOUND envelope GET /:id uses.
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Role not found' },
          });
        }
        // Cycle refusals from the setParent funnel (X3): untagged at the manager,
        // mapped here to the documented ROLE_INHERITANCE_CYCLE identifier, 409 per
        // batch L' criterion 6 (conflict-mapper is tag-prefix-only and T1-owned).
        if (message.toLowerCase().includes('cycle')) {
          return reply.status(409).send({
            success: false,
            error: { code: 'ROLE_INHERITANCE_CYCLE', message: 'Role inheritance forms a cycle' },
          });
        }
        throw err;
      }
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
      try {
        await roleManager.delete(id, request.tenantId ?? DEFAULT_TENANT);
        return { success: true };
      } catch (err) {
        // K-T2: ROLE_PROTECTED manager tag → 409 envelope (never a raw 500).
        const conflict = sendConflictError(reply, err);
        if (conflict) return conflict;
        throw err;
      }
    },
  );
}
