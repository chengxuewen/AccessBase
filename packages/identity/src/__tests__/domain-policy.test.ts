import { describe, it, expect } from 'vitest';
import { isEmailDomainAllowed, hasEmailAlias } from '../services/domain-policy.js';

// Semantics pinned VERBATIM from the retired PasswordProvider private methods
// (providers/PasswordProvider.ts:111 isDomainAllowed, :133 hasEmailAlias, R1-T9).

describe('isEmailDomainAllowed', () => {
  it('allows everything when both lists are empty (allow-all default)', () => {
    expect(isEmailDomainAllowed('a@any.corp', [], [])).toBe(true);
  });

  it('rejects when no domain part exists (malformed email)', () => {
    expect(isEmailDomainAllowed('no-at-sign', [], [])).toBe(false);
  });

  it('blocks exact domain match, wins over an allow-list that includes it', () => {
    // Blocked-check-first is the old precedence: block beats allow.
    expect(isEmailDomainAllowed('a@blocked.com', ['blocked.com'], ['blocked.com'])).toBe(false);
  });

  it('exact match only — subdomains are NOT implied (old === semantics, no suffix match)', () => {
    expect(isEmailDomainAllowed('a@evil.blocked.com', [], ['blocked.com'])).toBe(true);
    expect(isEmailDomainAllowed('a@sub.corp.io', ['corp.io'], [])).toBe(false);
  });

  it('allow-list restricts: listed pass, everything else rejected', () => {
    expect(isEmailDomainAllowed('a@ok.com', ['ok.com'], [])).toBe(true);
    expect(isEmailDomainAllowed('a@other.com', ['ok.com'], [])).toBe(false);
  });

  it('case-insensitive on both email domain and configured entries', () => {
    expect(isEmailDomainAllowed('a@OK.COM', ['Ok.Com'], [])).toBe(true);
    expect(isEmailDomainAllowed('a@Blocked.COM', [], ['BLOCKED.com'])).toBe(false);
  });

  it('multiple entries: any blocked hit rejects, any allowed hit passes', () => {
    expect(isEmailDomainAllowed('a@b2.com', [], ['b1.com', 'b2.com'])).toBe(false);
    expect(isEmailDomainAllowed('a@a2.com', ['a1.com', 'a2.com'], [])).toBe(true);
  });
});

describe('hasEmailAlias', () => {
  it('flags plus-pattern in the local part when blocking', () => {
    expect(hasEmailAlias('user+tag@gmail.com', true)).toBe(true);
  });

  it('never flags when the block flag is off (old gate: config.blockEmailAliases &&)', () => {
    expect(hasEmailAlias('user+tag@gmail.com', false)).toBe(false);
  });

  it('plain local part passes', () => {
    expect(hasEmailAlias('user@gmail.com', true)).toBe(false);
  });

  it('plus in the DOMAIN part is not an alias (local part only)', () => {
    expect(hasEmailAlias('user+a@gm+ail.com', true)).toBe(true);
    expect(hasEmailAlias('user@gm+ail.com', true)).toBe(false);
  });

  it('malformed address without local part does not crash', () => {
    expect(hasEmailAlias('@nolocal.com', true)).toBe(false);
  });
});
