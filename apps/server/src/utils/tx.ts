import { getUserManager } from './managers.js';
import type { DbLike } from '@accessbase/identity/db';

/**
 * Q2b: transaction wrapper for route-level multi-write funnels.
 *
 * Mechanism: the UserManager singleton's pool runs fn inside one transaction
 * and the received DbLike handle is THREADED into every manager call in the
 * funnel (create/changeStatus/setUserRoles/update/setParent all take a
 * trailing `db?: DbLike`). One pool, one tx, all writes atomic together.
 *
 * Test-seam note: route tests mocking @accessbase/identity classes must give
 * the UserManager mock `transaction: (fn) => fn({})` — the mocked write
 * methods ignore the handle anyway. The real-DB behavior is locked by
 * funnel-tx-integration.test.ts (rollback proof), NOT by the mock lanes.
 */
export async function routeTx<T>(fn: (tx: DbLike) => Promise<T>): Promise<T> {
  const um = await getUserManager();
  return um.transaction(fn);
}
