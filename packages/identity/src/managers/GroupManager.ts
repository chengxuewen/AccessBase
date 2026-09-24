/**
 * Q4b user groups: CRUD + membership + role bindings, tenant-scoped end to
 * end. Role-granting power has last-admin GUARD PARITY with the direct funnels
 * (rev.2 R2/R3): every mutation that can strip isSystem standing computes the
 * POST-state holder set (JS census with active+tenant joins) and refuses to
 * orphan the tenant. Perms-affecting mutations fan out invalidatePermissionCache
 * (fires the Q2c cross-node publish) + bumpAuthState parity (R9).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createDb, closeDb, type DbLike, type DrizzleDB } from '../db/index.js';
import { groupRoles, groupUsers, groups, roles, userRoles, users } from '../db/schema.js';
import {
  collectAdminHolders,
  holdsIsSystemExceptViaGroup,
  LAST_ADMIN_GUARD,
} from '../services/last-admin-guard.js';
import { bumpAuthState, delAuthState } from '../services/token-version.js';
import { invalidatePermissionCache } from './permission-cache.js';
import { logger } from '@accessbase/logging';

export interface Group {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
}

export class GroupManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string | DrizzleDB) {
    this.db =
      typeof databaseUrl === 'string' || databaseUrl === undefined
        ? createDb(databaseUrl)
        : databaseUrl;
  }

  async close(): Promise<void> {
    await closeDb(this.db);
  }

  private map(g: typeof groups.$inferSelect): Group {
    return {
      id: g.id,
      tenantId: g.tenantId,
      name: g.name,
      description: g.description ?? undefined,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }

  async findById(id: string, tenantId: string): Promise<Group | null> {
    const [row] = await this.db.select().from(groups).where(and(eq(groups.id, id), eq(groups.tenantId, tenantId))).limit(1);
    return row ? this.map(row) : null;
  }

  async list(tenantId: string): Promise<Array<Group & { memberCount: number; roleCount: number }>> {
    const rows = await this.db.select().from(groups).where(eq(groups.tenantId, tenantId)).orderBy(groups.name);
    const out: Array<Group & { memberCount: number; roleCount: number }> = [];
    for (const r of rows) {
      const [mc] = await this.db.select({ n: sql<number>`count(*)::int` }).from(groupUsers).where(eq(groupUsers.groupId, r.id));
      const [rc] = await this.db.select({ n: sql<number>`count(*)::int` }).from(groupRoles).where(eq(groupRoles.groupId, r.id));
      out.push({ ...this.map(r), memberCount: mc?.n ?? 0, roleCount: rc?.n ?? 0 });
    }
    return out;
  }

  async create(input: CreateGroupInput, tenantId: string): Promise<Group> {
    const [dup] = await this.db.select({ id: groups.id }).from(groups).where(and(eq(groups.tenantId, tenantId), eq(groups.name, input.name))).limit(1);
    if (dup) throw new Error('GROUP_NAME_EXISTS');
    const [row] = await this.db.insert(groups).values({ name: input.name, description: input.description ?? null, tenantId }).returning();
    if (!row) throw new Error('Failed to create group');
    logger.info({ groupId: row.id, tenantId }, 'group created');
    return this.map(row);
  }

  async update(id: string, patch: Partial<CreateGroupInput>, tenantId: string): Promise<Group> {
    const g = await this.findById(id, tenantId);
    if (!g) throw new Error('GROUP_NOT_FOUND');
    if (patch.name && patch.name !== g.name) {
      const [dup] = await this.db.select({ id: groups.id }).from(groups).where(and(eq(groups.tenantId, tenantId), eq(groups.name, patch.name))).limit(1);
      if (dup) throw new Error('GROUP_NAME_EXISTS');
    }
    const [row] = await this.db
      .update(groups)
      .set({ name: patch.name ?? g.name, description: patch.description ?? g.description ?? null, updatedAt: new Date() })
      .where(eq(groups.id, id))
      .returning();
    return this.map(row as typeof groups.$inferSelect);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const g = await this.findById(id, tenantId);
    if (!g) throw new Error('GROUP_NOT_FOUND');
    // R2: post-state holders = everyone EXCEPT this group's contribution
    const before = await collectAdminHolders(this.db, tenantId);
    if (before.size > 0) {
      const after = await this.holdersExcludingGroup(tenantId, id);
      if (after.size === 0) throw new Error(`${LAST_ADMIN_GUARD}: group is the only admin source of the tenant`);
    }
    const members = await this.memberIds(id); // capture BEFORE cascade wipes group_users rows
    await this.db.delete(groups).where(eq(groups.id, id)); // cascades membership+bindings
    for (const u of members) invalidatePermissionCache(tenantId, u);
    if (members.length > 0) {
      await bumpAuthState(this.db as DbLike, { tenantId, userIds: members }, delAuthState);
    }
    logger.info({ groupId: id }, 'group deleted');
  }

  private async holdersExcludingGroup(tenantId: string, groupId: string): Promise<Set<string>> {
    const direct = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.tenantId, tenantId)))
      .where(and(eq(userRoles.tenantId, tenantId), eq(roles.isSystem, true), eq(users.status, 'active')));
    const otherGroups = await this.db
      .select({ userId: groupUsers.userId })
      .from(groupUsers)
      .innerJoin(groupRoles, eq(groupUsers.groupId, groupRoles.groupId))
      .innerJoin(roles, eq(groupRoles.roleId, roles.id))
      .innerJoin(users, and(eq(users.id, groupUsers.userId), eq(users.tenantId, tenantId)))
      .where(and(eq(groupUsers.tenantId, tenantId), eq(roles.isSystem, true), eq(users.status, 'active'), sql`${groupUsers.groupId} <> ${groupId}`));
    const set = new Set<string>();
    for (const r of direct as Array<{ userId: string }>) set.add(r.userId);
    for (const r of otherGroups as Array<{ userId: string }>) set.add(r.userId);
    return set;
  }

  private async memberIds(groupId: string): Promise<string[]> {
    const rows = await this.db.select({ userId: groupUsers.userId }).from(groupUsers).where(eq(groupUsers.groupId, groupId));
    return (rows as Array<{ userId: string }>).map((r) => r.userId);
  }

  /** perms-affecting mutation fan-out (R9 parity + Q2c publish via hook). */
  private async invalidateMembers(groupId: string, tenantId: string): Promise<void> {
    const usersAffected = await this.memberIds(groupId);
    for (const u of usersAffected) invalidatePermissionCache(tenantId, u);
    if (usersAffected.length > 0) {
      await bumpAuthState(this.db as DbLike, { tenantId, userIds: usersAffected }, delAuthState);
    }
  }

  async listMembers(groupId: string, tenantId: string): Promise<Array<{ userId: string; email: string; name: string }>> {
    if (!(await this.findById(groupId, tenantId))) throw new Error('GROUP_NOT_FOUND');
    const rows = await this.db
      .select({ userId: users.id, email: users.email, name: users.name })
      .from(groupUsers)
      .innerJoin(users, eq(users.id, groupUsers.userId))
      .where(eq(groupUsers.groupId, groupId));
    return rows as Array<{ userId: string; email: string; name: string }>;
  }

  async addMember(groupId: string, userId: string, tenantId: string): Promise<void> {
    const g = await this.findById(groupId, tenantId);
    if (!g) throw new Error('GROUP_NOT_FOUND');
    // R5: member must live in the GROUP's tenant — cross-tenant rows would be
    // invisible to the user's own request context yet leak in member lists.
    const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1);
    if (!u) throw new Error('GROUP_MEMBER_TENANT_MISMATCH');
    await this.db.insert(groupUsers).values({ groupId, userId, tenantId }).onConflictDoNothing();
    invalidatePermissionCache(tenantId, userId);
    await bumpAuthState(this.db as DbLike, { tenantId, userIds: [userId] }, delAuthState);
  }

  async removeMember(groupId: string, userId: string, tenantId: string): Promise<void> {
    const g = await this.findById(groupId, tenantId);
    if (!g) throw new Error('GROUP_NOT_FOUND');
    const before = await collectAdminHolders(this.db, tenantId);
    if (before.has(userId) && before.size <= 1) {
      // sole admin via (also) this group — does another path keep them admin?
      const keeps = await holdsIsSystemExceptViaGroup(this.db, tenantId, userId, groupId);
      if (!keeps) throw new Error(`${LAST_ADMIN_GUARD}: would remove the tenant's last administrator`);
    }
    await this.db.delete(groupUsers).where(and(eq(groupUsers.groupId, groupId), eq(groupUsers.userId, userId)));
    invalidatePermissionCache(tenantId, userId);
    await bumpAuthState(this.db as DbLike, { tenantId, userIds: [userId] }, delAuthState);
  }

  async getGroupRoles(groupId: string, tenantId: string): Promise<string[]> {
    const rows = await this.db.select({ roleId: groupRoles.roleId }).from(groupRoles).where(and(eq(groupRoles.groupId, groupId), eq(groupRoles.tenantId, tenantId)));
    return (rows as Array<{ roleId: string }>).map((r) => r.roleId);
  }

  /** Full replacement of the group's role bindings (admin surface). */
  async setGroupRoles(groupId: string, roleIds: string[], tenantId: string, db?: DbLike): Promise<void> {
    const d: DbLike = db ?? (this.db as DbLike);
    const g = await this.findById(groupId, tenantId);
    if (!g) throw new Error('GROUP_NOT_FOUND');
    if (roleIds.length > 0) {
      const [bad] = await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(and(inArray(roles.id, roleIds), sql`${roles.tenantId} <> ${tenantId}`))
        .limit(1);
      if (bad) throw new Error('GROUP_ROLE_TENANT_MISMATCH');
    }
    const before = await collectAdminHolders(this.db, tenantId);
    const members = await this.memberIds(groupId);
    const newIsSystemPresent =
      roleIds.length > 0 &&
      (await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(and(inArray(roles.id, roleIds), eq(roles.isSystem, true)))
        .limit(1))[0] !== undefined;
    if (before.size > 0 && !newIsSystemPresent) {
      // the group stops granting isSystem — anyone left?
      const others = await this.holdersExcludingGroup(tenantId, groupId);
      const keptSelf = new Set<string>();
      for (const m of members) {
        if (await holdsIsSystemExceptViaGroup(this.db, tenantId, m, groupId)) keptSelf.add(m);
      }
      const after = new Set([...others, ...keptSelf]);
      if (after.size === 0) throw new Error(`${LAST_ADMIN_GUARD}: unbinding group roles would orphan the tenant`);
    }
    await d.delete(groupRoles).where(eq(groupRoles.groupId, groupId));
    for (const roleId of roleIds) {
      await d.insert(groupRoles).values({ groupId, roleId, tenantId }).onConflictDoNothing();
    }
    await this.invalidateMembers(groupId, tenantId);
    logger.info({ groupId, roleIds: roleIds.length }, 'group roles replaced');
  }

  /** SCIM-side helper: does this group carry an isSystem role (R4 lock)? */
  async grantsSystemRole(groupId: string, d: DbLike = this.db as DbLike): Promise<boolean> {
    const [hit] = await d
      .select({ id: groupRoles.groupId })
      .from(groupRoles)
      .innerJoin(roles, eq(groupRoles.roleId, roles.id))
      .where(and(eq(groupRoles.groupId, groupId), eq(roles.isSystem, true)))
      .limit(1);
    return Boolean(hit);
  }
}
