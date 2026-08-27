/**
 * Admin Initialization Module
 * Creates default admin user on first run if none exists
 */
import type { FastifyInstance } from 'fastify';
import { UserManager, RoleManager } from '@accessbase/identity';
import { logger } from '@accessbase/logging';
import { config } from './config.js';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

/**
 * Generate a random password
 */
function generatePassword(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/**
 * Initialize admin user if none exists
 */
export async function initializeAdmin(app: FastifyInstance): Promise<void> {
  const userManager = new UserManager();
  const roleManager = new RoleManager();

  try {
    // Use configured email or default
    const adminEmail = config.adminEmail || 'admin@accessbase.local';

    // Check if admin user exists
    const existingAdmin = await userManager.findByEmail(adminEmail);
    if (existingAdmin) {
      logger.info('Admin user already exists, skipping initialization');
      return;
    }

    logger.info('No admin user found, initializing default admin...');

    // Create admin role if it doesn't exist
    const adminRole = await roleManager.create(
      {
        name: 'admin',
        description: 'System administrator with full access',
      },
      DEFAULT_TENANT,
    );

    // Determine password
    let password: string;
    let isGenerated = false;

    if (config.adminPassword) {
      password = config.adminPassword;
      logger.info('Using configured admin password');
    } else {
      password = generatePassword();
      isGenerated = true;
    }

    // Create admin user
    const adminUser = await userManager.create(
      {
        email: adminEmail,
        name: 'Administrator',
        password,
        roles: [adminRole.id],
      },
      DEFAULT_TENANT,
    );

    // Log credentials
    if (isGenerated) {
      logger.warn(
        { email: adminEmail, password },
        `Generated admin password: ${password} - CHANGE IMMEDIATELY`,
      );
    } else {
      logger.warn({ email: adminEmail }, 'Admin user created with configured password');
    }

    logger.info(
      { userId: adminUser.id, email: adminEmail },
      'Admin user initialized successfully',
    );

    // If admin was configured via env vars, mark setup as complete
    // so setup wizard doesn't appear and admin can login directly
    if (config.adminEmail && config.adminPassword) {
      const { setAdminExists, setIsInitialized } = await import('./routes/setup.js');
      const { setSetupComplete } = await import('./middleware/setup-guard.js');
      setAdminExists(true);
      setIsInitialized(true);
      setSetupComplete(true);
      logger.info('Setup marked complete (admin configured via env vars)');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize admin user');
    throw error;
  }
}
