import { describe, it, expect } from 'vitest';
import { safeOidcRedirect } from '../oidc';

/** Q3B: the login-redirect allow-list must accept device-flow resume targets
 * (/oidc/device/:uid) exactly like auth ones, and keep rejecting traversal. */
describe('safeOidcRedirect (Q3B device branch)', () => {
  it('accepts /oidc/auth and /oidc/device resume paths', () => {
    expect(safeOidcRedirect('/oidc/auth/abc123')).toBe('/oidc/auth/abc123');
    expect(safeOidcRedirect('/oidc/device/abc123')).toBe('/oidc/device/abc123');
    expect(safeOidcRedirect(encodeURIComponent('/oidc/device/x1'))).toBe('/oidc/device/x1');
  });
  it('rejects off-list, backslash and double-encoded shapes', () => {
    expect(safeOidcRedirect('/oidc/admin/evil')).toBeUndefined();
    expect(safeOidcRedirect('/login')).toBeUndefined();
    expect(safeOidcRedirect('https://evil.example/oidc/auth/x')).toBeUndefined();
    expect(safeOidcRedirect('/oidc%5Cauth/x')).toBeUndefined();
    expect(safeOidcRedirect('%2F%2Fevil/oidc/auth/x')).toBeUndefined();
    expect(safeOidcRedirect(null)).toBeUndefined();
  });
});
