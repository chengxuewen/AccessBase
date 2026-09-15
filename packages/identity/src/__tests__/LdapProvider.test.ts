/**
 * LdapProvider tests - real implementation per SDD 2.1 (Batch D Task 2)
 * Mock model: ldapts bind FAILS BY THROWING (InvalidCredentialsError etc.);
 * search returns { searchEntries: [{ dn, ...flatAttrs }] } flat pojos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClientInstance = {
  bind: vi.fn(),
  search: vi.fn(),
  unbind: vi.fn(async () => undefined),
};

vi.mock('ldapts', () => ({
  Client: vi.fn(() => mockClientInstance),
}));

import { Client } from 'ldapts';
import { escapeLdapFilter, LdapProvider } from '../providers/LdapProvider.js';
import type { LdapConfig } from '../types.js';

function makeConfig(overrides: Partial<LdapConfig> = {}): LdapConfig {
  return {
    enabled: true,
    url: 'ldap://ldap.example.com:389',
    bindDN: 'cn=admin,dc=example,dc=com',
    bindPassword: 'admin-secret',
    searchBase: 'ou=people,dc=example,dc=com',
    searchFilter: '(uid={username})',
    attributeMapping: {
      uid: 'uid',
      mail: 'mail',
      cn: 'cn',
      department: 'department',
      sAMAccountName: 'sAMAccountName',
    },
    autoProvision: true,
    syncAttributes: true,
    encryptionScheme: 'sha',
    fallbackToLocal: false,
    ...overrides,
  };
}

const LDAP_ENTRY = {
  dn: 'uid=alice,ou=people,dc=example,dc=com',
  uid: 'alice',
  mail: 'alice@example.com',
  cn: 'Alice Anderson',
  department: 'Engineering',
  sAMAccountName: 'aanderson',
};

describe('escapeLdapFilter (RFC 4515)', () => {
  it('escapes backslash, asterisk, parens', () => {
    expect(escapeLdapFilter('a\\b*c(d)e')).toBe('a\\5cb\\2ac\\28d\\29e');
  });

  it('escapes NUL as \\00', () => {
    expect(escapeLdapFilter('a\0')).toBe('a\\00');
  });

  it('leaves safe strings untouched', () => {
    expect(escapeLdapFilter('alice')).toBe('alice');
  });

  it('neutralizes filter injection payload so it matches only literal uid', () => {
    // RED-first (R4): payload would otherwise widen the filter to match all users
    const payload = '*)(uid=*))(|uid=*';
    expect(escapeLdapFilter(payload)).toBe('\\2a\\29\\28uid=\\2a\\29\\29\\28|uid=\\2a');
  });
});

describe('LdapProvider.searchUser', () => {
  let provider: LdapProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LdapProvider(makeConfig());
  });

  it('binds admin, searches with escaped filter, returns dn + flat attributes', async () => {
    mockClientInstance.search.mockResolvedValueOnce({ searchEntries: [LDAP_ENTRY] });

    const result = await provider.searchUser('alice');

    expect(mockClientInstance.bind).toHaveBeenCalledWith(
      'cn=admin,dc=example,dc=com',
      'admin-secret',
    );
    expect(mockClientInstance.search).toHaveBeenCalledWith('ou=people,dc=example,dc=com', {
      scope: 'sub',
      filter: '(uid=alice)',
    });
    expect(mockClientInstance.unbind).toHaveBeenCalled();
    const { dn: _dn, ...rest } = LDAP_ENTRY;
    expect(result).toEqual({ dn: LDAP_ENTRY.dn, attributes: rest });
  });

  it('returns null on empty searchEntries', async () => {
    mockClientInstance.search.mockResolvedValueOnce({ searchEntries: [] });

    const result = await provider.searchUser('ghost');

    expect(result).toBeNull();
  });

  it('maps filter placeholder {username} through escapeLdapFilter', async () => {
    mockClientInstance.search.mockResolvedValueOnce({ searchEntries: [] });

    await provider.searchUser('ali*ce');

    expect(mockClientInstance.search).toHaveBeenCalledWith('ou=people,dc=example,dc=com', {
      scope: 'sub',
      filter: '(uid=ali\\2ace)',
    });
  });
});

describe('LdapProvider.bind', () => {
  let provider: LdapProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LdapProvider(makeConfig());
  });

  it('returns true when user bind resolves', async () => {
    mockClientInstance.bind.mockResolvedValueOnce(undefined);

    await expect(provider.bind('uid=alice,dc=example,dc=com', 'pw')).resolves.toBe(true);
    expect(mockClientInstance.bind).toHaveBeenCalledWith('uid=alice,dc=example,dc=com', 'pw');
    expect(mockClientInstance.unbind).toHaveBeenCalled();
  });

  it('returns false when user bind throws (InvalidCredentialsError model)', async () => {
    const err = new Error('Invalid credentials') as Error & { code?: string };
    err.code = '49';
    mockClientInstance.bind.mockRejectedValueOnce(err);

    await expect(provider.bind('uid=alice,dc=example,dc=com', 'wrong')).resolves.toBe(false);
  });
});

describe('LdapProvider.authenticate', () => {
  let provider: LdapProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LdapProvider(makeConfig());
  });

  it('happy chain: search 1 entry, user bind resolves, AuthResult carries User-shaped data', async () => {
    mockClientInstance.search.mockResolvedValueOnce({ searchEntries: [LDAP_ENTRY] });
    mockClientInstance.bind
      .mockResolvedValueOnce(undefined) // admin bind
      .mockResolvedValueOnce(undefined); // user bind

    const result = await provider.authenticate({ username: 'alice', password: 'pw' });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.user).toEqual({
      dn: LDAP_ENTRY.dn,
      uid: 'alice',
      mail: 'alice@example.com',
      email: 'alice@example.com',
      cn: 'Alice Anderson',
      name: 'Alice Anderson',
      department: 'Engineering',
      sAMAccountName: 'aanderson',
    });
  });

  it('user not found (empty searchEntries) fails with AUTH_064', async () => {
    mockClientInstance.search.mockResolvedValueOnce({ searchEntries: [] });

    const result = await provider.authenticate({ username: 'ghost', password: 'pw' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AUTH_064');
  });

  it('user bind throws fails with AUTH_064', async () => {
    mockClientInstance.search.mockResolvedValueOnce({ searchEntries: [LDAP_ENTRY] });
    mockClientInstance.bind
      .mockResolvedValueOnce(undefined) // admin bind OK
      .mockRejectedValueOnce(new Error('Invalid credentials')); // user bind fails

    const result = await provider.authenticate({ username: 'alice', password: 'wrong' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AUTH_064');
  });

  it('admin bind throws fails with AUTH_063', async () => {
    mockClientInstance.bind.mockRejectedValueOnce(new Error('connection refused'));

    const result = await provider.authenticate({ username: 'alice', password: 'pw' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AUTH_063');
  });

  it('attributeMapping applied: mail to email, cn to name via config', async () => {
    const entry = {
      dn: 'uid=bob,ou=people,dc=example,dc=com',
      uid: 'bob',
      mail: 'bob@corp.io',
      cn: 'Bob Brown',
      department: 'Ops',
    };
    mockClientInstance.search.mockResolvedValueOnce({ searchEntries: [entry] });
    mockClientInstance.bind.mockResolvedValue(undefined);

    const result = await provider.authenticate({ username: 'bob', password: 'pw' });

    expect(result.success).toBe(true);
    expect(result.user).toEqual({
      dn: entry.dn,
      uid: 'bob',
      mail: 'bob@corp.io',
      email: 'bob@corp.io',
      cn: 'Bob Brown',
      name: 'Bob Brown',
      department: 'Ops',
    });
  });

  it('missing credentials shape fails with AUTH_064 without touching LDAP', async () => {
    const result = await provider.authenticate({});

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AUTH_064');
    expect(mockClientInstance.bind).not.toHaveBeenCalled();
  });
});

describe('LdapProvider.syncAttributes', () => {
  let provider: LdapProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LdapProvider(makeConfig());
  });

  it('maps mail to email, displayName to name per R2 shape', async () => {
    const out = await provider.syncAttributes('user-123', {
      mail: 'carol@example.com',
      displayName: 'Carol Chen',
      department: 'Security',
    });

    expect(out).toEqual({ email: 'carol@example.com', name: 'Carol Chen' });
  });

  it('falls back to configured attributeMapping keys when displayName absent', async () => {
    const out = await provider.syncAttributes('user-123', {
      mail: 'dave@example.com',
      cn: 'Dave Diaz',
    });

    expect(out).toEqual({ email: 'dave@example.com', name: 'Dave Diaz' });
  });
});

describe('LdapProvider.autoProvision', () => {
  it('shapes LDAP attributes into a User-creatable payload (pure data-shaping, no UserManager - R3)', async () => {
    const provider = new LdapProvider(makeConfig());

    const payload = await provider.autoProvision({
      mail: 'erin@example.com',
      cn: 'Erin Evans',
      uid: 'erin',
      department: 'Platform',
    });

    expect(payload).toEqual({
      email: 'erin@example.com',
      name: 'Erin Evans',
      status: 'active',
      passwordHash: null,
    });
  });
});
