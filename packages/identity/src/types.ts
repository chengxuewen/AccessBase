/**
 * @accessbase/identity - Authentication and Authorization Types
 * Based on SDD Section 2: Core Interfaces
 */

// Re-export shared types
import type { User, Role, Permission, Session } from '@accessbase/shared-types';
export type { User, Role, Permission, Session };

/**
 * Auth Provider Types (SDD 2.1)
 */
export type AuthProviderType = 'password' | 'oauth' | 'webauthn' | 'saml' | 'oidc';

export interface AuthProvider {
  /** Provider identifier (e.g., 'password', 'github', 'webauthn') */
  name: string;

  /** Provider type */
  type: AuthProviderType;

  /** Whether provider is enabled (config-driven) */
  enabled: boolean;

  /** Execute authentication */
  authenticate(credentials: unknown): Promise<AuthResult>;

  /** User registration (optional, OAuth providers may not need this) */
  register?(userData: unknown): Promise<AuthResult>;

  /** Token verification (optional) */
  verify?(token: string): Promise<VerifyResult>;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  accessToken?: string;
  refreshToken?: string;
  requiresMfa?: boolean;
  error?: AuthError;
}

export interface VerifyResult {
  valid: boolean;
  user?: User;
  error?: AuthError;
}

/**
 * Auth Error Types
 */
export interface AuthError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * User Management Types (SDD 2.2)
 */
export type UserStatus = 'active' | 'suspended' | 'pending';

export interface CreateUserInput {
  email: string;
  name: string;
  password?: string;          // OAuth users may not have password
  avatarUrl?: string;
  roles?: string[];           // Role ID list
  metadata?: Record<string, unknown>;
}

export interface UpdateUserInput {
  name?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface UserQueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;            // Search by email/name
  status?: UserStatus;
  roleId?: string;
}

/**
 * Role Management Types (SDD 2.3)
 */
export interface CreateRoleInput {
  name: string;
  description?: string;
  parentId?: string;          // Parent role ID (RBAC1 inheritance)
  permissionIds?: string[];   // Initial permission list
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissionIds?: string[];   // Full replacement of permission list
}

export interface RoleQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  parentId?: string;
}

/**
 * Permission Management Types (SDD 2.4)
 */
export interface CreatePermissionInput {
  name: string;
  resource: string;           // Resource identifier, e.g., 'users', 'roles', 'config'
  action: string;             // Action identifier, e.g., 'read', 'write', 'delete', 'manage'
  description?: string;
}

export interface UpdatePermissionInput {
  name?: string;
  description?: string;
}

export interface PermissionQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  resource?: string;
  action?: string;
}

/**
 * Session Management Types (SDD 2.5)
 */
export interface SessionTokens {
  accessToken: string;        // RS256 signed, 15 min expiry
  refreshToken: string;       // 7 day expiry, configurable
  expiresIn: number;          // Access token expiry seconds
}

export interface TokenPayload {
  sub: string;                // User ID
  email: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  tokenVersion: number;       // For RBAC invalidation check
  iat: number;
  exp: number;
}

export interface SessionContext {
  ipAddress: string;
  userAgent: string;
  deviceInfo?: DeviceInfo;
  tenantId: string;
}

export interface DeviceInfo {
  deviceName: string;
  deviceType: string;
  os: string;
  browser: string;
}

export interface SessionValidation {
  valid: boolean;
  reason?: 'session_not_found' | 'idle_timeout' | 'absolute_timeout' | 'sso_session_expired' | 'sso_idle_timeout';
}

export interface SSOSession {
  id: string;
  userId: string;
  identityProviderId: string;
  createdAt: Date;
  lastActivityAt: Date;
  idleTimeout: number;        // Default 1800s (30 min)
  absoluteTimeout: number;    // Default 28800s (8 hours)
  expiresAt: Date;
  status: 'active' | 'expired' | 'revoked';
}

export interface LocalSession {
  id: string;
  userId: string;
  ssoSessionId: string;       // Bound SSO session
  tenantId: string;
  createdAt: Date;
  lastActivityAt: Date;
  idleTimeout: number;
  absoluteTimeout: number;
  expiresAt: Date;            // ≤ SSO session expiry time
  status: 'active' | 'expired' | 'revoked';
}

/**
 * MFA Types (SDD 2.6)
 */
export interface MfaSetupResult {
  secret: string;             // TOTP secret (Base32)
  qrCodeUrl: string;          // otpauth:// URI
  recoveryCodes: string[];    // One-time recovery codes (8 chars, 10 total)
}

export interface MfaVerifyResult {
  success: boolean;
  remainingRecoveryCodes?: number;
  error?: AuthError;
}

export interface TrustedDevice {
  id: string;
  userId: string;
  deviceFingerprint: string;
  deviceName: string;
  trustGrantedAt: Date;
  trustExpiresAt: Date;       // Default 30 days
  lastUsedAt: Date;
  ipAddress: string;
  userAgent: string;
  revoked: boolean;
}

export interface DeviceMetadata {
  deviceName: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Configuration Types (SDD Section 6)
 */
export interface IdentityConfig {
  auth: {
    password: PasswordConfig;
    jwt: JwtConfig;
    mfa: MfaConfig;
    oauth: Record<string, OAuthProviderConfig>;
    webauthn: WebAuthnConfig;
    ldap: LdapConfig;
    rbacPropagation: RbacPropagationConfig;
    sso: SsoConfig;
    rateLimit: RateLimitConfig;
  };
}

export interface PasswordConfig {
  enabled: boolean;
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  requireEmailVerification: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
  blockEmailAliases: boolean;
  bcryptRounds: number;
  passwordHistoryCount: number;
  lockoutThreshold: number;
  lockoutDuration: number;
}

export interface JwtConfig {
  accessTokenTTL: number;
  refreshTokenTTL: number;
  tokenRotation: boolean;
  privateKeyPath: string;
  publicKeyPath: string;
  issuer: string;
}

export interface MfaConfig {
  enabled: boolean;
  totp: {
    period: number;
    digits: number;
    algorithm: 'SHA1' | 'SHA256' | 'SHA512';
    window: number;
  };
  trustedDevices: {
    enabled: boolean;
    trustWindowDays: number;
    maxTrustedDevices: number;
    requireMfaToTrust: boolean;
  };
  recoveryCodes: {
    count: number;
    length: number;
  };
}

export interface OAuthProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  callbackUrl: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
}

export interface WebAuthnConfig {
  enabled: boolean;
  rpName: string;
  rpId: string;
  origin: string;
  authenticatorSelection: {
    authenticatorAttachment: 'platform' | 'cross-platform';
    userVerification: 'required' | 'preferred' | 'discouraged';
    residentKey: 'required' | 'preferred' | 'discouraged';
  };
  attestation: 'none' | 'indirect' | 'direct';
}

export interface LdapConfig {
  enabled: boolean;
  url: string;
  bindDN: string;
  bindPassword: string;
  searchBase: string;
  searchFilter: string;
  attributeMapping: {
    uid: string;
    mail: string;
    cn: string;
    department: string;
    sAMAccountName?: string;
  };
  autoProvision: boolean;
  syncAttributes: boolean;
  encryptionScheme: string;
  fallbackToLocal: boolean;
}

export interface RbacPropagationConfig {
  enabled: boolean;
  channel: string;
  localCacheTTL: number;
  batchSize: number;
}

export interface SsoConfig {
  session: {
    idleTimeout: number;
    absoluteTimeout: number;
    maxSessionsPerUser: number;
    singleLogoutEnabled: boolean;
    tenantOverrides?: Record<string, {
      idleTimeout?: number;
      absoluteTimeout?: number;
    }>;
  };
}

export interface RateLimitConfig {
  login: number;
  register: number;
  passwordReset: number;
  mfaVerify: number;
}

/**
 * Pagination Types
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Provider Public Config (for frontend)
 */
export interface ProviderPublicConfig {
  name: string;
  type: AuthProviderType;
  enabled: boolean;
  clientId?: string;
  scopes?: string[];
}