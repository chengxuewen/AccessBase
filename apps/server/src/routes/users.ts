import type { FastifyInstance } from 'fastify'

export async function userRoutes(app: FastifyInstance) {
  // All user routes require authentication
  app.addHook('preHandler', (app as any).authenticate)

  // GET /api/v1/users
  app.get('/', {
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
  }, async (request, reply) => {
    // TODO: Use @accessbase/identity UserManager when implemented
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // GET /api/v1/users/me
  app.get('/me', {
    schema: {
      description: 'Get current user profile',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    // TODO: Use @accessbase/identity UserManager when implemented
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // GET /api/v1/users/:id
  app.get<{ Params: { id: string } }>('/:id', {
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
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // POST /api/v1/users
  app.post('/', {
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
          roles: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // PUT /api/v1/users/:id
  app.put<{ Params: { id: string } }>('/:id', {
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
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })

  // DELETE /api/v1/users/:id
  app.delete<{ Params: { id: string } }>('/:id', {
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
  }, async (request, reply) => {
    return reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Identity package not yet wired' },
    })
  })
}
