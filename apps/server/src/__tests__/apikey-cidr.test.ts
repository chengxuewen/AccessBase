/**
 * 4A T4 — per-key CIDR gate pure-matrix locks (spec rev.4 §3 T4; F-16 both
 * halves: [] semantics + v4-mapped normalization; P-7=B verdict matrix).
 * The DB-free lane tests (authenticate/SCIM wiring) ride integration — the
 * pure contracts here are what the lanes consume.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeV4Mapped,
  apiKeyAllowedByCidr,
  validateCidrAllowlistInput,
  isValidCidrEntry,
  proxyGuardVerdict,
} from '../utils/apikey-cidr.js';

describe('v4-mapped normalization (F-16, webhook-url precedent)', () => {
  it('expands ::ffff:a.b.c.d on the request side', () => {
    expect(normalizeV4Mapped('::ffff:10.0.0.9')).toBe('10.0.0.9');
    expect(normalizeV4Mapped('::FFFF:10.0.0.9')).toBe('10.0.0.9');
    expect(normalizeV4Mapped('10.0.0.9')).toBe('10.0.0.9');
    // a real v6 address must NOT be mangled
    expect(normalizeV4Mapped('::1')).toBe('::1');
    expect(normalizeV4Mapped('fe80::1')).toBe('fe80::1');
  });

  it('mapped request IP matches plain v4 CIDR entries (THE red-lock)', () => {
    expect(apiKeyAllowedByCidr(['10.0.0.0/8'], '::ffff:10.1.2.3')).toBe(true);
    expect(apiKeyAllowedByCidr(['10.0.0.0/8'], '::ffff:192.168.1.1')).toBe(false);
  });

  it('mapped entries also normalize (either side may be v4-mapped)', () => {
    expect(apiKeyAllowedByCidr(['::ffff:10.0.0.0/8'], '10.9.9.9')).toBe(true);
    expect(isValidCidrEntry('::ffff:10.0.0.0/8')).toBe(true);
  });
});

describe('per-key gate semantics (F-16 fail-closed family)', () => {
  it('null/undefined = UNRESTRICTED (backward compat — existing keys unchanged)', () => {
    expect(apiKeyAllowedByCidr(null, '1.2.3.4')).toBe(true);
    expect(apiKeyAllowedByCidr(undefined, '1.2.3.4')).toBe(true);
  });

  it('[] = DENY ALL (fail-closed; CRUD rejects empty arrays so this is hand-edit territory)', () => {
    expect(apiKeyAllowedByCidr([], '127.0.0.1')).toBe(false);
  });

  it('junk shapes (non-array, non-string entries) deny — fail-closed per key', () => {
    expect(apiKeyAllowedByCidr({ not: 'a list' }, '10.0.0.1')).toBe(false);
    expect(apiKeyAllowedByCidr(['10.0.0.0/8', 42], '10.0.0.1')).toBe(false);
  });

  it('malformed ENTRY denies (per-key blast radius = one key; NOT the login-side fail-open)', () => {
    expect(apiKeyAllowedByCidr(['not-a-cidr', '10.0.0.0/8'], '10.5.5.5')).toBe(false);
    expect(apiKeyAllowedByCidr(['10.0.0.0/33'], '10.5.5.5')).toBe(false);
  });

  it('valid v4/v6 CIDR match and non-match', () => {
    expect(apiKeyAllowedByCidr(['10.0.0.0/8', '192.168.1.1/32'], '192.168.1.1')).toBe(true);
    expect(apiKeyAllowedByCidr(['2001:db8::/32'], '2001:db8:0:0:0:0:0:1')).toBe(true);
    expect(apiKeyAllowedByCidr(['2001:db8::/32'], '2001:db9::1')).toBe(false);
    expect(apiKeyAllowedByCidr(['10.0.0.5'], '10.0.0.5')).toBe(true); // bare IP entry
  });
});

describe('CRUD validation (keeps junk out of the database)', () => {
  it('null/undefined → null (unrestricted)', () => {
    expect(validateCidrAllowlistInput(undefined)).toEqual({ ok: true, value: null });
    expect(validateCidrAllowlistInput(null)).toEqual({ ok: true, value: null });
  });

  it('empty array REJECTED (never routed to the gate — F-16 contract)', () => {
    const r = validateCidrAllowlistInput([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('empty');
  });

  it('malformed entries rejected with the offending value named', () => {
    const r = validateCidrAllowlistInput(['10.0.0.0/8', 'bogus']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('bogus');
  });

  it('valid list passes through trimmed', () => {
    expect(validateCidrAllowlistInput([' 10.0.0.0/8 ', '192.168.1.1/32'])).toEqual({
      ok: true,
      value: ['10.0.0.0/8', '192.168.1.1/32'],
    });
  });
});

describe('boot posture verdict (P-7=B — prod fail-fast / dev warn)', () => {
  it('no keys with allowlists → ok regardless of trustProxy', () => {
    expect(proxyGuardVerdict('production', true, false)).toBe('ok');
    expect(proxyGuardVerdict('development', true, false)).toBe('ok');
  });

  it('keys gated + trustProxy NOT boolean-true (hop-count/CIDR config) → ok', () => {
    expect(proxyGuardVerdict('production', 2, true)).toBe('ok');
    expect(proxyGuardVerdict('production', '10.0.0.0/8', true)).toBe('ok');
    expect(proxyGuardVerdict('production', false, true)).toBe('ok');
  });

  it('keys gated + trustProxy=true: prod FAILS FAST (auth-integrity class), dev WARNS', () => {
    expect(proxyGuardVerdict('production', true, true)).toBe('fail-fast');
    expect(proxyGuardVerdict('development', true, true)).toBe('warn');
    expect(proxyGuardVerdict('test', true, true)).toBe('warn');
  });
});
