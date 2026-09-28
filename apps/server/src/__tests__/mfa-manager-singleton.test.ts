/**
 * R1-T1 — MfaManager process singleton lock (H1 pool leak).
 *
 * The old auth.ts closure factory built `new MfaManager(key)` per call and the
 * ctor dials createDb (a fresh pg Pool) when no handle is passed — the last
 * live PIT-081 site. These tests lock the memo in utils/mfa-manager.ts:
 * one construction per reset cycle, the shared authDb() handle passed
 * through, and a key-miss never poisoning the slot.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';

// Stand-ins for the two collaborators the memo touches. Defined before the
// vi.mock factories below (factories run at dynamic-import time, when these
// consts are already initialized — same shape as mfa.test.ts).
const fakeDb = { __fakeAuthDbHandle: true };
const MfaManagerSpy = vi.fn().mockImplementation(() => ({ tag: 'instance' }));
const testConfig = { mfaEncryptionKey: 'ab'.repeat(32) };

// Partial mocks: the memo module statically touches ONLY these exports.
// Undeclared keys would throw at link time (PIT-082) — roster kept minimal on purpose.
vi.mock('@accessbase/identity', () => ({ MfaManager: MfaManagerSpy }));
vi.mock('../utils/managers.js', () => ({ authDb: () => fakeDb }));
vi.mock('../config.js', () => ({ config: testConfig }));

const { getMfaManager, resetMfaManager } = await import('../utils/mfa-manager.js');

beforeEach(() => {
  resetMfaManager();
  MfaManagerSpy.mockClear();
  testConfig.mfaEncryptionKey = 'ab'.repeat(32);
});

describe('getMfaManager memo (R1-T1)', () => {
  it('constructs once and reuses the instance, over the shared authDb() handle', () => {
    const a = getMfaManager();
    const b = getMfaManager();
    expect(a).toBe(b);
    expect(MfaManagerSpy).toHaveBeenCalledTimes(1);
    // ctor args: (key, shared Q3A handle) — NO new pool (Momus R3/R6)
    expect(MfaManagerSpy.mock.calls[0]?.[0]).toBe('ab'.repeat(32));
    expect(MfaManagerSpy.mock.calls[0]?.[1]).toBe(fakeDb);
  });

  it('resetMfaManager() clears the memo so the next call reconstructs', () => {
    const a = getMfaManager();
    resetMfaManager();
    const b = getMfaManager();
    expect(b).not.toBe(a);
    expect(MfaManagerSpy).toHaveBeenCalledTimes(2);
  });

  it('throws the established message when the key is unset — slot not poisoned', () => {
    testConfig.mfaEncryptionKey = '';
    expect(() => getMfaManager()).toThrow(
      'MFA_ENCRYPTION_KEY not configured (32-byte hex required for TOTP)',
    );
    expect(MfaManagerSpy).not.toHaveBeenCalled();
    // re-stub the key: the failed lookup must NOT have cached anything
    testConfig.mfaEncryptionKey = 'ab'.repeat(32);
    const a = getMfaManager();
    expect(a).toBeTruthy();
    expect(MfaManagerSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resetManagers wiring (static lock)', () => {
  it('managers.ts resetManagers() calls resetMfaManager() (Q2a seam)', () => {
    const src = readFileSync(new URL('../utils/managers.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/import \{ resetMfaManager \} from '\.\/mfa-manager\.js'/);
    expect(src).toMatch(
      /export async function resetManagers\(\): Promise<void> \{[\s\S]*?resetMfaManager\(\);/,
    );
  });
});
