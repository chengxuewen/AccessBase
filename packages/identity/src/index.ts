/**
 * @accessbase/identity - Main entry point
 * Authentication and Authorization core package
 */

export * from './types.js';
export { AuthManager } from './managers/AuthManager.js';
export { UserManager } from './managers/UserManager.js';
export { RoleManager } from './managers/RoleManager.js';
export { PermissionManager } from './managers/PermissionManager.js';
export { SessionManager } from './managers/SessionManager.js';
export { MfaManager } from './managers/MfaManager.js';
export { PasswordProvider } from './providers/PasswordProvider.js';
export { OAuthProvider } from './providers/OAuthProvider.js';
export { WebAuthnProvider } from './providers/WebAuthnProvider.js';
export { LdapProvider } from './providers/LdapProvider.js';
export { authenticateHook } from './hooks/authenticate.js';
export { authorizeHook } from './hooks/authorize.js';

import { logger } from '@accessbase/logging';
import { AuthManager } from './managers/AuthManager.js';
import { UserManager } from './managers/UserManager.js';
import { RoleManager } from './managers/RoleManager.js';
import { PermissionManager } from './managers/PermissionManager.js';
import { SessionManager } from './managers/SessionManager.js';
import { MfaManager } from './managers/MfaManager.js';
import type { IdentityConfig } from './types.js';

/**
 * IdentityService - Main service class that aggregates all managers
 */
export class IdentityService {
  readonly authManager: AuthManager;
  readonly userManager: UserManager;
  readonly roleManager: RoleManager;
  readonly permissionManager: PermissionManager;
  readonly sessionManager: SessionManager;
  readonly mfaManager: MfaManager;

  constructor(config: IdentityConfig) {
    logger.info('Initializing IdentityService');

    this.authManager = new AuthManager();
    this.userManager = new UserManager();
    this.roleManager = new RoleManager();
    this.permissionManager = new PermissionManager();
    this.sessionManager = new SessionManager(config.auth.jwt);
    this.mfaManager = new MfaManager(config.auth.mfa);

    logger.info('IdentityService initialized successfully');
  }
}

// Default configurations
export const defaultIdentityConfig: IdentityConfig = {
  auth: {
    password: {
      enabled: true,
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
      requireEmailVerification: true,
      allowedDomains: [],
      blockedDomains: [],
      blockEmailAliases: true,
      bcryptRounds: 12,
      passwordHistoryCount: 5,
      lockoutThreshold: 5,
      lockoutDuration: 900,
    },
    jwt: {
      accessTokenTTL: 900, // 15 minutes
      refreshTokenTTL: 604800, // 7 days
      tokenRotation: true,
      privateKeyPath: process.env['JWT_PRIVATE_KEY_PATH'] || '',
      publicKeyPath: process.env['JWT_PUBLIC_KEY_PATH'] || '',
      issuer: 'accessbase',
    },
    mfa: {
      enabled: true,
      totp: {
        period: 30,
        digits: 6,
        algorithm: 'SHA1',
        window: 1,
      },
      trustedDevices: {
        enabled: true,
        trustWindowDays: 30,
        maxTrustedDevices: 10,
        requireMfaToTrust: true,
      },
      recoveryCodes: {
        count: 10,
        length: 8,
      },
    },
    oauth: {},
    webauthn: {
      enabled: false,
      rpName: 'AccessBase',
      rpId: 'localhost',
      origin: 'http://localhost:3000',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
      attestation: 'none',
    },
    ldap: {
      enabled: false,
      url: '',
      bindDN: '',
      bindPassword: '',
      searchBase: '',
      searchFilter: '',
      attributeMapping: {
        uid: 'userId',
        mail: 'email',
        cn: 'displayName',
        department: 'department',
      },
      autoProvision: true,
      syncAttributes: true,
      encryptionScheme: 'AES-256-GCM',
      fallbackToLocal: false,
    },
    rbacPropagation: {
      enabled: true,
      channel: 'rbac:invalidation',
      localCacheTTL: 300,
      batchSize: 1000,
    },
    sso: {
      session: {
        idleTimeout: 1800,
        absoluteTimeout: 28800,
        maxSessionsPerUser: 10,
        singleLogoutEnabled: true,
      },
    },
    rateLimit: {
      login: 10,
      register: 5,
      passwordReset: 3,
      mfaVerify: 5,
    },
  },
};
