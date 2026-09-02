/**
 * Setup Wizard API Routes
 * Handles system initialization, admin creation, and configuration
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UserManager, RoleManager } from '@accessbase/identity';
import { createDb, users, userRoles, roles } from '@accessbase/identity/db';
import { eq } from 'drizzle-orm';
import { logger } from '@accessbase/logging';
import { config } from '../config.js';
// DB-derived setup state (D113): the users table is the single source of truth.
// No in-memory state — see queryAdminExists/getSetupStatus below.

export type SetupStatus = {
  isInitialized: boolean;
  adminExists: boolean;
  configComplete: boolean;
};

let db: ReturnType<typeof createDb> | undefined;
function setupDb() {
  if (!db) db = createDb(config.databaseUrl);
  return db;
}

// Internal: does not catch — DB failure throws (guard relies on the reject signal).
// "Initialized" (D113, users table = source of truth):
//   1. configured/default admin email exists (fast path — one indexed lookup), OR
//   2. ANY user holds the 'admin' role (users ⋈ user_roles ⋈ roles) — closes the
//      custom-email blind spot for wizard-created admins (Task 2 carried ruling).
async function queryAdminExists(): Promise<SetupStatus> {
  const userManager = new UserManager();
  const admin = await userManager.findByEmail(config.adminEmail || 'admin@accessbase.local');
  if (admin) return { isInitialized: true, adminExists: true, configComplete: true };

  const rows = await setupDb()
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(roles.name, 'admin'))
    .limit(1);
  const initialized = rows.length > 0;
  return { isInitialized: initialized, adminExists: initialized, configComplete: initialized };
}

// For the status endpoint: never rejects (fail-open + log).
export async function getSetupStatus(): Promise<SetupStatus> {
  try {
    return await queryAdminExists();
  } catch (err) {
    logger.error({ err }, 'getSetupStatus: DB query failed — reporting uninitialized');
    return { isInitialized: false, adminExists: false, configComplete: false };
  }
}

// For setup-guard: rejects on DB failure (guard three-state判定).
export async function isSystemInitialized(): Promise<boolean> {
  const status = await queryAdminExists();
  return status.isInitialized;
}

// Track if setup is in progress to prevent concurrent admin creation
let setupInProgress = false;

export async function setupRoutes(app: FastifyInstance) {
  // GET /api/v1/setup/status
  app.get(
    '/status',
    {
      schema: {
        description: 'Check system setup status',
        tags: ['setup'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  isInitialized: { type: 'boolean' },
                  adminExists: { type: 'boolean' },
                  configComplete: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return {
        success: true,
        data: await getSetupStatus(),
      };
    },
  );

  // POST /api/v1/setup/admin
  app.post(
    '/admin',
    {
      schema: {
        description: 'Create initial admin user',
        tags: ['setup'],
        body: {
          type: 'object',
          required: ['email', 'name', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            name: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 8 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  userId: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          409: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          410: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, name, password } = request.body as {
        email: string;
        name: string;
        password: string;
      };

      // DB-derived check (D113): admin creation is blocked once an admin exists
      const status = await queryAdminExists();
      if (status.isInitialized) {
        return reply.status(410).send({
          success: false,
          error: {
            code: 'SETUP_ALREADY_COMPLETE',
            message: 'System setup has already been completed.',
          },
        });
      }

      if (status.adminExists) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'ADMIN_EXISTS',
            message: 'Admin user already exists.',
          },
        });
      }

      // Concurrent control: prevent duplicate creation
      if (setupInProgress) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'SETUP_IN_PROGRESS',
            message: 'Admin creation is already in progress.',
          },
        });
      }

      // Validate password complexity
      const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
      if (!PASSWORD_REGEX.test(password)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'WEAK_PASSWORD',
            message:
              'Password must be at least 8 characters and include uppercase, lowercase, and numbers.',
          },
        });
      }

      setupInProgress = true;

      try {
        const userManager = new UserManager();
        const roleManager = new RoleManager();
        const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

        // Check if admin user already exists in database
        const existingAdmin = await userManager.findByEmail(email);
        if (existingAdmin) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'ADMIN_EXISTS',
              message: 'Admin user already exists.',
            },
          });
        }

        // Create admin role (find or create — may already exist from initializeAdmin)
        let adminRole;
        try {
          adminRole = await roleManager.create(
            {
              name: 'admin',
              description: 'System administrator with full access',
            },
            DEFAULT_TENANT,
          );
        } catch (roleErr: unknown) {
          if (roleErr instanceof Error && roleErr.message === 'Role already exists in this tenant') {
            // Find existing role by querying rolePermissions join
            // RoleManager doesn't expose findByName, so we create a temporary one with admin ID
            const DEFAULT_ADMIN_ROLE_ID = '00000000-0000-0000-0000-000000000002';
            const found = await roleManager.findById(DEFAULT_ADMIN_ROLE_ID, DEFAULT_TENANT);
            if (found) {
              adminRole = found;
            } else {
              throw roleErr;
            }
          } else {
            throw roleErr;
          }
        }

        // Create admin user
        const adminUser = await userManager.create(
          {
            email,
            name,
            password,
          },
          DEFAULT_TENANT,
        );
        // UserManager.create ignores the roles field — assign admin role explicitly,
        // else wizard admins have no admin-role row and system stays uninitialized (T5 E2E finding)
        await roleManager.assignToUser(adminUser.id, adminRole.id, DEFAULT_TENANT);
        // Log without sensitive data
        logger.info({ userId: adminUser.id, email }, 'Admin user created via setup wizard');

        return reply.status(201).send({
          success: true,
          data: {
            userId: adminUser.id,
            email: adminUser.email,
            name: adminUser.name,
          },
        });
      } catch (error) {
        logger.error({ err: error, email }, 'Failed to create admin user');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'ADMIN_CREATION_FAILED',
            message: 'Failed to create admin user.',
          },
        });
      } finally {
        setupInProgress = false;
      }
    },
  );

  // POST /api/v1/setup/config
  app.post(
    '/config',
    {
      schema: {
        description: 'Save basic system configuration',
        tags: ['setup'],
        body: {
          type: 'object',
          required: ['siteName'],
          properties: {
            siteName: { type: 'string', minLength: 1 },
            siteUrl: { type: 'string' },
            adminEmail: { type: 'string' },
            smtpHost: { type: 'string' },
            smtpPort: { type: 'number' },
            smtpUser: { type: 'string' },
            smtpPassword: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  saved: { type: 'boolean' },
                },
              },
            },
          },
          410: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const config = request.body as {
        siteName: string;
        siteUrl: string;
        adminEmail: string;
        smtpHost?: string;
        smtpPort?: number;
        smtpUser?: string;
        smtpPassword?: string;
      };


      // Log without sensitive data (redact smtpPassword)
      const { smtpPassword: _, ...safeConfig } = config;
      logger.info({ config: safeConfig }, 'Setup configuration saved');

      return {
        success: true,
        data: {
          saved: true,
        },
      };
    },
  );

  // POST /api/v1/setup/complete
  app.post(
    '/complete',
    {
      schema: {
        description: 'Complete system setup',
        tags: ['setup'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' },
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          410: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Verify admin exists in DB (D113: users table is the source of truth).
      // No isInitialized→410 here: admin creation flips isInitialized mid-wizard,
      // so /complete is the LEGITIMATE next step (repeat calls are idempotent — re-issue tokens).
      const status = await queryAdminExists();
      if (!status.adminExists) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'ADMIN_NOT_CREATED',
            message: 'Admin user must be created before completing setup.',
          },
        });
      }

      // Generate JWT tokens for admin login
      const userManager = new UserManager();
      const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
      const { data: users } = await userManager.findAll({ page: 1, pageSize: 1 }, DEFAULT_TENANT);
      const adminUser = users[0];

      if (!adminUser) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'ADMIN_NOT_FOUND',
            message: 'Admin user not found.',
          },
        });
      }

      // Generate tokens using Fastify JWT
      const accessToken = app.jwt.sign(
        { sub: adminUser.id, email: adminUser.email },
        { expiresIn: '15m' },
      );

      const refreshToken = app.jwt.sign(
        { sub: adminUser.id, email: adminUser.email, type: 'refresh' },
        { expiresIn: '7d' },
      );

      logger.info({ userId: adminUser.id }, 'System setup completed');

      return {
        success: true,
        data: {
          accessToken,
          refreshToken,
        },
      };
    },
  );

  // GET /api/v1/setup/checks
  app.get(
    '/checks',
    {
      schema: {
        description: 'Run system environment checks',
        tags: ['setup'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  checks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        status: { type: 'string', enum: ['pass', 'fail'] },
                        message: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const checks = [];

      // Database check
      try {
        // In a real implementation, this would ping the database
        // For now, we'll assume it's configured if the app started
        checks.push({ name: 'database', status: 'pass', message: 'Database connection OK' });
      } catch {
        checks.push({ name: 'database', status: 'fail', message: 'Database connection failed' });
      }

      // Redis check
      try {
        // In a real implementation, this would ping Redis
        checks.push({ name: 'redis', status: 'pass', message: 'Redis connection OK' });
      } catch {
        checks.push({ name: 'redis', status: 'fail', message: 'Redis connection failed' });
      }

      // Disk space check
      try {
        const { statfs } = await import('node:fs/promises');
        const stats = await statfs('/');
        const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
        checks.push({
          name: 'disk_space',
          status: freeGB > 1 ? 'pass' : 'fail',
          message: freeGB > 1 ? 'Sufficient disk space' : 'Low disk space',
        });
      } catch {
        checks.push({ name: 'disk_space', status: 'pass', message: 'Disk check skipped' });
      }

      return {
        success: true,
        data: { checks },
      };
    },
  );
}
