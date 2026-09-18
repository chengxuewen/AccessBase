/**
 * Setup state synchronizer + env-bypass admin creation (Task 2).
 * DB is the single source of truth for setup state (D113). This module only
 * creates an admin when env dual-vars (ADMIN_EMAIL && ADMIN_PASSWORD) are both
 * set — explicit bypass for automated deployments (Docker/CI). Otherwise the
 * Setup Wizard runs on first access. All errors are swallowed: startup must
 * not crash; the wizard takes over.
 */
import type { FastifyInstance } from 'fastify';
import { UserManager, RoleManager } from '@accessbase/identity';
import { logger } from '@accessbase/logging';
import { config } from './config.js';
import { DEFAULT_TENANT } from './utils/constants.js';
import { createDb } from '@accessbase/identity/db';
import { ensureDefaultTenantRow } from './routes/permissions-seed.js';


export async function initializeAdmin(_app: FastifyInstance): Promise<void> {
  try {
    const userManager = new UserManager();
    const email = config.adminEmail || 'admin@accessbase.local';
    const admin = await userManager.findByEmail(email);
    if (admin) {
      logger.info('Admin user already exists, skipping initialization');
      return;
    }

    if (config.adminEmail && config.adminPassword) {
      // Default tenant first-writer (R6): row must exist before user creation.
      // Tolerant of missing/broken DB (best-effort helper would swallow, but
      // createDb itself may throw) — never block admin bootstrap.
      try {
        await ensureDefaultTenantRow(createDb(config.databaseUrl));
      } catch (dbErr: unknown) {
        logger.warn({ err: dbErr }, 'Default tenant row skipped — DB unavailable');
      }
      // env bypass for automated deployments (Docker/CI) — D113
      const roleManager = new RoleManager();
      const adminRole = await roleManager.create(
        { name: 'admin', description: 'System administrator with full access', isSystem: true },
        DEFAULT_TENANT,
      );
      const adminUser = await userManager.create(
        { email, name: 'Administrator', password: config.adminPassword },
        DEFAULT_TENANT,
      );
      await roleManager.assignToUser(adminUser.id, adminRole.id, DEFAULT_TENANT);
      logger.warn({ email }, 'Admin created via ADMIN_EMAIL/ADMIN_PASSWORD env bypass');
      return;
    }

    logger.info('No admin user found — Setup Wizard will run on first access');
  } catch (err) {
    logger.error({ err }, 'initializeAdmin failed — Setup Wizard will handle on first access');
  }
}
