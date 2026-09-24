/**
 * Q3E-E3 enforced-MFA policy read + enroll-arm body.
 * mfa_enforcement: off | admins | all (env MFA_ENFORCEMENT fallback).
 * admins ⇒ subject holds ≥1 isSystem role (the K-T2 built-in-admin marker).
 */
import type { FlowTokenService } from '@accessbase/identity';

export type MfaPolicy = 'off' | 'admins' | 'all';

const TRUTHY: Record<string, MfaPolicy> = { off: 'off', admins: 'admins', all: 'all' };

export async function resolveMfaPolicy(
  get: (key: string, env?: unknown, def?: unknown) => Promise<unknown>,
): Promise<MfaPolicy> {
  let raw: unknown = 'off';
  try {
    raw = await get('mfa_enforcement', process.env['MFA_ENFORCEMENT'], 'off');
  } catch {
    return 'off'; // config-plane failure never blocks the login door
  }
  return TRUTHY[String(raw)] ?? 'off';
}

/** policy hit for THIS user (before totpEnabled check). roleIsSystem precomputed by caller. */
export function policyHits(policy: MfaPolicy, isSystemAdmin: boolean): boolean {
  if (policy === 'all') return true;
  if (policy === 'admins') return isSystemAdmin;
  return false;
}

/** Issue the enroll chain token (arms return {mfaRequired,enroll,flowToken} — no session). */
export async function enrollArmBody(
  flowTokens: FlowTokenService,
  userId: string,
): Promise<{ mfaRequired: true; enroll: true; flowToken: string }> {
  const flowToken = await flowTokens.issue('mfa_enroll', { userId }, 300);
  return { mfaRequired: true, enroll: true, flowToken };
}

/** shared arm used by every login completion site (rev.2 F-B5 roster) */
export async function enrollGate(opts: {
  getOption: (key: string, env?: unknown, def?: unknown) => Promise<unknown>;
  issueEnroll: (userId: string) => Promise<string>;
  isSystemAdmin: () => Promise<boolean>;
  user: { id: string; totpEnabled?: boolean | null };
}): Promise<{ mfaRequired: true; enroll: true; flowToken: string } | null> {
  const policy = await resolveMfaPolicy(opts.getOption);
  if (policy === 'off' || opts.user.totpEnabled) return null;
  if (policy === 'admins' && !(await opts.isSystemAdmin())) return null;
  const flowToken = await opts.issueEnroll(opts.user.id);
  return { mfaRequired: true, enroll: true, flowToken };
}

/** options adapter (structural cast lives at call sites — generic get() resists inference) */
export interface LooseOptions {
  get(key: string, env?: unknown, def?: unknown): Promise<unknown>;
}
export function optionGetter(om: LooseOptions): (key: string, env?: unknown, def?: unknown) => Promise<unknown> {
  return (k, e, d) => om.get(k, e, d);
}

/** boolean pre-check for redirect-channel arms (oauth/saml callbacks) — the
 * actual mfa_enroll issuance happens later at the exchange endpoint. */
export async function enforceHit(opts: {
  getOption: (key: string, env?: unknown, def?: unknown) => Promise<unknown>;
  isSystemAdmin: () => Promise<boolean>;
  user: { totpEnabled?: boolean | null };
}): Promise<boolean> {
  const policy = await resolveMfaPolicy(opts.getOption);
  if (policy === 'off' || opts.user.totpEnabled) return false;
  if (policy === 'admins') return opts.isSystemAdmin();
  return true;
}
