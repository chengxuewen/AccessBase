/**
 * Fastify plugin for @accessbase/identity (SDD 3.1)
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { logger } from '@accessbase/logging';
import { IdentityService, defaultIdentityConfig } from './index.js';
import { PasswordProvider } from './providers/PasswordProvider.js';
import { OAuthProvider } from './providers/OAuthProvider.js';
import { WebAuthnProvider } from './providers/WebAuthnProvider.js';
import { LdapProvider } from './providers/LdapProvider.js';
import { authenticateHook } from './hooks/authenticate.js';
import { authorizeHook } from './hooks/authorize.js';
import type { IdentityConfig } from './types.js';

/**
 * Identity plugin options
 */
export interface IdentityPluginOptions {
  config?: IdentityConfig;
}

// Type augmentation is handled by @fastify/jwt
// Use fastify.jwt.verify() to get user payload

/**
 * Identity Fastify plugin
 */
const identityPlugin: FastifyPluginAsync<IdentityPluginOptions> = async (fastify, opts) => {
  logger.info('Registering identity plugin');

  // Phase 1: Dependency injection
  const config = opts.config || defaultIdentityConfig;
  const identityService = new IdentityService(config);

  // Phase 2: Register providers based on config
  if (config.auth.password.enabled) {
    identityService.authManager.register(new PasswordProvider(config.auth.password));
  }

  // Register OAuth providers
  for (const [providerName, providerConfig] of Object.entries(config.auth.oauth)) {
    if (providerConfig.enabled) {
      identityService.authManager.register(new OAuthProvider(providerConfig, providerName));
    }
  }

  if (config.auth.webauthn.enabled) {
    identityService.authManager.register(new WebAuthnProvider(config.auth.webauthn));
  }

  if (config.auth.ldap.enabled) {
    identityService.authManager.register(new LdapProvider(config.auth.ldap));
  }

  // Phase 3: Decorator injection
  fastify.decorate('identity', identityService);

  // Phase 4: Request hooks
  fastify.addHook('onRequest', authenticateHook);
  fastify.addHook('preHandler', authorizeHook);

  // Phase 5: Route registration (example routes)
  // These would be defined in separate route files
  // fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  // fastify.register(userRoutes, { prefix: '/api/v1/users' });
  // fastify.register(roleRoutes, { prefix: '/api/v1/roles' });
  // fastify.register(permissionRoutes, { prefix: '/api/v1/permissions' });

  logger.info('Identity plugin registered successfully');
};

export default fp(identityPlugin);
