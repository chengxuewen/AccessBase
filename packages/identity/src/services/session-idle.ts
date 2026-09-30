/**
 * SL-2 session-idle zero-dep reader leaf (spec 2026-09-29-session-lifetime
 * rev.2 D2 config-plane). Pure 3-tier resolver: env (numeric, incl '0') >
 * option (numeric incl 0) > fallback 86400. Garbage/negative in a tier =
 * that tier invalid → fall through (never bricks the knob). 0 = OFF (valid).
 *
 * Server-side wiring (apps/server/src/utils/session-idle-wiring.ts) feeds
 * this the raw env/options strings; SessionManager receives a resolved
 * number — the manager never reads env/options itself (mfa-policy precedent:
 * getter-injection, zero deps here).
 */
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 86_400;

/**
 * Parse one tier's raw value. Returns the number when the tier is VALID
 * (numeric, finite, >= 0 — 0 is valid and means OFF), null when the tier
 * must be skipped (absent, garbage, negative, or non-numeric junk like
 * jsonb objects).
 */
function parseTier(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * 3-tier idle-timeout resolution. env wins only when numeric (incl '0');
 * garbage env falls to option; garbage option falls to fallback (86400).
 * Negative = invalid tier (documented rule) — never clamps to 0, so a typo
 * can never silently DISABLE idle enforcement.
 */
export function resolveIdleTimeoutSeconds(
  envRaw: string | number | null | undefined,
  optionRaw: string | number | null | undefined,
  fallback: number = DEFAULT_IDLE_TIMEOUT_SECONDS,
): number {
  return parseTier(envRaw) ?? parseTier(optionRaw) ?? fallback;
}
