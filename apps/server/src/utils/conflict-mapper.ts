/**
 * RBAC guard-tag → 409 envelope mapper (Batch K T2).
 *
 * Manager funnels (RoleManager/UserManager) refuse protected operations by
 * throwing errors tagged with a known message prefix; routes map them to the
 * {success:false,error:{code,message}} envelope per the TENANT_PROTECTED
 * precedent (routes/tenants.ts sendTenantError). Without this mapping the
 * tags would surface as raw 500s.
 *
 * The tag strings mirror ROLE_PROTECTED / LAST_ADMIN_GUARD exported from
 * @accessbase/identity (packages/identity/src/services/last-admin-guard.ts).
 * Duplicated as literals on purpose: the route tests module-mock
 * '@accessbase/identity' and must not depend on the mock exposing the consts.
 */
import type { FastifyReply } from 'fastify';

const CONFLICT_TAGS: ReadonlyArray<{ tag: string; message: string }> = [
  { tag: 'ROLE_PROTECTED', message: 'Role is protected and cannot be modified or deleted' },
  {
    tag: 'LAST_ADMIN_GUARD',
    message: 'Operation would leave the tenant with no active administrator',
  },
];

/**
 * Returns the sent reply when `err` carries a known guard tag, or null when it
 * does not (caller continues its own error mapping / rethrow).
 */
export function sendConflictError(reply: FastifyReply, err: unknown): FastifyReply | null {
  const message = err instanceof Error ? err.message : String(err);
  for (const { tag, message: readable } of CONFLICT_TAGS) {
    if (message.startsWith(tag)) {
      return reply
        .status(409)
        .send({ success: false, error: { code: tag, message: readable } });
    }
  }
  return null;
}
