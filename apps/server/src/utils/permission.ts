/**
 * requirePermission — route-level permission enforcement (Task 9).
 *
 * Registered as a preHandler *after* app.authenticate, so request.user is
 * already populated by @fastify/jwt. Routes without a mapping in
 * getRequiredPermission pass through untouched (progressive enforcement,
 * same semantics as authorize.ts).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequiredPermission, PermissionManager } from '@accessbase/identity';
import { DEFAULT_TENANT } from './constants.js';

/** JWT access-token payload signed in routes/auth.ts issueTokenPair. */
interface TokenPayload {
  sub: string;
  email?: string;
  tenantId?: string;
}

export function requirePermission() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const required = getRequiredPermission(request.method, request.url);
    if (!required) return;
    const user = request.user as TokenPayload;
    const ok = await new PermissionManager().hasPermission(
      user.sub,
      required,
      user.tenantId ?? DEFAULT_TENANT,
    );
    if (!ok) {
      request.log.warn({ userId: user.sub, required }, 'Permission denied');
      await reply.status(403).send({
        success: false,
        error: { code: 'PERM_001', message: 'Insufficient permissions' },
      });
    }
  };
}
