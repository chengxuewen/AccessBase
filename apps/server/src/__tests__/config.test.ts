import { afterEach, describe, expect, it, vi } from 'vitest';

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
