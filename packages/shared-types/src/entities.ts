/**
 * User entity
 */
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  isActive: boolean;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role entity
 */
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: Permission[];
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Permission entity
 */
export interface Permission {
  id: string;
  resource: string;
  action: string;
  description?: string;
  createdAt: Date;
}

/**
 * Tenant entity
 */
export interface Tenant {
  id: string;
  name: string;
  domain?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session entity
 */
export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Audit log entity
 */
export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
