# Q4b User Groups + SCIM /ScimGroups — Design Spec

**Driver**: gap-audit market H (no groups lever; SCIM half-built) · **Baseline**: `c59f462` · **Approved**: user ticked Q4a→b→c.

## Facts (verified)
- Effective-permissions chokepoint: PermissionManager.getUserEffectivePermissions:158 → roleManager.getUserRoles(userId,tenantId) per role resolveInheritedPermissions → cached (perm-cache + Q2c pub/sub). Widening getUserRoles with group-via roles propagates to /auth/me, menu gates, requirePermission with ZERO other call-site changes.
- JWT carries NO permissions claim (Q3A tokenVersion only) — group changes need no re-auth, cache invalidation suffices.
- wouldOrphanLastAdmin (last-admin-guard.ts) counts userRoles⋈roles(isSystem) DIRECTLY — group-granted admins would be invisible → lockout vector. MUST extend the census to the group path (same-tenant).
- Partition gate (X1): role-permission binding funnel validates TENANT_BINDABLE; group→role binding only needs same-tenant (tenant roles can already only bind bindable perms).
- New codes must land in SAME commit: permissions-seed BUILTIN (21→24, RESOURCES +'groups'), authorize.routePermissions map, permission-partition lists (groups:* → TENANT_BINDABLE 9→12; invariant test forces it), conventions expected-value flips (grep -c "resource: '" =24; parity diff check), frontend menu/route gates.
- SCIM server pattern (batch H): scoped scim+json parser, own bearer preHandler, tenant isolation via key.scopes + request.tenantId, Users resource as template (find-or-create 409, startIndex 1-based, PATCH ops array).

## Schema (chain 0008 via drizzle generate + SENTINELS `0008|SELECT name FROM groups LIMIT 1` + dev db:push + ops counts 8→9)
groups(id uuid pk default, tenant_id uuid notNull refs tenants, name text notNull, description text, created/updated; unique(tenant_id,name))
group_users(group_id, user_id, tenant_id, composite pk, fk cascade group; user cascade? user delete → membership rows gone: cascade)
group_roles(group_id, role_id, tenant_id, composite pk, unique(group_id,role_id))

## Identity: GroupManager
create/update/delete (delete = membership cleanup first, guard none), addMember/removeMember/listMembers, grantRole/revokeRole/setGroupRoles(groupId, roleIds) — ALL membership/role mutations: recompute affected users → invalidatePermissionCache(tenantId, userId) (fires Q2c publish hook ⇒ cross-node ≤0s). getGroupRoles returns Role[].
- getUserRoles WIDEN (RoleManager): UNION direct userRoles + group_users⋈group_roles (distinct). getUserSessions untouched.
- last-admin-guard census: add `OR id IN (SELECT gu.user_id FROM group_users gu JOIN group_roles gr ON gr.group_id=gu.group_id JOIN roles r ON r.id=gr.role_id AND r.is_system WHERE gr.tenant_id=$)` — behavior files: existing K-T2 tests extended with one group-granted-admin case each direction.

## Server routes
`/api/v1/groups` (requirePermission users? NO — groups:read/write/delete via routePermissions map additions 'GET:/api/v1/groups':groups:read etc. prefix mechanism). CRUD + members GET/POST/DELETE + roles PUT (body {roleIds}) — tenant-scoped findById gates, conflict-mapper tags reuse.
SCIM `/ScimGroups`: GET list (startIndex/count, filter displayName eq + pr 'members' path), GET/:id (members refs), POST (displayName+members refs→group_users best-effort per-ref 404→invalidValue), PUT (replace), PATCH (Operations add/remove members path, value string or {value}), DELETE — scope 'scim' same as Users; RFC7644 schemas location headers.
register route: bootstrap creates NO default group (YAGNI).

## Frontend
Pages/Groups.tsx (ProTable list: name/desc/member-count/role-count + create/edit modal + detail drawer: members Transfer (users:read fetchAll) + roles Transfer (bindable list)) gated groups:read/write; menu entry + route; i18n en/zh ~20 keys (parity test guards); UserDetail v1 shows nothing (chips = follow-up).

## Tests/gates (RED first per unit)
identity: GroupManager mutation→cache-invalidate spy; getUserRoles union SQL; last-admin group census (2 directions). server: groups CRUD route tests (factory mock + resetManagers seam), permission-partition invariant (24 codes), scim-groups list/POST/PATCH shape. e2e: groups-crud.spec (CRUD + menu visibility + member add) + scim mock none. ops: counts 9 + fresh/idempotent + sentinel(0008). Gates: vitest full, 4×tsc, eslint touched, full e2e.
Order: schema+manager(+guards) → routes → SCIM → frontend → e2e → close-out. Dual-Momus pending (census hole + partition flips + SCIM PATCH semantics are the risky seams).
