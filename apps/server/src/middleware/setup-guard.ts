/**
 * Setup Guard Middleware
 * Blocks non-setup routes until setup is complete
 * Blocks setup write endpoints after setup is complete
 *
 * D113: setup state is derived from the users table on every request
 * (DB is the single source of truth — no in-memory flag).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '@accessbase/logging';
import { isSystemInitialized } from '../routes/setup.js';

const ALLOWED_PATHS = [
  '/api/v1/setup/status',
  '/api/v1/setup/checks',
  '/health',
  '/docs',
  '/',           // Frontend entry point (exact match only)
  '/index.html', // Direct index access
  '/assets/',    // Vite hashed assets (JS/CSS/images)
  '/favicon',    // Favicon
];

// Only /admin is guard-blocked once initialized. /config and /complete are legal
// writes DURING the wizard (admin exists ⇒ isInitialized true mid-wizard), and both
// handlers re-check state via queryAdminExists → 410 themselves (defense in depth).
const SETUP_WRITE_PATHS = ['/api/v1/setup/admin'];

export async function setupGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.url;

  // Always allow access to allowed paths
  if (ALLOWED_PATHS.some((path) => (path === '/' ? url === '/' : url.startsWith(path)))) {
    return;
  }

  let initialized: boolean;
  try {
    initialized = await isSystemInitialized();
  } catch (err) {
    // DB unreachable → fail closed (503), distinct from SETUP_REQUIRED (403)
    logger.error({ err, url }, 'Setup state unavailable (DB error) — failing closed');
    return reply.status(503).send({
      success: false,
      error: {
        code: 'SETUP_STATE_UNAVAILABLE',
        message: 'Setup state cannot be determined.',
      },
    });
  }

  // After setup complete, block setup write endpoints
  if (initialized && SETUP_WRITE_PATHS.some((path) => url.startsWith(path))) {
    logger.warn({ url }, 'Setup write endpoint blocked after setup completion');
    return reply.status(410).send({
      success: false,
      error: {
        code: 'SETUP_ALREADY_COMPLETE',
        message: 'System setup has already been completed.',
      },
    });
  }

  // Before setup complete, block non-setup routes
  if (!initialized && !url.startsWith('/api/v1/setup')) {
    logger.warn({ url }, 'Setup not complete, blocking request');
    return reply.status(403).send({
      success: false,
      error: {
        code: 'SETUP_REQUIRED',
        message: 'System setup is not complete. Please complete setup first.',
      },
    });
  }
}
