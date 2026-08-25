import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthProvider, AuthResult, User } from '../types.js';

// Mock @accessbase/logging before importing AuthManager
vi.mock('@accessbase/logging', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AuthManager } from '../managers/AuthManager.js';
import { logger } from '@accessbase/logging';

const mockLogger = vi.mocked(logger);

function createMockProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    name: 'test-provider',
    type: 'password',
    enabled: true,
    authenticate: vi.fn(),
    ...overrides,
  };
}

function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    isActive: true,
    tenantId: 'tenant-1',
    tokenVersion: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('AuthManager', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    authManager = new AuthManager();
  });

  describe('register', () => {
    it('should register a provider', () => {
      const provider = createMockProvider({ name: 'password' });

      authManager.register(provider);

      expect(authManager.getProvider('password')).toBe(provider);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('password'));
    });

    it('should warn when overwriting an existing provider', () => {
      const provider1 = createMockProvider({ name: 'password' });
      const provider2 = createMockProvider({ name: 'password' });

      authManager.register(provider1);
      authManager.register(provider2);

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('already registered'));
      expect(authManager.getProvider('password')).toBe(provider2);
    });

    it('should register multiple distinct providers', () => {
      const passwordProvider = createMockProvider({ name: 'password', type: 'password' });
      const oauthProvider = createMockProvider({ name: 'github', type: 'oauth' });

      authManager.register(passwordProvider);
      authManager.register(oauthProvider);

      expect(authManager.getProvider('password')).toBe(passwordProvider);
      expect(authManager.getProvider('github')).toBe(oauthProvider);
    });
  });

  describe('getEnabledProviders', () => {
    it('should return only enabled providers', () => {
      authManager.register(createMockProvider({ name: 'a', enabled: true }));
      authManager.register(createMockProvider({ name: 'b', enabled: false }));
      authManager.register(createMockProvider({ name: 'c', enabled: true }));

      const enabled = authManager.getEnabledProviders();

      expect(enabled).toHaveLength(2);
      expect(enabled.map((p) => p.name)).toEqual(['a', 'c']);
    });

    it('should return empty array when no providers are registered', () => {
      expect(authManager.getEnabledProviders()).toEqual([]);
    });
  });

  describe('getProvider', () => {
    it('should return provider by name', () => {
      const provider = createMockProvider({ name: 'ldap' });
      authManager.register(provider);

      expect(authManager.getProvider('ldap')).toBe(provider);
    });

    it('should return undefined for unknown provider', () => {
      expect(authManager.getProvider('nonexistent')).toBeUndefined();
    });
  });

  describe('authenticate', () => {
    it('should return success result from provider', async () => {
      const user = createMockUser();
      const provider = createMockProvider({ name: 'password' });
      vi.mocked(provider.authenticate).mockResolvedValue({
        success: true,
        user,
        accessToken: 'token-123',
      });
      authManager.register(provider);

      const result = await authManager.authenticate('password', {
        email: 'test@example.com',
        password: 'pass',
      });

      expect(result.success).toBe(true);
      expect(result.user).toBe(user);
      expect(result.accessToken).toBe('token-123');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('successful'));
    });

    it('should return AUTH_PROVIDER_NOT_FOUND for unknown provider', async () => {
      const result = await authManager.authenticate('nonexistent', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AUTH_PROVIDER_NOT_FOUND');
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    });

    it('should return AUTH_PROVIDER_DISABLED for disabled provider', async () => {
      const provider = createMockProvider({ name: 'oauth', enabled: false });
      authManager.register(provider);

      const result = await authManager.authenticate('oauth', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AUTH_PROVIDER_DISABLED');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    });

    it('should return failure result when provider authentication fails', async () => {
      const provider = createMockProvider({ name: 'password' });
      vi.mocked(provider.authenticate).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Bad credentials' },
      });
      authManager.register(provider);

      const result = await authManager.authenticate('password', { password: 'wrong' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CREDENTIALS');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });

    it('should return AUTH_ERROR when provider throws an exception', async () => {
      const provider = createMockProvider({ name: 'password' });
      vi.mocked(provider.authenticate).mockRejectedValue(new Error('DB connection lost'));
      authManager.register(provider);

      const result = await authManager.authenticate('password', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AUTH_ERROR');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getPublicProviderConfigs', () => {
    it('should return desensitized configs for enabled providers', () => {
      authManager.register(
        createMockProvider({ name: 'password', type: 'password', enabled: true }),
      );
      authManager.register(createMockProvider({ name: 'github', type: 'oauth', enabled: true }));
      authManager.register(
        createMockProvider({ name: 'disabled', type: 'webauthn', enabled: false }),
      );

      const configs = authManager.getPublicProviderConfigs();

      expect(configs).toHaveLength(2);
      expect(configs[0]).toEqual({ name: 'password', type: 'password', enabled: true });
      expect(configs[1]).toEqual({ name: 'github', type: 'oauth', enabled: true });
    });

    it('should return empty array when no enabled providers exist', () => {
      expect(authManager.getPublicProviderConfigs()).toEqual([]);
    });
  });
});
