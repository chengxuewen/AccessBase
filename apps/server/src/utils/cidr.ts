/**
 * Q3E-CIDR: zero-dependency IP allow/deny matching (v4 full bit-mask, v6
 * nibble-prefix, bare-IP equality). Malformed entries fail-open PER ENTRY
 * (a typo in one CIDR must never lock the whole estate out) with a one-time
 * warn per entry. Deny list wins over allow.
 */
import { logger } from '@accessbase/logging';

const warned = new Set<string>();
function warnBad(entry: string): boolean {
  if (!warned.has(entry)) {
    warned.add(entry);
    logger.warn({ entry }, 'auth cidr list: skipping malformed entry (fail-open per entry)');
  }
  return false;
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

export function ipInCidr(ip: string, entry: string): boolean {
  const t = entry.trim();
  if (!t) return false;
  const net = t.split('/')[0] ?? '';
  const bitsRaw = t.split('/')[1];
  if (net.includes(':') || ip.includes(':')) {
    // v6 path: normalize both to 32 hex chars, prefix-compare by nibbles
    const norm = (x: string): string | null => {
      const parts = x.toLowerCase().split('::');
      if (parts.length > 2) return null;
      const head = parts[0] ? parts[0].split(':') : [];
      const tail = parts[1] ? parts[1].split(':') : [];
      const need = 8 - head.length - tail.length;
      if (parts.length === 1 && need !== 0) return null;
      if (need < 0) return null;
      const groups = [...head, ...Array.from({ length: need }, () => '0'), ...tail];
      const hex = groups.map((g) => (g === '' ? '0000' : g.padStart(4, '0'))).join('');
      return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
    };
    const a = norm(ip);
    const b = norm(net);
    if (a === null || b === null) return warnBad(entry);
    if (!bitsRaw) return a === b;
    const bits = Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) return warnBad(entry);
    const nib = Math.ceil(bits / 4);
    const mask = bits % 4 === 0 ? 0 : 0xf >> bits % 4;
    if (a.slice(0, nib - (bits % 4 === 0 ? 0 : 1)) !== b.slice(0, nib - (bits % 4 === 0 ? 0 : 1))) return false;
    if (bits % 4 !== 0) {
      const ia = parseInt(a[nib - 1] ?? '0', 16);
      const ib = parseInt(b[nib - 1] ?? '0', 16);
      return (ia & mask) === (ib & mask);
    }
    return true;
  }
  const ipN = ipv4ToInt(ip);
  const netN = ipv4ToInt(net);
  if (ipN === null || netN === null) return warnBad(entry);
  if (!bitsRaw) return ipN === netN;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return warnBad(entry);
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return (ipN & mask) === (netN >>> 0 & mask);
}

/** Parse the two option values once; empty list = disabled. */
export function cidrVerdict(
  ip: string,
  allow: string | null | undefined,
  deny: string | null | undefined,
): 'ok' | 'blocked' {
  const denyList = (deny ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (denyList.some((c) => ipInCidr(ip, c))) return 'blocked';
  const allowList = (allow ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (allowList.length > 0 && !allowList.some((c) => ipInCidr(ip, c))) return 'blocked';
  return 'ok';
}
