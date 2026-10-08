import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { FlowTokenService, UserManager, RoleManager, SessionManager } from '@accessbase/identity';
import type { UserScopeFilter } from '@accessbase/identity';
import { getRedis } from '../utils/redis.js';
import { getSmtpMailer, resolvePublicOrigin } from './auth.js';
import { renderEmailFor } from '../utils/email-templates.js';
import { assertPasswordPolicy, readPasswordPolicy } from '@accessbase/identity';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { routeTx } from '../utils/tx.js';
import { requirePermission } from '../utils/permission.js';
import { resolveUserRowScope, type UserRowScopeCode } from '../utils/data-scope.js';
import { sendConflictError } from '../utils/conflict-mapper.js';
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

  /** 403 DATA_SCOPE envelope (spec §3.3: plain forbidden, conflict-mapper not used). */
  function forbiddenScope(reply: FastifyReply, message: string): FastifyReply {
    return reply.status(403).send({ success: false, error: { code: 'DATA_SCOPE', message } });
  }

  /**
   * DG-6d per-row guard against an already-resolved caller scope. kind 'all'
   * is the no-op default (ZERO extra queries — the untouched tenant-wide
   * posture stays byte-identical). 404-first preserved (spec flows oracle):
   * unknown / cross-tenant ids keep NOT_FOUND; an existing-but-out-of-scope
   * target reads 403 DATA_SCOPE.
   */
  async function rowScopeDenied(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    scope: UserScopeFilter,
  ): Promise<boolean> {
    if (scope.kind === 'all') return false;
    const target = await userManager.findById(id, request.tenantId ?? DEFAULT_TENANT);
    if (!target) {
    reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    return true;
    }
    if (!(await userManager.isWithinScope(id, scope))) {
      forbiddenScope(reply, 'User is outside your data scope');
      return true;
    }
    return false;
  }

  /** Resolve + guard in one step for routes without a prior target read. */
  async function guardRowScope(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    code: UserRowScopeCode,
  ): Promise<boolean> {
    const scope = await resolveUserRowScope(request, code);
    return rowScopeDenied(request, reply, id, scope);
  }

  /**
   * A3/R3 creation-arm gate: create / import / invite are tenant-wide-only
   * operations — a dept-scoped manager must not mint rows it cannot govern.
   */
  async function requireAllWriteScope(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> {
    const scope = await resolveUserRowScope(request, 'users:write');
    if (scope.kind === 'all') return false;
    forbiddenScope(reply, 'This operation requires tenant-wide (all) data scope');
    return true;
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
            // Q1-b3: schema-level whitelist (gap-audit D6) — invalid sortBy is a
            // loud 400 (FST_ERR_VALIDATION → VALIDATION_001), never a silent no-op.
            // Must stay in sync with the UserManager.findAll column map.
            sortBy: { type: 'string', enum: ['createdAt', 'email', 'name', 'status'] },
            sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, search, status, sortBy, sortOrder } = request.query as Record<string, string | undefined>;
      // DG-6d [R1]: the list surface rides the caller's users:read binding scope.
      const scope = await resolveUserRowScope(request, 'users:read');
      const result = await userManager.findAll(
        {
          page: Number(page),
          pageSize: Number(pageSize),
          search,
          status: status as 'active' | 'suspended' | 'pending' | undefined,
          sortBy,
          sortOrder: sortOrder as 'asc' | 'desc' | undefined,
          scope,
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
      // DG-6d: the export rides the SAME list predicate as GET / (users:read),
      // resolved once for every OFFSET page.
      const exportScope = await resolveUserRowScope(request, 'users:read');
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
        const result = await userManager.findAll({ page, pageSize: PAGE, scope: exportScope }, request.tenantId ?? DEFAULT_TENANT);
        if (result.data.length === 0) break;
        for (const user of result.data) {
          if (csvRows.length >= MAX_ROWS) break;
          // CSV export reflects effective roles (direct + group-granted).
          const roles = await roleManager.getEffectiveRoles(user.id, request.tenantId ?? DEFAULT_TENANT);
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
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          isActive: user.isActive,
          // Q1-f8: drives the Profile verification banner
          emailVerified: user.emailVerified ?? false,
        },
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
        // DG-6d: tenant-visible rows (404 above) additionally pass the caller's
        // users:read binding scope. kind 'all' short-circuits with zero cost.
        const readScope = await resolveUserRowScope(request, 'users:read');
        if (readScope.kind !== 'all' && !(await userManager.isWithinScope(id, readScope))) {
          return forbiddenScope(reply, 'User is outside your data scope');
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
      // [A3/R3] Creation arm: tenant-wide users:write required.
      if (await requireAllWriteScope(request, reply)) return reply;
      const unknown = await unknownRoleId(roleIds, request.tenantId);
      if (unknown) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_001', message: `Role ${unknown} not found in tenant` },
        });
      }
      try {
        // Q2b: create + role grant are ONE transaction (a failed grant must
        // not leave an ungranted user behind — gap-audit D1).
        const user = await routeTx(async (tx) => {
          const created = await userManager.create(
            { email, name, password, avatarUrl, isActive },
            request.tenantId ?? DEFAULT_TENANT,
            tx,
          );
          if (roleIds && roleIds.length > 0) {
            await roleManager.setUserRoles(created.id, roleIds, request.tenantId ?? DEFAULT_TENANT, tx);
          }
          return created;
        });
        return reply.status(201).send({ success: true, data: user });
      } catch (err) {
        const conflict = sendConflictError(reply, err);
        if (conflict) return conflict;
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
    async (request, reply) => {
      // [A3/R3] The import lane is a creation arm — gate exactly like POST /.
      if (await requireAllWriteScope(request, reply)) return reply;
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

  // POST /api/v1/users/:id/reset-password — Q4a admin reset: sets a temp
  // password, ARMS must-change (next password login routes through the force
  // flow), revokes sessions AND bumps auth-state (B7, via the manager funnel).
  app.post<{ Params: { id: string }; Body: { newPassword?: string } }>(
    '/:id/reset-password',
    {
      schema: {
        description: 'Admin password reset (arms force-change, revokes sessions)',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string', minLength: 1 } } },
      },
    },
    async (request, reply) => {
      const tenantId = request.tenantId ?? DEFAULT_TENANT;
      const target = await userManager.findById(request.params.id, tenantId);
      if (!target) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
      // DG-6d: reset is a mutation → the users:write binding scope guards it.
      const writeScope = await resolveUserRowScope(request, 'users:write');
      if (writeScope.kind !== 'all' && !(await userManager.isWithinScope(target.id, writeScope))) {
        return forbiddenScope(reply, 'User is outside your data scope');
      }
      const newPassword = request.body.newPassword;
      if (typeof newPassword !== 'string') {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_001', message: 'newPassword required' } });
      }
      const policy = await readPasswordPolicy(getOptionsManager().get.bind(getOptionsManager()), 'user_create');
      const verdict = assertPasswordPolicy(newPassword, policy);
      if (!verdict.ok) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_001', message: verdict.message ?? 'Password rejected' } });
      }
      await routeTx(async (tx) => {
        await userManager.adminResetPassword(target.id, newPassword, tx);
      });
      await getSessionManager().revokeAllUserSessions(target.id);
      return { success: true };
    },
  );

  // POST /api/v1/users/:id/invite — Q4a set-password email for users without
  // a usable password (invited/SCIM/JIT) or armed by an admin reset.
  app.post<{ Params: { id: string } }>(
    '/:id/invite',
    {
      schema: {
        description: 'Send a set-password invitation email (72h single-use link)',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    async (request, reply) => {
      // [A3] Invite is a creation-lane act (first-password mint) — tenant-wide required.
      if (await requireAllWriteScope(request, reply)) return reply;
      const tenantId = request.tenantId ?? DEFAULT_TENANT;
      const target = await userManager.findById(request.params.id, tenantId);
      if (!target) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
      const armed = target.mustChangePassword === true;
      if ((await userManager.hasPassword(target.id, undefined)) && !armed) {
        return reply.status(409).send({
          success: false,
          error: { code: 'CONFLICT', message: 'User already has a password — use admin reset instead' },
        });
      }
      const flowTokens = new FlowTokenService((await getRedis()) ?? undefined);
      const token = await flowTokens.issue('password_reset', { userId: target.id }, 72 * 3600);
      const mailer = await getSmtpMailer(getOptionsManager());
      if (!mailer) {
        return reply.status(202).send({ success: true, data: { message: 'Invitation recorded; email delivery is not configured' } });
      }
      const origin = await resolvePublicOrigin(request, getOptionsManager());
      const link = `${origin}/reset-password?token=${token}`;
      const rendered = await renderEmailFor(
        'invite',
        { link, invitee: target.email, inviter: 'An administrator' },
        getOptionsManager(),
      );
      mailer
        .send(target.email, rendered.subject, rendered.html)
        .catch((err: unknown) => {
          request.log.warn({ err }, 'invite mail delivery failed (degraded to log)');
        });
      return reply.status(202).send({ success: true, data: { message: 'If the account is invitable, an email has been sent.' } });
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
    async (request, reply) => {
      const { id } = request.params;
      // L′ B5: tenant-scoped existence gate — a tenant admin must not even learn
      // whether some other tenant's user id exists, let alone revoke its sessions.
      const scoped = await userManager.findById(id, request.tenantId ?? DEFAULT_TENANT);
      if (!scoped) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }
      // DG-6d: force-logout is a mutation → users:write binding scope (prefix trim).
      const writeScope = await resolveUserRowScope(request, 'users:write');
      if (writeScope.kind !== 'all' && !(await userManager.isWithinScope(id, writeScope))) {
        return forbiddenScope(reply, 'User is outside your data scope');
      }
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
      // DG-6d: update (fields AND the roleIds set-roles lane) is guarded by the
      // users:write binding scope. kind 'all' adds zero queries.
      if (await guardRowScope(request, reply, id, 'users:write')) return reply;
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
        const conflict = sendConflictError(reply, err);
        if (conflict) return conflict;
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
      // DG-6d: status changes ride the users:write binding scope.
      if (await guardRowScope(request, reply, id, 'users:write')) return reply;
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
        const conflict = sendConflictError(reply, err);
        if (conflict) return conflict;
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

  // DELETE /api/v1/users/:id — delete user. Optional {eraseAudit:true,
  // legalBasis} body (R-audit spec U2/D5): runs the sanctioned RTBF erasure
  // inside ONE routeTx whose FIRST statement is the advisory try-lock 727242
  // (B2 — serializes with the anchor worker; false → retryable 409), then
  // erase (email captured while the user row still exists) then the cascade.
  app.delete<{ Params: { id: string }; Body: { eraseAudit?: boolean; legalBasis?: string } }>(
    '/:id',
    {
      schema: {
        description: 'Delete user (optional body {eraseAudit:true, legalBasis} triggers sanctioned audit erasure in the same transaction)',
        tags: ['users'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          // Fastify v4 validates body schemas against ABSENT bodies on DELETE —
          // type must admit null so bodyless deletes keep passing (byte-identical
          // legacy path); the handler re-checks eraseAudit/legality itself.
          type: ['object', 'null'],
          properties: {
            eraseAudit: { type: 'boolean' },
            legalBasis: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const tenantId = request.tenantId ?? DEFAULT_TENANT;
      // Required-when-flag (U2): erasure without a stated legal basis is a 400,
      // not a silent no-erase. Plain deletes skip this branch entirely.
      if (request.body?.eraseAudit === true && !request.body.legalBasis) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_001', message: 'legalBasis is required when eraseAudit is true' },
        });
      }
      const erase = request.body?.eraseAudit === true;
      // [R1/B1] The delete surface guards with ITS OWN code (users:delete, not users:write).
      const deleteScope = await resolveUserRowScope(request, 'users:delete');
      // [A6/B2] Erasure is a compliance act, not subordinate management: it
      // requires tenant-wide 'all' even when users:delete is dept/self-scoped —
      // checked BEFORE routeTx / advisory lock 727242 so a denied erase never
      // touches the lock.
      if (erase && deleteScope.kind !== 'all') {
        return forbiddenScope(reply, 'Audit erasure requires tenant-wide (all) data scope');
      }
      if (await rowScopeDenied(request, reply, id, deleteScope)) return reply;
      try {
        if (!erase) {
          await userManager.delete(id, tenantId);
          return { success: true };
        }
        await routeTx(async (tx) => {
          // FIRST statement in the tx (B2): non-blocking try-lock serializes
          // with the anchor worker on key 727242. False = worker holds it →
          // retryable 409, nothing written.
          const lockResult = await tx.execute(
            sql`SELECT pg_try_advisory_xact_lock(727242) AS locked`,
          );
          const locked = Boolean(
            (lockResult as unknown as { rows?: Array<{ locked?: unknown }> }).rows?.[0]?.locked,
          );
          if (!locked) {
            throw new Error('ERASE_LOCK_BUSY: audit erasure is anchored by another operation — retry shortly');
          }
          const target = await userManager.findById(id, tenantId);
          if (!target) {
            throw new Error('User not found');
          }
          // Email captured while the user row still exists (U3 tombstone key).
          await userManager.eraseAuditData(
            id,
            {
              requestedBy: (request.user as { sub: string }).sub,
              legalBasis: request.body.legalBasis as string,
              email: target.email,
              tenantId,
            },
            tx,
          );
          await userManager.delete(id, tenantId, tx);
        });
        return { success: true };
      } catch (err) {
        const conflict = sendConflictError(reply, err);
        if (conflict) return conflict;
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.startsWith('ERASE_LOCK_BUSY')) {
          return reply.status(409).send({
            success: false,
            error: { code: 'ERASE_LOCK_BUSY', message: 'Audit erasure is temporarily locked by the anchor worker — retry shortly' },
          });
        }
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
