/**
 * Q4c-T2 SSRF guard (spec 2026-09-24-q4c rev.2 §5.5, invariants B2/R6).
 *
 * FAIL-CLOSED posture — this is NOT utils/cidr.ts: `ipInCidr` warns and
 * returns false for malformed entries (a typo in an allow-list must never
 * lock the whole estate out). Here an unparseable host is a REJECTION:
 * webhook URLs are attacker-supplied, and every parsing edge we don't
 * recognize is denied by default.
 *
 * Deny-set (canonical forms, spec §5.5):
 *   v4: 127.0.0.0/8, 0.0.0.0/8, 169.254.0.0/16
 *   v6: ::1, ::, fe80::/10
 * v4-mapped v6 (::ffff:a.b.c.d AND ::ffff:HHHH:HHHH) is expanded to v4
 * BEFORE deny-matching; other embedded-v4 forms are rejected outright
 * (strict parse). RFC1918 and all public addresses + hostnames ALLOWED
 * per the Q4c SSRF ruling.
 *
 * ponytail: DNS resolution + fetch has a TOCTOU rebinding window (a name
 * can resolve to 1.2.3.4 for the guard then to 127.0.0.1 for the actual
 * connect). Killing that requires a custom undici Agent with an
 * onConnect IP pin — deferred to integration day.
 */
import { promises as dns } from 'node:dns';

export type WebhookUrlVerdict =
  | { ok: true; hostname: string }
  | { ok: false; reason: string };

/** DNS answers cache — TTL per spec §5.5 (≤30s). */
const DNS_CACHE_TTL_MS = 30_000;
const dnsCache = new Map<string, { ok: boolean; reason?: string; expiresAt: number }>();

/** Test seam: drop cached DNS verdicts. */
export function _resetWebhookUrlCache(): void {
  dnsCache.clear();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8) | Number(p);
  }
  return n >>> 0;
}

/**
 * Normalize an IPv6 literal to 32 lowercase hex chars (returns null on any
 * ambiguity — including a dotted tail unless it sits in the exact
 * `::ffff:a.b.c.d` v4-mapped shape, which the caller pre-handles).
 */
function normalizeV6(host: string): string | null {
  const parts = host.toLowerCase().split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts[1] ? parts[1].split(':') : [];
  for (const g of [...head, ...tail]) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
  }
  const need = 8 - head.length - tail.length;
  if (parts.length === 1 && need !== 0) return null;
  if (need < 0) return null;
  const groups = [...head, ...Array.from({ length: need }, () => '0'), ...tail];
  const hex = groups.map((g) => g.padStart(4, '0')).join('');
  return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

function isDeniedV4(n: number): boolean {
  const top8 = (n >>> 24) & 0xff;
  const top16 = (n >>> 16) & 0xffff;
  return top8 === 0x7f || top8 === 0x00 || top16 === 0xa9fe;
}

function isDeniedV6Hex(hex: string): boolean {
  // `::/96` covers ::, ::1 and the deprecated IPv4-compatible twins
  // (`::127.0.0.1` = ::7f00:1). The spec-set names ::1/:: explicitly; the
  // family is denied whole — fail-closed EXTENDS the exact list, never
  // inverts it (no battery case relies on a ::/96 address being allowed).
  if (/^0{24}/.test(hex)) return true;
  // fe80::/10 → first 10 bits = 0b1111111010 → hex chars 0..1 = 'fe', char 2 in {8,9,a,b}
  return hex[0] === 'f' && hex[1] === 'e' && ['8', '9', 'a', 'b'].includes(hex[2] ?? '');
}

type Classified =
  | { kind: 'deny'; reason: string }
  | { kind: 'literal'; denyIf: () => boolean }
  | { kind: 'hostname' };

/**
 * Classify a bare host (brackets already stripped). Every shape we do not
 * positively recognize is DENIED (fail-closed).
 */
function classifyHost(host: string): Classified {
  if (!host) return { kind: 'deny', reason: 'empty-host' };
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { kind: 'deny', reason: 'localhost-literal' };
  }
  if (host.includes(':')) {
    // IPv6 literal. Dotted tail is only legal as the exact `::ffff:a.b.c.d`
    // v4-mapped form (spec §5.5); every other embedded-v4 shape is rejected.
    let v4: number | null = null;
    let hexBody = host;
    if (host.includes('.')) {
      const m = /^::ffff:(.+)$/i.exec(host);
      if (!m || !m[1]) return { kind: 'deny', reason: 'embedded-v4-not-v4-mapped' };
      v4 = ipv4ToInt(m[1]);
      if (v4 === null) return { kind: 'deny', reason: 'bad-v4-in-v6-tail' };
      hexBody = '::ffff:0:0'; // placeholder — v4 already extracted, deny-check routed via v4
    }
    const hex = normalizeV6(hexBody);
    if (hex === null) return { kind: 'deny', reason: 'unparseable-ipv6' };
    if (v4 !== null) {
      const v4int = v4;
      return { kind: 'literal', denyIf: () => isDeniedV4(v4int) };
    }
    // Canonicalize pure-hex v4-mapped (`::ffff:HHHH:HHHH`) to v4 before deny
    // (80 leading zero bits = 20 hex zeros, then the ffff marker).
    if (hex.slice(0, 20) === '0'.repeat(20) && hex.slice(20, 24) === 'ffff') {
      const mapped = parseInt(hex.slice(24, 32), 16) >>> 0;
      return { kind: 'literal', denyIf: () => isDeniedV4(mapped) };
    }
    return { kind: 'literal', denyIf: () => isDeniedV6Hex(hex) };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const n = ipv4ToInt(host);
    if (n === null) return { kind: 'deny', reason: 'bad-ipv4' };
    return { kind: 'literal', denyIf: () => isDeniedV4(n) };
  }
  return { kind: 'hostname' };
}

/**
 * Structural + literal check on a webhook URL (no DNS). Any literal IP in
 * the deny-set rejects; a hostname passes here and must additionally be
 * run through `resolveDeniedIps` at dispatch time.
 */
export function assertWebhookUrl(raw: string): WebhookUrlVerdict {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable-url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'scheme-not-http(s)' };
  }
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'userinfo-forbidden' };
  if (u.hash !== '') return { ok: false, reason: 'fragment-forbidden' };
  // WHATWG URL keeps the [] brackets on IPv6 hostnames AND canonicalizes
  // `::ffff:127.0.0.1` to hex `[::ffff:7f00:1]` — so a dotted-embedded
  // form is only detectable in the RAW bracketed text. Fail-closed:
  // any bracketed host containing '.' that is not the exact v4-mapped
  // shape (`::ffff:a.b.c.d`) is rejected before the hex host is parsed.
  const bracket = /\[([^\]]*)\]/.exec(raw);
  if (bracket && bracket[1]?.includes('.') && !/^::ffff:[\d.]+$/i.test(bracket[1] ?? '')) {
    return { ok: false, reason: 'embedded-v4-not-v4-mapped' };
  }
  const host = (u.hostname ?? '').replace(/^\[/, '').replace(/\]$/, '');
  const cls = classifyHost(host);
  if (cls.kind === 'deny') return { ok: false, reason: cls.reason };
  if (cls.kind === 'literal' && cls.denyIf()) return { ok: false, reason: 'denied-ip-literal' };
  return { ok: true, hostname: host };
}

/**
 * DNS-leg check for a bare hostname (already passed assertWebhookUrl).
 * Every answer is canonicalized and re-matched against the deny-set; any
 * un-classifiable answer rejects (fail-closed). Verdict cached ≤30s.
 */
export async function resolveDeniedIps(
  hostname: string,
  lookup?: (host: string, opts: { all: true }) => Promise<Array<{ address: string; family: number }>>,
): Promise<WebhookUrlVerdict> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ok ? { ok: true, hostname } : { ok: false, reason: cached.reason ?? 'cached-deny' };
  }
  const fn = lookup ?? ((h: string, o: { all: true }) => dns.lookup(h, o));
  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await fn(hostname, { all: true });
  } catch {
    dnsCache.set(hostname, { ok: false, reason: 'dns-lookup-failed', expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    return { ok: false, reason: 'dns-lookup-failed' };
  }
  if (answers.length === 0) {
    dnsCache.set(hostname, { ok: false, reason: 'dns-empty', expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    return { ok: false, reason: 'dns-empty' };
  }
  for (const a of answers) {
    const cls = classifyHost(a.address);
    // Every answer must be a literal (never another hostname) AND not denied.
    if (cls.kind === 'deny' || cls.kind === 'hostname') {
      dnsCache.set(hostname, { ok: false, reason: 'dns-answer-unclassifiable', expiresAt: Date.now() + DNS_CACHE_TTL_MS });
      return { ok: false, reason: 'dns-answer-unclassifiable' };
    }
    if (cls.denyIf()) {
      dnsCache.set(hostname, { ok: false, reason: 'dns-answer-denied', expiresAt: Date.now() + DNS_CACHE_TTL_MS });
      return { ok: false, reason: 'dns-answer-denied' };
    }
  }
  dnsCache.set(hostname, { ok: true, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
  return { ok: true, hostname };
}
