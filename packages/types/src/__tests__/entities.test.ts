import { describe, test, expectTypeOf } from 'vitest';
import type { User, Role, Permission, Tenant, Session, AuditLog } from '../entities.js';
import type {
  ApiResponse,
  ApiError,
  ApiMetadata,
  PaginatedResponse,
  PaginatedRequest,
} from '../api.js';
import type {
  JwtPayload,
  AuthProviderType,
  AuthProviderConfig,
  AuthResult,
  OAuthProvider,
  MfaType,
  MfaConfig,
} from '../auth.js';
import * as entities from '../entities.js';
import * as api from '../api.js';
import * as auth from '../auth.js';

// ── Module exports ──────────────────────────────────────────────────────────

describe('entities module exports', () => {
  test('exports all entity types', () => {
    expectTypeOf(entities).toHaveProperty('User' as never);
    expectTypeOf(entities).toHaveProperty('Role' as never);
    expectTypeOf(entities).toHaveProperty('Permission' as never);
    expectTypeOf(entities).toHaveProperty('Tenant' as never);
    expectTypeOf(entities).toHaveProperty('Session' as never);
    expectTypeOf(entities).toHaveProperty('AuditLog' as never);
  });
});

describe('api module exports', () => {
  test('exports all api types', () => {
    expectTypeOf(api).toHaveProperty('ApiResponse' as never);
    expectTypeOf(api).toHaveProperty('ApiError' as never);
    expectTypeOf(api).toHaveProperty('ApiMetadata' as never);
    expectTypeOf(api).toHaveProperty('PaginatedResponse' as never);
    expectTypeOf(api).toHaveProperty('PaginatedRequest' as never);
  });
});

describe('auth module exports', () => {
  test('exports all auth types', () => {
    expectTypeOf(auth).toHaveProperty('JwtPayload' as never);
    expectTypeOf(auth).toHaveProperty('AuthProviderType' as never);
    expectTypeOf(auth).toHaveProperty('AuthProviderConfig' as never);
    expectTypeOf(auth).toHaveProperty('AuthResult' as never);
    expectTypeOf(auth).toHaveProperty('OAuthProvider' as never);
    expectTypeOf(auth).toHaveProperty('MfaType' as never);
    expectTypeOf(auth).toHaveProperty('MfaConfig' as never);
  });
});

// ── Entity type shapes ──────────────────────────────────────────────────────

describe('User type shape', () => {
  test('User has required fields of correct types', () => {
    const user: User = {
      id: 'u-1',
      email: 'test@example.com',
      name: 'Test User',
      isActive: true,
      tenantId: 't-1',
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expectTypeOf(user).toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf(user).toHaveProperty('email').toEqualTypeOf<string>();
    expectTypeOf(user).toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf(user).toHaveProperty('avatar').toEqualTypeOf<string | undefined>();
    expectTypeOf(user).toHaveProperty('isActive').toEqualTypeOf<boolean>();
    expectTypeOf(user).toHaveProperty('tenantId').toEqualTypeOf<string>();
    expectTypeOf(user).toHaveProperty('tokenVersion').toEqualTypeOf<number>();
    expectTypeOf(user).toHaveProperty('createdAt').toEqualTypeOf<Date>();
    expectTypeOf(user).toHaveProperty('updatedAt').toEqualTypeOf<Date>();
  });
});

describe('Role type shape', () => {
  test('Role has required fields of correct types', () => {
    const role: Role = {
      id: 'r-1',
      name: 'admin',
      permissions: [],
      tenantId: 't-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expectTypeOf(role).toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf(role).toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf(role).toHaveProperty('description').toEqualTypeOf<string | undefined>();
    expectTypeOf(role).toHaveProperty('permissions').toEqualTypeOf<Permission[]>();
    expectTypeOf(role).toHaveProperty('tenantId').toEqualTypeOf<string>();
  });
});

describe('Permission type shape', () => {
  test('Permission has required fields of correct types', () => {
    const perm: Permission = {
      id: 'p-1',
      resource: 'user',
      action: 'read',
      createdAt: new Date(),
    };
    expectTypeOf(perm).toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf(perm).toHaveProperty('resource').toEqualTypeOf<string>();
    expectTypeOf(perm).toHaveProperty('action').toEqualTypeOf<string>();
    expectTypeOf(perm).toHaveProperty('description').toEqualTypeOf<string | undefined>();
  });
});

describe('Tenant type shape', () => {
  test('Tenant has required fields of correct types', () => {
    const tenant: Tenant = {
      id: 't-1',
      name: 'ACME',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expectTypeOf(tenant).toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf(tenant).toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf(tenant).toHaveProperty('domain').toEqualTypeOf<string | undefined>();
    expectTypeOf(tenant).toHaveProperty('isActive').toEqualTypeOf<boolean>();
  });
});

describe('Session type shape', () => {
  test('Session has required fields of correct types', () => {
    const session: Session = {
      id: 's-1',
      userId: 'u-1',
      token: 'jwt-token',
      expiresAt: new Date(),
      createdAt: new Date(),
    };
    expectTypeOf(session).toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf(session).toHaveProperty('userId').toEqualTypeOf<string>();
    expectTypeOf(session).toHaveProperty('token').toEqualTypeOf<string>();
    expectTypeOf(session).toHaveProperty('expiresAt').toEqualTypeOf<Date>();
  });
});

describe('AuditLog type shape', () => {
  test('AuditLog has required fields of correct types', () => {
    const log: AuditLog = {
      id: 'al-1',
      userId: 'u-1',
      action: 'create',
      resource: 'user',
      createdAt: new Date(),
    };
    expectTypeOf(log).toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf(log).toHaveProperty('userId').toEqualTypeOf<string>();
    expectTypeOf(log).toHaveProperty('action').toEqualTypeOf<string>();
    expectTypeOf(log).toHaveProperty('resource').toEqualTypeOf<string>();
    expectTypeOf(log).toHaveProperty('resourceId').toEqualTypeOf<string | undefined>();
    expectTypeOf(log)
      .toHaveProperty('details')
      .toEqualTypeOf<Record<string, unknown> | undefined>();
    expectTypeOf(log).toHaveProperty('ipAddress').toEqualTypeOf<string | undefined>();
    expectTypeOf(log).toHaveProperty('userAgent').toEqualTypeOf<string | undefined>();
  });
});

// ── API type shapes ─────────────────────────────────────────────────────────

describe('ApiResponse type shape', () => {
  test('ApiResponse is generic and allows typed data', () => {
    const res: ApiResponse<string> = { success: true, data: 'ok' };
    expectTypeOf(res).toHaveProperty('success').toEqualTypeOf<boolean>();
    expectTypeOf(res).toHaveProperty('data').toEqualTypeOf<string | undefined>();
    expectTypeOf(res).toHaveProperty('error').toEqualTypeOf<ApiError | undefined>();
    expectTypeOf(res).toHaveProperty('metadata').toEqualTypeOf<ApiMetadata | undefined>();
  });
});

describe('PaginatedResponse type shape', () => {
  test('PaginatedResponse is generic with items array and metadata', () => {
    const page: PaginatedResponse<User> = {
      items: [],
      metadata: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    };
    expectTypeOf(page).toHaveProperty('items').toEqualTypeOf<User[]>();
    expectTypeOf(page).toHaveProperty('metadata').toEqualTypeOf<ApiMetadata>();
  });
});

describe('PaginatedRequest type shape', () => {
  test('PaginatedRequest has optional pagination fields', () => {
    const req: PaginatedRequest = {};
    expectTypeOf(req).toHaveProperty('page').toEqualTypeOf<number | undefined>();
    expectTypeOf(req).toHaveProperty('pageSize').toEqualTypeOf<number | undefined>();
    expectTypeOf(req).toHaveProperty('sortBy').toEqualTypeOf<string | undefined>();
    expectTypeOf(req).toHaveProperty('sortOrder').toEqualTypeOf<'asc' | 'desc' | undefined>();
  });
});

// ── Auth type shapes ────────────────────────────────────────────────────────

describe('JwtPayload type shape', () => {
  test('JwtPayload has all JWT standard and custom fields', () => {
    const payload: JwtPayload = {
      sub: 'u-1',
      email: 'test@example.com',
      tenantId: 't-1',
      roles: ['admin'],
      iat: Date.now(),
      exp: Date.now() + 3600,
    };
    expectTypeOf(payload).toHaveProperty('sub').toEqualTypeOf<string>();
    expectTypeOf(payload).toHaveProperty('email').toEqualTypeOf<string>();
    expectTypeOf(payload).toHaveProperty('tenantId').toEqualTypeOf<string>();
    expectTypeOf(payload).toHaveProperty('roles').toEqualTypeOf<string[]>();
    expectTypeOf(payload).toHaveProperty('iat').toEqualTypeOf<number>();
    expectTypeOf(payload).toHaveProperty('exp').toEqualTypeOf<number>();
  });
});

describe('AuthProviderType type', () => {
  test('AuthProviderType is a string union of 4 values', () => {
    const t: AuthProviderType = 'password';
    expect(t).toBe('password');
  });
});

describe('AuthResult type shape', () => {
  test('AuthResult allows success case with token', () => {
    const result: AuthResult = {
      success: true,
      user: { id: 'u-1', email: 'a@b.com', name: 'A' },
      token: 'jwt',
    };
    expectTypeOf(result).toHaveProperty('success').toEqualTypeOf<boolean>();
    expectTypeOf(result).toHaveProperty('token').toEqualTypeOf<string | undefined>();
    expectTypeOf(result).toHaveProperty('error').toEqualTypeOf<string | undefined>();
  });
});

describe('OAuthProvider type', () => {
  test('OAuthProvider is a string union of 6 values', () => {
    const p: OAuthProvider = 'github';
    expect(p).toBe('github');
  });
});

describe('MfaType type', () => {
  test('MfaType is a string union of 3 values', () => {
    const m: MfaType = 'totp';
    expect(m).toBe('totp');
  });
});

describe('MfaConfig type shape', () => {
  test('MfaConfig has required and optional fields', () => {
    const cfg: MfaConfig = { type: 'totp', enabled: true };
    expectTypeOf(cfg).toHaveProperty('type').toEqualTypeOf<MfaType>();
    expectTypeOf(cfg).toHaveProperty('enabled').toEqualTypeOf<boolean>();
    expectTypeOf(cfg).toHaveProperty('secret').toEqualTypeOf<string | undefined>();
    expectTypeOf(cfg).toHaveProperty('backupCodes').toEqualTypeOf<string[] | undefined>();
  });
});
