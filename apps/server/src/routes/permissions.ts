import type { FastifyInstance } from 'fastify';
import { PermissionManager } from '@accessbase/identity';

export async function permissionRoutes(app: FastifyInstance) {
  // All permission routes require authentication
  app.addHook('preHandler', app.authenticate);

  // Reuse single PermissionManager instance per route module
  const permissionManager = new PermissionManager();

  // GET /api/v1/permissions
  app.get(
    '/',
    {
      schema: {
        description: 'List permissions (paginated)',
        tags: ['permissions'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 100 } = request.query as {
        page?: number;
        pageSize?: number;
      };
      const result = await permissionManager.findAll({
        page: Number(page),
        pageSize: Number(pageSize),
      });
      return { success: true, data: result.data, total: result.total };
    },
  );
}
