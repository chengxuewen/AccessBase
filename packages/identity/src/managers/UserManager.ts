/**
 * UserManager - User management with Drizzle ORM (SDD 2.2)
 */
import { eq, and, like, sql, count, asc, desc, notInArray } from 'drizzle-orm';
import { closeDb, createDb, type DrizzleDB } from '../db/index.js';
import { users, passwordHistory, type User as DbUser, type NewUser } from '../db/schema.js';
import { invalidatePermissionCache } from './permission-cache.js';
import { wouldOrphanLastAdmin, LAST_ADMIN_GUARD } from '../services/last-admin-guard.js';
import { logger } from '@accessbase/logging';
import type {
  User,
  CreateUserInput,
  UpdateUserInput,
  UserQueryParams,
  UserStatus,
  PaginatedResult,
} from '../types.js';
import bcryptjs from 'bcryptjs';
const { hash, compare } = bcryptjs;

export class UserManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string) {
    this.db = createDb(databaseUrl);
  }

  /**
   * Create user (auto-hash password, assign default role)
   */
  async create(data: CreateUserInput, tenantId: string): Promise<User> {
    logger.info(`Creating user: ${data.email} in tenant: ${tenantId}`);

    // Hash password if provided
    let passwordHash: string | null = null;
    if (data.password) {
      passwordHash = await hash(data.password, 12);
    }

    const newUser: NewUser = {
      email: data.email,
      name: data.name,
      passwordHash,
      avatarUrl: data.avatarUrl ?? null,
      tenantId,
      status: data.isActive === false ? 'suspended' : 'active',
    };

    const [inserted] = await this.db.insert(users).values(newUser).returning();

    if (!inserted) {
      throw new Error('Failed to create user');
    }

    return this.mapToUser(inserted);
  }

  /**
   * Find user by ID (tenant isolated)
   */
  async findById(id: string, tenantId: string): Promise<User | null> {
    logger.debug(`Finding user by ID: ${id} in tenant: ${tenantId}`);

    const result = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .limit(1);

    const user = result[0];
    return user ? this.mapToUser(user) : null;
  }
  
  /**
   * Find user by ID across ALL tenants (no tenantId predicate).
   * For flows that hold only a user id from a token/session row and cannot
   * know the tenant up front (e.g. the refresh door in apps/server auth.ts).
   */
  async findByIdAny(id: string): Promise<User | null> {
    logger.debug(`Finding user by ID across tenants: ${id}`);

    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    const user = result[0];
    return user ? this.mapToUser(user) : null;
  }

  /**
   * Find user by email (global, for login)
   */
  async findByEmail(email: string): Promise<User | null> {
    logger.debug(`Finding user by email: ${email}`);

    const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    const user = result[0];
    return user ? this.mapToUser(user) : null;
  }

  /**
   * Find user by phone (Batch I, R1). Global lookup for SMS OTP login.
   * LIMIT 2 detects duplicates: 1 row returns the user; 2+ rows means the
   * auth-path account mapping is ambiguous, so treat as no-match + warn
   * (DB layer additionally enforces the partial unique index from migration 0004).
   */
  async findByPhone(phone: string): Promise<User | null> {
    logger.debug(`Finding user by phone: ${phone}`);

    const result = await this.db.select().from(users).where(eq(users.phone, phone)).limit(2);

    if (result.length > 1) {
      logger.warn({ phone }, 'duplicate phone registrations');
      return null;
    }
    const user = result[0];
    return user ? this.mapToUser(user) : null;
  }

  /**
   * Paginated user list query
   */
  async findAll(params: UserQueryParams, tenantId: string): Promise<PaginatedResult<User>> {
    logger.debug({ params, tenantId }, 'Querying users');

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    // Build where conditions
    const conditions = [eq(users.tenantId, tenantId)];

    // ponytail: lower(email)= is an un-indexed full scan; the upgrade path is
    // a functional index on lower(email) plus write-side email normalization
    // (unique on lower). Note the pre-existing asymmetry: write-side
    // uniqueness (findByEmail) is exact-case eq, so case-variant twin rows
    // can exist and this read matches both.
    if (params.emailExact) {
      conditions.push(sql`lower(${users.email}) = ${params.emailExact.toLowerCase()}`);
    } else if (params.search) {
      conditions.push(
        sql`(${users.email} ILIKE ${'%' + params.search + '%'} OR ${users.name} ILIKE ${'%' + params.search + '%'})`,
      );
    }

    if (params.status) {
      conditions.push(eq(users.status, params.status));
    }

    const where = and(...conditions);

    // Get total count
    const [totalResult] = await this.db.select({ count: count() }).from(users).where(where);

    const total = totalResult?.count ?? 0;

    // Get paginated results — Q1-b3: REAL sorting (gap-audit D6 — sortBy was
    // advertised but silently dropped). Whitelist mirrors the route guard;
    // unknown values never reach here (route 400s them). Default: createdAt ASC.
    const sortCol =
      params.sortBy === 'email'
        ? users.email
        : params.sortBy === 'name'
          ? users.name
          : params.sortBy === 'status'
            ? users.status
            : users.createdAt;
    const results = await this.db
      .select()
      .from(users)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(params.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol));

    return {
      data: results.map((u) => this.mapToUser(u)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update user information
   */
  async update(id: string, data: UpdateUserInput, tenantId: string): Promise<User> {
    logger.info(`Updating user: ${id} in tenant: ${tenantId}`);

    const updateData: Partial<NewUser> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl;

    const [updated] = await this.db
      .update(users)
      .set(updateData)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .returning();

    if (!updated) {
      throw new Error('User not found');
    }

    return this.mapToUser(updated);
  }

  /**
   * Delete user (soft delete / hard delete)
   */
  async delete(id: string, tenantId: string): Promise<void> {
    logger.info(`Deleting user: ${id} in tenant: ${tenantId}`);

    // K-T2: deleting the tenant's last active admin is a lockout vector —
    // refuse before any write (manager funnel, addendum R2).
    if (await wouldOrphanLastAdmin(this.db, tenantId, id)) {
      throw new Error(
        `${LAST_ADMIN_GUARD}: cannot delete the last active administrator of the tenant`,
      );
    }

    await this.db.delete(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }

  /**
   * Change user status (active / suspended / pending)
   */
  async changeStatus(id: string, status: UserStatus, tenantId: string): Promise<User> {
    logger.info(`Changing user ${id} status to ${status} in tenant: ${tenantId}`);

    // K-T2: suspending the last active admin is a lockout vector. The guard is
    // fanned in here (not in the route) so the SCIM surface (PATCH active=false
    // → changeStatus directly) is gated too; only the →suspended transition
    // consults it — registration 'pending' and reactivation never do (R2).
    if (status === 'suspended' && (await wouldOrphanLastAdmin(this.db, tenantId, id))) {
      throw new Error(
        `${LAST_ADMIN_GUARD}: cannot suspend the last active administrator of the tenant`,
      );
    }
    const [updated] = await this.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .returning();

    if (!updated) {
      throw new Error('User not found');
    }

    invalidatePermissionCache(tenantId, id);
    return this.mapToUser(updated);
  }

  /**
   * Verify password
   */
  async verifyPassword(email: string, password: string): Promise<User> {
    logger.debug(`Verifying password for email: ${email}`);

    const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    const user = result[0];

    if (!user || !user.passwordHash) {
      throw new Error('Invalid credentials');
    }

    // P0: disabled (suspended/pending) accounts must fail before any bcrypt work
    if (user.status !== 'active') {
      throw new Error('ACCOUNT_SUSPENDED');
    }
    const isValid = await compare(password, user.passwordHash);

    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    return this.mapToUser(user);
  }

  /**
   * Change password (authed): verify old, reject reuse from last 5, rotate.
   * Throws Error('Invalid credentials') | Error('PASSWORD_REUSED').
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row?.passwordHash || !(await compare(oldPassword, row.passwordHash))) {
      throw new Error('Invalid credentials');
    }
    await this.rotatePassword(userId, row.passwordHash, newPassword);
  }

  /**
   * Reset password (post flow-token): no old-password check, same reuse gate.
   * Throws Error('PASSWORD_REUSED') | Error('User not found').
   */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row?.passwordHash) {
      throw new Error('User not found');
    }
    await this.rotatePassword(userId, row.passwordHash, newPassword);
  }

  /** Shared tail of change/reset: reuse gate vs last 5, hash+swap, history push+prune. */
  private async rotatePassword(userId: string, currentHash: string, newPassword: string): Promise<void> {
    const recent = await this.db.select()
      .from(passwordHistory)
      .where(eq(passwordHistory.userId, userId))
      .orderBy(desc(passwordHistory.createdAt))
      .limit(5);
    for (const entry of recent) {
      if (await compare(newPassword, entry.passwordHash)) {
        throw new Error('PASSWORD_REUSED');
      }
    }
    const newHash = await hash(newPassword, 12);
    await this.db.update(users).set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await this.db.insert(passwordHistory).values({ userId, passwordHash: currentHash });
    // Prune beyond last 5 (keep the just-inserted + 4 newest)
    const keep = await this.db.select({ id: passwordHistory.id })
      .from(passwordHistory)
      .where(eq(passwordHistory.userId, userId))
      .orderBy(desc(passwordHistory.createdAt))
      .limit(5);
    await this.db.delete(passwordHistory).where(
      and(eq(passwordHistory.userId, userId), notInArray(passwordHistory.id, keep.map((k) => k.id))),
    );
    logger.info({ userId }, 'Password rotated, history updated');
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(userId: string): Promise<void> {
    logger.info(`Sending email verification for user: ${userId}`);
    // Implementation will:
    // 1. Generate verification token
    // 2. Store token in Redis with TTL
    // 3. Send verification email
    throw new Error('Not implemented - requires email service integration');
  }

  /**
   * Verify email
   */
  async verifyEmail(token: string): Promise<User> {
    logger.info('Verifying email with token');
    // Implementation will:
    // 1. Validate verification token from Redis
    // 2. Find user by token
    // 3. Mark email as verified
    // 4. Invalidate token
    throw new Error('Not implemented - requires Redis integration');
  }
  /**
   * Mark the user's email as verified (Q1-b2 — consumes the email_verify flow
   * token at the route layer; this is the write funnel). Id is globally unique
   * so no tenant predicate applies.
   */
  async markEmailVerified(id: string): Promise<void> {
    await this.db.update(users).set({ emailVerified: true }).where(eq(users.id, id));
  }


  /**
   * Map database user to application user type
   */
  /** Release the internally-created pool (singleton reset / graceful shutdown). */
  async close(): Promise<void> {
    await closeDb(this.db);
  }

  private mapToUser(dbUser: DbUser): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      phone: dbUser.phone,
      isActive: dbUser.status === 'active',
      totpEnabled: dbUser.totpEnabled,
      emailVerified: dbUser.emailVerified ?? false,
      // DB status is a varchar; narrow to the claim's enum. Invalid values →
      // undefined = no claim = legacy-pass in authenticate.
      status: (['active', 'suspended', 'pending'] as const).includes(
        dbUser.status as 'active' | 'suspended' | 'pending',
      )
        ? (dbUser.status as 'active' | 'suspended' | 'pending')
        : undefined,
      tenantId: dbUser.tenantId,
      tokenVersion: dbUser.tokenVersion,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
    };
  }
}
