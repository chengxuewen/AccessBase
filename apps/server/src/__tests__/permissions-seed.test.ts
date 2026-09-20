import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { permissions, rolePermissions } from '@accessbase/identity/db';
import { selfHealSeed, runSelfHealOnce, ensureSeedForAdmin } from '../routes/permissions-seed.js';
import { logger } from '@accessbase/logging';
import { seedBuiltinPermissions } from '../routes/permissions-seed.js';

// ---------- mock drizzle chainable builder ----------

function mockDb(selectRows: Array<{ id: string }> = []) {
  const insertedPermissions: unknown[][] = [];
  const insertedRolePerms: unknown[][] = [];

  const selectChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(selectRows),
    }),
  };

  const db = {
    insert: vi.fn().mockImplementation((table: unknown) => {
      const tableName =
        table === permissions ? 'permissions' : table === rolePermissions ? 'role_permissions' : 'unknown';
      return {
        values: vi.fn().mockImplementation((rows: unknown[]) => {
          if (tableName === 'permissions') insertedPermissions.push(rows);
          else insertedRolePerms.push(rows);
          return {
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          };
        }),
      };
    }),
    select: vi.fn().mockReturnValue(selectChain),
    // expose captured data for assertions
    _captured: { insertedPermissions, insertedRolePerms },
  };

  return db;
}

// ---------- constants ----------

const EXPECTED_PERMISSION_COUNT = 21;
const RESOURCES = ['users', 'roles', 'permissions', 'audit', 'stats', 'options', 'clients', 'apikeys', 'tenants'] as const;
const ACTIONS = ['read', 'write', 'delete'] as const;

// ---------- tests ----------

describe('seedBuiltinPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(`inserts ${EXPECTED_PERMISSION_COUNT} permissions and binds all to admin role on first run`, async () => {
    const fakeIds = Array.from({ length: EXPECTED_PERMISSION_COUNT }, (_, i) => `perm-${i}`);
    // select returns EXPECTED_PERMISSION_COUNT rows matching the inserted permissions
    const selectRows = Array.from({ length: EXPECTED_PERMISSION_COUNT }, (_, i) => ({ id: fakeIds[i] }));
    const db = mockDb(selectRows) as unknown as ReturnType<typeof import('@accessbase/identity/db').createDb>;

    await seedBuiltinPermissions(db, 'admin-role-id');

    // 1 insert call for permissions, 1 for role_permissions
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db._captured.insertedPermissions).toHaveLength(1);
    expect(db._captured.insertedPermissions[0]).toHaveLength(EXPECTED_PERMISSION_COUNT);
    expect(db._captured.insertedRolePerms).toHaveLength(1);
    expect(db._captured.insertedRolePerms[0]).toHaveLength(EXPECTED_PERMISSION_COUNT);
  });

  it('is idempotent — second call does not throw (onConflictDoNothing)', async () => {
    const selectRows = Array.from({ length: EXPECTED_PERMISSION_COUNT }, (_, i) => ({ id: `id-${i}` }));
    const db = mockDb(selectRows) as unknown as ReturnType<typeof import('@accessbase/identity/db').createDb>;

    // First seed
    await seedBuiltinPermissions(db, 'admin-role-id');
    // Second seed — must not throw
    await expect(seedBuiltinPermissions(db, 'admin-role-id')).resolves.toBeUndefined();
  });

  it('does not throw when insert itself fails (best-effort)', async () => {
    const db = {
      insert: vi.fn().mockImplementation(() => {
        throw new Error('DB connection lost');
      }),
      select: vi.fn(),
    } as unknown as ReturnType<typeof import('@accessbase/identity/db').createDb>;

    // Must not throw — seed is best-effort
    await expect(seedBuiltinPermissions(db, 'admin-role-id')).resolves.toBeUndefined();
  });
});

// ---------- K-T2: system-role stamp idempotency ----------

describe('ensureSeedForAdmin system-role stamp (K-T2)', () => {
  function stampDb() {
    const setCalls: unknown[] = [];
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((v: unknown) => {
          setCalls.push(v);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
      _setCalls: setCalls,
    };
    return db as unknown as ReturnType<typeof import('@accessbase/identity/db').createDb> & {
      _setCalls: unknown[];
    };
  }

  it('stamps admin roles with isSystem=true and is idempotent across runs (no throw)', async () => {
    const { ensureSeedForAdmin } = await import('../routes/permissions-seed.js');
    const db = stampDb();

    await expect(ensureSeedForAdmin(db)).resolves.toBeUndefined();
    await expect(ensureSeedForAdmin(db)).resolves.toBeUndefined();

    // One stamp per run, both with the same set payload.
    expect(db._setCalls).toHaveLength(2);
    expect(db._setCalls[0]).toEqual({ isSystem: true });
    expect(db._setCalls[1]).toEqual({ isSystem: true });
  });

  it('stamp failure does not block permission seeding (best-effort)', async () => {
    const { ensureSeedForAdmin } = await import('../routes/permissions-seed.js');
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
      update: vi.fn().mockImplementation(() => {
        throw new Error('column is_system does not exist');
      }),
    } as unknown as ReturnType<typeof import('@accessbase/identity/db').createDb>;

    // Must not throw — a legacy table without is_system must not break self-heal.
    await expect(ensureSeedForAdmin(db)).resolves.toBeUndefined();
  });
});

// ---------- L-T2: selfHealSeed bounded retry (D2) ----------

describe('selfHealSeed bounded retry (L-T2 / D2)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => ({} as never));
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => ({} as never));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('failing runOnce then success -> attempts=2, warn between, no final error', async () => {
    const { selfHealSeed } = await import('../routes/permissions-seed.js');
    const runOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error('dial failed'))
      .mockResolvedValueOnce(undefined);

    const promise = selfHealSeed('postgresql://x', { attempts: 6, delayMs: 5000, runOnce });
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('always-failing runOnce -> attempts=6, exactly one final error line', async () => {
    const { selfHealSeed } = await import('../routes/permissions-seed.js');
    const runOnce = vi.fn().mockRejectedValue(new Error('dial failed'));

    const promise = selfHealSeed('postgresql://x', { attempts: 6, delayMs: 5000, runOnce });
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(runOnce).toHaveBeenCalledTimes(6);
    expect(warnSpy).toHaveBeenCalledTimes(5);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('success-first runOnce -> attempts=1, exits normally', async () => {
    const { selfHealSeed } = await import('../routes/permissions-seed.js');
    const runOnce = vi.fn().mockResolvedValue(undefined);

    await selfHealSeed('postgresql://x', { attempts: 6, delayMs: 5000, runOnce });

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('runSelfHealOnce real probe (L-T2 anti-swallow lock / D2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects when DATABASE_URL points at an unreachable database (probe observes failure)', async () => {
    const { runSelfHealOnce } = await import('../routes/permissions-seed.js');
    await expect(
      runSelfHealOnce('postgresql://selfheal:probe@127.0.0.1:1/nonexistent'),
    ).rejects.toThrow();
  }, 10000);
});
