import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuditLogger } from './logger.js';
import type { AuditAction, AuditLogEntry } from './types.js';

/**
 * Map HTTP method to audit action
 */
function mapMethodToAction(method: string): AuditAction {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'UPDATE';
  }
}

/**
 * Extract resource type from URL
 */
function extractResourceType(url: string): string {
  // Extract resource type from URL pattern like /api/users/:id
  const parts = url.split('/').filter(Boolean);

  // Skip 'api' prefix if present
  const startIndex = parts[0] === 'api' ? 1 : 0;

  if (parts.length > startIndex) {
    return parts[startIndex] || 'unknown';
  }

  return 'unknown';
}

/**
 * Extract resource ID from request params
 */
function extractResourceId(request: FastifyRequest): string {
  const params = request.params as Record<string, string>;
  return params['id'] || 'unknown';
}

/**
 * Create audit middleware for Fastify
 */
export function createAuditMiddleware(auditLogger: AuditLogger) {
  return async function auditMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Only audit write operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      return;
    }

    // Skip health check and other non-auditable endpoints
    if (request.url.startsWith('/health') || request.url.startsWith('/metrics')) {
      return;
    }

    const startTime = Date.now();

    // Store original reply.send to capture response
    const originalSend = reply.send;
    let responseBody: Record<string, unknown> | undefined;

    reply.send = function (payload: unknown) {
      if (payload && typeof payload === 'object') {
        responseBody = payload as Record<string, unknown>;
      }
      return originalSend.call(this, payload);
    };

    // Continue with request processing
    reply.raw.on('finish', async () => {
      const duration = Date.now() - startTime;

      const user = (request as any).user;
      const tenantId = (request as any).tenantId;

      const entry: AuditLogEntry = {
        userId: user?.id || 'anonymous',
        username: user?.username || 'anonymous',
        userIp: request.ip,
        userAgent: request.headers['user-agent'] || 'unknown',
        action: mapMethodToAction(request.method),
        resourceType: extractResourceType(request.url),
        resourceId: extractResourceId(request),
        requestBody: (request.body as Record<string, unknown>) || {},
        responseBody,
        timestamp: new Date(),
        tenantId: tenantId || 'system',
        requestId: request.id,
        responseStatus: reply.statusCode,
        success: reply.statusCode < 400,
        errorMessage:
          reply.statusCode >= 400 ? (responseBody as any)?.message || 'Request failed' : undefined,
      };

      try {
        await auditLogger.log(entry);
      } catch (error) {
        // Don't let audit logging failures affect the request
        request.log.error({ err: error }, 'Failed to write audit log');
      }
    });
  };
}

/**
 * Audit auth events (login/logout)
 */
export function auditAuthEvent(
  auditLogger: AuditLogger,
  request: FastifyRequest,
  event: 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED',
  user?: { id: string; username: string; tenantId: string },
): void {
  const entry: AuditLogEntry = {
    userId: user?.id || 'anonymous',
    username: user?.username || (request.body as any)?.email || 'anonymous',
    userIp: request.ip,
    userAgent: request.headers['user-agent'] || 'unknown',
    action: event,
    resourceType: 'auth',
    resourceId: user?.id || 'unknown',
    requestBody: { email: (request.body as any)?.email },
    timestamp: new Date(),
    tenantId: user?.tenantId || 'system',
    requestId: request.id,
    success: event !== 'LOGIN_FAILED',
  };

  auditLogger.log(entry).catch((error) => {
    request.log.error({ err: error }, 'Failed to write auth audit log');
  });
}

/**
 * Audit config changes
 */
export function auditConfigChange(
  auditLogger: AuditLogger,
  request: FastifyRequest,
  configKey: string,
  oldValue: unknown,
  newValue: unknown,
): void {
  const user = (request as any).user;
  const tenantId = (request as any).tenantId;

  const entry: AuditLogEntry = {
    userId: user?.id || 'system',
    username: user?.username || 'system',
    userIp: request.ip,
    userAgent: request.headers['user-agent'] || 'unknown',
    action: 'UPDATE',
    resourceType: 'config',
    resourceId: configKey,
    requestBody: { key: configKey, oldValue, newValue },
    timestamp: new Date(),
    tenantId: tenantId || 'system',
    requestId: request.id,
    success: true,
  };

  auditLogger.log(entry).catch((error) => {
    request.log.error({ err: error }, 'Failed to write config audit log');
  });
}
