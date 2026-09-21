import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  TenantManager,
  UserManager,
  RoleManager,
  TENANT_BINDABLE_PERMISSIONS,
  readPasswordPolicy,
  assertPasswordPolicy,
} from '@accessbase/identity';
import { createDb, roles as rolesTable } from '@accessbase/identity/db';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { config } from '../config.js';
import { requirePermission } from '../utils/permission.js';
import { getOptionsManager } from './options.js';
import { bindPermissions } from './permissions-seed.js';

type StatusSender = { status: (code: number) => { send: (payload: unknown) => unknown } };

/**
 * Tenants CRUD routes — global resource (no tenant scoping; DEFAULT_TENANT
 * does not apply here). Default-tenant modify/delete and duplicate slugs both
 * surface as TENANT_PROTECTED-tagged errors from TenantManager → mapped to 409.
 *
 * L′ platform belt: every mutation (create/update/delete/bootstrap) additionally
 * requires request.tenantId === DEFAULT_TENANT at the HANDLER layer — route code
 * gates are short-circuited by '*'-scope API keys, and the belt being the FIRST
 * check means non-platform callers can never probe tenant existence/state.
 */
export async function tenantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  const tenantManager = new TenantManager();
  const userManager = new UserManager();
  const roleManager = new RoleManager();

  // Lazy dial for the two direct-SQL writes bootstrap needs (isSystem stamp +
  // strict bind) — same setup.ts pattern; managers are typed APIs without those surfaces.
  let seedDb: ReturnType<typeof createDb> | undefined;
  function getSeedDb(): ReturnType<typeof createDb> {
    if (!seedDb) seedDb = createDb(config.databaseUrl);
    return seedDb;
  }

  /** Belt check (see header). undefined = platform caller, proceed. */
  function platformBelt(request: { tenantId?: string }, reply: StatusSender) {
    if (request.tenantId === DEFAULT_TENANT) return undefined;
    return reply.status(403).send({
      success: false,
      error: {
        code: 'TENANT_PLATFORM_ONLY',
        message: 'Tenant management is restricted to the platform (default) tenant',
      },
    });
  }

  /** Error → HTTP mapping shared by all handlers (brief contract). */
  function sendTenantError(reply: StatusSender, err: unknown) {
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
      const belt = platformBelt(request, reply);
      if (belt) return belt;
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
      const belt = platformBelt(request, reply);
      if (belt) return belt;
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
      const belt = platformBelt(request, reply);
      if (belt) return belt;
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

  // POST /api/v1/tenants/:id/bootstrap — cold-start a tenant (L′ spec D2):
  // find-or-create its 'admin' role (isSystem-stamped), STRICT-bind the 9
  // tenant-bindable codes, then create + assign the first administrator.
  // Same-tenant email holder = idempotent replay (200); other-tenant email =
  // 409 (users.email is globally unique).
  app.post<{ Params: { id: string } }>(
    '/:id/bootstrap',
    {
      schema: {
        description: 'Bootstrap a tenant: create its admin role and first administrator',
        tags: ['tenants'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            name: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      // 1. belt FIRST (B7a): non-platform callers never learn 404/409 states
      const belt = platformBelt(request, reply);
      if (belt) return belt;
      // 2. the wizard owns the default tenant (no second platform admin via this path)
      if (id === DEFAULT_TENANT) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'TENANT_PROTECTED',
            message: 'The default tenant is bootstrapped by the setup wizard',
          },
        });
      }
      const { email, name, password } = request.body as {
        email: string;
        name?: string;
        password: string;
      };
      try {
        // 3. target exists + active
        const tenant = await tenantManager.findById(id);
        if (!tenant) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          });
        }
        if (tenant.status !== 'active') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'TENANT_PROTECTED',
              message: 'Only an active tenant can be bootstrapped',
            },
          });
        }
        // 4. email is globally unique. Same-tenant holder converges ONLY when it
        // already HOLDS the tenant admin role (L″ D1: a plain same-tenant user
        // must not be silently promoted); otherwise ordinary conflict.
        const existingUser = await userManager.findByEmail(email);
        let replayArm = false;
        if (existingUser) {
          if (existingUser.tenantId !== id) {
            return reply.status(409).send({
              success: false,
              error: {
                code: 'EMAIL_EXISTS',
                message: 'Email already registered in another tenant',
              },
            });
          }
          const held = await roleManager.getUserRoles(existingUser.id, id);
          replayArm = held.some((r) => r.name === 'admin');
          if (!replayArm) {
            return reply.status(409).send({
              success: false,
              error: {
                code: 'EMAIL_EXISTS',
                message: 'Email already registered in this tenant without admin role',
              },
            });
          }
        }
        // 5. password policy at the ROUTE layer via the dedicated user_create
        // callsite (R2/G-3); the replay arm mints no credential and skips it.
        if (!replayArm) {
          const om = getOptionsManager();
          const policy = await readPasswordPolicy(om.get.bind(om), 'user_create');
          const pw = assertPasswordPolicy(password, policy);
          if (!pw.ok) {
            return reply.status(400).send({
              success: false,
              error: { code: 'WEAK_PASSWORD', message: pw.message },
            });
          }
        }
        // 6. role find-or-create (create() IS find-or-create on (name,tenantId))
        // + UNCONDITIONAL idempotent isSystem stamp (B6 window) — replay converges
        // a half-failed first attempt through these same idempotent steps.
        const adminRole = await roleManager.create(
          { name: 'admin', description: 'Tenant administrator', isSystem: true },
          id,
        );
        await getSeedDb()
          .update(rolesTable)
          .set({ isSystem: true })
          .where(eq(rolesTable.id, adminRole.id));
        // 7. STRICT bind — shortfall throws (never a 201 with silent 0 bindings, X4)
        await bindPermissions(getSeedDb(), adminRole.id, TENANT_BINDABLE_PERMISSIONS);
        // 8. fresh-path user create AFTER the bind can no longer fail
        const userId = replayArm && existingUser
          ? existingUser.id
          : (await userManager.create({ email, name: name ?? email, password }, id)).id;
        // 9. membership (conflict-safe since T1 onConflictDoNothing — replays converge)
        await roleManager.assignToUser(userId, adminRole.id, id);
        return reply.status(replayArm ? 200 : 201).send({
          success: true,
          data: {
            userId,
            roleId: adminRole.id,
            tenantId: id,
            alreadyBootstrapped: replayArm,
          },
        });

      } catch (err) {
        return sendTenantError(reply, err);
      }
    },
  );
}
