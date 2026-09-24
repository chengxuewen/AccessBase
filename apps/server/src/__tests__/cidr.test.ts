import { describe, it, expect } from 'vitest';
import { ipInCidr, cidrVerdict } from '../utils/cidr.js';

describe('ipInCidr (Q3E)', () => {
  it('v4 bit-mask + prefix + bare equality', () => {
    expect(ipInCidr('10.1.2.3', '10.1.0.0/16')).toBe(true);
    expect(ipInCidr('10.2.2.3', '10.1.0.0/16')).toBe(false);
    expect(ipInCidr('10.1.2.3', '10.1.2.3')).toBe(true);
    expect(ipInCidr('10.1.2.3', '10.1.2.4')).toBe(false);
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('255.255.255.255', '128.0.0.0/1')).toBe(true);
    expect(ipInCidr('127.0.0.1', '128.0.0.0/1')).toBe(false);
  });
  it('v6 nibble-prefix + /48 + bare', () => {
    expect(ipInCidr('2001:db8:1234::1', '2001:db8:1200::/40')).toBe(true);
    expect(ipInCidr('2001:db8:abcd::1', '2001:db8:1200::/40')).toBe(false);
    expect(ipInCidr('::1', '0:0:0:0:0:0:0:1')).toBe(true);
    expect(ipInCidr('fe80::1', 'fe80::/10')).toBe(true);
  });
  it('malformed entries fail open per-entry (no throw, no lockout)', () => {
    expect(ipInCidr('10.0.0.1', 'not-an-ip/999')).toBe(false);
    expect(ipInCidr('10.0.0.1', '10.0.0.0/xx')).toBe(false);
    // non-empty allow list stays whitelist-mode even if every entry is garbage:
    // fail-CLOSED at the list level (a typo must never open a bypass)
    expect(cidrVerdict('10.0.0.1', 'garbage/', '')).toBe('blocked');
  });
});

describe('cidrVerdict', () => {
  it('empty lists = disabled; deny wins; allow whitelist mode', () => {
    expect(cidrVerdict('1.1.1.1', '', '')).toBe('ok');
    expect(cidrVerdict('1.1.1.1', '0.0.0.0/0', '1.1.1.0/24')).toBe('blocked');
    expect(cidrVerdict('2.2.2.2', '2.2.0.0/16', '1.1.1.0/24')).toBe('ok');
    expect(cidrVerdict('3.3.3.3', '2.2.0.0/16', '')).toBe('blocked');
  });
});
