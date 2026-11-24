/**
 * 4A T5 — groups claim contract (D-5=A/F-17/F-18): scope-gated emission,
 * tenant-confined projection (no DEFAULT_TENANT guess), deterministic cap.
 * OidcAdapter drives with injected fns — no DB in the claims path.
 */
import { describe, it, expect } from 'vitest';
import type { DrizzleDB } from '@accessbase/identity/db';
import { OidcAdapter, buildGroupsClaim, GROUPS_CLAIM_CAP } from '../oidc/adapter.js';

const emptyDb = {} as DrizzleDB;

describe('buildGroupsClaim (F-18/sec M-4)', () => {
  it('sorts deterministically (claim order must not leak insertion order)', () => {
    const r = buildGroupsClaim(['zeta', 'alpha', 'Mid']);
    expect(r.groups).toEqual(['alpha', 'Mid', 'zeta']);
    expect(r.groups_truncated).toBe(false);
  });

  it('caps at 50 with the truncation marker (deterministic truncation: sorted first)', () => {
    const many = Array.from({ length: GROUPS_CLAIM_CAP + 10 }, (_, i) => `g-${String(i).padStart(3, '0')}`);
    const r = buildGroupsClaim(many);
    expect(r.groups).toHaveLength(GROUPS_CLAIM_CAP);
    expect(r.groups_truncated).toBe(true);
    // truncation keeps the lexicographically-first 50
    expect(r.groups[0]).toBe('g-000');
    expect(r.groups.at(-1)).toBe(`g-${String(GROUPS_CLAIM_CAP - 1).padStart(3, '0')}`);
  });
});

function adapterWith(user: {
  name?: string;
  email?: string;
  tenantId?: string;
} | null, groups: string[]): OidcAdapter {
  return new OidcAdapter(emptyDb, {
    getUser: async () => user,
    getGroupsForUser: async () => groups,
  });
}

describe('claims(use, scope) gating (F-18)', () => {
  const account = adapterWith(
    { name: 'Alice', email: 'a@x', tenantId: 't1' },
    ['Eng', 'Platform'],
  );

  it('scope WITHOUT groups → base claims only (no groups key at all)', async () => {
    const claims = await account.findAccount(undefined, 'u1').then((a) => a.claims('userinfo', 'openid profile email'));
    expect(claims).not.toHaveProperty('groups');
    expect(claims).not.toHaveProperty('groups_truncated');
    expect(claims.sub).toBe('u1');
  });

  it('undefined scope → base claims only', async () => {
    const claims = await account.findAccount(undefined, 'u1').then((a) => a.claims());
    expect(claims).not.toHaveProperty('groups');
  });

  it("scope 'groups' → groups + marker (sorted, within cap)", async () => {
    const claims = await account.findAccount(undefined, 'u1').then((a) => a.claims('userinfo', 'openid groups'));
    expect(claims.groups).toEqual(['Eng', 'Platform']);
    expect(claims.groups_truncated).toBe(false);
  });
});

describe('F-17: tenant comes from the SAME user row (no DEFAULT_TENANT guess)', () => {
  it('user row WITHOUT tenantId → empty groups claim, never a cross-tenant projection', async () => {
    const account = adapterWith({ name: 'NoTenant' }, ['should-not-leak']);
    const claims = await account.findAccount(undefined, 'u1').then((a) => a.claims('userinfo', 'groups'));
    expect(claims.groups).toEqual([]);
    expect(claims.groups_truncated).toBe(false);
  });

  it('projection is called with the ROW tenantId, verbatim', async () => {
    const seen: Array<[string, string]> = [];
    const adapter = new OidcAdapter(emptyDb, {
      getUser: async () => ({ name: 'A', tenantId: 't-row' }),
      getGroupsForUser: async (userId, tenantId) => {
        seen.push([userId, tenantId]);
        return ['g'];
      },
    });
    await adapter.findAccount(undefined, 'u-row').then((a) => a.claims('userinfo', 'groups'));
    expect(seen).toEqual([['u-row', 't-row']]);
  });
});
