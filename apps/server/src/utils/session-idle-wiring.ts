/**
 * SL-2 session-idle wiring (spec 2026-09-29-session-lifetime rev.2 D2):
 * resolves SESSION_IDLE_TIMEOUT_SECONDS (env) / session.idle_timeout_seconds
 * (options) into the number handed to SessionManager.rotateRefreshToken.
 *
 * Config-plane failure = idle enforcement at env tier or OFF-free default —
 * never a refresh outage (G4 fail-open, mfa-policy posture). The pure tier
 * math lives in identity's zero-dep resolver; this file only feeds it.
 */
import { resolveIdleTimeoutSeconds } from '@accessbase/identity';
import { getOptionsManager } from '../routes/options.js';

/** Option key registered in KNOWN_OPTION_KEYS (options.ts W3-2 rule). */
export const SESSION_IDLE_OPTION_KEY = 'session.idle_timeout_seconds';

/** Resolve the idle cutoff seconds for this node. 0 = enforcement off. */
export async function resolveIdleSeconds(): Promise<number> {
  const envRaw = process.env['SESSION_IDLE_TIMEOUT_SECONDS'];
  let optionRaw: string | number | undefined;
  try {
    const v = await getOptionsManager().get(SESSION_IDLE_OPTION_KEY, undefined, undefined);
    if (typeof v === 'number' || typeof v === 'string') optionRaw = v;
  } catch {
    // options plane down — fall through; resolver default tier covers it
  }
  // Tier math is the resolver's: numeric env (incl '0'=off) wins; garbage
  // env is ignored there, then the option tier, then 86400.
  return resolveIdleTimeoutSeconds(envRaw, optionRaw);
}
