/**
 * Domain-restriction policy — pure validators extracted verbatim from the
 * retired PasswordProvider shell (R1-T9/DG-7). The old private methods
 * (isDomainAllowed :111, hasEmailAlias :133) had no live caller; the register
 * route in apps/server now consumes these so the feature actually exists.
 *
 * Semantics preserved exactly:
 * - blocked-list wins over allow-list (checked first)
 * - exact whole-domain match only (no subdomain implication)
 * - case-insensitive on both sides
 * - empty allowed list = allow-all
 */

export function isEmailDomainAllowed(
  email: string,
  allowed: readonly string[],
  blocked: readonly string[],
): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  // Check blocked domains
  if (blocked.length > 0) {
    if (blocked.some((d) => d.toLowerCase() === domain)) {
      return false;
    }
  }

  // Check allowed domains (if specified)
  if (allowed.length > 0) {
    return allowed.some((d) => d.toLowerCase() === domain);
  }

  return true;
}

/**
 * True when the email carries an alias (e.g. user+tag@gmail.com) AND alias
 * blocking is on — mirrors the old gate `config.blockEmailAliases &&
 * this.hasEmailAlias(email)` folded into one pure function.
 */
export function hasEmailAlias(email: string, blockAliases: boolean): boolean {
  if (!blockAliases) return false;
  const localPart = email.split('@')[0];
  return localPart?.includes('+') ?? false;
}
