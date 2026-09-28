/**
 * MfaManager process singleton (R1-T1 — H1: the last live PIT-081 pool site).
 *
 * WHY: auth.ts's closure factory built `new MfaManager(key)` per call and the
 * ctor dials createDb (a fresh pg Pool) whenever no handle is passed — pool
 * churn on every MFA request. This memo constructs ONCE and passes the shared
 * Q3A authDb() handle; pool ownership and shutdown stay with authDb()/
 * closeAuthDb (MfaManager has no close() — nothing to tear down here).
 *
 * WHY a separate module (not managers.ts): managers.ts deliberately avoids
 * static identity imports so partial route-test mocks link (its docblock);
 * this focused module may static-import MfaManager exactly as routes/auth.ts
 * already does. resetManagers() calls resetMfaManager() to keep the test seam
 * shared across every buildApp() instance in a file.
 */
import { MfaManager } from '@accessbase/identity';
import { config } from '../config.js';
import { authDb } from './managers.js';

let mfaManager: MfaManager | undefined;

/** Sync value-memo (no await on the construction path, unlike the Q2a getters). */
export function getMfaManager(): MfaManager {
  if (!mfaManager) {
    // Key checked BEFORE memoizing: a failed slot is never cached (the message
    // mirrors the requireMfaKey helper it replaces, verbatim).
    if (!config.mfaEncryptionKey) {
      throw new Error('MFA_ENCRYPTION_KEY not configured (32-byte hex required for TOTP)');
    }
    mfaManager = new MfaManager(config.mfaEncryptionKey, authDb()); // shared Q3A handle — no new pool
  }
  return mfaManager;
}

/** Test seam: clears the memo. Does NOT close authDb — it doesn't own it. */
export function resetMfaManager(): void {
  mfaManager = undefined;
}
