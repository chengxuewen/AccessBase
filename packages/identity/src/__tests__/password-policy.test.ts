/**
 * PasswordPolicy helper — 5-dimension password policy with options-driven
 * overrides (Batch C Task 4 / C2).
 *
 * R12 / PIT-045: test seams inject REAL jsonb types (4 not "4", true not
 * "true"); env fallbacks arrive as strings. readPasswordPolicy must accept
 * both forms via defensive coercion.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assertPasswordPolicy, readPasswordPolicy } from '../services/password-policy.js';
import type { PasswordPolicy } from '../services/password-policy.js';

describe('assertPasswordPolicy', () => {
  const strict: PasswordPolicy = {
    minLength: 12,
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSpecial: true,
  };

  it('accepts a password meeting all five dimensions', () => {
    expect(assertPasswordPolicy('Str0ng!Pass12', strict)).toEqual({ ok: true });
  });

  it('rejects below minLength', () => {
    const r = assertPasswordPolicy('Ab1!x', strict);
    expect(r.ok).toBe(false);
  });

  it('rejects missing uppercase', () => {
    expect(assertPasswordPolicy('weakpass1!xyz'.slice(0, 12), strict).ok).toBe(false);
  });

  it('rejects missing lowercase', () => {
    expect(assertPasswordPolicy('WEAKPASS1!XY', strict).ok).toBe(false);
  });

  it('rejects missing digit', () => {
    expect(assertPasswordPolicy('WeakPass!word', strict).ok).toBe(false);
  });

  it('rejects missing special when required', () => {
    expect(assertPasswordPolicy('WeakPass12345', strict).ok).toBe(false);
  });

  it('does NOT require special when requireSpecial is false (register default)', () => {
    const register: PasswordPolicy = { ...strict, minLength: 8, requireSpecial: false };
    expect(assertPasswordPolicy('Passw0rd!', register)).toEqual({ ok: true });
    expect(assertPasswordPolicy('Passw0rd', register)).toEqual({ ok: true });
  });

  it('boundary: exactly minLength passes', () => {
    expect(assertPasswordPolicy('Ab1!Ab1!Ab1!', { ...strict, minLength: 11 }).ok).toBe(true);
  });

  it('ok:false result carries code and message when supplied by caller', () => {
    const r = assertPasswordPolicy('weak', strict, 'AUTH_REG_002');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('AUTH_REG_002');
    expect(typeof r.message).toBe('string');
  });

  it('ok:true result carries no code/message', () => {
    const r = assertPasswordPolicy('Str0ng!Pass12', strict, 'AUTH_REG_002');
    expect(r.code).toBeUndefined();
    expect(r.message).toBeUndefined();
  });

  it('each dimension independently triggers rejection', () => {
    const base: PasswordPolicy = {
      minLength: 8,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: false,
    };
    // missing upper only
    expect(assertPasswordPolicy('alllower1x', base).ok).toBe(false);
    // missing lower only
    expect(assertPasswordPolicy('ALLUPPER1X', base).ok).toBe(false);
    // missing digit only
    expect(assertPasswordPolicy('AllLetterxX', base).ok).toBe(false);
    // meets all
    expect(assertPasswordPolicy('AllGood1x', base).ok).toBe(true);
  });
});

describe('readPasswordPolicy — jsonb-typed seams (R12/PIT-045)', () => {
  /** Minimal OptionsManager.get stand-in backed by a jsonb-shaped record. */
  function optsFrom(values: Record<string, unknown>) {
    return {
      get: vi.fn(async <T>(key: string, _env: T | undefined, def: T) =>
        key in values ? (values[key] as T) : def,
      ),
    };
  }

  it('register callsite defaults when NO options and NO env: {8,T,T,T,F}', async () => {
    const policy = await readPasswordPolicy(optsFrom({}).get, 'register');
    expect(policy).toEqual({
      minLength: 8,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: false,
    });
  });

  it('change/reset callsite defaults when NO options and NO env: {12,T,T,T,T}', async () => {
    const policy = await readPasswordPolicy(optsFrom({}).get, 'password-change');
    expect(policy).toEqual({
      minLength: 12,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: true,
    });
  });

  it('jsonb-typed options override callsite defaults (4 and true, NOT strings)', async () => {
    const policy = await readPasswordPolicy(
      optsFrom({ password_min_length: 4, password_require_special: true }).get,
      'register',
    );
    expect(policy.minLength).toBe(4);
    expect(policy.requireSpecial).toBe(true);
  });

  it('jsonb false overrides default true', async () => {
    const policy = await readPasswordPolicy(
      optsFrom({ password_require_upper: false }).get,
      'password-change',
    );
    expect(policy.requireUpper).toBe(false);
  });

  it('env-string seams are coerced: "4" → 4, "true" → true', async () => {
    const policy = await readPasswordPolicy(
      optsFrom({
        password_min_length: '4',
        password_require_special: 'true',
        password_require_upper: 'false',
      }).get,
      'register',
    );
    expect(policy.minLength).toBe(4);
    expect(policy.requireSpecial).toBe(true);
    expect(policy.requireUpper).toBe(false);
  });

  it('partial overrides keep other dimensions at callsite defaults', async () => {
    const policy = await readPasswordPolicy(
      optsFrom({ password_min_length: 16 }).get,
      'register',
    );
    expect(policy).toEqual({
      minLength: 16,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: false, // register default, not the change/reset default
    });
  });

  it('garbage minLength falls back to the callsite default (defensive)', async () => {
    const policy = await readPasswordPolicy(
      optsFrom({ password_min_length: 'not-a-number' }).get,
      'register',
    );
    expect(policy.minLength).toBe(8);
  });

  it('env "TRUE" (uppercase) is now honored — asBool hardened case-insensitively', async () => {
    const policy = await readPasswordPolicy(
      optsFrom({ password_require_special: 'TRUE' }).get,
      'register',
    );
    expect(policy.requireSpecial).toBe(true); // previously silently fell back to default
  });

  it('"True" (mixed case) still enables the dimension', async () => {
    const policy = await readPasswordPolicy(
      optsFrom({ password_require_special: 'True' }).get,
      'register',
    );
    expect(policy.requireSpecial).toBe(true);
  });
});
