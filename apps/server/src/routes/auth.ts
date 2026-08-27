import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface LoginBody {
  email: string;
  password: string;
}

interface RegisterBody {
  email: string;
  name: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/login
  app.post<{ Body: LoginBody }>(
    '/login',
    {
      schema: {
        description: 'Password login',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' },
                  refreshToken: { type: 'string' },
                  expiresIn: { type: 'number' },
                },
              },
            },
          },
          401: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      try {
        const userManager = new (await import('@accessbase/identity')).UserManager();
        const user = await userManager.verifyPassword(email, password);

        const accessToken = app.jwt.sign(
          { sub: user.id, email: user.email },
          { expiresIn: '15m' },
        );
        const refreshToken = app.jwt.sign(
          { sub: user.id, email: user.email, type: 'refresh' },
          { expiresIn: '7d' },
        );

        request.log.info({ email }, 'Login successful');

        return {
          success: true,
          data: {
            accessToken,
            refreshToken,
            expiresIn: 900,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              roles: [],
            },
          },
        };
      } catch (err: unknown) {
        request.log.warn({ email }, 'Login failed');
        return reply.status(401).send({
          success: false,
          error: {
            code: 'AUTH_002',
            message: 'Invalid email or password',
          },
        });
      }
    },
  );

  // POST /api/v1/auth/register
  app.post<{ Body: RegisterBody }>(
    '/register',
    {
      schema: {
        description: 'User registration',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'name', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            name: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, name, password } = request.body;

      // TODO: Use @accessbase/identity UserManager when implemented
      request.log.info({ email, name }, 'Registration attempt');

      return reply.status(501).send({
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Identity package not yet wired',
        },
      });
    },
  );
  // GET /api/v1/auth/me
  app.get(
    '/me',
    {
      preHandler: [(app as any).authenticate],
      schema: {
        description: 'Get current user profile',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { sub: string; email: string };
      const userManager = new (await import('@accessbase/identity')).UserManager();
      const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
      const user = await userManager.findById(payload.sub, DEFAULT_TENANT);
      if (!user) {
        throw new Error('User not found');
      }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: [],
      };
    },
  );

  // POST /api/v1/auth/logout
  app.post(
    '/logout',
    {
      preHandler: [(app as any).authenticate],
      schema: {
        description: 'Logout (revoke session)',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      // JWT is stateless — logout is client-side (discard tokens)
      return { success: true };
    },
  );

  // POST /api/v1/auth/refresh
  app.post(
    '/refresh',
    {
      schema: {
        description: 'Refresh access token',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      try {
        const payload = app.jwt.verify(refreshToken) as { sub: string; email: string; type?: string };
        if (payload.type !== 'refresh') {
          throw new Error('Not a refresh token');
        }
        const accessToken = app.jwt.sign(
          { sub: payload.sub, email: payload.email },
          { expiresIn: '15m' },
        );
        const newRefreshToken = app.jwt.sign(
          { sub: payload.sub, email: payload.email, type: 'refresh' },
          { expiresIn: '7d' },
        );
        return {
          success: true,
          data: { accessToken, refreshToken: newRefreshToken, expiresIn: 900 },
        };
      } catch {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_003', message: 'Invalid refresh token' },
        });
      }
    },
  );
}
