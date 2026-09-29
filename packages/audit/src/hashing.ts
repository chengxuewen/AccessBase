import { createHash } from 'node:crypto';

/**
 * GENESIS sentinel: foldRoot/receiptHash over an EMPTY ordered hash list.
 * Documented constant (spec D2: first anchor's prev_root uses this value).
 */
export const GENESIS = sha256Hex('');

/**
 * The exact field set hashed into a row's content hash (spec D1).
 * createdAt is a Date — serialized via toISOString() (type-aware, NOT the
 * identical ISO string; hash commits to the value's timestamp semantics).
 */
export interface AuditRowFields {
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestBody: Record<string, unknown>;
  responseStatus: number | undefined;
  requestId: string;
  ip: string;
  userAgent: string;
  createdAt: Date;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Recursive stable serialization: object keys sorted; arrays order-PRESERVING;
 * Date → tagged {"$date": ISO} form (type-aware: a Date is NOT an identical
 * ISO string); undefined properties dropped (JSON.stringify drop rule).
 * Output is deterministic regardless of insertion order (jsonb reorders keys
 * at rest — this is the reproducibility contract between writer and verifier).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return '{"$date":' + JSON.stringify(value.toISOString()) + '}';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 hex over canonicalJson of EXACTLY the D1 field set — extra
 * properties on the input object are ignored (field pick is explicit).
 */
export function rowHash(entry: AuditRowFields): string {
  return sha256Hex(
    canonicalJson({
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      requestBody: entry.requestBody,
      responseStatus: entry.responseStatus,
      requestId: entry.requestId,
      ip: entry.ip,
      userAgent: entry.userAgent,
      createdAt: entry.createdAt,
    }),
  );
}

/**
 * SHA-256 hex of hashes.join('') in the GIVEN order (empty list → GENESIS).
 */
export function foldRoot(orderedHashes: readonly string[]): string {
  if (orderedHashes.length === 0) return GENESIS;
  return sha256Hex(orderedHashes.join(''));
}

/**
 * Erasure-receipt digest — identical concat semantics to foldRoot (spec D5),
 * exported as an alias so call sites carry intent.
 */
export const receiptHash = foldRoot;
