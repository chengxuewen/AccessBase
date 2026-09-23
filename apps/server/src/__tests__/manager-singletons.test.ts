import { describe, it, expect, vi } from 'vitest';

process.env.NODE_ENV = 'test';

vi.mock('@accessbase/identity', () => {
  class Fake {
    closed = false;
    close = vi.fn(async () => {
      this.closed = true;
    });
  }
  class Plain {
    // no close() — duck-type proof (rev.2 F-A3: route-test factories return
    // plain objects; resetManagers must not throw)
  }
  return {
    UserManager: Fake,
    RoleManager: Plain,
    TenantManager: Fake,
  };
});

import { getUserManager, getRoleManager, getTenantManager, resetManagers } from '../utils/managers.js';

describe('manager singletons (Q2a A)', () => {
  it('caches one instance per getter until reset', async () => {
    const a = await getUserManager();
    const b = await getUserManager();
    expect(a).toBe(b);
    await resetManagers();
    const c = await getUserManager();
    expect(c).not.toBe(a);
  });

  it('resetManagers duck-types close (Fake has it, Plain does not) and clears ALL refs', async () => {
    const um = await getUserManager();
    const rm = await getRoleManager();
    const tm = await getTenantManager();
    // no throw despite RoleManager lacking close()
    await expect(resetManagers()).resolves.toBeUndefined();
    expect(um.close).toHaveBeenCalledTimes(1);
    expect(tm.close).toHaveBeenCalledTimes(1);
    expect(rm.close).toBeUndefined();
    // refs cleared → fresh constructions
    expect(await getUserManager()).not.toBe(um);
    await resetManagers();
  });
});
