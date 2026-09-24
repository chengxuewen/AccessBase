/**
 * Q4c-T2 SSRF guard unit battery (spec 2026-09-24-q4c rev.2 §8.2 — the
 * list is verbatim; invariant 2). No real DNS anywhere: the resolver leg
 * runs against fake lookups only (dispatcher invariant 6: dial nothing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertWebhookUrl,
  resolveDeniedIps,
  _resetWebhookUrlCache,
} from '../utils/webhook-url.js';

beforeEach(() => {
  _resetWebhookUrlCache();
});

describe('assertWebhookUrl — §8.2 deny battery (literals, sync leg)', () => {
  const DENY = [
    'http://localhost',
    'http://localhost:8080/hooks',
    'http://evil.localhost/',
    'http://127.0.0.2',
    'http://127.1.1.1/',
    'http://[::1]',
    'http://[::]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:7f00:1]',
    'http://169.254.169.254/latest/meta-data',
    'http://0.1.2.3',
    'http://[fe80::1]',
    'http://[febf::2]/',
  ];
  for (const url of DENY) {
    it(`denies ${url}`, () => {
      expect(assertWebhookUrl(url).ok).toBe(false);
    });
  }

  const ALLOW = [
    'http://10.0.0.5',
    'http://192.168.1.1:3000/events',
    'https://172.16.3.9/hook',
    'http://8.8.8.8',
    'https://example.com/hooks/v1',
  ];
  for (const url of ALLOW) {
    it(`allows ${url} (RFC1918/public per ruling)`, () => {
      const v = assertWebhookUrl(url);
      expect(v.ok).toBe(true);
    });
  }

  it('rejects non-http(s) schemes and garbage', () => {
    expect(assertWebhookUrl('ftp://example.com').ok).toBe(false);
    expect(assertWebhookUrl('http://').ok).toBe(false);
    expect(assertWebhookUrl('not a url').ok).toBe(false);
    expect(assertWebhookUrl('file:///etc/passwd').ok).toBe(false);
  });

  it('rejects userinfo and fragments', () => {
    expect(assertWebhookUrl('http://admin:pw@example.com/').ok).toBe(false);
    expect(assertWebhookUrl('http://example.com/#frag').ok).toBe(false);
    expect(assertWebhookUrl('https://u@example.com/x').ok).toBe(false);
  });

  it('rejects embedded-v4 shapes that are NOT the ::ffff: v4-mapped form', () => {
    // WHATWG canonicalizes 64:ff9b::1.2.3.4 → 64:ff9b::102:304 — a pure-hex
    // v6 that is neither v4-mapped nor in the v6 deny-set; the strict rule
    // the contract names applies to the dotted form before canonicalization.
    expect(assertWebhookUrl('http://[64:ff9b::1.2.3.4]/').ok).toBe(false);
    // `::1.2.3.4` canonicalizes to `::102:304` — inside the deprecated
    // IPv4-compatible `::/96` family, which the guard denies whole (:: and
    // ::1 — both spec-named — are its members; see webhook-url.ts note).
    expect(assertWebhookUrl('http://[::102:304]/').ok).toBe(false);
    expect(assertWebhookUrl('http://[::7f00:1]/').ok).toBe(false); // ::127.0.0.1
  });

  it('::ffff:10.0.0.5 maps to v4 and follows the v4 ruling (RFC1918 allowed)', () => {
    expect(assertWebhookUrl('http://[::ffff:10.0.0.5]/').ok).toBe(true);
    expect(assertWebhookUrl('http://[::ffff:127.0.0.5]/').ok).toBe(false);
  });
});

describe('resolveDeniedIps — resolver leg (fake lookup only)', () => {
  it('hostname resolving to 127.0.0.1 is denied via the resolver leg', async () => {
    const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);
    const gate = assertWebhookUrl('http://internal.corp.example');
    expect(gate.ok).toBe(true); // sync leg cannot see the IP
    if (!gate.ok) return;
    const v = await resolveDeniedIps(gate.hostname, lookup);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe('dns-answer-denied');
  });

  it('ALL answers are checked — one public + one loopback denies', async () => {
    const lookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '::1', family: 6 as const },
    ]);
    expect((await resolveDeniedIps('weird.ha.example', lookup)).ok).toBe(false);
  });

  it('un-classifiable answer shape denies (fail-closed)', async () => {
    const lookup = vi.fn(async () => [{ address: 'not-an-ip', family: 4 as const }]);
    expect((await resolveDeniedIps('ha.example', lookup)).ok).toBe(false);
    const lookup6 = vi.fn(async () => [{ address: '999.1.1.1', family: 4 as const }]);
    expect((await resolveDeniedIps('ha2.example', lookup6)).ok).toBe(false);
  });

  it('empty answers and lookup errors deny', async () => {
    expect((await resolveDeniedIps('nx.example', async () => [])).ok).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    expect((await resolveDeniedIps('nx.example', boom)).ok).toBe(false);
  });

  it('public answers pass; verdict cached ≤30s (second call does not re-resolve)', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
    expect((await resolveDeniedIps('good.example', lookup)).ok).toBe(true);
    expect((await resolveDeniedIps('good.example', lookup)).ok).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    // Denied verdicts are cached too.
    const bad = vi.fn(async () => [{ address: '169.254.169.254', family: 4 as const }]);
    expect((await resolveDeniedIps('meta.example', bad)).ok).toBe(false);
    expect((await resolveDeniedIps('meta.example', bad)).ok).toBe(false);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('cache expiry: after 30s the resolver runs again', async () => {
    vi.useFakeTimers();
    try {
      const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
      expect((await resolveDeniedIps('ttl.example', lookup)).ok).toBe(true);
      await vi.advanceTimersByTimeAsync(30_001);
      expect((await resolveDeniedIps('ttl.example', lookup)).ok).toBe(true);
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
