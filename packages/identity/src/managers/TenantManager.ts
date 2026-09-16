/**
 * TenantManager - hard tenant lifecycle (Batch G Task 1)
 *
 * create / findAll / findById / update / soft delete. The default tenant is
 * protected: any update or delete against DEFAULT_TENANT throws
 * TENANT_PROTECTED (409-style) — suspending it would lock out every login
 * (self-lockout, R8). Suspend paths invalidate the tenant permission cache (R2).
 */
import { eq, and, sql, count } from 'drizzle-orm';
import { createDb, type DrizzleDB } from '../db/index.js';
import { tenants, type TenantRow, type NewTenantRow } from '../db/schema.js';
import { invalidatePermissionCache } from './permission-cache.js';
import { logger } from '@accessbase/logging';
import type { PaginatedResult } from '../types.js';

/** Error message tag for default-tenant protection (409 TENANT_PROTECTED). */
export const TENANT_PROTECTED = 'TENANT_PROTECTED';

/** Default tenant literal id — must stay in sync with apps/server DEFAULT_TENANT. */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
}

export interface UpdateTenantInput {
  name?: string;
  slug?: string;
  status?: string;
}

export interface TenantQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export class TenantManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string) {
    this.db = createDb(databaseUrl);
  }

  /**
   * Create tenant. Duplicate slug → TENANT_PROTECTED-tagged error (409 shape).
   */
  async create(data: CreateTenantInput): Promise<Tenant> {
    logger.info(`Creating tenant: ${data.slug}`);

    const existing = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, data.slug))
      .limit(1);

    if (existing.length > 0) {
      logger.info(`Tenant slug '${data.slug}' already exists`);
      throw new Error(`${TENANT_PROTECTED}: slug '${data.slug}' already exists`);
    }

    const newTenant: NewTenantRow = {
      name: data.name,
      slug: data.slug,
    };

    const [inserted] = await this.db.insert(tenants).values(newTenant).returning();

    if (!inserted) {
      throw new Error('Failed to create tenant');
    }

    return this.mapToTenant(inserted);
  }

  /**
   * Query tenant list (paginated, optional search on name/slug).
   */
  async findAll(params: TenantQueryParams): Promise<PaginatedResult<Tenant>> {
    logger.debug({ params }, 'Querying tenants');

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params.search) {
      conditions.push(
        sql`(${tenants.name} ILIKE ${'%' + params.search + '%'} OR ${tenants.slug} ILIKE ${'%' + params.search + '%'})`,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await this.db
      .select({ count: count() })
      .from(tenants)
      .where(where);

    const total = totalResult?.count ?? 0;

    const results = await this.db
      .select()
      .from(tenants)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(tenants.createdAt);

    return {
      data: results.map((row) => this.mapToTenant(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find tenant by ID.
   */
  async findById(id: string): Promise<Tenant | null> {
    logger.debug(`Finding tenant by ID: ${id}`);

    const result = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);

    const row = result[0];
    if (!row) return null;

    return this.mapToTenant(row);
  }

  /**
   * Update tenant. Any update against the default tenant → TENANT_PROTECTED.
   * Suspending (status='suspended') invalidates the tenant permission cache (R2).
   */
  async update(id: string, data: UpdateTenantInput): Promise<Tenant> {
    if (id === DEFAULT_TENANT_ID) {
      throw new Error(`${TENANT_PROTECTED}: the default tenant cannot be modified`);
    }
    logger.info(`Updating tenant: ${id}`);

    const existing = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);

    if (existing.length === 0) {
      throw new Error('Tenant not found');
    }

    const updateData: Partial<NewTenantRow> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.slug !== undefined) updateData.slug = data.slug;
    if (data.status !== undefined) updateData.status = data.status;

    const [updated] = await this.db
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning();

    if (!updated) {
      throw new Error('Failed to update tenant');
    }

    if (updated.status === 'suspended') {
      invalidatePermissionCache(id);
    }

    return this.mapToTenant(updated);
  }

  /**
   * Soft delete: sets status='suspended' (rows are never hard-deleted —
   * users/roles/api_keys reference tenant ids). Default tenant → TENANT_PROTECTED.
   */
  async delete(id: string): Promise<Tenant> {
    return this.update(id, { status: 'suspended' });
  }

  /**
   * Map database row to application Tenant type.
   */
  private mapToTenant(row: TenantRow): Tenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

