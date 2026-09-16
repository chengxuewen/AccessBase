import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IdentityService, OptionsManager } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Plugins requiring fastify@5 mocked out (established pattern from oauth.test.ts)
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// SamlProvider mocked: the real class lazily loads @node-saml/node-saml and
// runs real XML crypto — the route tests own the channel semantics (302s,
// exchange union, find-or-provision), not signature verification.
class MockSamlProvider {
  constructor(public config: Record<string, unknown>) {}
  async loginUrl(relayState: string, _host?: string): Promise<string> {
    return `https://idp.example.com/sso?RelayState=${encodeURIComponent(relayState)}`;
  }
  async validateResponse(
    container: Record<string, string>,
  ): Promise<{ email: string; nameId: string; displayName?: string } | { error: 'AUTH_SAML_002'; message: string }> {
    const samlResponse = container['SAMLResponse'] ?? '';
    if (samlResponse === 'invalid') {
      return { error: 'AUTH_SAML_002', message: 'Invalid SAML assertion' };
    }
    if (samlResponse === 'no-email') {
      return { email: '', nameId: 'anon' };
    }
    return { email: 'saml@test.local', nameId: 'user-1', displayName: 'SAML User' };
  }
  async metadataXml(): Promise<string> {
    return '<?xml version="1.0"?><EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:accessbase:saml:sp"/>';
  }
}

// UserManager + SessionManager mocked (DB-touching); see the FlowTokenService
// seam below for the shared issue/consume stub.
const testUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'saml@test.local',
  name: 'SAML User',
  status: 'active',
  tenantId: '00000000-0000-0000-0000-000000000001',
  totpEnabled: false,
};

/** Mutable behavior switches for the mocked UserManager rows. */
const userManagerState = {
  existing: null as Record<string, unknown> | null,
};

const sessionManagerMock = {
  issueRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'test-refresh-token' }),
  findSessionByToken: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
};

// Shared FlowTokenService stub via module-level Map (oauth.test.ts seam) —
// with burn-first consume ordering (delete BEFORE payload check; Task 6 fixes
// the real stub to match this shape).
const sharedFlowStore = new Map<string, { purpose: string; payload: unknown; ttl?: number }>();
function resetSharedFlowStore(): void {
  sharedFlowStore.clear();
}
const sharedFlowTokens = {
  issue: vi.fn(async (purpose: string, payload: unknown, ttl?: number) => {
    const token = crypto.randomUUID().replaceAll('-', '');
    sharedFlowStore.set(token, { purpose, payload, ttl });
    return token;
  }),
  consume: vi.fn(async <T,>(token: string, purpose: string): Promise<T | null> => {
    const rec = sharedFlowStore.get(token);
    // Burn-first: the token is consumed even if the purpose mismatches.
    sharedFlowStore.delete(token);
    if (!rec || rec.purpose !== purpose) return null;
    return rec.payload as T;
  }),
};

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    SamlProvider: MockSamlProvider,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn(async (email: string) => {
        // Guard fast path: setup-guard's queryAdminExists looks up the admin
        // email first — resolve a stub admin so the guard reports initialized
        // (ldap-login.test.ts precedent).
        if (email === 'admin@accessbase.local') return { ...testUser, email };
        if (userManagerState.existing) return userManagerState.existing;
        return email === testUser.email ? testUser : null;
      }),
      create: vi.fn(async (input: { email: string; name?: string }, _tenantId: string) => ({
        id: testUser.id,
        email: input.email,
        name: input.name ?? '',
        status: 'active',
        totpEnabled: false,
      })),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({
      getUserRoles: vi.fn().mockResolvedValue([{ id: 'r1', name: 'Admin' }]),
    })),
    SessionManager: vi.fn().mockImplementation(() => sessionManagerMock),
    FlowTokenService: vi.fn().mockImplementation(() => sharedFlowTokens),
  };
});

// Options seam: SAML config reads config via getOptionsManager(). A plain
// object with a get() honoring env-first matches the real contract.
const optionsStore = new Map<string, unknown>();
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : (optionsStore.has(key) ? optionsStore.get(key) : defaultValue),
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetSharedFlowStore();
  optionsStore.clear();
  userManagerState.existing = null;
  sessionManagerMock.issueRefreshToken.mockClear();
});

/** Turn SAML fully on via options (enabled + entryPoint + idpCert). */
function enableSaml(): void {
  optionsStore.set('saml_enabled', 'true');
  optionsStore.set('saml_entry_point', 'https://idp.example.com/sso');
  optionsStore.set('saml_idp_cert', 'MIIC-test-cert');
}

/** POST a SAMLResponse body to ACS. */
function postAcs(response: string): ReturnType<typeof app.inject> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/saml/acs',
    payload: `SAMLResponse=${encodeURIComponent(response)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

/** Run a happy ACS round-trip, return the samlCode from the redirect. */
async function runAcs(response: string): Promise<string> {
  const res = await postAcs(response);
  expect(res.statusCode).toBe(302);
  return (res.headers['location'] as string).split('samlCode=')[1]?.split('&')[0] ?? '';
}

describe('GET /api/v1/auth/saml/status', () => {
  it('reports enabled:false by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/saml/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { enabled: false } });
  });

  it('reports enabled:true when the three-key gate is satisfied', async () => {
    enableSaml();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/saml/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { enabled: true } });
  });
});

describe('GET /api/v1/auth/saml/login', () => {
  it('returns 503 AUTH_SAML_001 when disabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/saml/login' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_SAML_001' } });
  });

  it('redirects 302 to the IdP entry point when enabled', async () => {
    enableSaml();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/saml/login' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location'] as string).toContain('idp.example.com/sso');
  });

  it('returns 503 when only entry_point is missing (three-key gate)', async () => {
    optionsStore.set('saml_enabled', 'true');
    optionsStore.set('saml_idp_cert', 'MIIC-test-cert');
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/saml/login' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('AUTH_SAML_001');
  });
});

describe('POST /api/v1/auth/saml/acs', () => {
  it('redirects 302 samlError=AUTH_SAML_001 when disabled (browser channel, never JSON)', async () => {
    const res = await postAcs('valid');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location'] as string).toContain('samlError=AUTH_SAML_001');
  });

  it('redirects 302 samlError=AUTH_SAML_002 when the assertion fails validation', async () => {
    enableSaml();
    const res = await postAcs('invalid');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location'] as string).toContain('samlError=AUTH_SAML_002');
  });

  it('redirects 302 samlError=AUTH_SAML_002 when the identity has no email', async () => {
    enableSaml();
    const res = await postAcs('no-email');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location'] as string).toContain('samlError=AUTH_SAML_002');
  });

  it('redirects 302 samlError=AUTH_004 when the existing user is suspended', async () => {
    enableSaml();
    userManagerState.existing = { ...testUser, status: 'suspended' };
    const res = await postAcs('valid');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location'] as string).toContain('samlError=AUTH_004');
    // Gate fired before issuance: no token pair minted
    expect(sessionManagerMock.issueRefreshToken).not.toHaveBeenCalled();
  });

  it('happy non-totp: 302 samlCode + saml_exchange payload carries accessToken, NO mfaPending', async () => {
    enableSaml();
    const res = await postAcs('valid');
    expect(res.statusCode).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toContain('/login?samlCode=');
    // Redirect target only carries the code — no tokens ride the URL
    expect(location).not.toContain('accessToken');
    const record = [...sharedFlowStore.values()].find((r) => r.purpose === 'saml_exchange');
    expect(record).toBeDefined();
    expect(record?.payload).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: 'test-refresh-token',
      user: { id: testUser.id, email: testUser.email },
    });
    expect(record?.payload).not.toHaveProperty('mfaPending');
  });

  it('totp user: 302 + saml_exchange payload mfaPending:true, no accessToken pre-issued', async () => {
    enableSaml();
    userManagerState.existing = { ...testUser, totpEnabled: true };
    sessionManagerMock.issueRefreshToken.mockClear();
    const code = await runAcs('valid');
    expect(code).toBeTruthy();
    const record = [...sharedFlowStore.values()].find((r) => r.purpose === 'saml_exchange');
    expect(record?.payload).toMatchObject({ userId: testUser.id, mfaPending: true });
    expect(record?.payload).not.toHaveProperty('accessToken');
    // R6 parity: no refresh session minted on the redirect chain
    expect(sessionManagerMock.issueRefreshToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/saml/exchange', () => {
  it('returns 401 AUTH_SAML_002 for invalid/expired code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/saml/exchange',
      payload: { code: 'invalid-code' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'AUTH_SAML_002' } });
  });

  it('mfaPending variant: {mfaRequired, flowToken} + mfa_verify {userId} issued at exchange time', async () => {
    enableSaml();
    userManagerState.existing = { ...testUser, totpEnabled: true };
    const code = await runAcs('valid');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/saml/exchange', payload: { code } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.mfaRequired).toBe(true);
    expect(typeof body.data.flowToken).toBe('string');
    expect(body.data.accessToken).toBeUndefined();
    // exchange-time issuance (R1): mfa_verify {userId} 300s minted HERE
    const mfaRecord = [...sharedFlowStore.entries()].find(([, r]) => r.purpose === 'mfa_verify');
    expect(mfaRecord).toBeDefined();
    expect(mfaRecord?.[1].payload).toEqual({ userId: testUser.id });
    // R2 batch-E parity: mfa_verify must carry the 300s TTL end-to-end
    expect(mfaRecord?.[1].ttl).toBe(300);
  });

  it('non-mfaPending variant: token-pair envelope with user roles (union arm 2)', async () => {
    enableSaml();
    const code = await runAcs('valid');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/saml/exchange', payload: { code } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.mfaRequired).toBeUndefined();
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.refreshToken).toBe('test-refresh-token');
    expect(body.data.expiresIn).toBe(900);
    expect(body.data.user).toMatchObject({ id: testUser.id, email: testUser.email, name: testUser.name });
    // Wire shape (R2 batch-E class): declared item properties must survive
    // fast-json-stringify — bare `items: {type:'object'}` would emit [{}].
    expect(body.data.user.roles).toEqual([{ id: 'r1', name: 'Admin' }]);
    // single-use: second exchange fails
    const res2 = await app.inject({ method: 'POST', url: '/api/v1/auth/saml/exchange', payload: { code } });
    expect(res2.statusCode).toBe(401);
  });

  it('union 200 schema: BOTH variants serialize their full payload (R2 fast-json-stringify)', async () => {
    enableSaml();
    // Arm 1 (mfaPending): fire through ACS → exchange and assert the raw body
    userManagerState.existing = { ...testUser, totpEnabled: true };
    const mfaCode = await runAcs('valid');
    const mfaRes = await app.inject({ method: 'POST', url: '/api/v1/auth/saml/exchange', payload: { code: mfaCode } });
    expect(mfaRes.statusCode).toBe(200);
    const mfaData = JSON.parse(mfaRes.body as string).data;
    // Every arm key must survive serialization — an arm-only schema would strip
    // the other variant's fields (R2 lesson); declared flat = pass-through.
    for (const key of ['mfaRequired', 'flowToken']) {
      expect(mfaData).toHaveProperty(key);
    }
    expect(mfaData.mfaRequired).toBe(true);
    expect(typeof mfaData.flowToken).toBe('string');

    // Arm 2 (token pair): full shape incl. nested user projection
    userManagerState.existing = null;
    const pairCode = await runAcs('valid');
    const pairRes = await app.inject({ method: 'POST', url: '/api/v1/auth/saml/exchange', payload: { code: pairCode } });
    expect(pairRes.statusCode).toBe(200);
    const pairData = JSON.parse(pairRes.body as string).data;
    for (const key of ['accessToken', 'refreshToken', 'expiresIn', 'user']) {
      expect(pairData).toHaveProperty(key);
    }
    expect(pairData.user).toMatchObject({ id: testUser.id, email: testUser.email });
    expect(Array.isArray(pairData.user.roles)).toBe(true);
  });
});

describe('GET /api/v1/auth/saml/metadata', () => {
  it('serves SP metadata as XML when enabled', async () => {
    enableSaml();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/saml/metadata' });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('xml');
    expect(res.body).toContain('EntityDescriptor');
  });

  it('returns 503 AUTH_SAML_001 when disabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/saml/metadata' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('AUTH_SAML_001');
  });
});

describe('static invariants (app.ts source)', () => {
  it('app.ts registers no global content-type parser (scoped parser stays in the plugin)', () => {
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect(src).not.toMatch(/addContentTypeParser/);
  });

  it('app.ts excludes the SAML ACS route from audit (R10)', () => {
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect(src).toContain("/api/v1/auth/saml/acs");
  });
});

