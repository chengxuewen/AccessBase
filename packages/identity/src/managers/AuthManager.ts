/**
 * AuthManager - Manages authentication providers (SDD 2.1)
 */
import { logger } from '@accessbase/logging';
import type { AuthProvider, AuthResult, ProviderPublicConfig, AuthProviderType } from '../types.js';

export class AuthManager {
  private providers = new Map<string, AuthProvider>();

  /**
   * Register an authentication provider
   */
  register(provider: AuthProvider): void {
    if (this.providers.has(provider.name)) {
      logger.warn(`Provider ${provider.name} already registered, overwriting`);
    }
    this.providers.set(provider.name, provider);
    logger.info(`Registered auth provider: ${provider.name} (${provider.type})`);
  }

  /**
   * Get all enabled providers
   */
  getEnabledProviders(): AuthProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.enabled);
  }

  /**
   * Get provider by name
   */
  getProvider(name: string): AuthProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Authenticate using specified provider
   */
  async authenticate(providerName: string, credentials: unknown): Promise<AuthResult> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      logger.error(`Auth provider not found: ${providerName}`);
      return {
        success: false,
        error: {
          code: 'AUTH_PROVIDER_NOT_FOUND',
          message: `Authentication provider '${providerName}' not found`,
        },
      };
    }

    if (!provider.enabled) {
      logger.warn(`Attempt to use disabled provider: ${providerName}`);
      return {
        success: false,
        error: {
          code: 'AUTH_PROVIDER_DISABLED',
          message: `Authentication provider '${providerName}' is disabled`,
        },
      };
    }

    try {
      logger.debug(`Authenticating with provider: ${providerName}`);
      const result = await provider.authenticate(credentials);
      if (result.success) {
        logger.info(`Authentication successful for provider: ${providerName}`);
      } else {
        logger.warn(`Authentication failed for provider: ${providerName}`);
      }
      return result;
    } catch (error) {
      logger.error({ err: error }, `Authentication error for provider ${providerName}`);
      return {
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication failed due to internal error',
        },
      };
    }
  }

  /**
   * Get public provider configs (desensitized) for frontend
   */
  getPublicProviderConfigs(): ProviderPublicConfig[] {
    return this.getEnabledProviders().map((provider) => ({
      name: provider.name,
      type: provider.type as AuthProviderType,
      enabled: provider.enabled,
    }));
  }
}
