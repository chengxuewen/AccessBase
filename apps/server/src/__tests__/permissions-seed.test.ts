import { describe, it, expect, vi, beforeEach } from 'vitest';
import { permissions, rolePermissions } from '@accessbase/identity/db';
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

const EXPECTED_PERMISSION_COUNT = 9;
const RESOURCES = ['users', 'roles', 'permissions'] as const;
const ACTIONS = ['read', 'write', 'delete'] as const;

// ---------- tests ----------

describe('seedBuiltinPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts 9 permissions and binds all to admin role on first run', async () => {
    const fakeIds = Array.from({ length: 9 }, (_, i) => `perm-${i}`);
    // select returns 9 rows matching the 9 inserted permissions
    const selectRows = RESOURCES.flatMap((_, ri) =>
      ACTIONS.map((_, ai) => ({ id: fakeIds[ri * 3 + ai] })),
    );
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
    const selectRows = RESOURCES.flatMap((_, ri) =>
      ACTIONS.map((_, ai) => ({ id: `id-${ri * 3 + ai}` })),
    );
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
