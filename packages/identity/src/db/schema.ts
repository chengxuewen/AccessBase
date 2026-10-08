/**
 * Drizzle ORM Schema Definitions for @accessbase/identity
 * Based on database.md §22 and identity-sdd.md
 */
import {
pgTable,
  bigint,bigserial,
uuid,
varchar,
text,
  boolean,
  integer,
  date,
  timestamp,
  jsonb,
primaryKey,
index,uniqueIndex,

unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
    /** Q4a: admin reset / invite → must set a new password at next login */
    mustChangePassword: boolean('must_change_password').default(false).notNull(),
    status: varchar('status', { length: 20 }).default('active').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    tokenVersion: integer('token_version').default(1).notNull(),
    // Batch I: E.164 SMS OTP; nullable until registered via SCIM/admin; partial unique index in migration 0004 (R1/R9)
    phone: varchar('phone', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // SCIM correlation-only (per-tenant, best-effort) — no unique constraint (R6).
    externalId: uuid('external_id'),
  },
  (table) => ({
    emailIdx: index('idx_users_email').on(table.email),
    tenantIdx: index('idx_users_tenant').on(table.tenantId),
    statusIdx: index('idx_users_status').on(table.status),
    // Batch O: canonical declarations for the batch-I partial indexes (migration 0004) — snapshot & schema must match
    phoneIdx: index('idx_users_phone').on(table.phone).where(sql`${table.phone} IS NOT NULL`),
    phoneUniqueIdx: uniqueIndex('idx_users_phone_unique').on(table.phone).where(sql`${table.phone} IS NOT NULL`),
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
    /** DG-6d data-scope rank for THIS binding: 'all' | 'dept' | 'self' (enum clamped at the funnel) */
    dataScope: text('data_scope').notNull().default('all'),
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
    // Session-lifetime SL-1: idle-expiry touchpoint (rotation sets it; default now() keeps INSERT paths unchanged)
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
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
    // R-audit (spec 2026-09-28 D3): tamper-evidence chain columns. All NULLable
    // (legacy rows and pending state); no FKs — this table has none today.
    rowHash: text('row_hash'),
    anchorId: bigint('anchor_id', { mode: 'number' }),
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    erasureId: uuid('erasure_id'),
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
    /** Logout-coherence batch: OIDC RP id_token (id_token_hint for end_session; A4 plaintext like siblings) */
    idToken: text('id_token'),
    /** Logout-coherence batch: SAML AuthnStatement SessionIndex captured at ACS for SP-initiated SLO */
    sessionIndex: text('session_index'),
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

/**
 * WebAuthn Credentials table (Phase 6d Task 3) -- passkey registrations.
 * user_id varchar(64) matching oauth_accounts style (no FK — tests use synthetic ids).
 * credential_id text: real credential IDs are base64url up to 1023 bytes, too big for varchar.
 * transports stored as JSON string ('["internal","hybrid"]').
 */
export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('idx_webauthn_credentials_user').on(table.userId),
  }),
);

export type WebauthnCredentialRow = typeof webauthnCredentials.$inferSelect;
export type NewWebauthnCredentialRow = typeof webauthnCredentials.$inferInsert;

/**
 * Options key-value table (Batch 4) -- runtime configuration store.
 */
export const options = pgTable('options', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OptionsRow = typeof options.$inferSelect;

/**
 * OIDC clients table (Batch 5) -- OpenID Connect provider registrations.
 * secret_encrypted stores AES-256-GCM blob (v1:salt:iv:tag:ct, key scrypt(JWT_SECRET, salt))
 * -- never plaintext; see task-1-brief + task 4 ruling.
 */
export const oidcClients = pgTable('oidc_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: text('client_id').notNull().unique(),
  name: text('name').notNull(),
  secretEncrypted: text('secret_encrypted').notNull(),
  redirectUris: jsonb('redirect_uris').notNull(),
  postLogoutRedirectUris: jsonb('post_logout_redirect_uris').default([]),
  grantTypes: jsonb('grant_types').notNull(),
  scope: text('scope').notNull(),
  tokenAuthMethod: text('token_endpoint_auth_method').notNull().default('client_secret_basic'),
  /** Q3D: RP back-channel logout endpoint (opt-in via OIDC_BACKCHANNEL_LOGOUT) */
  backchannelLogoutUri: text('backchannel_logout_uri'),
  /** Logout-coherence batch: public JWKS for private_key_jwt client auth (kty-scoped public members only) */
  jwks: jsonb('jwks'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Q4b user groups (gap-audit market H): groups grant roles via group_roles,
 * memberships via group_users. All fks CASCADE (users/roles hard-delete paths;
 * RoleManager.delete census counts group_roles before allowing).
 */
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** DG-6d: 'group' | 'department' — department groups ARE the dept source (A1 ruling) */
  kind: text('kind').notNull().default('group'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.tenantId, t.name)]);

export const groupUsers = pgTable('group_users', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] })]);

export const groupRoles = pgTable('group_roles', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.roleId] })]);

export type GroupRow = typeof groups.$inferSelect;

export type OidcClientRow = typeof oidcClients.$inferSelect;

/**
 * OIDC grants table (Batch 5) -- persisted consent/grant records.
 * provider_grant_id is oidc-provider's grant jti; userId is the AccessBase user uuid.
 */
export const oidcGrants = pgTable('oidc_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerGrantId: text('provider_grant_id').notNull().unique(),
  userId: uuid('user_id').notNull(),
  clientId: text('client_id').notNull(),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OidcGrantRow = typeof oidcGrants.$inferSelect;

/**
 * OIDC provider adapter state (batch N). Generic KV mirroring the
 * oidc-provider Adapter contract for EVERY non-Client kind: verbatim jsonb
 * payload plus derived index columns (Session uid, interaction userCode,
 * grantId) and TTL. Replaces the module-level memory Map whose ponytail
 * comment admitted restart wipes all RP refresh tokens.
 */
export const oidcAdapterState = pgTable(
  'oidc_adapter_state',
  {
    kind: text('kind').notNull(),
    id: text('id').notNull(),
    payload: jsonb('payload').notNull(),
    /** Derived payload.uid — indexed for Session (official memory adapter
     * only indexes Session uid; we populate only kind='Session'). */
    uid: text('uid'),
    /** Derived payload.userCode, lower-cased (interaction resumption). */
    userCode: text('user_code'),
    /** Derived payload.grantId — cross-kind token revocation. */
    grantId: text('grant_id'),
    /** NULL = provider passed no expiry (rare). Relative expiresIn was
     * converted at write time: now() + expiresIn + clockTolerance seconds. */
    notAfter: timestamp('not_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.kind, t.id] }),
    uidIdx: index('oidc_adapter_state_uid_idx').on(t.kind, t.uid).where(sql`${t.uid} IS NOT NULL`),
    userCodeIdx: index('oidc_adapter_state_user_code_idx').on(t.kind, t.userCode).where(sql`${t.userCode} IS NOT NULL`),
    grantIdx: index('oidc_adapter_state_grant_idx').on(t.grantId),
    ttlIdx: index('oidc_adapter_state_ttl_idx').on(t.notAfter),
  }),
);

export type OidcAdapterStateRow = typeof oidcAdapterState.$inferSelect;

/**
 * API keys table (Batch C Task 1). Plaintext is shown exactly once at create
 * time and never stored -- only sha256 hex hash. prefix (first 8 chars) exists
 * for list identification. hash UNIQUE constraint provides the lookup index.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 128 }).notNull(),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    hash: varchar('hash', { length: 64 }).notNull().unique(),
    scopes: jsonb('scopes').default(['*']).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_api_keys_tenant').on(table.tenantId),
  }),
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;


/**
 * Tenants table (Batch G Task 1). Hard-tenant rows; the bootstrap seed writes
 * the default tenant with the fixed DEFAULT_TENANT literal id + slug 'default'.
 * slug is globally unique — tenant resolution key.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    status: varchar('status', { length: 20 }).default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index('idx_tenants_slug').on(table.slug),
  }),
);

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenantRow = typeof tenants.$inferInsert;

/**
 * Q4c events outbox + webhooks (spec 2026-09-24-q4c rev.2 §3).
 *
 * `events` is the durable fan-out trail written at the manager funnels (same tx
 * as the mutation when a caller handle is passed). `fanout_complete_at` is the
 * SOLE terminal marker (rev.2 removed dead_at): an event is terminal iff no
 * pending delivery references it — zero-subscriber events terminalize on the
 * first fan-out pass (vacuous rule). NO fk to tenants: tenants soft-delete, and
 * the age-based prune (§3) is the only lifecycle writer.
 */
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    fanoutCompleteAt: timestamp('fanout_complete_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_events_pending_fanout')
      .on(t.tenantId)
      .where(sql`${t.fanoutCompleteAt} IS NULL`),
    index('idx_events_created').on(t.createdAt),
  ],
);

/**
 * Per-tenant webhook subscription. `subscribed_events` is a text[] filter
 * ('{*}' = all); `secret_encrypted` holds the AES-GCM v1 envelope (dispatcher
 * decrypts once per endpoint per tick — never per delivery, F5/R4).
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    secretEncrypted: text('secret_encrypted').notNull(),
    subscribedEvents: text('subscribed_events').array().notNull().default(sql`'{*}'::text[]`),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.tenantId, t.url)],
);

/**
 * Delivery ledger. Surrogate `id` (rev.2 R1) is the claim cursor; UNIQUE
 * (event_id, endpoint_id) is the fan-out ON CONFLICT target. status only
 * reaches terminal (delivered|dead) via the dispatcher; retry lease is the
 * 60s `next_attempt_at` push in the claim CTE (§5.2).
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastError: text('last_error'),
    responseStatus: integer('response_status'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique().on(t.eventId, t.endpointId),
    index('idx_deliveries_due').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpointRow = typeof webhookEndpoints.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;

/**
 * Day-anchored audit chain roots (R-audit spec 2026-09-28 D2). One row per
 * (day, seq) fold of ordered audit row hashes; prev_root links across folds.
 * pruned_at is set by the retention sweeper when the folded rows are gone.
 */
export const auditChainAnchors = pgTable(
  'audit_chain_anchors',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    day: date('day').notNull(),
    seq: integer('seq').notNull(),
    firstId: uuid('first_id').notNull(),
    lastId: uuid('last_id').notNull(),
    rowCount: integer('row_count').notNull(),
    root: text('root').notNull(),
    prevRoot: text('prev_root'),
    prunedAt: timestamp('pruned_at', { withTimezone: true }),
    anchoredAt: timestamp('anchored_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('audit_chain_anchors_day_seq_unique').on(t.day, t.seq)],
);

/**
 * Sanctioned RTBF erasure ledger (R-audit spec 2026-09-28 D5). receipt_hash
 * binds the ledger to the pre-erasure row-hash set; erasure_id on audit_logs
 * links scrubbed rows back here for verify-time receipt recomputation.
 */
export const auditErasures = pgTable('audit_erasures', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  subjectUserId: uuid('subject_user_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  legalBasis: text('legal_basis').notNull(),
  receiptHash: text('receipt_hash').notNull(),
  rowsAffected: integer('rows_affected').notNull(),
  eventsScrubbed: integer('events_scrubbed').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AuditChainAnchorRow = typeof auditChainAnchors.$inferSelect;
export type NewAuditChainAnchorRow = typeof auditChainAnchors.$inferInsert;
export type AuditErasureRow = typeof auditErasures.$inferSelect;
export type NewAuditErasureRow = typeof auditErasures.$inferInsert;
