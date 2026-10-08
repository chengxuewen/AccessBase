/**
 * Logout-coherence batch T-RP (spec 2026-10-08 §3.3): rp-end-session util —
 * dynamic provider registry endSessionUrl validation (drop-with-warn) and
 * resolveRpEndSessionUrl (provider arm + newest-generic-link arm).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { OptionsManager } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// In-memory oauth_accounts store behind the shared authDb() handle. The mock's
// limit(1)/orderBy are chain-preserving seams: orderBy is IDENTITY because the
// test owns row ordering (rows[0] = newest). The desc(createdAt) SQL itself is
// drizzle's contract, not this seam's business.
const rows: Array<Record<string, unknown>> = [];

vi.mock('@accessbase/identity/db', () => ({
  oauthAccounts: { _: 'oauth_accounts-marker' },
  createDb: () => ({
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          const projected = rows.map((r) =>
            projection ? Object.fromEntries(Object.keys(projection).map((k) => [k, r[k]])) : r,
          );
          const arr = projected as Array<Record<string, unknown>> & {
            limit: () => Promise<Array<Record<string, unknown>>>;
            orderBy: () => Promise<Array<Record<string, unknown>>>;
          };
          arr.limit = async () => arr.slice(0, 1);
          arr.orderBy = async () => arr;
          return arr;
        },
      }),
    }),
  }),
  closeDb: async () => {},
}));

const optionsStore = new Map<string, unknown>();
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: async (key: string, envValue: unknown, defaultValue: unknown) =>
    envValue !== undefined ? envValue : optionsStore.has(key) ? optionsStore.get(key) : defaultValue,
} as unknown as OptionsManager);

const { loadDynamicProviders, resolveRpEndSessionUrl } = await import('../utils/rp-end-session.js');
const { logger } = await import('@accessbase/logging');

const validProvider = {
  authUrl: 'https://idp.example.com/authorize',
  tokenUrl: 'https://idp.example.com/token',
  userinfoUrl: 'https://idp.example.com/userinfo',
  clientId: 'cid',
};

function setProviders(providers: Record<string, unknown>): void {
  optionsStore.set('oauth_providers', providers);
  for (const name of Object.keys(providers)) {
    optionsStore.set(`oauth_${name}_client_secret`, 'secret');
  }
}

afterEach(() => {
  optionsStore.clear();
  rows.length = 0;
  vi.restoreAllMocks();
});

describe('loadDynamicProviders endSessionUrl validation (drop-with-warn, provider survives)', () => {
  it('keeps an https endSessionUrl', async () => {
    setProviders({ 'ok-idp': { ...validProvider, endSessionUrl: 'https://idp.example.com/logout' } });
    const registry = await loadDynamicProviders();
    expect(registry['ok-idp']?.endSessionUrl).toBe('https://idp.example.com/logout');
  });

  it('drops a non-https endSessionUrl with a warn — provider stays in the registry', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    setProviders({ 'insecure-idp': { ...validProvider, endSessionUrl: 'http://idp.example.com/logout' } });
    const registry = await loadDynamicProviders();
    expect(registry['insecure-idp']).toBeDefined();
    expect(registry['insecure-idp']?.endSessionUrl).toBeUndefined();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('endSessionUrl'))).toBe(true);
  });

  it('drops a non-string endSessionUrl with a warn — provider stays in the registry', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    setProviders({ 'junk-idp': { ...validProvider, endSessionUrl: 42 } });
    const registry = await loadDynamicProviders();
    expect(registry['junk-idp']).toBeDefined();
    expect(registry['junk-idp']?.endSessionUrl).toBeUndefined();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('endSessionUrl'))).toBe(true);
  });
});

describe('resolveRpEndSessionUrl', () => {
  it('provider arm: registry endSessionUrl + stored id_token -> exact urlencoded URL', async () => {
    setProviders({ 'ok-idp': { ...validProvider, endSessionUrl: 'https://idp.example.com/logout' } });
    rows.push({ userId: 'u1', provider: 'ok-idp', providerAccountId: 'pa1', idToken: 'a b&c/d+e=f' });
    const url = await resolveRpEndSessionUrl('u1', 'ok-idp');
    expect(url).toBe('https://idp.example.com/logout?id_token_hint=a%20b%26c%2Fd%2Be%3Df');
  });

  it('null when the link row has no id_token', async () => {
    setProviders({ 'ok-idp': { ...validProvider, endSessionUrl: 'https://idp.example.com/logout' } });
    rows.push({ userId: 'u1', provider: 'ok-idp', providerAccountId: 'pa1', idToken: null });
    expect(await resolveRpEndSessionUrl('u1', 'ok-idp')).toBeNull();
  });

  it('null when the provider is absent from the registry', async () => {
    rows.push({ userId: 'u1', provider: 'unregistered', providerAccountId: 'pa1', idToken: 'tok' });
    expect(await resolveRpEndSessionUrl('u1', 'unregistered')).toBeNull();
  });

  it('null when the registry entry has no endSessionUrl', async () => {
    setProviders({ 'plain-idp': { ...validProvider } });
    rows.push({ userId: 'u1', provider: 'plain-idp', providerAccountId: 'pa1', idToken: 'tok' });
    expect(await resolveRpEndSessionUrl('u1', 'plain-idp')).toBeNull();
  });

  it('newest arm (no provider): first row with endSessionUrl + id_token wins, gaps skipped', async () => {
    setProviders({
      'plain-idp': { ...validProvider },
      'ok-idp': { ...validProvider, endSessionUrl: 'https://idp.example.com/logout' },
    });
    // rows[0] = newest (identity orderBy — see seam note at the top)
    rows.push({ userId: 'u1', provider: 'plain-idp', providerAccountId: 'pa0', idToken: 'newest-no-es' });
    rows.push({ userId: 'u1', provider: 'ghost-idp', providerAccountId: 'pa1', idToken: 'not-registered' });
    rows.push({ userId: 'u1', provider: 'ok-idp', providerAccountId: 'pa2', idToken: 'third-row-wins' });
    expect(await resolveRpEndSessionUrl('u1')).toBe(
      'https://idp.example.com/logout?id_token_hint=third-row-wins',
    );
  });

  it('newest arm: no usable row -> null', async () => {
    setProviders({ 'ok-idp': { ...validProvider, endSessionUrl: 'https://idp.example.com/logout' } });
    rows.push({ userId: 'u1', provider: 'ok-idp', providerAccountId: 'pa1', idToken: null });
    expect(await resolveRpEndSessionUrl('u1')).toBeNull();
  });
});
