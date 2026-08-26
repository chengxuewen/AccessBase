/**
 * RoleManager - Role management with RBAC1 inheritance (SDD 2.3)
 * Drizzle ORM implementation
 */
import { eq, and, sql, count } from 'drizzle-orm';
import { createDb, type DrizzleDB } from '../db/index.js';
import {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  type Role as DbRole,
  type NewRole,
  type Permission as DbPermission,
} from '../db/schema.js';
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
      isSystem: false,
    };

    const [inserted] = await this.db.insert(roles).values(newRole).returning();

    if (!inserted) {
      throw new Error('Failed to create role');
    }

    // Assign permissions if provided
    if (data.permissionIds && data.permissionIds.length > 0) {
      await this.setRolePermissions(inserted.id, data.permissionIds);
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

    // Get permissions for each role
    const rolesWithPermissions = await Promise.all(
      results.map(async (role) => {
        const perms = await this.getRolePermissions(role.id);
        return this.mapToRole(role, perms);
      }),
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

    // Check if system role (prevent modification)
    if (role.isSystem) {
      throw new Error('Cannot modify system role');
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
      await this.setRolePermissions(id, data.permissionIds);
    }

    const perms = await this.getRolePermissions(id);
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

    // Check if system role (prevent deletion)
    if (role.isSystem) {
      throw new Error('Cannot delete system role');
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

    if (parentId) {
      const [parent] = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.id, parentId), eq(roles.tenantId, tenantId)))
        .limit(1);

      if (!parent) {
        throw new Error('Parent role not found');
      }

      // Check for inheritance cycles (A→B→A)
      const hasCycle = await this.checkInheritanceCycle(parentId, tenantId);
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

    await this.db.insert(userRoles).values({
      userId,
      roleId,
      tenantId,
    });
  }

  /**
   * Revoke role from user
   */
  async revokeFromUser(userId: string, roleId: string, tenantId: string): Promise<void> {
    logger.info(`Revoking role ${roleId} from user ${userId} in tenant: ${tenantId}`);

    await this.db
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.tenantId, tenantId),
        ),
      );
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
   * Set role permissions (full replacement)
   */
  private async setRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
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
   * Check for inheritance cycles
   */
  private async checkInheritanceCycle(parentId: string, tenantId: string): Promise<boolean> {
    const visited = new Set<string>();

    const check = async (currentId: string): Promise<boolean> => {
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
      permissions: perms,
      createdAt: dbRole.createdAt,
      updatedAt: dbRole.updatedAt,
    };
  }
}
