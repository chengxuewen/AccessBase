/**
 * 4A T4 — per-key CIDR gate (spec rev.4 §3 T4; rulings R5 / F-04 / F-16 /
 * P-7=B). Reuses the Q3E zero-dependency matcher (utils/cidr.ts) — the
 * webhook SSRF guard is a SEPARATE impl (panel F-19) and is NOT involved.
 *
 * Deliberate divergences from the login-side cidrVerdict posture (F-16):
 *   - `null`/undefined allowlist = UNRESTRICTED (backward compat — existing
 *     keys keep their behavior; this is the documented default).
 *   - `[]` = DENY ALL (fail-CLOSED). CRUD rejects empty arrays (400), so this
 *     shape can only appear through hand-edited rows — locking the door is
 *     the right failure for a key whose owner asked for an allowlist that
 *     got emptied.
 *   - malformed entries = that entry DENIES (fail-CLOSED, key-scoped). The
 *     login-side matcher is fail-open per entry to avoid estate-wide lockout;
 *     a per-key gate has blast radius one key, and an unparseable entry must
 *     never silently widen the door. CRUD validation (validateCidrAllowlist)
 *     keeps malformed entries out of the database in the first place.
 *   - v4-mapped IPv6 (::ffff:a.b.c.d) is normalized on BOTH sides before
 *     matching — webhook-url.ts's normalize precedent, F-16 RED-locked.
 *
 * P-7=B (panel run 2 CONFLICT-3): a CIDR gate compares request.ip against
 * entries — but TRUST_PROXY=true makes Fastify trust the ENTIRE
 * X-Forwarded-For chain, so request.ip is CLIENT-CONTROLLED and the gate is
 * security theater. proxyGuardVerdict encodes the boot posture: prod boots
 * with that combination FAIL-FAST (requireJwtSecret class — a fake lock is
 * worse than a refused boot); dev warns. The DB-dependent check runs at
 * startup only (NOT in the env-only warnDegradedChecks pure fn).
 */
import { ipInCidr } from './cidr.js';

/** Expand a v4-mapped IPv6 address (::ffff:a.b.c.d) to plain dotted quad. */
export function normalizeV4Mapped(addr: string): string {
  const lower = addr.toLowerCase();
  if (lower.startsWith('::ffff:') && !lower.slice(7).includes(':')) {
    return lower.slice(7);
  }
  return addr;
}

/** Strict single-entry validation for CRUD writes (never persists junk).
 * Validates the NORMALIZED form — the gate matches v4-mapped-normalized
 * entries, so '::ffff:10.0.0.0/8' must validate exactly like '10.0.0.0/8'. */
export function isValidCidrEntry(entry: string): boolean {
  const t = normalizeV4Mapped(entry.trim());
  if (!t) return false;
  const [net, bitsRaw, ...rest] = t.split('/');
  if (!net || rest.length > 0) return false;
  if (bitsRaw !== undefined) {
    const bits = Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0) return false;
    if (net.includes(':') ? bits > 128 : bits > 32) return false;
  }
  // Structural probe: a valid entry must match its own network address.
  return ipInCidr(net, t);
}

/**
 * The per-key gate. Semantics documented in the header. `ip` may be
 * v4-mapped (proxies commonly emit ::ffff: forms) — normalized first.
 */
export function apiKeyAllowedByCidr(
  allowlist: unknown,
  requestIp: string,
): boolean {
  if (allowlist === null || allowlist === undefined) return true; // unrestricted
  if (!Array.isArray(allowlist)) return false; // jsonb junk → fail-closed
  if (allowlist.length === 0) return false; // [] → deny all (see header)
  const ip = normalizeV4Mapped(requestIp);
  // Pre-validate EVERY entry BEFORE matching (fail-closed): a junk or
  // malformed entry denies the key outright — "first entry matched" must
  // never let a trailing malformed entry silently widen the door.
  const entries: string[] = [];
  for (const raw of allowlist) {
    if (typeof raw !== 'string') return false;
    const entry = normalizeV4Mapped(raw.trim());
    if (!isValidCidrEntry(entry)) return false;
    entries.push(entry);
  }
  return entries.some((entry) => ipInCidr(ip, entry));
}

/** CRUD-side validation: accepts `string[]` (non-empty, parseable) or
 * null/undefined (unrestricted). Empty arrays and junk are rejected. */
export function validateCidrAllowlistInput(
  value: unknown,
): { ok: true; value: string[] | null } | { ok: false; reason: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'cidrAllowlist must be an array of CIDR strings or null' };
  }
  if (value.length === 0) {
    return {
      ok: false,
      reason: 'cidrAllowlist must not be an empty array — omit the field (or null) for unrestricted access',
    };
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || !isValidCidrEntry(entry)) {
      return { ok: false, reason: `cidrAllowlist contains an invalid CIDR entry: ${String(entry)}` };
    }
  }
  return { ok: true, value: (value as string[]).map((e) => e.trim()) };
}

/**
 * Boot posture matrix (P-7=B). Pure — the DB-dependent wiring lives at the
 * call site; this function only encodes the verdict.
 */
export function proxyGuardVerdict(
  nodeEnv: string,
  trustProxy: unknown,
  anyKeyUsesCidr: boolean,
): 'fail-fast' | 'warn' | 'ok' {
  if (!anyKeyUsesCidr) return 'ok'; // no gate active — posture irrelevant
  if (trustProxy !== true) return 'ok'; // hop-count/CIDR config — ip is trustworthy
  return nodeEnv === 'production' ? 'fail-fast' : 'warn';
}
