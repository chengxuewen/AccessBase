import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  rowHash,
  foldRoot,
  receiptHash,
  GENESIS,
  type AuditRowFields,
} from '../hashing.js';

const base: AuditRowFields = {
  tenantId: 't1',
  userId: 'u1',
  action: 'CREATE',
  resourceType: 'user',
  resourceId: 'r1',
  requestBody: { name: 'Test' },
  responseStatus: 201,
  requestId: 'req-1',
  ip: '127.0.0.1',
  userAgent: 'vitest',
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
};

describe('canonicalJson', () => {
  it('is key-order independent (shuffled insertion → equal)', () => {
    const a = { b: 1, a: 2, c: { y: 1, x: 2 } };
    const b = { c: { x: 2, y: 1 }, a: 2, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order (different order → different string)', () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
    expect(canonicalJson({ k: [1, 2] })).not.toBe(canonicalJson({ k: [2, 1] }));
  });

  it('serializes Date as tagged {$date: ISO} form (type-aware)', () => {
    expect(canonicalJson({ d: new Date('2026-01-02T03:04:05.678Z') })).toBe(
      '{"d":{"$date":"2026-01-02T03:04:05.678Z"}}',
    );
  });

  it('is type-aware: Date vs identical ISO string DIFFER', () => {
    const viaDate = canonicalJson({ t: new Date('2026-01-02T03:04:05.678Z') });
    const viaString = canonicalJson({ t: '2026-01-02T03:04:05.678Z' });
    expect(viaDate).not.toBe(viaString);
  });

  it('drops undefined properties (JSON.stringify drop rule)', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('keeps null, numbers/strings/booleans verbatim (keys sorted)', () => {
    expect(canonicalJson({ n: null, x: 1, s: 'x', b: true })).toBe(
      '{"b":true,"n":null,"s":"x","x":1}',
    );
  });

  it('is stable for nested objects at any depth', () => {
    const a = { o: { p: { z: 1, a: [1, { k2: 2, k1: 1 }] } } };
    const b = { o: { p: { a: [1, { k1: 1, k2: 2 }], z: 1 } } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe('rowHash', () => {
  it('is stable over the spec D1 field set', () => {
    expect(rowHash(base)).toBe(rowHash({ ...base }));
    // 64 hex chars = sha256 hex digest
    expect(rowHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores extra properties on the input object (picks D1 set explicitly)', () => {
    const withExtra = { ...base, id: 'injected', success: true, username: 'x' } as AuditRowFields & {
      id: string;
      success: boolean;
      username: string;
    };
    expect(rowHash(withExtra)).toBe(rowHash(base));
  });

  it('changes when a D1 field changes', () => {
    expect(rowHash({ ...base, action: 'UPDATE' })).not.toBe(rowHash(base));
    expect(rowHash({ ...base, requestBody: {} })).not.toBe(rowHash(base));
    expect(rowHash({ ...base, createdAt: new Date('2026-09-29T00:00:00.000Z') })).not.toBe(
      rowHash(base),
    );
  });

  it('covers ALL eleven D1 fields (each one perturbs the hash)', () => {
    const fields: (keyof AuditRowFields)[] = [
      'tenantId',
      'userId',
      'action',
      'resourceType',
      'resourceId',
      'requestBody',
      'responseStatus',
      'requestId',
      'ip',
      'userAgent',
      'createdAt',
    ];
    for (const f of fields) {
      const mutated: AuditRowFields = { ...base };
      // every field must be required and covered — a missing field must not typecheck
      mutated[f] = (f === 'requestBody' ? {} : f === 'createdAt' ? new Date(0) : f === 'responseStatus' ? 500 : 'zzz') as never;
      expect(rowHash(mutated)).not.toBe(rowHash(base));
    }
  });
});

describe('foldRoot', () => {
  it('is deterministic for a fixed ordered list', () => {
    const hashes = ['aa', 'bb', 'cc'];
    expect(foldRoot(hashes)).toBe(foldRoot([...hashes]));
    expect(foldRoot(hashes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is order-sensitive (concat in given order)', () => {
    expect(foldRoot(['aa', 'bb'])).not.toBe(foldRoot(['bb', 'aa']));
  });

  it('handles a single leaf', () => {
    const single = foldRoot(['only-leaf']);
    expect(single).toMatch(/^[0-9a-f]{64}$/);
    expect(single).not.toBe('only-leaf');
  });

  it('returns the GENESIS sentinel for an empty list', () => {
    expect(foldRoot([])).toBe(GENESIS);
  });
});

describe('receiptHash', () => {
  it('matches foldRoot for the same ordered set (same concat semantics)', () => {
    const hashes = ['h1', 'h2', 'h3'];
    expect(receiptHash(hashes)).toBe(foldRoot(hashes));
    expect(receiptHash([])).toBe(foldRoot([]));
  });
});
