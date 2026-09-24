import { describe, it, expect, vi } from 'vitest';
import { resolveMfaPolicy, policyHits, enforceHit, enrollGate } from '../utils/mfa-policy.js';

const get = (v: unknown) => async () => v;

describe('mfa policy resolution (Q3E)', () => {
  it('unknown/absent values collapse to off; admins/all honored', async () => {
    expect(await resolveMfaPolicy(get(undefined) as never)).toBe('off');
    expect(await resolveMfaPolicy(get('nope') as never)).toBe('off');
    expect(await resolveMfaPolicy(get('admins') as never)).toBe('admins');
    expect(await resolveMfaPolicy(get('all') as never)).toBe('all');
  });
  it('policyHits truth table', () => {
    expect(policyHits('off', true)).toBe(false);
    expect(policyHits('all', false)).toBe(true);
    expect(policyHits('admins', true)).toBe(true);
    expect(policyHits('admins', false)).toBe(false);
  });
  it('enforceHit skips bound users, admins-only consults roles lazily', async () => {
    const isAdmin = vi.fn(async () => true);
    expect(await enforceHit({ getOption: get('all'), isSystemAdmin: isAdmin, user: { totpEnabled: true } })).toBe(false);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(await enforceHit({ getOption: get('admins'), isSystemAdmin: isAdmin, user: {} })).toBe(true);
    expect(await enforceHit({ getOption: get('admins'), isSystemAdmin: async () => false, user: {} })).toBe(false);
  });
  it('enrollGate issues the chain token only when the policy hits', async () => {
    const issue = vi.fn(async () => 'ft-1');
    const r = await enrollGate({ getOption: get('all'), issueEnroll: issue, isSystemAdmin: async () => false, user: { id: 'u1' } });
    expect(r).toEqual({ mfaRequired: true, enroll: true, flowToken: 'ft-1' });
    expect(await enrollGate({ getOption: get('off'), issueEnroll: issue, isSystemAdmin: async () => true, user: { id: 'u1' } })).toBeNull();
  });
  it('config-plane explosion = off (login door never 500s on policy reads)', async () => {
    const boom = async () => { throw new Error('db down'); };
    expect(await resolveMfaPolicy(boom)).toBe('off');
  });
});
