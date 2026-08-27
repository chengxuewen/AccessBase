/**
 * Setup Guard Middleware
 * Blocks non-setup routes until setup is complete
 * Blocks setup write endpoints after setup is complete
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '@accessbase/logging';

// In-memory setup state (should match setup.ts)
// This is a simplified approach - production should use database
let setupComplete = false;

const ALLOWED_PATHS = [
  '/api/v1/setup/status',
  '/api/v1/setup/checks',
  '/health',
  '/docs',
  '/',           // Frontend entry point
  '/index.html',  // Direct index access
  '/assets/',     // Vite hashed assets (JS/CSS/images)
  '/favicon',     // Favicon
];

// Setup write paths that should be blocked after setup is complete
const SETUP_WRITE_PATHS = ['/api/v1/setup/admin', '/api/v1/setup/config', '/api/v1/setup/complete'];

export function setSetupComplete(value: boolean): void {
  setupComplete = value;
}

export async function setupGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.url;

  // Always allow access to allowed paths
  if (ALLOWED_PATHS.some((path) => url.startsWith(path))) {
    return;
  }

  // After setup complete, block setup write endpoints
  if (setupComplete && SETUP_WRITE_PATHS.some((path) => url.startsWith(path))) {
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
  if (!setupComplete && !url.startsWith('/api/v1/setup')) {
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
