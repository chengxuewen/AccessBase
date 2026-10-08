/**
 * PermissionManager - Permission management (SDD 2.4)
 */
import { createDb, type DrizzleDB } from '../db/index.js';
import { count, sql, and, eq } from 'drizzle-orm';
import { permissions, rolePermissions, type NewPermission } from '../db/schema.js';
import { RoleManager, mergeWidestScope } from './RoleManager.js';
import {
  PERMISSION_CACHE_TTL_MS,
  getCachedPermissions,
  invalidatePermissionCache,
  setCachedPermissions,
} from './permission-cache.js';
import { logger } from '@accessbase/logging';
import type {
  Permission,
  DataScope,
  CreatePermissionInput,
  UpdatePermissionInput,
  PermissionQueryParams,
  PaginatedResult,
} from '../types.js';

export class PermissionManager {
  private readonly db: DrizzleDB;
  private readonly roleManager: RoleManager;
  private readonly cacheTtlMs: number;

  constructor(
    databaseUrl?: string,
    roleManager?: RoleManager,
    options?: { cacheTtlMs?: number },
  ) {
    this.db = createDb(databaseUrl);
    this.roleManager = roleManager ?? new RoleManager(databaseUrl);
    this.cacheTtlMs = options?.cacheTtlMs ?? PERMISSION_CACHE_TTL_MS;
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
    const hit = getCachedPermissions(tenantId, userId);
    if (hit && hit.expiresAt > Date.now()) return hit.permissions;

    logger.debug(`Computing effective permissions for user ${userId} in tenant: ${tenantId}`);

    const roles = await this.roleManager.getEffectiveRoles(userId, tenantId); // Q4b: direct+inheritance+groups
    // DG-6d widest-wins: the same code granted by several bindings keeps the
    // WIDEST scope (all > dept > self), independent of the role iteration order
    // (the previous last-wins set made the answer depend on which role came
    // second). Membership semantics are unchanged.
    const seen = new Map<string, Permission>();
    for (const role of roles) {
      for (const p of await this.roleManager.resolveInheritedPermissions(role.id, tenantId)) {
        const held = seen.get(p.id);
        seen.set(p.id, held ? mergeWidestScope(held, p) : p);
      }
    }
    const permissions = [...seen.values()];
    setCachedPermissions(tenantId, userId, permissions, this.cacheTtlMs);
    return permissions;
  }

  /**
   * Invalidate cached effective permissions: one (tenantId, userId) entry,
   * all entries of a tenant, or everything when called without arguments.
   */
  invalidatePermissionCache(tenantId?: string, userId?: string): void {
    invalidatePermissionCache(tenantId, userId);
  }

  /**
   * Check if user has specified permission
   */
  async hasPermission(userId: string, permission: string, tenantId: string): Promise<boolean> {
    logger.debug(`Checking permission ${permission} for user ${userId} in tenant: ${tenantId}`);

    const list = await this.getUserEffectivePermissions(userId, tenantId);
    return this.findMatch(list, permission) !== undefined;
  }

  /**
   * DG-6d row-visibility ceiling of ONE code for one user — the value the
   * users routes gate their row predicates on. Reuses the widened effective-
   * permission cache (same entry, same tenant-wide invalidation, so scope
   * edits propagate immediately).
   *
   * - null → the code is not granted at all (guarded routes 403 first).
   * - else → the binding scope; catalog-shaped rows (never bound) read 'all'.
   */
  async getUserDataScope(
    userId: string,
    permission: string,
    tenantId: string,
  ): Promise<DataScope | null> {
    const granted = this.findMatch(
      await this.getUserEffectivePermissions(userId, tenantId),
      permission,
    );
    return granted ? (granted.dataScope ?? 'all') : null;
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
    return permissions.some((permission) => this.findMatch(list, permission) !== undefined);
  }

  /**
   * Match a 'resource:action' string against a permission list.
   */
  private findMatch(list: Permission[], permission: string): Permission | undefined {
    const idx = permission.lastIndexOf(':');
    const resource = permission.slice(0, idx);
    const action = permission.slice(idx + 1);
    return list.find((p) => p.resource === resource && p.action === action);
  }

  /**
   * Set role permissions (full replacement).
   *
   * @deprecated DEAD API with zero src callers (spec 2026-10-08 §2 R4): it
   * carries neither the tenant partition guard nor the data_scope clamp that
   * RoleManager's private funnel enforces, and no tenant parameter exists.
   * Removal is backlog — do NOT adopt it for new code; bind through the
   * RoleManager create/update funnels instead.
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

    // Role→permission mapping changed: every user holding this role is
    // affected; cache is cross-tenant, so clear all entries.
    invalidatePermissionCache();
  }
}
