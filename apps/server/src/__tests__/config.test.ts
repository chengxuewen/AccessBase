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
