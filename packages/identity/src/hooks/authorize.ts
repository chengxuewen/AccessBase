/**
 * Fastify Authorization Hook (SDD 3.3)
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '@accessbase/logging';

// Public routes that don't require authorization
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
 * Get required permission for route
 */
function getRequiredPermission(method: string, url: string): string | null {
  // Map HTTP methods and routes to required permissions
  // This should be configurable or derived from route metadata
  const routePermissions: Record<string, string> = {
    'GET:/api/v1/users': 'users:read',
    'POST:/api/v1/users': 'users:write',
    'PUT:/api/v1/users': 'users:write',
    'DELETE:/api/v1/users': 'users:delete',
    'GET:/api/v1/roles': 'roles:read',
    'POST:/api/v1/roles': 'roles:write',
    'PUT:/api/v1/roles': 'roles:write',
    'DELETE:/api/v1/roles': 'roles:delete',
    'GET:/api/v1/permissions': 'permissions:read',
    'POST:/api/v1/permissions': 'permissions:write',
    'PUT:/api/v1/permissions': 'permissions:write',
    'DELETE:/api/v1/permissions': 'permissions:delete',
  };

  const key = `${method}:${url.split('?')[0]}`;
  return routePermissions[key] || null;
}

/**
 * Authorization hook - runs before route handler
 */
export async function authorizeHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Skip public routes
  if (isPublicRoute(request.url)) {
    return;
  }

  // Get user from request (set by authenticateHook)
  const user = (request as FastifyRequest & { user?: { sub: string; tenantId: string } }).user;
  if (!user) {
    logger.warn('No user context found in authorization hook');
    reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_001',
        message: 'Authentication required',
      },
    });
    return;
  }

  // Get required permission for this route
  const requiredPermission = getRequiredPermission(request.method, request.url);
  if (!requiredPermission) {
    // No permission required for this route
    return;
  }

  try {
    // Get permission manager from request context
    const permissionManager = request.server.identity?.permissionManager;
    if (!permissionManager) {
      logger.error('PermissionManager not available');
      reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
      return;
    }

    // Check if user has required permission
    const hasPermission = await permissionManager.hasPermission(
      user.sub,
      requiredPermission,
      user.tenantId,
    );

    if (!hasPermission) {
      logger.warn(`User ${user.sub} lacks permission: ${requiredPermission}`);
      reply.status(403).send({
        success: false,
        error: {
          code: 'AUTH_007',
          message: 'Insufficient permissions',
        },
      });
      return;
    }

    logger.debug(`Authorized user ${user.sub} for permission: ${requiredPermission}`);
  } catch (error) {
    logger.error({ err: error }, 'Authorization error');
    reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  }
}
