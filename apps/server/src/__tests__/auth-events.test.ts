/**
 * R1-T3 auth-events unit locks: fire-and-forget telemetry posture.
 * Real emitEvent over a captured fake db (only the identity/db connection
 * factory is faked — table defs stay real so the inserted payload shape is
 * exercised, not mocked away).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

const warnSpy = vi.fn();
vi.mock('@accessbase/logging', () => ({
  logger: { warn: (...args: unknown[]) => warnSpy(...args), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface CapturedInsert {
  values: Record<string, unknown>;
}
const inserts: CapturedInsert[] = [];
let insertMode: 'ok' | 'reject' = 'ok';
const dbMock = {
  insert: vi.fn(() => {
    if (insertMode === 'reject') {
      return { values: vi.fn().mockRejectedValue(new Error('db down')) };
    }
    return {
      values: vi.fn((vals: Record<string, unknown>) => {
        inserts.push({ values: vals });
        return Promise.resolve();
      }),
    };
  }),
};

vi.mock('@accessbase/identity/db', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createDb: vi.fn(() => dbMock),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

const { emitAuthEvent } = await import('../utils/auth-events.js');
const { closeAuthDb } = await import('../utils/managers.js');

/** Let floating (never-awaited) promises settle + reject. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  inserts.length = 0;
  warnSpy.mockClear();
  insertMode = 'ok';
});

describe('emitAuthEvent', () => {
  it('writes an events row with type/tenant/minimal payload (success arm)', () => {
    emitAuthEvent({
      type: 'auth.login.success',
      tenantId: 't-1',
      userId: 'u-1',
      email: 'a@b.c',
      method: 'password',
    });
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(row).toBeDefined();
    expect(row?.values.type).toBe('auth.login.success');
    expect(row?.values.tenantId).toBe('t-1');
    // Payload shape locked: email + method (+userId on success/logout), NO reason, no flow material.
    expect(row?.values.payload).toEqual({ email: 'a@b.c', method: 'password', userId: 'u-1' });
  });

  it('failure arm carries reason, omits userId when unknown', () => {
    emitAuthEvent({
      type: 'auth.login.failure',
      tenantId: 't-1',
      email: 'a@b.c',
      method: 'password',
      reason: 'bad_credentials',
    });
    const row = inserts[0];
    expect(row?.values.type).toBe('auth.login.failure');
    expect(row?.values.payload).toEqual({ email: 'a@b.c', method: 'password', reason: 'bad_credentials' });
  });

  it('swallows insert rejection: no throw, no unhandled rejection, warn logged', async () => {
    insertMode = 'reject';
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(() =>
        emitAuthEvent({ type: 'auth.logout', tenantId: 't-1', userId: 'u-1', email: 'a@b.c', method: 'password' }),
      ).not.toThrow();
      await flush();
      expect(warnSpy).toHaveBeenCalled();
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('swallows synchronous authDb boot failure (whole body in try/catch)', async () => {
    await closeAuthDb(); // clear the memoized handle so the next authDb() re-dials
    const dbMod = (await import('@accessbase/identity/db')) as { createDb: ReturnType<typeof vi.fn> };
    dbMod.createDb.mockImplementationOnce(() => {
      throw new Error('pool boot failed');
    });
    expect(() =>
      emitAuthEvent({ type: 'auth.login.success', tenantId: 't-1', email: 'a@b.c', method: 'totp' }),
    ).not.toThrow();
    await flush();
    expect(warnSpy).toHaveBeenCalled();
    dbMod.createDb.mockImplementation(() => dbMock); // restore for any later dial
  });
});
