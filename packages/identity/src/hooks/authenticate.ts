/**
 * Fastify Authentication Hook (SDD 3.3)
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '@accessbase/logging';
import type { TokenPayload } from '../types.js';

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/verify-email',
  '/api/v1/health',
];

/**
 * Check if route is public
 */
function isPublicRoute(url: string): boolean {
  return PUBLIC_ROUTES.some((route) => url.startsWith(route));
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Authentication hook - runs on every request
 */
export async function authenticateHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip public routes
  if (isPublicRoute(request.url)) {
    return;
  }

  // Extract Bearer token
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    logger.warn('Missing authorization token');
    reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_001',
        message: 'Missing authorization token',
      },
    });
    return;
  }

  try {
    // Get session manager from request context
    const sessionManager = request.server.identity?.sessionManager;
    if (!sessionManager) {
      logger.error('SessionManager not available');
      reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
      return;
    }

    // Verify JWT signature and expiration
    const payload = await sessionManager.verifyAccessToken(token);

    // Check token_version (RBAC invalidation)
    const userManager = request.server.identity?.userManager;
    if (userManager) {
      const user = await userManager.findById(payload.sub, payload.tenantId);
      if (user && user.tokenVersion !== payload.tokenVersion) {
        logger.warn(`Token version mismatch for user: ${payload.sub}`);
        reply.status(401).send({
          success: false,
          error: {
            code: 'AUTH_003',
            message: 'Token has been invalidated',
          },
        });
        return;
      }
    }

    // Inject user context into request
    (request as FastifyRequest & { user: TokenPayload }).user = payload;
    logger.debug(`Authenticated user: ${payload.sub}`);
  } catch (error) {
    logger.error({ err: error }, 'Authentication error');
    reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_002',
        message: 'Invalid or expired token',
      },
    });
  }
}
