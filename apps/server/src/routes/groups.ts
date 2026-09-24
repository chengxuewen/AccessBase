import type { FastifyInstance, FastifyReply } from 'fastify';
import { GroupManager } from '@accessbase/identity';
import { DEFAULT_TENANT } from '../utils/constants.js';
import { routeTx } from '../utils/tx.js';
import { requirePermission } from '../utils/permission.js';
import { sendConflictError } from '../utils/conflict-mapper.js';

/**
 * Q4b user groups — tenant-scoped CRUD + membership + role bindings.
 * Permission gates come from the authorize hook map (groups:read/write/delete
 * on the /api/v1/groups prefix). Every funnel re-verifies tenant ownership via
 * findById inside GroupManager; cross-tenant ids surface as GROUP_NOT_FOUND
 * (404, no existence leak). Guard tags (LAST_ADMIN_GUARD) map through the
 * shared conflict-mapper; group-specific codes map locally.
 */
export async function groupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  // Reuse single GroupManager instance per route module (roles.ts precedent).
  const groupManager = new GroupManager();

  const tenantOf = (request: { tenantId?: string }): string => request.tenantId ?? DEFAULT_TENANT;

  /** Map GroupManager error tags to envelopes; null = not ours (rethrow). */
  function sendGroupError(reply: FastifyReply, err: unknown): FastifyReply | null {
    const conflict = sendConflictError(reply, err);
    if (conflict) return conflict;
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'GROUP_NOT_FOUND') {
      return reply
        .status(404)
        .send({ success: false, error: { code: 'GROUP_NOT_FOUND', message: 'Group not found' } });
    }
    if (message === 'GROUP_NAME_EXISTS') {
      return reply.status(409).send({
        success: false,
        error: { code: 'GROUP_NAME_EXISTS', message: 'A group with this name already exists' },
      });
    }
    if (message === 'GROUP_MEMBER_TENANT_MISMATCH') {
      return reply.status(400).send({
        success: false,
        error: { code: 'GROUP_MEMBER_TENANT_MISMATCH', message: 'User does not belong to this tenant' },
      });
    }
    if (message === 'GROUP_ROLE_TENANT_MISMATCH') {
      return reply.status(400).send({
        success: false,
        error: { code: 'GROUP_ROLE_TENANT_MISMATCH', message: 'Role does not belong to this tenant' },
      });
    }
    return null;
  }

  // GET /api/v1/groups
  app.get(
    '/',
    {
      schema: {
        description: 'List user groups with member/role counts',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const data = await groupManager.list(tenantOf(request));
      return { success: true, data };
    },
  );

  // GET /api/v1/groups/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get group by ID',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const group = await groupManager.findById(request.params.id, tenantOf(request));
      if (!group) {
        return reply.status(404).send({
          success: false,
          error: { code: 'GROUP_NOT_FOUND', message: 'Group not found' },
        });
      }
      return { success: true, data: group };
    },
  );

  // POST /api/v1/groups
  app.post<{ Body: { name?: string; description?: string } }>(
    '/',
    {
      schema: {
        description: 'Create a group',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const group = await groupManager.create(
          { name: String(request.body.name), description: request.body.description },
          tenantOf(request),
        );
        return reply.status(201).send({ success: true, data: group });
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );

  // PUT /api/v1/groups/:id
  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/:id',
    {
      schema: {
        description: 'Update a group',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const group = await groupManager.update(request.params.id, request.body ?? {}, tenantOf(request));
        return { success: true, data: group };
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );

  // DELETE /api/v1/groups/:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Delete a group (cascades membership + bindings)',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        await groupManager.delete(request.params.id, tenantOf(request));
        return { success: true, data: null };
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );

  // GET /api/v1/groups/:id/members
  app.get<{ Params: { id: string } }>(
    '/:id/members',
    {
      schema: {
        description: 'List group members',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const data = await groupManager.listMembers(request.params.id, tenantOf(request));
        return { success: true, data };
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );

  // POST /api/v1/groups/:id/members
  app.post<{ Params: { id: string }; Body: { userId?: string } }>(
    '/:id/members',
    {
      schema: {
        description: 'Add a member (must belong to the group tenant)',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        await groupManager.addMember(request.params.id, String(request.body.userId), tenantOf(request));
        return { success: true, data: null };
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );

  // DELETE /api/v1/groups/:id/members/:userId
  app.delete<{ Params: { id: string; userId: string } }>(
    '/:id/members/:userId',
    {
      schema: {
        description: 'Remove a member',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id', 'userId'],
          properties: { id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        await groupManager.removeMember(request.params.id, request.params.userId, tenantOf(request));
        return { success: true, data: null };
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );

  // GET /api/v1/groups/:id/roles
  app.get<{ Params: { id: string } }>(
    '/:id/roles',
    {
      schema: {
        description: 'List bound role ids',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const data = await groupManager.getGroupRoles(request.params.id, tenantOf(request));
        return { success: true, data };
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );

  // PUT /api/v1/groups/:id/roles
  app.put<{ Params: { id: string }; Body: { roleIds?: string[] } }>(
    '/:id/roles',
    {
      schema: {
        description: 'Replace role bindings (transaction; last-admin census guarded)',
        tags: ['groups'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['roleIds'],
          properties: { roleIds: { type: 'array', items: { type: 'string', format: 'uuid' } } },
        },
      },
    },
    async (request, reply) => {
      try {
        const roleIds = Array.isArray(request.body.roleIds) ? request.body.roleIds : [];
        // Q2b discipline: delete+insert loop atomic in one transaction.
        await routeTx((tx) => groupManager.setGroupRoles(request.params.id, roleIds, tenantOf(request), tx));
        return { success: true, data: null };
      } catch (err) {
        const sent = sendGroupError(reply, err);
        if (sent) return sent;
        throw err;
      }
    },
  );
}
