/**
 * JWT payload
 */
export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  roles: string[];
  iat: number;
  exp: number;
}

/**
 * Auth provider type
 */
export type AuthProviderType = 'password' | 'oauth' | 'webauthn' | 'ldap';

/**
 * Auth provider config
 */
export interface AuthProviderConfig {
  name: string;
  type: AuthProviderType;
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Auth result
 */
export interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  token?: string;
  refreshToken?: string;
  error?: string;
}

/**
 * OAuth provider types
 */
export type OAuthProvider = 'github' | 'discord' | 'oidc' | 'telegram' | 'linuxdo' | 'wechat';

/**
 * MFA type
 */
export type MfaType = 'totp' | 'sms' | 'email';

/**
 * MFA config
 */
export interface MfaConfig {
  type: MfaType;
  enabled: boolean;
  secret?: string;
  backupCodes?: string[];
}
