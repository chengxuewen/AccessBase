/**
 * RoleManager - Role management with RBAC1 inheritance (SDD 2.3)
 * Drizzle ORM implementation
 */
import { eq, and, sql, count, inArray } from 'drizzle-orm';
import { closeDb, createDb, type DrizzleDB } from '../db/index.js';
import {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  type Role as DbRole,
  type NewRole,
  type Permission as DbPermission,
} from '../db/schema.js';
import { invalidatePermissionCache } from './permission-cache.js';
import {
  wouldOrphanLastAdmin,
  ROLE_PROTECTED,
  LAST_ADMIN_GUARD,
} from '../services/last-admin-guard.js';
import {
  TENANT_BINDABLE_SET,
  DEFAULT_TENANT_ID,
  PERMISSION_NOT_BINDABLE,
} from '../services/permission-partition.js';
import { logger } from '@accessbase/logging';
import type {
  Role,
  Permission,
  CreateRoleInput,
  UpdateRoleInput,
  RoleQueryParams,
  PaginatedResult,
} from '../types.js';

export class RoleManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string) {
    this.db = createDb(databaseUrl);
  }

  /**
   * Create role (tenant-level)
   */
  async create(data: CreateRoleInput, tenantId: string): Promise<Role> {
    logger.info(`Creating role: ${data.name} in tenant: ${tenantId}`);

    // Check for duplicate role name in tenant
    const existing = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.name, data.name), eq(roles.tenantId, tenantId)))
      .limit(1);

    if (existing.length > 0) {
      logger.info(`Role '${data.name}' already exists in tenant ${tenantId}, returning existing`);
      return existing[0] as unknown as Role;
    }

    // Validate parent role exists if provided
    if (data.parentId) {
      const parent = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.id, data.parentId), eq(roles.tenantId, tenantId)))
        .limit(1);

      if (parent.length === 0) {
        throw new Error('Parent role not found');
      }

      // Check for inheritance cycles (A→B→A)
      const hasCycle = await this.checkInheritanceCycle(data.parentId, tenantId);
      if (hasCycle) {
        throw new Error('Inheritance cycle detected');
      }
    }

    const newRole: NewRole = {
      name: data.name,
      description: data.description ?? null,
      tenantId,
      parentId: data.parentId ?? null,
      isSystem: data.isSystem ?? false,
    };

    const [inserted] = await this.db.insert(roles).values(newRole).returning();

    if (!inserted) {
      throw new Error('Failed to create role');
    }

    // Assign permissions if provided
    if (data.permissionIds && data.permissionIds.length > 0) {
      await this.setRolePermissions(inserted.id, data.permissionIds, tenantId);
    }

    return this.mapToRole(inserted, []);
  }

  /**
   * Find role by ID
   */
  async findById(id: string, tenantId: string): Promise<Role | null> {
    logger.debug(`Finding role by ID: ${id} in tenant: ${tenantId}`);

    const result = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId)))
      .limit(1);

    const role = result[0];
    if (!role) return null;

    // Get permissions for this role
    const perms = await this.getRolePermissions(id);

    return this.mapToRole(role, perms);
  }

  /**
   * Query role list
   */
  async findAll(params: RoleQueryParams, tenantId: string): Promise<PaginatedResult<Role>> {
    logger.debug({ params, tenantId }, 'Querying roles');

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    // Build where conditions
    const conditions = [eq(roles.tenantId, tenantId)];

    if (params.search) {
      conditions.push(
        sql`(${roles.name} ILIKE ${'%' + params.search + '%'} OR ${roles.description} ILIKE ${'%' + params.search + '%'})`,
      );
    }

    if (params.parentId) {
      conditions.push(eq(roles.parentId, params.parentId));
    }

    const where = and(...conditions);

    // Get total count
    const [totalResult] = await this.db.select({ count: count() }).from(roles).where(where);

    const total = totalResult?.count ?? 0;

    // Get paginated results
    const results = await this.db
      .select()
      .from(roles)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(roles.createdAt);

    // Fetch all permissions for the page in ONE query, group by roleId in memory
    const roleIds = results.map((r) => r.id);
    const permRows = roleIds.length
      ? await this.db
          .select()
          .from(permissions)
          .innerJoin(rolePermissions, eq(permissions.id, rolePermissions.permissionId))
          .where(inArray(rolePermissions.roleId, roleIds))
      : [];
    const permsByRole = new Map<string, Permission[]>();
    for (const row of permRows) {
      const list = permsByRole.get(row.role_permissions.roleId) ?? [];
      list.push({
        id: row.permissions.id,
        resource: row.permissions.resource,
        action: row.permissions.action,
        description: row.permissions.description ?? undefined,
        createdAt: row.permissions.createdAt,
      });
      permsByRole.set(row.role_permissions.roleId, list);
    }
    const rolesWithPermissions = results.map((role) =>
      this.mapToRole(role, permsByRole.get(role.id) ?? []),
    );

    return {
      data: rolesWithPermissions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update role
   */
  async update(id: string, data: UpdateRoleInput, tenantId: string): Promise<Role> {
    logger.info(`Updating role: ${id} in tenant: ${tenantId}`);

    // Check role exists
    const existing = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      throw new Error('Role not found');
    }

    const role = existing[0]!;

    // K-T2: system roles are immutable (tag mapped to 409 by routes).
    if (role.isSystem) {
      throw new Error(`${ROLE_PROTECTED}: cannot modify the built-in administrator role`);
    }

    const updateData: Partial<NewRole> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    const [updated] = await this.db
      .update(roles)
      .set(updateData)
      .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId)))
      .returning();

    if (!updated) {
      throw new Error('Failed to update role');
    }

    // Replace permissions if provided
    if (data.permissionIds !== undefined) {
      await this.setRolePermissions(id, data.permissionIds, tenantId);
    }

    const perms = await this.getRolePermissions(id);
    // update() may replace permissionIds → tenant-wide effect; always invalidate.
    invalidatePermissionCache(tenantId);
    return this.mapToRole(updated, perms);
  }

  /**
   * Delete role (prevent deleting system roles)
   */
  async delete(id: string, tenantId: string): Promise<void> {
    logger.info(`Deleting role: ${id} in tenant: ${tenantId}`);

    // Check role exists
    const existing = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      throw new Error('Role not found');
    }

    const role = existing[0]!;

    // K-T2: system roles cannot be deleted (tag mapped to 409 by routes).
    if (role.isSystem) {
      throw new Error(`${ROLE_PROTECTED}: cannot delete the built-in administrator role`);
    }

    // Check if role has users assigned
    const [userCount] = await this.db
      .select({ count: count() })
      .from(userRoles)
      .where(eq(userRoles.roleId, id));

    if ((userCount?.count ?? 0) > 0) {
      throw new Error('Cannot delete role with assigned users');
    }

    // Delete role (cascade will handle role_permissions)
    await this.db.delete(roles).where(and(eq(roles.id, id), eq(roles.tenantId, tenantId)));
    invalidatePermissionCache(tenantId);
  }

  /**
   * Set role inheritance (parent role)
   */
  async setParent(roleId: string, parentId: string | null, tenantId: string): Promise<Role> {
    logger.info(`Setting parent role for ${roleId} to ${parentId} in tenant: ${tenantId}`);

    // Validate both roles exist
    const [role] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
      .limit(1);

    if (!role) {
      throw new Error('Role not found');
    }

    // K-T2 immutability extended: system roles are locked on the parent path too
    // (L-prime R6 funnel guard — setParent was the one funnel entry missing it).
    if (role.isSystem) {
      throw new Error(
        `${ROLE_PROTECTED}: cannot change the parent of the built-in administrator role`,
      );
    }

    if (parentId) {
      const [parent] = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.id, parentId), eq(roles.tenantId, tenantId)))
        .limit(1);

      if (!parent) {
        throw new Error('Parent role not found');
      }

      // Check for inheritance cycles closing at THIS role (L-prime X3: the walk
      // must receive roleId — self-parent and newly-closed mutual loops are
      // invisible to an ancestors-only traversal).
      const hasCycle = await this.checkInheritanceCycle(parentId, tenantId, roleId);
      if (hasCycle) {
        throw new Error('Inheritance cycle detected');
      }
    }

    const [updated] = await this.db
      .update(roles)
      .set({ parentId, updatedAt: new Date() })
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
      .returning();

    if (!updated) {
      throw new Error('Failed to update role parent');
    }

    const perms = await this.getRolePermissions(roleId);
    invalidatePermissionCache(tenantId);
    return this.mapToRole(updated, perms);
  }

  /**
   * Resolve inherited permissions (including parent role permissions)
   */
  async resolveInheritedPermissions(roleId: string, tenantId: string): Promise<Permission[]> {
    logger.debug(`Resolving inherited permissions for role: ${roleId} in tenant: ${tenantId}`);

    const allPermissions: Permission[] = [];
    const visited = new Set<string>();

    // Recursive function to traverse parent chain
    const resolveChain = async (currentRoleId: string): Promise<void> => {
      if (visited.has(currentRoleId)) return;
      visited.add(currentRoleId);

      // Get direct permissions for this role
      const perms = await this.getRolePermissions(currentRoleId);
      allPermissions.push(...perms);

      // Get parent role
      const [role] = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.id, currentRoleId), eq(roles.tenantId, tenantId)))
        .limit(1);

      if (role?.parentId) {
        await resolveChain(role.parentId);
      }
    };

    await resolveChain(roleId);

    // Remove duplicates by permission ID
    const uniquePermissions = new Map<string, Permission>();
    for (const perm of allPermissions) {
      uniquePermissions.set(perm.id, perm);
    }

    return Array.from(uniquePermissions.values());
  }

  /**
   * Assign role to user
   */
  async assignToUser(userId: string, roleId: string, tenantId: string): Promise<void> {
    logger.info(`Assigning role ${roleId} to user ${userId} in tenant: ${tenantId}`);

    await this.db
      .insert(userRoles)
      .values({ userId, roleId, tenantId })
      // L-prime G-1: user_roles has a composite PK — replay paths (bootstrap
      // step-4 convergence arm) re-assign the same triple, must not duplicate-key.
      .onConflictDoNothing();
    invalidatePermissionCache(tenantId, userId);
  }

  /**
   * Revoke role from user
   */
  async revokeFromUser(userId: string, roleId: string, tenantId: string): Promise<void> {
    logger.info(`Revoking role ${roleId} from user ${userId} in tenant: ${tenantId}`);

    // K-T2: revoking an isSystem role from the tenant's last active admin is
    // a lockout vector — refuse before any write (manager funnel per addendum R2).
    const [targetRole] = await this.db
      .select({ isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);
    if (targetRole?.isSystem && (await wouldOrphanLastAdmin(this.db, tenantId, userId))) {
      throw new Error(
        `${LAST_ADMIN_GUARD}: cannot revoke the last active administrator of the tenant`,
      );
    }

    await this.db
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.tenantId, tenantId),
        ),
      );
    invalidatePermissionCache(tenantId, userId);
  }

  /**
   * Set user roles (full replacement, tenant-scoped)
   */
  async setUserRoles(userId: string, roleIds: string[], tenantId: string): Promise<void> {
    logger.info(`Setting roles [${roleIds.join(', ')}] for user ${userId} in tenant: ${tenantId}`);

    // K-T2: when the replacement set drops an isSystem role the user currently
    // holds, check the last-admin census before deleting anything (R2).
    const held = await this.db
      .select({ userId: userRoles.userId, roleId: userRoles.roleId, isSystem: roles.isSystem })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));
    const dropsSystemRole = held.some((row) => row.isSystem && !roleIds.includes(row.roleId));
    if (dropsSystemRole && (await wouldOrphanLastAdmin(this.db, tenantId, userId))) {
      throw new Error(
        `${LAST_ADMIN_GUARD}: cannot remove the last active administrator of the tenant`,
      );
    }

    // Remove existing assignments
    await this.db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));

    // Add new assignments
    if (roleIds.length > 0) {
      await this.db.insert(userRoles).values(
        roleIds.map((roleId) => ({ userId, roleId, tenantId })),
      );
    }
    invalidatePermissionCache(tenantId, userId);
  }

  /**
   * Get user roles in specified tenant (including inherited roles)
   */
  async getUserRoles(userId: string, tenantId: string): Promise<Role[]> {
    logger.debug(`Getting roles for user ${userId} in tenant: ${tenantId}`);

    // Get direct roles from user_roles
    const directRoles = await this.db
      .select()
      .from(roles)
      .innerJoin(userRoles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));

    const result: Role[] = [];
    const visited = new Set<string>();

    // For each role, resolve parent chain
    for (const row of directRoles) {
      const role = row.roles;
      if (!visited.has(role.id)) {
        visited.add(role.id);
        const perms = await this.getRolePermissions(role.id);
        result.push(this.mapToRole(role, perms));

        // Add parent roles
        if (role.parentId) {
          const parentPerms = await this.resolveInheritedPermissions(role.parentId, tenantId);
          const [parentRole] = await this.db
            .select()
            .from(roles)
            .where(and(eq(roles.id, role.parentId), eq(roles.tenantId, tenantId)))
            .limit(1);

          if (parentRole && !visited.has(parentRole.id)) {
            visited.add(parentRole.id);
            result.push(this.mapToRole(parentRole, parentPerms));
          }
        }
      }
    }

    return result;
  }

  /**
   * Get permissions for a specific role
   */
  private async getRolePermissions(roleId: string): Promise<Permission[]> {
    const result = await this.db
      .select()
      .from(permissions)
      .innerJoin(rolePermissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId));

    return result.map((row) => ({
      id: row.permissions.id,
      resource: row.permissions.resource,
      action: row.permissions.action,
      description: row.permissions.description ?? undefined,
      createdAt: row.permissions.createdAt,
    }));
  }

  /**
   * Set role permissions (full replacement).
   *
   * L-prime X1 binding funnel: permission rows are GLOBAL; a non-default tenant
   * may only bind the TENANT_BINDABLE names. Without this guard a tenant admin
   * with roles:write could enumerate the global catalog (permissions:read) and
   * bind tenants:write / options:write to a fresh role — full platform takeover.
   */
  private async setRolePermissions(
    roleId: string,
    permissionIds: string[],
    tenantId: string,
  ): Promise<void> {
    if (tenantId !== DEFAULT_TENANT_ID && permissionIds.length > 0) {
      const rows = await this.db
        .select({ id: permissions.id, name: permissions.name })
        .from(permissions)
        .where(inArray(permissions.id, permissionIds));
      const nameById = new Map(rows.map((row) => [row.id, row.name]));
      for (const permissionId of permissionIds) {
        const name = nameById.get(permissionId);
        // Unknown ids fall through to the FK constraint below (unchanged behavior).
        if (name && !TENANT_BINDABLE_SET.has(name)) {
          throw new Error(`${PERMISSION_NOT_BINDABLE}: ${name}`);
        }
      }
    }

    // Remove existing permissions
    await this.db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

    // Add new permissions
    if (permissionIds.length > 0) {
      await this.db.insert(rolePermissions).values(
        permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      );
    }
  }

  /**
   * Check for inheritance cycles. roleId (when present) is the role the new edge
   * attaches to: reaching it while walking the proposed parent's ancestors means
   * the edge CLOSES a cycle (self-parent A-A and mutual A-B-A were undetectable
   * before — re-review X3).
   */
  private async checkInheritanceCycle(
    parentId: string,
    tenantId: string,
    roleId?: string,
  ): Promise<boolean> {
    const visited = new Set<string>();

    const check = async (currentId: string): Promise<boolean> => {
      if (roleId !== undefined && currentId === roleId) return true;
      if (visited.has(currentId)) return true;
      visited.add(currentId);

      const [role] = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.id, currentId), eq(roles.tenantId, tenantId)))
        .limit(1);

      if (!role?.parentId) return false;
      return check(role.parentId);
    };

    return check(parentId);
  }

  /**
   * Map database role to application role type
   */
  private mapToRole(dbRole: DbRole, perms: Permission[]): Role {
    return {
      id: dbRole.id,
      name: dbRole.name,
      description: dbRole.description ?? undefined,
      tenantId: dbRole.tenantId,
      isSystem: dbRole.isSystem ?? false,
      permissions: perms,
      createdAt: dbRole.createdAt,
      updatedAt: dbRole.updatedAt,
    };
  }

  /** Release the internally-created pool (singleton reset / graceful shutdown). */
  async close(): Promise<void> {
    await closeDb(this.db);
  }

}
