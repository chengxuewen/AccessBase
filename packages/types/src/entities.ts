/**
 * User entity
 */
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  /**
   * E.164 phone (Batch I, R1). Nullable + partial-unique (migration 0004);
   * global lookup key for SMS OTP login.
   */
  phone?: string | null;

  isActive: boolean;
  /** Raw account status; JWT status claim source for disabled-user enforcement (P0) */
  status?: 'active' | 'suspended' | 'pending';
  tenantId: string;
  tokenVersion: number;
  /** TOTP MFA enabled (Phase 6b) */
  totpEnabled?: boolean;
  /** Email ownership verified via the /auth/verify-email flow (Q1-b2, closes design A4). */
  emailVerified?: boolean;
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
  isSystem: boolean; // K-T2: built-in roles (admin) are immutable — UI locks them
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
