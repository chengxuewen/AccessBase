import type { FastifyInstance } from 'fastify'

export async function roleRoutes(app: FastifyInstance) {
  // All role routes require authentication
  app.addHook('preHandler', (app as any).authenticate)

  // GET /api/v1/roles
  app.get('/', {
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
  }, async (request, reply) => {
    // TODO: Use @accessbase/identity RoleManager when implemented
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // GET /api/v1/roles/:id
  app.get<{ Params: { id: string } }>('/:id', {
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
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // POST /api/v1/roles
  app.post('/', {
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
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // PUT /api/v1/roles/:id
  app.put<{ Params: { id: string } }>('/:id', {
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
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // DELETE /api/v1/roles/:id
  app.delete<{ Params: { id: string } }>('/:id', {
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
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })
}
