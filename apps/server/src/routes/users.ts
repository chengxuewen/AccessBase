import type { FastifyInstance } from 'fastify';
import { UserManager, RoleManager, SessionManager } from '@accessbase/identity';
import { assertPasswordPolicy, readPasswordPolicy } from '@accessbase/identity';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { requirePermission } from '../utils/permission.js';
import { toCsv } from '../utils/csv.js';
import { getOptionsManager } from './options.js';


/**
 * Module-level lazy singleton (addendum #5): per-request `new SessionManager()`
 * would pile up pg Pools. Constructed only when suspend first needs it.
 */
let sessionManagerSingleton: SessionManager | null = null;
function getSessionManager(): SessionManager {
  sessionManagerSingleton ??= new SessionManager();
  return sessionManagerSingleton;
}

export async function userRoutes(app: FastifyInstance) {
  // All user routes require authentication
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  // Reuse single UserManager instance per route module
  const userManager = new UserManager();
  const roleManager = new RoleManager();

  /** Tenant-scope check for caller-supplied roleIds; returns the first unknown id (route-boundary validation). */
  async function unknownRoleId(roleIds: string[] | undefined, tenantId?: string): Promise<string | null> {
    if (!roleIds) return null;
    for (const roleId of roleIds) {
      const role = await roleManager.findById(roleId, tenantId ?? DEFAULT_TENANT);
      if (!role) return roleId;
    }
    return null;
  }

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
        request.tenantId ?? DEFAULT_TENANT,
      );
      return { success: true, data: result.data, total: result.total };
    },
  );

  // GET /api/v1/users/export — full CSV download.
  // NOTE: rides the existing GET:/api/v1/users mapping (prefix truncation →
  // users:read); no new authorize.ts key (addendum #4 drift guard). Registered
  // before the /:id route so 'export' is not swallowed as an id.
  app.get(
    '/export',
    {
      schema: {
        description: 'Export users as CSV',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      // OFFSET pages of 500 until an empty/short batch; 50k safety cap.
      // ponytail: 50k-row cap — raise if real exports hit it
      const PAGE = 500;
      const MAX_ROWS = 50_000;
      const headers = [
        'id',
        'email',
        'name',
        'status',
        'isActive',
        'totpEnabled',
        'tenantId',
        'roles',
        'createdAt',
        'updatedAt',
      ];
      const csvRows: Record<string, unknown>[] = [];
      for (let page = 1; csvRows.length < MAX_ROWS; page++) {
        const result = await userManager.findAll({ page, pageSize: PAGE }, request.tenantId ?? DEFAULT_TENANT);
        if (result.data.length === 0) break;
        for (const user of result.data) {
          if (csvRows.length >= MAX_ROWS) break;
          const roles = await roleManager.getUserRoles(user.id, request.tenantId ?? DEFAULT_TENANT);
          csvRows.push({
            ...user,
            roles: roles.map((r) => r.name).join(','),
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
          });
        }
        if (result.data.length < PAGE) break;
      }

      const csv = toCsv(headers, csvRows);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.send(csv);
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
      const user = await userManager.findById(payload.sub, request.tenantId ?? DEFAULT_TENANT);
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
        const user = await userManager.findById(id, request.tenantId ?? DEFAULT_TENANT);
        if (!user) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'User not found' },
          });
        }
        // Detail exposes the role list (UserDetail renders it, UserEdit prefills roleIds)
        const roles = await roleManager.getUserRoles(id, request.tenantId ?? DEFAULT_TENANT);
        return {
          success: true,
          data: {
            ...user,
            roles: roles.map((r) => ({ id: r.id, name: r.name })),
            roleIds: roles.map((r) => r.id),
          },
        };
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
            isActive: { type: 'boolean' },
            roleIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, name, password, avatarUrl, isActive, roleIds } = request.body as {
        email: string;
        name: string;
        password?: string;
        avatarUrl?: string;
        isActive?: boolean;
        roleIds?: string[];
      };
      const unknown = await unknownRoleId(roleIds, request.tenantId);
      if (unknown) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_001', message: `Role ${unknown} not found in tenant` },
        });
      }
      try {
        const user = await userManager.create(
          { email, name, password, avatarUrl, isActive },
          request.tenantId ?? DEFAULT_TENANT,
        );
        if (roleIds && roleIds.length > 0) {
          await roleManager.setUserRoles(user.id, roleIds, request.tenantId ?? DEFAULT_TENANT);
        }
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

  // POST /api/v1/users/import — two-phase CSV/JSON row import (C5b).
  // Dry-run (default) validates each row and returns a report without writing.
  // commit=true creates valid rows individually — one bad row never blocks others.
  // Imported users land ACTIVE (R6): create receives isActive: true explicitly.
  // Rides POST:/api/v1/users prefix → users:write; no new authorize.ts key.
  app.post(
    '/import',
    {
      schema: {
        description: 'Import users (two-phase: dry-run report, then commit)',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['rows'],
          properties: {
            rows: { type: 'array', maxItems: 1000, items: { type: 'object' } },
            commit: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { rows, commit } = request.body as {
        rows: Array<{ email?: string; name?: string; password?: string }>;
        commit?: boolean;
      };
      const policy = await readPasswordPolicy(getOptionsManager().get.bind(getOptionsManager()), 'register');
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const errors: Array<{ row: number; field: string; message: string }> = [];
      const valid: Array<{ email: string; name: string; password: string }> = [];

      for (const [i, row] of rows.entries()) {
        const email = (row.email ?? '').trim();
        const name = (row.name ?? '').trim();
        const password = row.password ?? '';
        if (!emailRe.test(email)) {
          errors.push({ row: i, field: 'email', message: 'Invalid email' });
          continue;
        }
        if (!name) {
          errors.push({ row: i, field: 'name', message: 'Name is required' });
          continue;
        }
        const pw = assertPasswordPolicy(password, policy);
        if (!pw.ok) {
          errors.push({ row: i, field: 'password', message: pw.message });
          continue;
        }
        if (commit) {
          try {
            // Pre-existing duplicate check; in-batch duplicates surface via the
            // same path once the first row is created (findByEmail sees it).
            if (await userManager.findByEmail(email)) {
              errors.push({ row: i, field: 'email', message: 'User with this email already exists' });
              continue;
            }
            await userManager.create(
              { email, name, password, isActive: true },
              request.tenantId ?? DEFAULT_TENANT,
            );
          } catch (err) {
            // Per-row isolation: unique-violation or any create failure only
            // fails this row; the loop continues.
            const error = err instanceof Error ? err : new Error(String(err));
            request.log.error({ err: error, row: i }, 'Import row failed');
            errors.push({ row: i, field: 'email', message: 'User with this email already exists' });
            continue;
          }
        } else {
          valid.push({ email, name, password });
        }
      }

      return commit
        ? { success: true, data: { created: rows.length - errors.length, errors } }
        : { success: true, data: { valid: valid.length, errors } };
    },
  );

  // POST /api/v1/users/:id/force-logout — revoke every session of a user (C3).
  // R13 simplified: revokeAllUserSessions only — NO permission-cache invalidation
  // (the affected user's authz is unchanged; only their sessions die). Idempotent.
  app.post<{ Params: { id: string } }>(
    '/:id/force-logout',
    {
      schema: {
        description: 'Revoke all sessions for a user (force logout)',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      await getSessionManager().revokeAllUserSessions(id);
      return { success: true, data: { revoked: true } };
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
            roleIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, avatarUrl, roleIds } = request.body as {
        name?: string;
        avatarUrl?: string;
        roleIds?: string[];
      };
      const unknown = await unknownRoleId(roleIds, request.tenantId);
      if (unknown) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_001', message: `Role ${unknown} not found in tenant` },
        });
      }
      try {
        const user = await userManager.update(id, { name, avatarUrl }, request.tenantId ?? DEFAULT_TENANT);
        if (roleIds !== undefined) {
          await roleManager.setUserRoles(id, roleIds, request.tenantId ?? DEFAULT_TENANT);
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
        const user = await userManager.changeStatus(id, status, request.tenantId ?? DEFAULT_TENANT);
        // P0: suspension must take effect immediately — kill all refresh sessions.
        // Access tokens die at authenticate via the status claim re-check.
        if (status === 'suspended') {
          await getSessionManager().revokeAllUserSessions(id);
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
        await userManager.delete(id, request.tenantId ?? DEFAULT_TENANT);
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
