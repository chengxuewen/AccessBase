/**
 * PasswordPolicy — 5-dimension password policy with options-driven overrides
 * (Batch C Task 4 / C2).
 *
 * Zero-change contract: when neither options nor env are configured, the
 * per-callsite defaults reproduce the pre-refactor behavior byte-for-byte
 * (register: 8/upper/lower/digit; change/reset: 12/upper/lower/digit/special).
 *
 * R12 / PIT-045: OptionsManager.get returns parsed jsonb (native number /
 * boolean) while env fallbacks arrive as strings — every option value is
 * coerced defensively so both forms work.
 */
export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
}

export type PasswordPolicyCallsite = 'register' | 'password-change' | 'user_create';

const DEFAULTS: Record<PasswordPolicyCallsite, PasswordPolicy> = {
  register: {
    minLength: 8,
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSpecial: false,
  },
  'password-change': {
    minLength: 12,
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSpecial: true,
  },
  // L-prime G-3: tenant-admin bootstrap provisions credentials through the same
  // policy surface as self-registration (register profile; the five password_*
  // option keys are callsite-shared — no new options codes).
  user_create: {
    minLength: 8,
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSpecial: false,
  },
};

/** Coerce an env-string-or-jsonb option into a boolean, defensively. */
function asBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return v === true;
}

/** Coerce an env-string-or-jsonb option into a positive integer, defensively. */
function asInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return fallback;
}

/**
 * Resolve the effective policy for a callsite: option > env > callsite default.
 * `manager.get` must be passed METHOD-BOUND (e.g. `manager.get.bind(manager)` or
 * an arrow wrapper) — OptionsManager.get reads `this.cache`; a bare method
 * reference would lose `this` under ESM strict mode.
 */
export async function readPasswordPolicy(
  getOption: <T>(key: string, envValue: T | undefined, defaultValue: T) => Promise<T>,
  callsite: PasswordPolicyCallsite,
): Promise<PasswordPolicy> {
  const def = DEFAULTS[callsite];
  const minLength = asInt(
    await getOption<unknown>('password_min_length', process.env['PASSWORD_MIN_LENGTH'], def.minLength),
    def.minLength,
  );
  const requireUpper = asBool(
    await getOption<unknown>('password_require_upper', process.env['PASSWORD_REQUIRE_UPPER'], def.requireUpper),
    def.requireUpper,
  );
  const requireLower = asBool(
    await getOption<unknown>('password_require_lower', process.env['PASSWORD_REQUIRE_LOWER'], def.requireLower),
    def.requireLower,
  );
  const requireDigit = asBool(
    await getOption<unknown>('password_require_digit', process.env['PASSWORD_REQUIRE_DIGIT'], def.requireDigit),
    def.requireDigit,
  );
  const requireSpecial = asBool(
    await getOption<unknown>('password_require_special', process.env['PASSWORD_REQUIRE_SPECIAL'], def.requireSpecial),
    def.requireSpecial,
  );
  return { minLength, requireUpper, requireLower, requireDigit, requireSpecial };
}

/** Check a password against the policy; returns a route-shaped result. */
export function assertPasswordPolicy(
  password: string,
  policy: PasswordPolicy,
  code?: string,
): { ok: true; code?: undefined; message?: undefined } | { ok: false; code?: string; message: string } {
  if (password.length < policy.minLength) {
    return {
      ok: false,
      code,
      message: `Password needs ${policy.minLength}+ chars with${policy.requireUpper ? ' upper,' : ''}${policy.requireLower ? ' lower,' : ''}${policy.requireDigit ? ' digit' : ''}${policy.requireSpecial ? ' and special' : ''}`,
    };
  }
  if (policy.requireUpper && !/[A-Z]/.test(password)) return { ok: false, code, message: 'Password must contain an uppercase letter' };
  if (policy.requireLower && !/[a-z]/.test(password)) return { ok: false, code, message: 'Password must contain a lowercase letter' };
  if (policy.requireDigit && !/\d/.test(password)) return { ok: false, code, message: 'Password must contain a digit' };
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) return { ok: false, code, message: 'Password must contain a special character' };
  return { ok: true };
}
