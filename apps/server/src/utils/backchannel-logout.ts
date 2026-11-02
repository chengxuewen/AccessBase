/**
 * Q3D back-channel logout receiver pipeline (spec 2026-10-12, adjudications
 * A1-A5). IdP-facing S2S surface — NO envelope, NO bearer; the route layer
 * (backchannel-logout route) replies directly in the BCL spec shape.
 *
 * Pipeline order (§3.3, normative):
 *   1. parse provider config by exact iss (A4)  -> AUTH_BCLO_* on miss is 400
 *   2. verify: jose jwtVerify against createRemoteJWKSet(jwksUri) (A5
 *      fail-closed; unknown kid forces refetch via cooldownSingleUse), alg
 *      allowlist RS256/ES256/PS256, iss exact, aud contains clientId, events
 *      member present (object value, extras tolerated), nonce PROHIBITED,
 *      jti REQUIRED (BCL §2.4), exp/iat skew 60s + max age 600s (A3/R8)
 *   3. resolve: sub -> oauth_accounts rows (provider+providerAccountId);
 *      null-sub / sid-only / unknown sub -> 200 benign no-op (A1)
 *   4. effects in caller tx: revokeAllUserSessions + 3-line tokenVersion bump
 *      (A2) + authst DEL + token-material nulling
 *   5. emit auth.backchannel_logout (fire-and-forget telemetry lane)
 *   6. dedup claim LAST (A3): jti key, sha256 fallback, failure release
 */
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyBaseLogger } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { oauthAccounts, users } from '@accessbase/identity/db';
import type { DbLike } from '@accessbase/identity/db';
import type { DynamicProviderConfig } from './rp-end-session.js';
import { getRedis } from './redis.js';

export const BCLO_MAX_TOKEN_AGE_SECONDS = 600; // R8: makes the 1h dedup TTL derivable
export const BCLO_CLOCK_TOLERANCE_SECONDS = 60;
const BCLO_DEDUP_TTL_SECONDS = 3600;
const BCLO_DEDUP_PREFIX = 'ab:bclo:';

const ALG_ALLOWLIST = ['RS256', 'ES256', 'PS256'] as const;
export const BCLO_EVENT_URI = 'http://schemas.openid.net/event/backchannel-logout';

/** Terminal pipeline outcome — the route maps these to wire responses. */
export type BackchannelLogoutOutcome =
  | { kind: 'ok' } // 200 empty (processed, or benign no-op)
  | { kind: 'invalid'; code: 'AUTH_BCLO_001' | 'AUTH_BCLO_002' | 'AUTH_BCLO_003'; detail: string };

export interface BackchannelLogoutDeps {
  /** AuthContext db handle (routeTx-managed when the caller wraps one). */
  db: DbLike;
  /** Providers registry snapshot (caller loads once per request). */
  providers: Record<string, DynamicProviderConfig & { clientSecret: string }>;
  /** SessionManager for revokeAllUserSessions (identity funnel). */
  revokeAllUserSessions: (userId: string) => Promise<void>;
  /** authst DEL arm (managers.ts helper) — bump pairs with it like the manager funnels. */
  delAuthStateKeys: (userIds: string[]) => Promise<void>;
  /** Fire-and-forget telemetry emit (auth.backchannel_logout). */
  emitEvent: (input: { userId: string; provider: string; jti: string }) => void;
  logger: Pick<FastifyBaseLogger, 'info' | 'warn'>;
}

interface VerifiedToken {
  iss: string;
  sub: string | null;
  aud: string | string[];
  jti: string;
  sid?: string;
}

// jose JWKS resolvers cached per jwksUri (process-lifetime; createRemoteJWKSet
// handles cooldown + refetch internally).
const jwksResolvers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwksFor(uri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksResolvers.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri), { cooldownDuration: 30_000 });
    jwksResolvers.set(uri, set);
  }
  return set;
}

/** Find the provider whose configured issuer EXACTLY matches token.iss (A4). */
export function providerByIss(
  providers: BackchannelLogoutDeps['providers'],
  iss: string,
): { name: string; config: DynamicProviderConfig & { clientSecret: string } } | null {
  for (const [name, config] of Object.entries(providers)) {
    if (config.issuer !== undefined && config.jwksUri !== undefined && config.issuer === iss) {
      return { name, config };
    }
  }
  return null;
}

/** Static claim checks that do not need crypto (order: cheap rejects first). */
export function checkClaims(payload: Record<string, unknown>, clientId: string): VerifiedToken | { error: 'AUTH_BCLO_002' | 'AUTH_BCLO_003'; detail: string } {
  if (typeof payload['iss'] !== 'string' || payload['iss'] === '') return { error: 'AUTH_BCLO_002', detail: 'iss missing' };
  const aud = payload['aud'];
  const audList = Array.isArray(aud) ? aud : [aud];
  if (!audList.includes(clientId)) return { error: 'AUTH_BCLO_002', detail: 'aud mismatch' };
  const events = payload['events'];
  if (events === null || typeof events !== 'object' || Array.isArray(events) || !(BCLO_EVENT_URI in (events as object))) {
    return { error: 'AUTH_BCLO_002', detail: 'events member missing or not an object' };
  }
  if (payload['nonce'] !== undefined) return { error: 'AUTH_BCLO_002', detail: 'nonce PROHIBITED in logout tokens' };
  if (typeof payload['jti'] !== 'string' || payload['jti'] === '') return { error: 'AUTH_BCLO_002', detail: 'jti REQUIRED (BCL 2.4)' };
  // sub: string or explicitly null (Keycloak client-initiated logout sends null).
  // ABSENT sub with a sid is sid-only — same benign no-op family (A1).
  if (payload['sub'] !== undefined && payload['sub'] !== null && typeof payload['sub'] !== 'string') {
    return { error: 'AUTH_BCLO_002', detail: 'sub must be a string or null' };
  }
  const now = Math.floor(Date.now() / 1000);
  const iat = typeof payload['iat'] === 'number' ? payload['iat'] : Number.NaN;
  if (!Number.isFinite(iat)) return { error: 'AUTH_BCLO_002', detail: 'iat missing' };
  if (now - iat > BCLO_MAX_TOKEN_AGE_SECONDS + BCLO_CLOCK_TOLERANCE_SECONDS) {
    return { error: 'AUTH_BCLO_003', detail: 'token beyond max age' };
  }
  return {
    iss: payload['iss'],
    sub: typeof payload['sub'] === 'string' ? payload['sub'] : null,
    aud: audList as string[],
    jti: payload['jti'],
    sid: typeof payload['sid'] === 'string' ? payload['sid'] : undefined,
  };
}

/** Dedup claim — LAST step before answering ok (A3). Returns false when already claimed. */
export async function claimBackchannelLogout(jti: string, tokenBytes: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return true; // no redis: single-node honest, effects are idempotent anyway
    const key = `${BCLO_DEDUP_PREFIX}${jti || createHash('sha256').update(tokenBytes).digest('hex')}`;
    const nx = await redis.set(key, '1', 'EX', BCLO_DEDUP_TTL_SECONDS, 'NX');
    return nx === 'OK' || nx === 1 || nx === true;
  } catch {
    return true; // redis down: fall open to idempotent processing (A3 crash-safety beats dedup strictness)
  }
}

/** Release a claimed dedup key when an effect threw AFTER claiming (A3 failure-release). */
export async function releaseBackchannelLogoutClaim(jti: string, tokenBytes: string): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    const key = `${BCLO_DEDUP_PREFIX}${jti || createHash('sha256').update(tokenBytes).digest('hex')}`;
    await redis.del(key);
  } catch {
    /* redis gone — TTL cleans up */
  }
}

/**
 * Full pipeline. Throws nothing — every failure maps to an outcome; effect
 * failures after claim release the claim (A3) and surface as invalid with a
 * 500-family detail the route maps to a generic spec-shape 500.
 */
export async function processBackchannelLogout(
  logoutToken: string,
  deps: BackchannelLogoutDeps,
): Promise<BackchannelLogoutOutcome> {
  if (typeof logoutToken !== 'string' || logoutToken.length === 0 || logoutToken.length > 8192) {
    return { kind: 'invalid', code: 'AUTH_BCLO_001', detail: 'logout_token missing or oversized' };
  }

  // 1. Unverified iss read for provider selection (the iss claim itself is
  // re-verified inside jwtVerify against the config value after selection).
  let issProbe: string | null = null;
  try {
    const parts = logoutToken.split('.');
    if (parts.length !== 3) return { kind: 'invalid', code: 'AUTH_BCLO_001', detail: 'not a JWT' };
    const payloadB64 = parts[1];
    if (payloadB64 === undefined) return { kind: 'invalid', code: 'AUTH_BCLO_001', detail: 'not a JWT' };
    const payloadPart = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { iss?: unknown };
    issProbe = typeof payloadPart.iss === 'string' ? payloadPart.iss : null;
  } catch {
    return { kind: 'invalid', code: 'AUTH_BCLO_001', detail: 'undecodable JWT payload' };
  }
  if (issProbe === null) return { kind: 'invalid', code: 'AUTH_BCLO_002', detail: 'iss missing' };
  const matched = providerByIss(deps.providers, issProbe);
  if (!matched) return { kind: 'invalid', code: 'AUTH_BCLO_002', detail: 'no provider configured for this issuer' };

  // 2. Verify — jose enforces exp/nbf; iss/aud re-checked against CONFIG (A5:
  // never trust the token's own pointers). Unknown kid => cooldownSingleUse
  // forces a JWKS refetch on the next verify (rotation path, I5).
  let payload: Record<string, unknown>;
  try {
    const jwksUri = matched.config.jwksUri;
    if (jwksUri === undefined) return { kind: 'invalid', code: 'AUTH_BCLO_002', detail: 'provider has no jwksUri' };
    const { payload: verified } = await jwtVerify(logoutToken, jwksFor(jwksUri), {
      issuer: matched.config.issuer,
      audience: matched.config.clientId,
      algorithms: [...ALG_ALLOWLIST],
      clockTolerance: BCLO_CLOCK_TOLERANCE_SECONDS,
    });
    payload = verified as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'verify failed';
    const expired = /exp|temporal/i.test(msg);
    return { kind: 'invalid', code: expired ? 'AUTH_BCLO_003' : 'AUTH_BCLO_002', detail: 'token verification failed' };
  }
  const claims = checkClaims(payload, matched.config.clientId);
  if ('error' in claims) return { kind: 'invalid', code: claims.error, detail: claims.detail };

  // 3. Resolve — A1: unresolvable targets are benign 200s.
  const sub = claims.sub;
  if (sub === null) {
    deps.logger.warn({ jti: claims.jti, iss: claims.iss, hasSid: claims.sid !== undefined }, 'bclo: null-sub token (Keycloak client-initiated edge) — benign no-op');
    return { kind: 'ok' };
  }
  const links = await deps.db
    .select({ id: oauthAccounts.id, userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, matched.name), eq(oauthAccounts.providerAccountId, sub)));
  if (links.length === 0) {
    return { kind: 'ok' }; // unknown sub — user never logged in here (A1)
  }

  try {
    // 4. Effects (idempotent; caller tx wraps 2-4 when the route provides one).
    const userIds = [...new Set(links.map((l) => l.userId))];
    for (const userId of userIds) {
      await deps.revokeAllUserSessions(userId);
    }
    // A2: replicate the manager bump inside the caller tx + authst DEL arm.
    const tenants = await deps.db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(inArray(users.id, userIds));
    const bumped: string[] = [];
    for (const row of tenants) {
      await deps.db
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(and(eq(users.tenantId, row.tenantId), eq(users.id, row.id)));
      bumped.push(row.id);
    }
    if (bumped.length > 0) await deps.delAuthStateKeys(bumped);
    await deps.db
      .update(oauthAccounts)
      .set({ accessToken: null, refreshToken: null, idToken: null })
      .where(inArray(oauthAccounts.id, links.map((l) => l.id)));

    // 5. Telemetry (fire-and-forget — never fails the response).
    for (const userId of userIds) {
      deps.emitEvent({ userId, provider: matched.name, jti: claims.jti });
    }
  } catch (err) {
    await releaseBackchannelLogoutClaim(claims.jti, logoutToken);
    deps.logger.warn({ err }, 'bclo: effect failure — dedup claim released for redelivery');
    return { kind: 'invalid', code: 'AUTH_BCLO_002', detail: 'logout processing failed' };
  }

  // 6. Claim LAST (A3): losers of the race already ran idempotent effects.
  await claimBackchannelLogout(claims.jti, logoutToken);
  return { kind: 'ok' };
}
