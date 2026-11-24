/**
 * 4A T1 — CAEP/RISC SET signer (spec rev.4 §3 T1, rulings P-2=B / P-1=C).
 *
 * A SET (RFC 8417) is a signed statement about something that ALREADY happened
 * ("this account was disabled") — unlike id/access tokens which assert a
 * present authentication state. Profile pins (panel run 1 S1-3 / F-09):
 *   typ  = secevent+jwt          (RFC 8417 §2.3 — receivers MUST check)
 *   kid  = 'set-signing'         (P-2=B: dedicated key, same published JWKS —
 *                                 blast-radius isolation from auth/id_token)
 *   aud  = the TARGET client_id  (cross-client SET replay dies here)
 *   exp  ≤ 300s                  (short-lived; sign at DELIVERY time so
 *                                 retries get a fresh window with the SAME
 *                                 persisted jti — at-least-once, dedup by jti)
 *   txn  = delivery row id       (traceability back to the ledger)
 *   sub_id + subject             (RFC 9493 iss_sub; both member spellings
 *                                 emitted — pre-SSF-1.0 and final receivers
 *                                 each read the shape they know)
 *
 * Signing uses the DEDICATED key pair (JWT_SET_*_KEY_PATH), never the
 * auth/id_token key: compromising the SET key lets an attacker broadcast fake
 * account-disabled/purged events, but NOT forge user sessions.
 */
import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { CAEP_EVENT_TYPES } from '@accessbase/identity';

/** Stable kid under which loadJwks publishes the SET public key (P-2=B). */
export const SET_KID = 'set-signing';

/** SSE/RISC wire URNs — single source of truth lives in identity (caep.ts),
 * colocated with the enqueue that persists them onto caep_deliveries rows. */
export { CAEP_EVENT_TYPES };

export interface SetDeliveryInput {
  /** OIDC issuer (the transmitter identity — `iss`). */
  issuer: string;
  /** Target client_id (`aud` — this SET is FOR this receiver). */
  audience: string;
  /** Stable delivery jti (persisted on caep_deliveries; retry reuses it). */
  jti: string;
  /** caep_deliveries.id — the `txn` traceability claim. */
  txn: string;
  /** The disabled/purged user's id (`sub` in the iss_sub subject pair). */
  subjectId: string;
  /** Which lifecycle event this is (account-disabled | account-purged). */
  eventType: string;
}

/**
 * Sign one SET for one delivery. Never throws on claim shape (callers map
 * failures to delivery outcomes); throws only on key/sign errors.
 */
export async function signSet(
  privateKeyPem: string,
  input: SetDeliveryInput,
  nowSeconds?: number,
): Promise<string> {
  const key = createPrivateKey(privateKeyPem);
  const subjectPair = { format: 'iss_sub', iss: input.issuer, sub: input.subjectId };
  const payload = {
    events: {
      [input.eventType]: {
        subject: subjectPair,
        // RFC 8417 final + legacy receivers disagree on the member name —
        // emit both spellings of the SAME iss_sub pair (S1-3 interop note).
        sub_id: subjectPair,
      },
    },
    txn: input.txn,
  };
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: SET_KID, typ: 'secevent+jwt' })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setJti(input.jti)
    .setIssuedAt(nowSeconds)
    .setExpirationTime((nowSeconds ?? Math.floor(Date.now() / 1000)) + 300)
    .sign(key);
}

/** Log helper for the drainer's terminal outcomes (kept here for one home). */
export function logSetDelivery(
  log: { warn: (o: unknown, m: string) => void },
  jti: string,
  outcome: 'delivered' | 'dead',
  detail: string,
): void {
  if (outcome === 'dead') {
    log.warn({ jti, detail }, 'CAEP SET delivery dead-lettered');
  }
}
