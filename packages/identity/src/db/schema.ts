/**
 * Drizzle ORM Schema Definitions for @accessbase/identity
 * Based on database.md §22 and identity-sdd.md
 */
import {
pgTable,
uuid,
varchar,
text,
boolean,
integer,
  timestamp,
  jsonb,
primaryKey,
index,
unique,
} from 'drizzle-orm/pg-core';

/**
 * Users table (database.md §22.1)
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    emailVerified: boolean('email_verified').default(false),
    mfaEnabled: boolean('mfa_enabled').default(false),
    mfaSecret: varchar('mfa_secret', { length: 255 }),
    status: varchar('status', { length: 20 }).default('active').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    tokenVersion: integer('token_version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('idx_users_email').on(table.email),
    tenantIdx: index('idx_users_tenant').on(table.tenantId),
    statusIdx: index('idx_users_status').on(table.status),
  }),
);

/**
 * Roles table (database.md §22.1)
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    tenantId: uuid('tenant_id').notNull(),
    parentId: uuid('parent_id'),
    isSystem: boolean('is_system').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_roles_tenant').on(table.tenantId),
    parentIdx: index('idx_roles_parent').on(table.parentId),
    uniqueNameTenant: unique('unique_role_name_tenant').on(table.name, table.tenantId),
  }),
);

/**
 * Permissions table (database.md §22.1)
 */
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    resource: varchar('resource', { length: 100 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueResourceAction: unique('unique_permission_resource_action').on(
      table.resource,
      table.action,
    ),
  }),
);

/**
 * Role-Permissions junction table (database.md §22.1)
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    compositePk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  }),
);

/**
 * User-Roles junction table (database.md §22.1)
 */
export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
  },
  (table) => ({
    compositePk: primaryKey({ columns: [table.userId, table.roleId, table.tenantId] }),
  }),
);

/**
 * Sessions table (database.md §22.1)
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Phase 6a Task 4: refresh token rotation
    refreshTokenHash: varchar('refresh_token_hash', { length: 255 }),
    deviceInfo: jsonb('device_info'),
    ipAddress: varchar('ip_address', { length: 45 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
(table) => ({
userIdIdx: index('idx_sessions_user').on(table.userId),
tokenIdx: index('idx_sessions_token').on(table.token),
expiresIdx: index('idx_sessions_expires').on(table.expiresAt),
refreshTokenHashIdx: index('idx_sessions_refresh_hash').on(table.refreshTokenHash),
}),
);

/**
 * Type exports for use in managers
 */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
