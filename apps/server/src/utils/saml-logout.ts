/**
 * SAML logout-coherence utilities (spec 2026-10-08-logout-coherence §3.1/§3.2).
 *
 * Single source for everything the SP-initiated logout + IdP-initiated SLO
 * lanes need OUTSIDE the protocol provider: options-driven provider
 * construction (with the Redis CacheProvider injected — identity stays
 * redis-free, dispatcher-deps precedent), the oauth_accounts saml link
 * lifecycle, and the LogoutRequest replay-dedup claim.
 *
 * Consumers: routes/saml.ts (now + SLO arms) and later routes/auth/core.ts
 * (/auth/logout composer via resolveSamlLogoutUrl).
 */
import { and, eq } from 'drizzle-orm';
import { oauthAccounts } from '@accessbase/identity/db';
import type { SamlProvider } from '@accessbase/identity';
import { logger } from '@accessbase/logging';
import { getOptionsManager } from '../routes/options.js';
import { authDb } from './managers.js';
import { buildSamlCacheProvider, SAML_REQUEST_TTL_MS } from './saml-cache-provider.js';
import { getRedis } from './redis.js';

/**
 * Options→SamlProvider construction with the §3.6 Redis cacheProvider and the
 * B3 logout keys. Per-request like the historical buildProvider — shared
 * state now lives in Redis, so per-instance construction is harmless.
 *
 * `host` only feeds the saml_acs_url fallback; logout URL generation does
 * not embed it, so resolveSamlLogoutUrl may pass a placeholder.
 */
export async function buildSamlProvider(host: string): Promise<SamlProvider> {
  const om = getOptionsManager();
  const get = async (key: string, envKey: string, def: unknown) =>
    om.get(key, process.env[envKey], def);
  const entryPoint = String(await get('saml_entry_point', 'SAML_ENTRY_POINT', ''));
  const logoutUrl = String(await get('saml_logout_url', 'SAML_LOGOUT_URL', ''));
  if (logoutUrl === '' && entryPoint !== '') {
    warnLogoutUrlFallback();
  }
  const { SamlProvider } = await import('@accessbase/identity');
  return new SamlProvider({
    enabled: true,
    entryPoint,
    idpCert: String(await get('saml_idp_cert', 'SAML_IDP_CERT', '')),
    entityId: String(await get('saml_entity_id', 'SAML_ENTITY_ID', 'urn:accessbase:saml:sp')),
    idpIssuer: String(await get('saml_idp_issuer', 'SAML_IDP_ISSUER', '')) || undefined,
    privateKey: String(await get('saml_private_key', 'SAML_PRIVATE_KEY', '')) || undefined,
    publicCert: String(await get('saml_public_cert', 'SAML_PUBLIC_CERT', '')) || undefined,
    clockSkewMs: Number(await get('saml_clock_skew_ms', 'SAML_CLOCK_SKEW_MS', '300000')),
    callbackUrl: String(
      await get('saml_acs_url', 'SAML_ACS_URL', `http://${host}/api/v1/auth/saml/acs`),
    ),
    // §3.6 precondition: shared request-id cache (undefined -> node-saml
    // per-instance default, warned once inside the builder).
    cacheProvider: await buildSamlCacheProvider(),
    // node-saml itself defaults the SLO destination to entryPoint (saml.js:95).
    logoutUrl: logoutUrl !== '' ? logoutUrl : undefined,
    logoutCallbackUrl:
      String(await get('saml_slo_callback_url', 'SAML_SLO_CALLBACK_URL', '')) || undefined,
  });
}

let warnedLogoutFallback = false;
function warnLogoutUrlFallback(): void {
  if (warnedLogoutFallback) return;
  warnedLogoutFallback = true;
  logger.warn(
    { option: 'saml_logout_url' },
    'saml_logout_url not set — SP-initiated logout falls back to saml_entry_point as the IdP SLO destination (128-char NameID links only)',
  );
}

/**
 * Persist/refresh the saml link after ACS find-or-provision (§3.1).
 * Fail-soft BY DESIGN: a link problem must never fail the login — but every
 * swallow is LOUD (B7 invisible-seam doctrine).
 */
export async function upsertSamlLink(
  userId: string,
  nameId: string,
  sessionIndex: string | null,
): Promise<void> {
  // provider_account_id is varchar(128) — overflow would be a silent DB error.
  if (nameId.length > 128) {
    logger.warn(
      { userId, nameIdLength: nameId.length, limit: 128 },
      'SAML NameID exceeds oauth_accounts.provider_account_id(128) — link SKIPPED, login unaffected (SP-initiated SLO unavailable for this identity)',
    );
    return;
  }
  try {
    await authDb()
      .insert(oauthAccounts)
      .values({ userId, provider: 'saml', providerAccountId: nameId, sessionIndex })
      .onConflictDoUpdate({
        target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
        set: { userId, sessionIndex },
      });
  } catch (err) {
    logger.warn({ err, userId }, 'SAML link upsert failed — login unaffected');
  }
}

/**
 * The caller's SP-initiated logout URL, or null when the user has no saml
 * link. Shared by GET /auth/saml/logout and the later /auth/logout composer
 * (single source, spec §3.4 resolution order).
 */
export async function resolveSamlLogoutUrl(userId: string): Promise<string | null> {
  const [link] = await authDb()
    .select({
      providerAccountId: oauthAccounts.providerAccountId,
      sessionIndex: oauthAccounts.sessionIndex,
    })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, 'saml'), eq(oauthAccounts.userId, userId)))
    .limit(1);
  if (!link) return null;
  const provider = await buildSamlProvider('localhost');
  return provider.logoutUrl(link.providerAccountId, link.sessionIndex ?? null);
}

/**
 * Single-use claim for inbound LogoutRequest IDs (§3.2 R2 — replay defense
 * is ours; node-saml caches only IDs WE generated, saml.js:142/295).
 * Redis SETNX wins; absent Redis falls back to an in-process Map.
 */
const localSeen = new Map<string, number>();
let warnedDedupFallback = false;

export async function claimSamlRequestId(requestId: string): Promise<boolean> {
  const redis = await getRedis();
  if (redis) {
    const ok = await redis.set(
      `ab:saml:sreq:${requestId}`,
      '1',
      'EX',
      Math.ceil(SAML_REQUEST_TTL_MS / 1000),
      'NX',
    );
    return ok === 'OK';
  }
  if (!warnedDedupFallback) {
    warnedDedupFallback = true;
    logger.warn(
      { feature: 'saml-slo' },
      'Redis unavailable — SAML LogoutRequest replay-dedup is in-process only (single-node honest)',
    );
  }
  // ponytail: per-node Map dedup, swept on claim; upgrade path is the Redis
  // SETNX arm above (shared across nodes). Memory ceiling: one entry per
  // distinct RequestID inside the TTL window.
  const now = Date.now();
  for (const [id, expiresAt] of localSeen) {
    if (expiresAt <= now) localSeen.delete(id);
  }
  if (localSeen.has(requestId)) return false;
  localSeen.set(requestId, now + SAML_REQUEST_TTL_MS);
  return true;
}

/** Test seam: clear the in-process dedup state between suites. */
export function _resetSloDedupForTest(): void {
  localSeen.clear();
  warnedDedupFallback = false;
}

