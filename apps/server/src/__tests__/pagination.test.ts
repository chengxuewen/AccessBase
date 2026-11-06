/**
 * T3 (gap-remediation 2026-10-12): shared pagination helper + the B2 SCIM
 * guard (no-opts list() returns the FULL set — /ScimGroups depends on it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';

import { parsePageQuery, paginatedReply, PAGE_MAX_SIZE } from '../utils/pagination.js';

describe('parsePageQuery', () => {
  it('defaults: no query → page 1, size 20, offset 0', () => {
    expect(parsePageQuery({})).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });
  it('page 2 size 10 → offset 10', () => {
    expect(parsePageQuery({ page: '2', pageSize: '10' })).toEqual({
      page: 2,
      pageSize: 10,
      offset: 10,
    });
  });
  it('caps pageSize at 100', () => {
    expect(parsePageQuery({ pageSize: '5000' }).pageSize).toBe(PAGE_MAX_SIZE);
  });
  it('garbage values fall to defaults', () => {
    expect(parsePageQuery({ page: 'abc', pageSize: '-5' })).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
    });
  });
  it('page 0 → 1', () => {
    expect(parsePageQuery({ page: '0' }).page).toBe(1);
  });
});

describe('paginatedReply envelope (events.ts precedent)', () => {
  it('flat siblings: success/data/total/page/pageSize — NO items, NO totalPages', () => {
    const r = paginatedReply([1, 2], 42, { page: 3, pageSize: 20, offset: 40 });
    expect(r).toEqual({ success: true, data: [1, 2], total: 42, page: 3, pageSize: 20 });
    expect(r).not.toHaveProperty('items');
    expect(r).not.toHaveProperty('totalPages');
  });
});

// B2 SCIM guard: structural assertion (saml.test precedent) — the no-opts
// branch of GroupManager.list must not carry .limit/.offset, and the SCIM
// caller must invoke list() without opts (full set for in-memory filtering).
describe('SCIM full-set guard (B2, structural)', () => {
  it('GroupManager.list no-opts branch has no LIMIT/OFFSET; opts branch does', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      '/home/ubuntu/Documents/AccessBase/packages/identity/src/managers/GroupManager.ts',
      'utf-8',
    );
    const baseArm = src.slice(src.indexOf('const base ='), src.indexOf('const rows = opts ?'));
    expect(baseArm).not.toMatch(/\.limit\(/);
    expect(baseArm).not.toMatch(/\.offset\(/);
    const optsArm = src.slice(
      src.indexOf('const rows = opts ?'),
      src.indexOf('const rows = opts ?') + 120,
    );
    expect(optsArm).toMatch(/\.limit\(/);
    expect(optsArm).toMatch(/\.offset\(/);
  });

  it('scim.ts caller invokes list() WITHOUT opts (full set)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      '/home/ubuntu/Documents/AccessBase/apps/server/src/routes/scim.ts',
      'utf-8',
    );
    expect(src).toContain('groupManager.list(tenantId)');
    expect(src).not.toContain('groupManager.list(tenantId,');
  });
});
