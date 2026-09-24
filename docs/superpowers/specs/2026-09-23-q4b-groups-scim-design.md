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

---

## rev.2 — dual-Momus absorbed (flows bg_099c8fa2 / blockers bg_400cf34d)

- **R1 (both, design pivot)**: do NOT widen getUserRoles (9 callers incl. users.ts:194 detail→UserEdit prefill→setUserRoles REPLACE round-trip = group roles materialize as DIRECT rows; CSV/tenants/bootstrap held-check collateral). Instead new `RoleManager.getEffectiveRoles(userId,tenantId)` (direct ∪ group, visited-deduped) consumed ONLY by PermissionManager.getUserEffectivePermissions + the admin `.some(name==='admin')` gates (auth.ts:212/326, saml/oauth/webauthn, tenants:307 = desired). getUserRoles stays direct-only for edit/list/assignment surfaces.
- **R2 (blocker A)**: last-admin guard is asymmetric once groups grant roles: census = JS TWO-QUERY union (direct holders; group-path holders WITH users.status='active' AND tenant join — no raw `$` positional SQL, no OR-append which is structurally broken for group-only admins); the four group funnels (removeMember/revokeRole/setGroupRoles/delete) run the same wouldOrphanLastAdmin AFTER computing the post-mutation candidate set (pre-set minus members losing isSystem via this mutation); spec's earlier "guard none" on delete is REVOKED.
- **R3 (blocker C)**: over-block fix — setUserRoles/revokeFromUser skip the guard when the subject retains isSystem via a group (new holdsSystemRoleViaGroup helper). K-T2 behavior tests gain both-direction group cases.
- **R4 (blocker D)**: SCIM membership mutations on groups bound to ≥1 isSystem role → 403 invalidValue (role-granting power stays on the admin surface; 'scim' scope otherwise unchanged). Group→role binding never exists in SCIM.
- **R5 (blocker E)**: addMember validates target user is in the GROUP's tenant (findById scoped) — cross-tenant membership rejected pre-insert.
- **R6 (flows R1)**: "RESOURCES +'groups'" was a phantom fact (array deleted in cb79df5; bindPermissions now name-readback). Real registration flips: BUILTIN_PERMISSIONS 21→24, partition TENANT_BINDABLE 9→12, routePermissions 4 entries, frontend gates, conventions expected-value grep text fixed in the same commit.
- **R7 (blocker/cascade)**: group_users & group_roles: ON DELETE CASCADE on BOTH fk columns (UserManager.delete is hard; RoleManager.delete hard once guard-clear). RoleManager.delete "assigned users" census must ALSO count group_roles (or a group-only-bound role is silently deletable).
- **R8**: sentinel quotes `FROM "groups"`. Chain 0008 purely-additive (3 CREATEs) — safe on stamped dev + fresh deploys; db:push for the dev box (Q3C convention).
- **R9 (parity)**: group membership/role mutations call bumpAuthState for the affected users (assignToUser precedent) alongside invalidatePermissionCache (which fires the Q2c cross-node publish).
- **R10**: SCIM Groups list reuses the ceil-correction formula (scim.ts:298) explicitly; displayName-eq filter mapping; discovery Schemas gains Group. ResourceTypes skip noted (cosmetic).
- **R11**: users.ts:120 CSV export switches to getEffectiveRoles (desired: effective roles in export) — stated, not silent.
