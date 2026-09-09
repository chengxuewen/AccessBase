/**
 * getRequiredPermission route→permission mapping (pure function, no DB).
 * Guards the prefix-segment matching fix: /api/v1/users/<id> must resolve
 * to the resource-root key (users:read), not miss like the old exact-key lookup.
 */
import { describe, it, expect } from 'vitest';
import { getRequiredPermission } from '../hooks/authorize.js';

describe('getRequiredPermission (prefix matching)', () => {
  it('resolves nested user id to users:read on GET', () => {
    expect(getRequiredPermission('GET', '/api/v1/users/123')).toBe('users:read');
  });

  it('resolves DELETE on nested id to users:delete', () => {
    expect(getRequiredPermission('DELETE', '/api/v1/users/123')).toBe('users:delete');
  });

  it('strips query string before matching', () => {
    expect(getRequiredPermission('GET', '/api/v1/roles/11111111-1111-1111-1111-111111111111?page=2')).toBe('roles:read');
  });

  it('matches resource root exactly', () => {
    expect(getRequiredPermission('POST', '/api/v1/users')).toBe('users:write');
  });

  it('returns null for non-resource paths', () => {
    expect(getRequiredPermission('GET', '/api/v1/audit-logs')).toBeNull();
    expect(getRequiredPermission('GET', '/health/live')).toBeNull();
  });

  it('returns null for methods without a mapping', () => {
    expect(getRequiredPermission('HEAD', '/api/v1/users/123')).toBeNull();
  });

  it('PATCH on users resolves to users:write', () => {
    expect(getRequiredPermission('PATCH', '/api/v1/users/123/status')).toBe('users:write');
  });

  it('returns null for /users/me full-equality exemption (self-service)', () => {
    expect(getRequiredPermission('GET', '/api/v1/users/me')).toBeNull();
  });

  it('exemption does not leak to sub-segments: /users/me/<id> still resolves users:read', () => {
    expect(getRequiredPermission('GET', '/api/v1/users/me/123')).toBe('users:read');
  });
});
