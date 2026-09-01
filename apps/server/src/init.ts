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

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

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
      // env bypass for automated deployments (Docker/CI) — D113
      const roleManager = new RoleManager();
      const adminRole = await roleManager.create(
        { name: 'admin', description: 'System administrator with full access' },
        DEFAULT_TENANT,
      );
      await userManager.create(
        { email, name: 'Administrator', password: config.adminPassword, roles: [adminRole.id] },
        DEFAULT_TENANT,
      );
      logger.warn({ email }, 'Admin created via ADMIN_EMAIL/ADMIN_PASSWORD env bypass');
      return;
    }

    logger.info('No admin user found — Setup Wizard will run on first access');
  } catch (err) {
    logger.error({ err }, 'initializeAdmin failed — Setup Wizard will handle on first access');
  }
}
