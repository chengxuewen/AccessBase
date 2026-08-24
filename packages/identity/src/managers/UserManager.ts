/**
 * UserManager - User management with Drizzle ORM (SDD 2.2)
 */
import { eq, and, like, sql, count } from 'drizzle-orm';
import { createDb, type DrizzleDB } from '../db/index.js';
import { users, type User as DbUser, type NewUser } from '../db/schema.js';
import { logger } from '@accessbase/logging';
import type {
  User,
  CreateUserInput,
  UpdateUserInput,
  UserQueryParams,
  UserStatus,
  PaginatedResult,
} from '../types.js';
import { hash, compare } from 'bcryptjs';

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
      status: 'active',
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
   * Find user by email (global, for login)
   */
  async findByEmail(email: string): Promise<User | null> {
    logger.debug(`Finding user by email: ${email}`);

    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

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

    if (params.search) {
      conditions.push(
        sql`(${users.email} ILIKE ${'%' + params.search + '%'} OR ${users.name} ILIKE ${'%' + params.search + '%'})`
      );
    }

    if (params.status) {
      conditions.push(eq(users.status, params.status));
    }

    const where = and(...conditions);

    // Get total count
    const [totalResult] = await this.db
      .select({ count: count() })
      .from(users)
      .where(where);

    const total = totalResult?.count ?? 0;

    // Get paginated results
    const results = await this.db
      .select()
      .from(users)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(users.createdAt);

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

    await this.db
      .delete(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }

  /**
   * Change user status (active / suspended / pending)
   */
  async changeStatus(id: string, status: UserStatus, tenantId: string): Promise<User> {
    logger.info(`Changing user ${id} status to ${status} in tenant: ${tenantId}`);

    const [updated] = await this.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .returning();

    if (!updated) {
      throw new Error('User not found');
    }

    return this.mapToUser(updated);
  }

  /**
   * Verify password
   */
  async verifyPassword(email: string, password: string): Promise<User> {
    logger.debug(`Verifying password for email: ${email}`);

    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = result[0];

    if (!user || !user.passwordHash) {
      throw new Error('Invalid credentials');
    }

    const isValid = await compare(password, user.passwordHash);

    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    return this.mapToUser(user);
  }

  /**
   * Reset password (via reset token)
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    logger.info('Resetting password with token');
    // Implementation will:
    // 1. Validate reset token from Redis
    // 2. Find user by token
    // 3. Hash new password
    // 4. Update user password
    // 5. Invalidate token
    throw new Error('Not implemented - requires Redis integration');
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
   * Map database user to application user type
   */
  private mapToUser(dbUser: DbUser): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      isActive: dbUser.status === 'active',
      tenantId: dbUser.tenantId,
      tokenVersion: dbUser.tokenVersion,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
    };
  }
}
