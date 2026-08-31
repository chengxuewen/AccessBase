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
    // Phase 6b Task 3: TOTP MFA (encrypted at rest)
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').default(false).notNull(),
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

/**
 * Audit logs table (database.md §22.1, Phase 6a Task 5)
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: varchar('tenant_id', { length: 64 }),
    userId: varchar('user_id', { length: 64 }),
    action: varchar('action', { length: 128 }).notNull(),
    resourceType: varchar('resource_type', { length: 64 }),
    resourceId: varchar('resource_id', { length: 64 }),
    requestBody: jsonb('request_body'),
    responseStatus: integer('response_status'),
    requestId: varchar('request_id', { length: 64 }),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdIdx: index('idx_audit_logs_created').on(table.createdAt),
    userIdx: index('idx_audit_logs_user').on(table.userId),
  }),
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;

/**
 * MFA recovery codes (Phase 6b Task 3). Plaintext never stored — bcrypt hashes only.
 * `used` boolean is database.md conformance (mandatory alongside used_at).
 */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    used: boolean('used').default(false).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('idx_mfa_recovery_codes_user').on(table.userId),
  }),
);

export type MfaRecoveryCode = typeof mfaRecoveryCodes.$inferSelect;
export type NewMfaRecoveryCode = typeof mfaRecoveryCodes.$inferInsert;

/**
 * Password history (Phase 6b Task 4). Last-5 reuse prevention; old hashes only —
 * users.password_hash stays the live credential.
 */
export const passwordHistory = pgTable(
  'password_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('idx_password_history_user').on(table.userId),
  }),
);

export type PasswordHistoryRow = typeof passwordHistory.$inferSelect;
export type NewPasswordHistoryRow = typeof passwordHistory.$inferInsert;

/**
 * OAuth Accounts table (Phase 6d Task 1) -- links users to external OAuth providers.
 * user_id is varchar(64) matching recent tables (mfa_recovery_codes/password_history style);
 * tokens stored for API passthrough (GitHub/Google) per [PLAN].
 */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerAccountId: varchar('provider_account_id', { length: 128 }).notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('idx_oauth_accounts_user').on(table.userId),
    providerAccountUnique: unique('unique_oauth_provider_account').on(
      table.provider,
      table.providerAccountId,
    ),
  }),
);

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;
