/**
 * Admin Initialization Module
 * Creates default admin user on first run if none exists
 */
import type { FastifyInstance } from 'fastify'
import { UserManager, RoleManager } from '@accessbase/identity'
import { logger } from '@accessbase/logging'
import { config } from './config.js'

const ADMIN_EMAIL = 'admin@accessbase.local'
const DEFAULT_TENANT = 'default'

/**
 * Generate a random password
 */
function generatePassword(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => chars[byte % chars.length]).join('')
}

/**
 * Initialize admin user if none exists
 */
export async function initializeAdmin(app: FastifyInstance): Promise<void> {
  const userManager = new UserManager()
  const roleManager = new RoleManager()

  try {
    // Check if admin user exists
    const existingAdmin = await userManager.findByEmail(ADMIN_EMAIL)
    if (existingAdmin) {
      logger.info('Admin user already exists, skipping initialization')
      return
    }

    logger.info('No admin user found, initializing default admin...')

    // Create admin role if it doesn't exist
    const adminRole = await roleManager.create(
      {
        name: 'admin',
        description: 'System administrator with full access',
      },
      DEFAULT_TENANT,
    )

    // Determine password
    let password: string
    let isGenerated = false

    if (config.adminPassword) {
      password = config.adminPassword
      logger.info('Using configured admin password')
    } else {
      password = generatePassword()
      isGenerated = true
    }

    // Create admin user
    const adminUser = await userManager.create(
      {
        email: ADMIN_EMAIL,
        name: 'Administrator',
        password,
        roles: [adminRole.id],
      },
      DEFAULT_TENANT,
    )

    // Log credentials
    if (isGenerated) {
      logger.warn(
        { email: ADMIN_EMAIL, password },
        `Generated admin password: ${password} - CHANGE IMMEDIATELY`,
      )
    } else {
      logger.warn({ email: ADMIN_EMAIL }, 'Admin user created with configured password')
    }

    logger.info({ userId: adminUser.id, email: ADMIN_EMAIL }, 'Admin user initialized successfully')
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize admin user')
    throw error
  }
}
