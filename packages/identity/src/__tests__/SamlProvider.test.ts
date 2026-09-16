/**
 * SamlProvider tests (Batch F Task 1)
 *
 * Mock model mirrors LdapProvider.test.ts vi.mock style: '@node-saml/node-saml'
 * is mocked with a factory returning { SAML: vi.fn().mockImplementation(...),
 * generateServiceProviderMetadata: vi.fn(...) }. The FIRST test is the R11
 * smoke: it bypasses the mock via vi.doUnmock + dynamic import to prove the
 * REAL package (CJS named-export interop) resolves under our moduleResolution.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSamlInstance = {
  // Real signatures (lib/saml.d.ts): getAuthorizeUrlAsync(RelayState, host, options);
  // validatePostResponseAsync(container) → { profile: Profile | null, loggedOut: boolean }.
  getAuthorizeUrlAsync: vi.fn(),
  validatePostResponseAsync: vi.fn(async () => ({
    profile: null as null | Record<string, unknown>,
    loggedOut: false,
  })),
};

const MockSAMLClass = vi.fn().mockImplementation(() => mockSamlInstance);
const mockGenerateMetadata = vi.fn();

vi.mock('@node-saml/node-saml', () => ({
  SAML: MockSAMLClass,
  generateServiceProviderMetadata: mockGenerateMetadata,
}));

import { SamlProvider } from '../providers/SamlProvider.js';
import type { SamlProviderConfig } from '../providers/SamlProvider.js';

function makeConfig(overrides: Partial<SamlProviderConfig> = {}): SamlProviderConfig {
  return {
    enabled: true,
    entryPoint: 'https://idp.example.com/sso/saml',
    idpCert: 'MIICfakeidpcert',
    entityId: 'https://sp.example.com/metadata',
    callbackUrl: 'https://sp.example.com/auth/saml/callback',
    ...overrides,
  };
}

describe('R11 smoke: real @node-saml/node-saml named import resolves', () => {
  it('imports the real package (not mocked) and SAML is a function', async () => {
    vi.resetModules();
    vi.doUnmock('@node-saml/node-saml');
    try {
      const mod = (await import('@node-saml/node-saml')) as { SAML: unknown };
      expect(typeof mod.SAML).toBe('function');
    } finally {
      // Restore the mock for subsequent tests in this file.
      vi.doMock('@node-saml/node-saml', () => ({
        SAML: MockSAMLClass,
        generateServiceProviderMetadata: mockGenerateMetadata,
      }));
    }
  });
});

describe('SamlProvider.loginUrl', () => {
  let provider: SamlProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SamlProvider(makeConfig());
  });

  it('calls getAuthorizeUrlAsync and returns the redirect URL', async () => {
    mockSamlInstance.getAuthorizeUrlAsync.mockResolvedValueOnce(
      'https://idp.example.com/sso/saml?SAMLRequest=xyz',
    );

    const url = await provider.loginUrl('relay-123');

    expect(mockSamlInstance.getAuthorizeUrlAsync).toHaveBeenCalledTimes(1);
    expect(url).toBe('https://idp.example.com/sso/saml?SAMLRequest=xyz');
  });

  it('forwards relayState positionally (real signature: getAuthorizeUrlAsync(RelayState, host, options))', async () => {
    mockSamlInstance.getAuthorizeUrlAsync.mockResolvedValueOnce('https://idp.example.com/redirect');

    await provider.loginUrl('relay-abc');

    const call = mockSamlInstance.getAuthorizeUrlAsync.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0]).toBe('relay-abc');
  });
});

describe('SamlProvider.validateResponse', () => {
  let provider: SamlProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SamlProvider(makeConfig());
  });

  it('happy path: profile.email present returns email/nameId', async () => {
    mockSamlInstance.validatePostResponseAsync.mockResolvedValueOnce({
      profile: {
        email: 'alice@example.com',
        nameID: 'alice@example.com',
        nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      },
      loggedOut: false,
    });

    const result = await provider.validateResponse({ SAMLResponse: 'b64blob' });

    expect(result).toEqual({
      email: 'alice@example.com',
      nameId: 'alice@example.com',
    });
    expect(mockSamlInstance.validatePostResponseAsync).toHaveBeenCalledWith({
      SAMLResponse: 'b64blob',
    });
  });

  it('falls back to nameID when email absent', async () => {
    mockSamlInstance.validatePostResponseAsync.mockResolvedValueOnce({
      profile: { nameID: 'fallback-user' },
      loggedOut: false,
    });

    const result = await provider.validateResponse({ SAMLResponse: 'b64blob' });

    expect(result).toEqual({ email: 'fallback-user', nameId: 'fallback-user' });
  });

  it('extracts displayName from the profile index signature when present', async () => {
    mockSamlInstance.validatePostResponseAsync.mockResolvedValueOnce({
      profile: { email: 'bob@example.com', nameID: 'bob', displayName: 'Bob Brown' },
      loggedOut: false,
    });

    const result = await provider.validateResponse({ SAMLResponse: 'b64blob' });

    expect(result).toEqual({
      email: 'bob@example.com',
      nameId: 'bob',
      displayName: 'Bob Brown',
    });
  });

  it('returns { error: AUTH_SAML_002 } with generic message on null profile (never throws)', async () => {
    mockSamlInstance.validatePostResponseAsync.mockResolvedValueOnce(null);

    const result = await provider.validateResponse({ SAMLResponse: 'b64blob' });

    expect(result).toEqual({ error: 'AUTH_SAML_002', message: 'SAML sign-in failed' });
  });

  it('returns { error: AUTH_SAML_002 } when validation throws (never throws)', async () => {
    mockSamlInstance.validatePostResponseAsync.mockRejectedValueOnce(new Error('bad signature'));

    const result = await provider.validateResponse({ SAMLResponse: 'b64blob' });

    expect(result).toEqual({ error: 'AUTH_SAML_002', message: 'SAML sign-in failed' });
  });
});

describe('SamlProvider.metadataXml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls generateServiceProviderMetadata with issuer and callbackUrl', async () => {
    mockGenerateMetadata.mockReturnValueOnce('<EntityDescriptor>...</EntityDescriptor>');
    const provider = new SamlProvider(makeConfig());

    const xml = await provider.metadataXml();

    expect(xml).toBe('<EntityDescriptor>...</EntityDescriptor>');
    expect(mockGenerateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        issuer: 'https://sp.example.com/metadata',
        callbackUrl: 'https://sp.example.com/auth/saml/callback',
      }),
    );
    expect(mockGenerateMetadata).toHaveBeenCalledWith(
      expect.not.objectContaining({ logoutCallbackUrl: expect.anything() }),
    );
  });
});

describe('SamlProvider lazy import', () => {
  it('constructor does not load node-saml; getSaml caches after first call', async () => {
    vi.clearAllMocks();
    const provider = new SamlProvider(makeConfig());

    // Before any method call: SAML class not yet constructed (lazy - R5).
    expect(MockSAMLClass).not.toHaveBeenCalled();

    const first = await provider['getSaml']();
    const second = await provider['getSaml']();

    // Cached: both calls return the same resolved module.
    expect(second).toBe(first);
    expect(MockSAMLClass).toHaveBeenCalledTimes(1);
    expect(mockSamlInstance.getAuthorizeUrlAsync).not.toHaveBeenCalled();
  });
});

describe('SamlProvider constructor options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes node-saml constructor options derived from config', async () => {
    const provider = new SamlProvider(makeConfig({ clockSkewMs: 600000 }));
    await provider['getSaml']();

    expect(MockSAMLClass).toHaveBeenCalledTimes(1);
    const opts = MockSAMLClass.mock.calls[0][0] as Record<string, unknown>;
    expect(opts['issuer']).toBe('https://sp.example.com/metadata');
    expect(opts['callbackUrl']).toBe('https://sp.example.com/auth/saml/callback');
    expect(opts['idpCert']).toBe('MIICfakeidpcert');
    expect(opts['entryPoint']).toBe('https://idp.example.com/sso/saml');
    expect(opts['wantAssertionsSigned']).toBe(true);
    expect(opts['wantAuthnResponseSigned']).toBe(true);
    // Replay protection is non-negotiable: node-saml v5.1.0 defaults
    // validateInResponseTo to 'never', enabling assertion replay within
    // the clock window. Provider must force 'always' (spec F1 hardening).
    expect(opts['validateInResponseTo']).toBe('always');
    expect(opts['acceptedClockSkewMs']).toBe(600000);
    expect(opts['audience']).toBe('https://sp.example.com/metadata');
  });

  it('omits privateKey/publicCert/idpIssuer keys when empty', async () => {
    const provider = new SamlProvider(makeConfig());
    await provider['getSaml']();

    const opts = MockSAMLClass.mock.calls[0][0] as Record<string, unknown>;
    expect('privateKey' in opts).toBe(false);
    expect('publicCert' in opts).toBe(false);
    expect('idpIssuer' in opts).toBe(false);
  });

  it('includes privateKey/publicCert/idpIssuer when provided', async () => {
    const provider = new SamlProvider(
      makeConfig({ privateKey: 'KEY', publicCert: 'CERT', idpIssuer: 'https://idp.example.com/metadata' }),
    );
    await provider['getSaml']();

    const opts = MockSAMLClass.mock.calls[0][0] as Record<string, unknown>;
    expect(opts['privateKey']).toBe('KEY');
    expect(opts['publicCert']).toBe('CERT');
    expect(opts['idpIssuer']).toBe('https://idp.example.com/metadata');
  });

  it('defaults acceptedClockSkewMs to 300000 when clockSkewMs not set', async () => {
    const provider = new SamlProvider(makeConfig());
    await provider['getSaml']();

    const opts = MockSAMLClass.mock.calls[0][0] as Record<string, unknown>;
    expect(opts['acceptedClockSkewMs']).toBe(300000);
  });
});
