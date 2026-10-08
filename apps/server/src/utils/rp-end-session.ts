/**
 * Generic-OIDC RP end-session support (logout-coherence batch, spec
 * 2026-10-08-logout-coherence-design.md §3.3).
 *
 * Owns the dynamic provider registry — MOVED out of routes/oauth.ts so the
 * OAuth login flow (loadDynamicProviders) and the end-session composers
 * (resolveRpEndSessionUrl: this route + the /auth/logout 'newest generic link'
 * arm) share one source of truth.
 *
 * `endSessionUrl` is an optional per-provider field: an invalid value (non-
 * string / non-https) drops the FIELD with a warn — the provider itself
 * survives, mirroring the registry's never-break-login philosophy.
 */
import { and, desc, eq } from 'drizzle-orm';
import { oauthAccounts } from '@accessbase/identity/db';
import { logger } from '@accessbase/logging';
import { getOptionsManager } from '../routes/options.js';
import { authDb } from './managers.js';

/** Valid dynamic provider name (also the options-key suffix for its secret). */
export const PROVIDER_NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Non-sensitive fields of a dynamic provider (secret lives in its own option key, R7). */
export interface DynamicProviderConfig {
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  scope?: string;
  /** OIDC RP-initiated logout endpoint (https-only; §3.3). */
  endSessionUrl?: string;
}

/**
 * Dynamic providers from options: `oauth_providers` holds the non-sensitive
 * JSON (R7); each secret lives in its own `oauth_<name>_client_secret` key
 * (matches SENSITIVE_KEY_PATTERN → masked in GET /v1/options). Malformed
 * JSON / invalid name / missing fields skip that provider with a warn —
 * built-ins and startup are never affected.
 */
export async function loadDynamicProviders(): Promise<
  Record<string, DynamicProviderConfig & { clientSecret: string }>
> {
  const options = getOptionsManager();
  const raw = await options.get<unknown>('oauth_providers', process.env['OAUTH_PROVIDERS'], '');
  let parsed: unknown;
  if (typeof raw === 'string') {
    if (raw === '') return {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('oauth: oauth_providers option is not valid JSON — dynamic providers skipped');
      return {};
    }
  } else {
    // jsonb object path: the options value column is jsonb, so the natural
    // Settings→Options flow (UI JSON.parse → PUT object) stores an object and
    // OptionsManager.get() returns it already parsed — never JSON.parse it again.
    parsed = raw;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('oauth: oauth_providers option is not an object — dynamic providers skipped');
    return {};
  }
  const out: Record<string, DynamicProviderConfig & { clientSecret: string }> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PROVIDER_NAME_PATTERN.test(name)) {
      logger.warn(`oauth: dynamic provider name '${name}' is invalid — skipped`);
      continue;
    }
    const c = (value ?? {}) as Partial<DynamicProviderConfig>;
    if (
      typeof c.authUrl !== 'string' || c.authUrl === '' ||
      typeof c.tokenUrl !== 'string' || c.tokenUrl === '' ||
      typeof c.userinfoUrl !== 'string' || c.userinfoUrl === '' ||
      typeof c.clientId !== 'string' || c.clientId === ''
    ) {
      logger.warn(`oauth: dynamic provider '${name}' is missing required fields — skipped`);
      continue;
    }
    // tokenUrl carries the client secret — plaintext http transport is rejected.
    // tokenUrl carries the client secret — plaintext http transport is rejected
    // EXCEPT for loopback hosts (dev/self-loop parity: clients.ts isValidRedirectUri
    // and the vite proxy precedent — same machine, no wire to tap).
    const httpsUrl = (u: string): boolean => {
      if (u.startsWith('https://')) return true;
      try {
        const p = new URL(u);
        return p.protocol === 'http:' && (p.hostname === 'localhost' || p.hostname === '127.0.0.1');
      } catch {
        return false;
      }
    };
    const clientSecretRaw = await options.get<unknown>(`oauth_${name}_client_secret`, undefined, '');
    // Secret option values may arrive as a jsonb string (UI sends a quoted
    // JSON string) or as a bare value — coerce only real strings through.
    const clientSecret = typeof clientSecretRaw === 'string' ? clientSecretRaw : '';
    if (
      (c.scope !== undefined && typeof c.scope !== 'string') ||
      !httpsUrl(c.authUrl) || !httpsUrl(c.tokenUrl) || !httpsUrl(c.userinfoUrl)
    ) {
      logger.warn(`oauth: dynamic provider '${name}' has invalid fields (scope must be a string, URLs must be https or loopback-http) — skipped`);
      continue;
    }
    if (clientSecret === '') {
      logger.warn(`oauth: dynamic provider '${name}' has no oauth_${name}_client_secret option — skipped`);
      continue;
    }
    // endSessionUrl: invalid value drops the FIELD, not the provider — login
    // keeps working, only RP-initiated logout becomes unavailable (§3.3).
    let endSessionUrl: string | undefined;
    if (c.endSessionUrl !== undefined) {
      if (typeof c.endSessionUrl === 'string' && httpsUrl(c.endSessionUrl)) {
        endSessionUrl = c.endSessionUrl;
      } else {
        logger.warn(`oauth: dynamic provider '${name}' has invalid endSessionUrl (must be an https string) — field dropped, provider kept`);
      }
    }
    out[name] = {
      authUrl: c.authUrl,
      tokenUrl: c.tokenUrl,
      userinfoUrl: c.userinfoUrl,
      clientId: c.clientId,
      scope: c.scope,
      endSessionUrl,
      clientSecret,
    };
  }
  return out;
}

/**
 * Resolve the RP-initiated end_session URL for a user (§3.3):
 * the stored `id_token` as id_token_hint + the provider registry entry's
 * https `endSessionUrl`. Anything missing → null (fail-soft — the IdP leg
 * must never fail a logout).
 *
 * - `provider` given: that exact link row (userId + provider, limit 1).
 * - `provider` omitted — the /auth/logout 'newest generic link' arm:
 *   rows ordered by created_at DESC; the first row whose id_token is stored
 *   AND whose provider is registered with an endSessionUrl wins.
 */
export async function resolveRpEndSessionUrl(userId: string, provider?: string): Promise<string | null> {
  const db = authDb();
  const columns = { provider: oauthAccounts.provider, idToken: oauthAccounts.idToken };
  const rows = provider
    ? await db
        .select(columns)
        .from(oauthAccounts)
        .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)))
        .limit(1)
    : await db
        .select(columns)
        .from(oauthAccounts)
        .where(eq(oauthAccounts.userId, userId))
        .orderBy(desc(oauthAccounts.createdAt));
  const registry = await loadDynamicProviders();
  for (const row of rows) {
    if (!row.idToken) continue;
    const endSessionUrl = registry[row.provider]?.endSessionUrl;
    if (!endSessionUrl) continue;
    return `${endSessionUrl}?id_token_hint=${encodeURIComponent(row.idToken)}`;
  }
  return null;
}
