/**
 * Permission partition — batch L′ (X1/X2).
 *
 * The 21 builtin permissions are exhaustively partitioned into the set a
 * NON-DEFAULT tenant may bind to its roles and the set reserved for the
 * platform (default tenant). Permission rows are global; this split is the
 * ceiling enforced by RoleManager.setRolePermissions for tenant callers so a
 * tenant admin holding roles:write can never self-bind tenants:*, options:*,
 * clients:*, permissions:write/delete or apikeys:* (escalation killer X1).
 *
 * apikeys:* is platform-only by ruling X2: keys are minted with the creator's
 * request.tenantId (always DEFAULT for reachable creators) and a '*'-scope key
 * short-circuits every requirePermission gate — binding one into a tenant role
 * would hand out a skeleton key past this partition.
 *
 * INVARIANT (pinned by tests): disjoint + union == the 21 BUILTIN_PERMISSIONS
 * names in apps/server/src/routes/permissions-seed.ts. Any new permission code
 * MUST be placed into exactly one of these lists (server-side invariant test
 * fails otherwise).
 */
import { DEFAULT_TENANT_ID } from '../managers/TenantManager.js';

/** Names a non-default tenant may bind to its roles (9 codes). */
export const TENANT_BINDABLE_PERMISSIONS: ReadonlyArray<string> = [
  'users:read',
  'users:write',
  'users:delete',
  'roles:read',
  'roles:write',
  'roles:delete',
  'permissions:read',
  'audit:read',
  'stats:read',
];

/** Names reserved to the platform/default tenant (12 codes). */
export const PLATFORM_ONLY_PERMISSIONS: ReadonlyArray<string> = [
  'tenants:read',
  'tenants:write',
  'tenants:delete',
  'options:read',
  'options:write',
  'clients:read',
  'clients:write',
  'permissions:write',
  'permissions:delete',
  'apikeys:read',
  'apikeys:write',
  'apikeys:delete',
];

/** Error tag for a refused tenant binding (routes map to 409 envelope). */
export const PERMISSION_NOT_BINDABLE = 'PERMISSION_NOT_BINDABLE';

/** O(1) membership lookup for the funnel guard. */
export const TENANT_BINDABLE_SET: ReadonlySet<string> = new Set(TENANT_BINDABLE_PERMISSIONS);

/**
 * Re-export so funnel call sites import the constant and the partition from a
 * single module. Canonical definition stays in TenantManager (batch G).
 */
export { DEFAULT_TENANT_ID };
