/**
 * SL-2 session-idle zero-dep reader leaf (spec 2026-09-29-session-lifetime
 * rev.2 D2 config-plane). Pure 3-tier resolver: env (numeric, incl '0') >
 * option (numeric incl 0) > fallback 86400. Garbage/negative in a tier =
 * that tier invalid → fall through (never bricks the knob). 0 = OFF (valid).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveIdleTimeoutSeconds,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
} from '../services/session-idle.js';

describe('resolveIdleTimeoutSeconds (SL-2)', () => {
  it('defaults to 86400 when both tiers absent', () => {
    expect(resolveIdleTimeoutSeconds(undefined, undefined)).toBe(86400);
    expect(resolveIdleTimeoutSeconds(null, null)).toBe(86400);
    expect(resolveIdleTimeoutSeconds('', '')).toBe(86400);
    expect(DEFAULT_IDLE_TIMEOUT_SECONDS).toBe(86400);
  });

  it('env numeric wins over option, including 0 (explicit off)', () => {
    expect(resolveIdleTimeoutSeconds('0', '3600')).toBe(0);
    expect(resolveIdleTimeoutSeconds('7200', '3600')).toBe(7200);
    expect(resolveIdleTimeoutSeconds('3600', undefined)).toBe(3600);
  });

  it('env garbage/negative falls through to option tier', () => {
    expect(resolveIdleTimeoutSeconds('abc', '3600')).toBe(3600);
    expect(resolveIdleTimeoutSeconds('-5', '3600')).toBe(3600);
    expect(resolveIdleTimeoutSeconds('30abc', '7200')).toBe(7200);
  });

  it('option numeric wins over default, including 0 (explicit off)', () => {
    expect(resolveIdleTimeoutSeconds(undefined, '0')).toBe(0);
    expect(resolveIdleTimeoutSeconds(undefined, '43200')).toBe(43200);
    // OptionsManager jsonb values arrive as native numbers (PIT-045)
    expect(resolveIdleTimeoutSeconds(undefined, 3600)).toBe(3600);
    expect(resolveIdleTimeoutSeconds(undefined, 0)).toBe(0);
  });

  it('option garbage/negative falls through to default', () => {
    expect(resolveIdleTimeoutSeconds(undefined, 'abc')).toBe(86400);
    expect(resolveIdleTimeoutSeconds(undefined, -1)).toBe(86400);
    expect(resolveIdleTimeoutSeconds('abc', 'oops')).toBe(86400);
    // jsonb object/boolean junk is not a number-string — rejected
    expect(resolveIdleTimeoutSeconds(undefined, true)).toBe(86400);
    expect(resolveIdleTimeoutSeconds(undefined, { seconds: 5 })).toBe(86400);
  });

  it('custom fallback honored when both tiers invalid', () => {
    expect(resolveIdleTimeoutSeconds(undefined, undefined, 60)).toBe(60);
    expect(resolveIdleTimeoutSeconds('x', 'y', 0)).toBe(0);
  });

  it('negative = invalid tier (documented rule), 0 = valid off', () => {
    expect(resolveIdleTimeoutSeconds('-5', '-1')).toBe(86400);
    expect(resolveIdleTimeoutSeconds('0', '-1')).toBe(0);
  });
});
