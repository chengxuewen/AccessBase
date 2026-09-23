/**
 * Route-level manager singletons (Q2a — spec 2026-09-23-q2 rev.2 F-A1..F-A6).
 *
 * WHY: the handler-site `new (await import('@accessbase/identity')).UserManager()`
 * pattern allocated ONE pg Pool per request (constructors call createDb ->
 * new Pool). Live burst on this box: 24-wide request waves accumulated
 * 50 -> 74 -> 99 connections across three waves (pools linger for pg-pool's
 * 10s idle window and share nothing) until Postgres answered
 * "sorry, too many clients already". Any overlapping real traffic hits the
 * same wall at max_connections.
 *
 * HOW: managers are constructed once per process behind these getters.
 * Plugin-scope `new X()` sites (roles.ts:14, users.ts:27-28, auth.ts:67-68 ...)
 * were left alone — they are bounded by app-registration count and their
 * tests depend on construction semantics (roles.test results[0] premise).
 *
 * TEST + SHUTDOWN SEAM: resetManagers() closes owned pools (duck-typed —
 * plain-object vi.mock factories have no close(), F-A3) and clears refs, so
 * every test gets a fresh construction and mock.results premises hold.
 */
import type { RoleManager, TenantManager, UserManager } from '@accessbase/identity';

let userManager: UserManager | undefined;
let roleManager: RoleManager | undefined;
let tenantManager: TenantManager | undefined;

/**
 * Classes resolve through a dynamic import (type-only static import above):
 * route-test vi.mock factories define only the subset their route touches —
 * a static named import would throw at link time for missing keys (tenant-gate
 * collection failure). `await import` resolves the proxy per-key.
 */
async function resolveClass(key: 'UserManager' | 'RoleManager' | 'TenantManager'): Promise<new () => unknown> {
  const mod = (await import('@accessbase/identity')) as unknown as Record<string, unknown>;
  return mod[key] as new () => unknown;
}

// PROMISE memo (not value memo): the ctor path awaits a dynamic import, so a
// value check would let every concurrent first-request build its own manager
// (+pool) before the first assignment lands — live-fired as 24 pools per burst.
// The memoed promise is created once; awaiters all share it. Rejections reset
// the slot so a transient boot failure is not cached forever.
function memo<T>(read: () => Promise<T> | undefined, write: (p: Promise<T> | undefined) => void, make: () => Promise<T>): () => Promise<T> {
  return () => {
    const existing = read();
    if (existing) return existing;
    const p = make().catch((err: unknown) => {
      write(undefined);
      throw err;
    });
    write(p);
    return p;
  };
}

let userManagerP: Promise<UserManager> | undefined;
let roleManagerP: Promise<RoleManager> | undefined;
let tenantManagerP: Promise<TenantManager> | undefined;

export const getUserManager = memo<UserManager>(
  () => userManagerP,
  (p) => { userManagerP = p; },
  async () => (userManager = new (await resolveClass('UserManager'))() as UserManager),
);

export const getRoleManager = memo<RoleManager>(
  () => roleManagerP,
  (p) => { roleManagerP = p; },
  async () => (roleManager = new (await resolveClass('RoleManager'))() as RoleManager),
);

/** Moved from auth.ts's closure-local holder (rev.2 F-A4: it was never importable). */
export const getTenantManager = memo<TenantManager>(
  () => tenantManagerP,
  (p) => { tenantManagerP = p; },
  async () => (tenantManager = new (await resolveClass('TenantManager'))() as TenantManager),
);

/**
 * Close the pools owned by these singletons and reset refs. Wired into app
 * onClose (graceful shutdown) and into route tests' beforeEach where the
 * old per-request construction guaranteed spy isolation.
 */
export async function resetManagers(): Promise<void> {
  userManagerP = undefined;
  roleManagerP = undefined;
  tenantManagerP = undefined;
  for (const m of [userManager, roleManager, tenantManager]) {
    const close = (m as { close?: () => Promise<void> } | undefined)?.close;
    if (typeof close === 'function') {
      try {
        await close.call(m);
      } catch {
        // shutdown must never throw on pool teardown
      }
    }
  }
  userManager = undefined;
  roleManager = undefined;
  tenantManager = undefined;
}
