/**
 * PermissionManager - Permission management (SDD 2.4)
 */
import { createDb, type DrizzleDB } from '../db/index.js';
import { count, sql, and, eq } from 'drizzle-orm';
import { permissions, rolePermissions, type NewPermission } from '../db/schema.js';
import { RoleManager } from './RoleManager.js';
import { logger } from '@accessbase/logging';
import type {
  Permission,
  CreatePermissionInput,
  UpdatePermissionInput,
  PermissionQueryParams,
  PaginatedResult,
} from '../types.js';

export class PermissionManager {
  private readonly db: DrizzleDB;
  private readonly roleManager: RoleManager;

  constructor(databaseUrl?: string, roleManager?: RoleManager) {
    this.db = createDb(databaseUrl);
    this.roleManager = roleManager ?? new RoleManager(databaseUrl);
  }

  /**
   * Create permission definition
   */
  async create(data: CreatePermissionInput): Promise<Permission> {
    logger.info(`Creating permission: ${data.resource}:${data.action}`);
    const [inserted] = await this.db
      .insert(permissions)
      .values({
        name: data.name,
        resource: data.resource,
        action: data.action,
        description: data.description ?? null,
      } satisfies NewPermission)
      .returning();
    if (!inserted) {
      throw new Error('Failed to create permission');
    }
    return this.mapToPermission(inserted);
  }

  /**
   * Query all permission definitions
   */
  async findAll(params?: PermissionQueryParams): Promise<PaginatedResult<Permission>> {
    logger.debug({ params }, 'Querying permissions');

    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params?.search) {
      conditions.push(
        sql`(${permissions.resource} ILIKE ${'%' + params.search + '%'} OR ${permissions.action} ILIKE ${'%' + params.search + '%'} OR ${permissions.name} ILIKE ${'%' + params.search + '%'})`,
      );
    }
    if (params?.resource) conditions.push(eq(permissions.resource, params.resource));
    if (params?.action) conditions.push(eq(permissions.action, params.action));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [totalResult] = await this.db.select({ count: count() }).from(permissions).where(where);
    const total = totalResult?.count ?? 0;

    const results = await this.db
      .select()
      .from(permissions)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(permissions.createdAt);

    return {
      data: results.map((p) => this.mapToPermission(p)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private mapToPermission(row: {
    id: string;
    resource: string;
    action: string;
    description: string | null;
    createdAt: Date;
  }): Permission {
    return {
      id: row.id,
      resource: row.resource,
      action: row.action,
      description: row.description ?? undefined,
      createdAt: row.createdAt,
    };
  }

  /**
   * Update permission
   */
  async update(id: string, data: UpdatePermissionInput): Promise<Permission> {
    logger.info(`Updating permission: ${id}`);

    const updateData: Partial<NewPermission> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    const [updated] = await this.db
      .update(permissions)
      .set(updateData)
      .where(eq(permissions.id, id))
      .returning();

    if (!updated) {
      throw new Error('Permission not found');
    }
    return this.mapToPermission(updated);
  }

  /**
   * Delete permission (prevent if referenced by roles)
   */
  async delete(id: string): Promise<void> {
    logger.info(`Deleting permission: ${id}`);

    const [refCount] = await this.db
      .select({ count: count() })
      .from(rolePermissions)
      .where(eq(rolePermissions.permissionId, id));

    if ((refCount?.count ?? 0) > 0) {
      throw new Error('Permission is in use');
    }
    await this.db.delete(permissions).where(eq(permissions.id, id));
  }

  /**
   * Get user's effective permissions (including role inheritance)
   */
  async getUserEffectivePermissions(userId: string, tenantId: string): Promise<Permission[]> {
    logger.debug(`Getting effective permissions for user ${userId} in tenant: ${tenantId}`);

    const roles = await this.roleManager.getUserRoles(userId, tenantId);
    const seen = new Map<string, Permission>();
    for (const role of roles) {
      for (const p of await this.roleManager.resolveInheritedPermissions(role.id, tenantId)) {
        seen.set(p.id, p);
      }
    }
    return [...seen.values()];
  }

  /**
   * Check if user has specified permission
   */
  async hasPermission(userId: string, permission: string, tenantId: string): Promise<boolean> {
    logger.debug(`Checking permission ${permission} for user ${userId} in tenant: ${tenantId}`);

    const list = await this.getUserEffectivePermissions(userId, tenantId);
    return this.matches(list, permission);
  }

  /**
   * Batch check permissions
   */
  async hasPermissions(
    userId: string,
    permissions: string[],
    tenantId: string,
  ): Promise<boolean> {
    logger.debug(`Checking permissions for user ${userId} in tenant: ${tenantId}`);

    const list = await this.getUserEffectivePermissions(userId, tenantId);
    return permissions.some((permission) => this.matches(list, permission));
  }

  /**
   * Match a 'resource:action' string against a permission list.
   */
  private matches(list: Permission[], permission: string): boolean {
    const idx = permission.lastIndexOf(':');
    const resource = permission.slice(0, idx);
    const action = permission.slice(idx + 1);
    return list.some((p) => p.resource === resource && p.action === action);
  }

  /**
   * Set role permissions (full replacement)
   */
  async setRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    logger.info(`Setting permissions for role ${roleId}`);

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
}
