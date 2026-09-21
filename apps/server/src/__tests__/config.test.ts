import { afterEach, describe, expect, it, vi } from 'vitest';
import { warnDegradedChecks } from '../config';

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.resetModules();
});

describe('config jwtSecret', () => {
  it('throws at import time in production without JWT_SECRET', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];
    vi.resetModules();
    await expect(import('../config')).rejects.toThrow(/JWT_SECRET/);
  });

  it('falls back to dev secret outside production', async () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['JWT_SECRET'];
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.jwtSecret).toBe('dev-secret-do-not-use-in-production');
  });
});

describe('config corsOrigins', () => {
  it('throws at import time in production with empty CORS_ORIGINS', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'set';
    delete process.env['CORS_ORIGINS'];
    vi.resetModules();
    await expect(import('../config')).rejects.toThrow(/CORS_ORIGINS/);
  });

  it('succeeds in production when both JWT_SECRET and CORS_ORIGINS are set', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'set';
    process.env['CORS_ORIGINS'] = 'https://admin.example.com';
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.corsOrigins).toBe('https://admin.example.com');
  });

  it('does not throw in dev/test when CORS_ORIGINS is empty', async () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['CORS_ORIGINS'];
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.corsOrigins).toBe('');
  });
});

describe('warnDegradedChecks (L-T4 / spec D5: pure, env-only, options qualifiers)', () => {
  it('production with empty env reports all five degrade lines with options-table qualifiers', () => {
    const lines = warnDegradedChecks({}, true);
    expect(lines).toHaveLength(6);
    expect(lines.some((l) => /MFA_ENCRYPTION_KEY/.test(l) && /env-only/.test(l))).toBe(true);
    expect(lines.some((l) => /SMTP_HOST/.test(l) && /options-configured/.test(l))).toBe(true);
    expect(
      lines.some((l) => /OAuth|SAML/.test(l) && /options-table config not visible at boot/.test(l)),
    ).toBe(true);
    expect(lines.some((l) => /WEBAUTHN_ORIGIN/.test(l))).toBe(true);
    expect(lines.some((l) => /SITE_URL/.test(l) && /request host/.test(l))).toBe(true);
    expect(lines.some((l) => /METRICS_TOKEN/.test(l) && /route-pattern/.test(l))).toBe(true);
  });

  it('METRICS_TOKEN warn is prod-only and disappears with a token set (L-M D2)', () => {
    const prodOpen = warnDegradedChecks({ METRICS_TOKEN: '' }, true);
    expect(prodOpen.some((l) => /METRICS_TOKEN/.test(l))).toBe(true);
    const prodGated = warnDegradedChecks({ METRICS_TOKEN: 't' }, true);
    expect(prodGated.some((l) => /METRICS_TOKEN/.test(l))).toBe(false);
    const dev = warnDegradedChecks({}, false);
    expect(dev.some((l) => /METRICS_TOKEN/.test(l))).toBe(false);
  });

  it('production fully configured via env reports nothing', () => {
    const lines = warnDegradedChecks(
      {
        MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
        SMTP_HOST: 'smtp.example.com',
        GITHUB_CLIENT_ID: 'client-id',
        GITHUB_CLIENT_SECRET: 'client-secret',
        WEBAUTHN_ORIGIN: 'https://app.example.com',
        METRICS_TOKEN: 'a-token',
        SITE_URL: 'https://app.example.com',
      },
      true,
    );
    expect(lines).toEqual([]);
  });

  it('dev suppresses the prod-only subjective checks (WEBAUTHN localhost default, SITE_URL)', () => {
    const lines = warnDegradedChecks({}, false);
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => /WEBAUTHN_ORIGIN/.test(l))).toBe(false);
    expect(lines.some((l) => /SITE_URL/.test(l))).toBe(false);
  });

  it('env-level SAML counts as provider config (no OAuth/SAML line)', () => {
    const lines = warnDegradedChecks({ SAML_ENABLED: 'true' }, true);
    expect(lines.some((l) => /options-table config not visible at boot/.test(l))).toBe(false);
  });

  it('OAUTH_PROVIDERS env counts as provider config', () => {
    const lines = warnDegradedChecks({ OAUTH_PROVIDERS: 'generic' }, true);
    expect(lines.some((l) => /options-table config not visible at boot/.test(l))).toBe(false);
  });

  it('is a pure function: never reads ambient process.env for its verdicts', () => {
    process.env['MFA_ENCRYPTION_KEY'] = 'ab'.repeat(32);
    try {
      const lines = warnDegradedChecks({}, false);
      expect(lines.some((l) => /MFA_ENCRYPTION_KEY/.test(l))).toBe(true);
    } finally {
      delete process.env['MFA_ENCRYPTION_KEY'];
    }
  });
});
