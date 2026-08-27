import type { FastifyInstance } from 'fastify';
import { UserManager } from '@accessbase/identity';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

export async function userRoutes(app: FastifyInstance) {
  // All user routes require authentication
  app.addHook('preHandler', (app as any).authenticate);

  // Reuse single UserManager instance per route module
  const userManager = new UserManager();

  // GET /api/v1/users — paginated list
  app.get(
    '/',
    {
      schema: {
        description: 'List users (paginated)',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            search: { type: 'string' },
            status: { type: 'string', enum: ['active', 'suspended', 'pending'] },
            sortBy: { type: 'string' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, search, status, sortBy, sortOrder } = request.query as Record<string, string | undefined>;
      const result = await userManager.findAll(
        {
          page: Number(page),
          pageSize: Number(pageSize),
          search,
          status: status as 'active' | 'suspended' | 'pending' | undefined,
          sortBy,
          sortOrder: sortOrder as 'asc' | 'desc' | undefined,
        },
        DEFAULT_TENANT,
      );
      return { success: true, data: result.data, total: result.total };
    },
  );

  // GET /api/v1/users/me — current user profile
  app.get(
    '/me',
    {
      schema: {
        description: 'Get current user profile',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { sub: string };
      const user = await userManager.findById(payload.sub, DEFAULT_TENANT);
      if (!user) {
        throw new Error('User not found');
      }
      return {
        success: true,
        data: { id: user.id, email: user.email, name: user.name, isActive: user.isActive },
      };
    },
  );

  // GET /api/v1/users/:id — get by ID
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get user by ID',
        tags: ['users'],
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
        const user = await userManager.findById(id, DEFAULT_TENANT);
        if (!user) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'User not found' },
          });
        }
        return { success: true, data: user };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'User not found' },
          });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/users — create user
  app.post(
    '/',
    {
      schema: {
        description: 'Create a new user',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['email', 'name'],
          properties: {
            email: { type: 'string', format: 'email' },
            name: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 8 },
            avatarUrl: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, name, password, avatarUrl } = request.body as {
        email: string;
        name: string;
        password?: string;
        avatarUrl?: string;
      };
      try {
        const user = await userManager.create({ email, name, password, avatarUrl }, DEFAULT_TENANT);
        return reply.status(201).send({ success: true, data: user });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          return reply.status(409).send({
            success: false,
            error: { code: 'CONFLICT', message: 'User with this email already exists' },
          });
        }
        throw err;
      }
    },
  );

  // PUT /api/v1/users/:id — update user
  app.put<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Update user',
        tags: ['users'],
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
            avatarUrl: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, avatarUrl } = request.body as { name?: string; avatarUrl?: string };
      try {
        const user = await userManager.update(id, { name, avatarUrl }, DEFAULT_TENANT);
        return { success: true, data: user };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'User not found' },
          });
        }
        throw err;
      }
    },
  );

  // PATCH /api/v1/users/:id/status — change user status
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/:id/status',
    {
      schema: {
        description: 'Change user status',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['active', 'suspended', 'pending'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body as { status: 'active' | 'suspended' | 'pending' };
      try {
        const user = await userManager.changeStatus(id, status, DEFAULT_TENANT);
        return { success: true, data: user };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'User not found' },
          });
        }
        throw err;
      }
    },
  );

  // DELETE /api/v1/users/:id — delete user
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Delete user',
        tags: ['users'],
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
        await userManager.delete(id, DEFAULT_TENANT);
        return { success: true };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'User not found' },
          });
        }
        throw err;
      }
    },
  );
}
