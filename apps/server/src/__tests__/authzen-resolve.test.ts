/**
 * 4A T3 — AuthZEN resolution matrix (F-07 subject-bound fail-closed;
 * S3-3 identifier hygiene; catalog whitelist). Fully scripted deps — no DB.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateAuthZen,
  type AuthZenResolutionDeps,
} from '../utils/authzen-resolve.js';

const KNOWN = new Set([
  'users:read',
  'users:write',
  'users:delete',
  'roles:read',
  'audit:read',
]);

function makeDeps(overrides: Partial<AuthZenResolutionDeps> = {}): AuthZenResolutionDeps {
  return {
    findSubject: async (subjectId, _tenantId) =>
      subjectId === 'u-alice' || subjectId === 'u-bob' ? { id: subjectId } : null,
    hasPermission: async (userId, code) => !(userId === 'u-bob' && code === 'users:write'),
    getUserDataScope: async (userId, _code) =>
      userId === 'u-alice' ? 'self' : null, // u-bob has NO binding (fail-closed bait)
    getDepartmentIdsForUser: async () => ['g-dept-1'],
    isWithinScope: async (targetUserId, scope) => {
      if (scope.kind === 'all') return true;
      if (scope.kind === 'self') return targetUserId === scope.userId;
      if (scope.kind === 'dept') return scope.groupIds.includes('g-dept-1') ? true : false;
      return false;
    },
    knownCodes: KNOWN,
    ...overrides,
  };
}

const base = {
  subjectId: 'u-alice',
  resourceType: 'roles',
  actionName: 'read',
  tenantId: 't1',
};

describe('identifier hygiene (S3-3)', () => {
  it('":" in resource.type or action.name → false invalid-identifier (forgery guard)', async () => {
    expect(
      (await evaluateAuthZen(makeDeps(), { ...base, resourceType: 'users:read' })).reason,
    ).toBe('invalid-identifier');
    expect(
      (await evaluateAuthZen(makeDeps(), { ...base, actionName: 'read:all' })).reason,
    ).toBe('invalid-identifier');
    expect(
      (await evaluateAuthZen(makeDeps(), { ...base, resourceType: '', actionName: 'read' })).reason,
    ).toBe('invalid-identifier');
  });
});

describe('catalog whitelist (unknown codes are FALSE, never best-effort)', () => {
  it('unknown code → false unknown-code', async () => {
    expect(
      (await evaluateAuthZen(makeDeps(), { ...base, resourceType: 'documents', actionName: 'read' }))
        .decision,
    ).toBe(false);
    expect(
      (await evaluateAuthZen(makeDeps(), { ...base, resourceType: 'documents', actionName: 'read' }))
        .reason,
    ).toBe('unknown-code');
  });
});

describe('subject-bound fail-closed (F-07 — THE red family)', () => {
  it('unknown subject → false unknown-subject (never fail-soft tenant-wide)', async () => {
    const r = await evaluateAuthZen(makeDeps(), { ...base, subjectId: 'u-ghost' });
    expect(r.decision).toBe(false);
    expect(r.reason).toBe('unknown-subject');
  });

  it('cross-tenant subject → false (findById is tenant-scoped, so the ghost is unknown)', async () => {
    const scoped = makeDeps({
      findSubject: async (subjectId, tenantId) =>
        tenantId === 't1' && subjectId === 'u-alice' ? { id: subjectId } : null,
    });
    const r = await evaluateAuthZen(scoped, { ...base, subjectId: 'u-alice', tenantId: 't-other' });
    expect(r.decision).toBe(false);
    expect(r.reason).toBe('unknown-subject');
  });

  it('code-level permission miss → false', async () => {
    const r = await evaluateAuthZen(makeDeps(), {
      ...base,
      subjectId: 'u-bob',
      resourceType: 'users',
      actionName: 'write',
    });
    expect(r.decision).toBe(false);
    expect(r.reason).toBe('permission-denied');
  });
});

describe('users-surface row check (subject binding, fail-closed)', () => {
  const usersRead = { ...base, resourceType: 'users', actionName: 'read' };

  it('NULL binding on a governed code → FALSE (no-scope-binding) — NEVER tenant-wide', async () => {
    const r = await evaluateAuthZen(makeDeps(), {
      ...usersRead,
      subjectId: 'u-bob', // permission passes, but the binding is null
      resourceId: 'u-anyone',
    });
    expect(r.decision).toBe(false);
    expect(r.reason).toBe('no-scope-binding');
  });

  it('self binding: own row true, other row false', async () => {
    expect(
      (await evaluateAuthZen(makeDeps(), { ...usersRead, resourceId: 'u-alice' })).decision,
    ).toBe(true);
    expect(
      (await evaluateAuthZen(makeDeps(), { ...usersRead, resourceId: 'u-someone-else' })).decision,
    ).toBe(false);
  });

  it('dept binding resolves department groups for the SUBJECT', async () => {
    const seen: Array<{ kind: string; groupIds?: string[] }> = [];
    const deps = makeDeps({
      getUserDataScope: async () => 'dept',
      isWithinScope: async (_t, scope) => {
        seen.push({ kind: scope.kind, groupIds: scope.kind === 'dept' ? scope.groupIds : undefined });
        return true;
      },
    });
    expect((await evaluateAuthZen(deps, { ...usersRead, resourceId: 'u-x' })).decision).toBe(true);
    expect(seen[0]).toEqual({ kind: 'dept', groupIds: ['g-dept-1'] });
  });

  it('all binding → row check passes for any id', async () => {
    const deps = makeDeps({ getUserDataScope: async () => 'all' });
    expect(
      (await evaluateAuthZen(deps, { ...usersRead, resourceId: 'u-anyone' })).decision,
    ).toBe(true);
  });

  it('users code WITHOUT resource.id → code-level only (true)', async () => {
    expect((await evaluateAuthZen(makeDeps(), { ...usersRead })).decision).toBe(true);
  });

  it('non-users codes skip the row check entirely', async () => {
    expect((await evaluateAuthZen(makeDeps(), base)).decision).toBe(true);
  });
});
