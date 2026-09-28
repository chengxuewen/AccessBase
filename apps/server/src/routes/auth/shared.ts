/**
 * routes/auth split (batch R2, DG-5 pure move): hoisted module-level helpers.
 * Bodies verbatim from routes/auth.ts; only the signatures gained the
 * parameters the closure versions used to capture (app / sessionManager /
 * roleManager / permissionManager) plus the H′3 latch accessors that keep the
 * once-per-process warn semantics intact across modules.
 */
import { Mailer, getRedisClient } from '@accessbase/identity';
import type {
  SessionManager,
  RoleManager,
  PermissionManager,
} from '@accessbase/identity';
import type { SmsConfig } from '@accessbase/identity';
import { getTenantManager } from '../../utils/managers.js';
import { cidrVerdict } from '../../utils/cidr.js';
import { config } from '../../config.js';
import { getOptionsManager } from '../options.js';
import { DEFAULT_TENANT } from '../../utils/constants.js';
import { logger } from '@accessbase/logging';
import type { FastifyInstance } from 'fastify';

// H′3: loud one-time warn when the magic-link origin falls back to the request
// Host (attacker-controllable). Module latch = once per process; exported reset
// is a test seam only (latch would otherwise fire in the first fallthrough test).
let hostFallbackWarned = false;
export function _resetHostFallbackWarnForTest(): void {
  hostFallbackWarned = false;
}

// Cross-module accessors for the SAME process latch above: resolvePublicOrigin
// below and the passwordless magic arm (routes/auth/passwordless.ts) both read
// and write it — a bare export binding cannot be reassigned cross-module.
export function getHostFallbackWarned(): boolean {
  return hostFallbackWarned;
}
export function setHostFallbackWarned(value: boolean): void {
  hostFallbackWarned = value;
}

/** Q1-b2: shared SMTP option set → Mailer (forgot/magic precedent, env>option>default). */
export async function getSmtpMailer(
  options: ReturnType<typeof getOptionsManager>,
): Promise<Mailer | null> {
  const host = await options.get('smtp_host', process.env['SMTP_HOST'], '');
  const port = Number(
    await options.get('smtp_port', process.env['SMTP_PORT'] ? Number(process.env['SMTP_PORT']) : undefined, 587),
  );
  const smtpUser = await options.get('smtp_user', process.env['SMTP_USER'], '');
  const pass = await options.get('smtp_password', process.env['SMTP_PASSWORD'], '');
  const from = await options.get('smtp_from', process.env['SMTP_FROM'], '');
  return host ? Mailer.fromConfig({ host, port, user: smtpUser, pass, from }) : null;
}

/**
 * R1-T10 (DG-8a): auth.require_verified_email — three-level read mirroring the
 * captcha gate (env > option > default 'false'), config-plane failure = off
 * (never block the login door on a dead options read). True ⇒ the TERMINAL
 * session-issuance arms demand a verified address; intermediate arms
 * (force-change / enroll / step-up) run BEFORE this check — anti-lockout.
 */
export async function verifiedEmailRequired(user: { emailVerified?: boolean }): Promise<boolean> {
  if (user.emailVerified === true) return false;
  let flag: unknown = 'false';
  try {
    flag = await getOptionsManager().get(
      'auth.require_verified_email',
      process.env['AUTH_REQUIRE_VERIFIED_EMAIL'],
      'false',
    );
  } catch {
    return false;
  }
  return flag === '1' || flag === 'true' || flag === 1 || flag === true;
}

/** Q1-b2: magic-link R3 three-arm origin chain (site.url > forwarded host when
 * TRUST_PROXY > request host with the module warn latch). */
export async function resolvePublicOrigin(
  request: { headers: { [k: string]: string | string[] | undefined }; protocol: string },
  options: ReturnType<typeof getOptionsManager>,
): Promise<string> {
  const siteUrl = await options.get('site.url', process.env['SITE_URL'], '');
  if (siteUrl) return siteUrl;
  const forwardedHost = config.trustProxy
    ? (request.headers['x-forwarded-host'] as string | undefined)
    : undefined;
  const proto = request.headers['x-forwarded-proto'] ?? request.protocol;
  if (forwardedHost) return `${proto}://${forwardedHost}`;
  if (!hostFallbackWarned) {
    hostFallbackWarned = true;
    logger.warn(
      'verify-email origin falling back to request Host — production MUST set SITE_URL',
    );
  }
  return `${proto}://${request.headers['host'] ?? ''}`;
}

// Tenant suspension gate: shared process singleton (Q2a — was a closure-local holder).
// Q3E-CIDR: network admission on the public auth surface (deny wins).
// Called BEFORE any credential/lockout work so blocked IPs cannot probe.
// Consume-side endpoints (magic/reset/otp verify) intentionally skip it —
// post-email IPs legitimately differ (spec E2).
export const cidrGate = async (request: { ip: string }, reply: {
  status: (c: number) => { send: (b: unknown) => unknown };
}): Promise<boolean> => {
  // Config-plane failure must NEVER 500 the login door (fail-open like
  // skipOnError rate limits): no lists readable = no gating active.
  let allow = '';
  let deny = '';
  try {
    const options = getOptionsManager();
    allow = String(await options.get('auth_cidr_allow', process.env['AUTH_CIDR_ALLOW'], ''));
    deny = String(await options.get('auth_cidr_deny', process.env['AUTH_CIDR_DENY'], ''));
  } catch {
    return false;
  }
  if (allow === '' && deny === '') return false;
  if (cidrVerdict(request.ip, String(allow), String(deny)) === 'blocked') {
    reply.status(403).send({
      success: false,
      error: { code: 'AUTH_IP_002', message: 'Access denied from this network' },
    });
    return true;
  }
  return false;
};

/**
 * SMS OTP delivery config (options key → env fallback, mailer precedent).
 * Credentials are env-only: secrets never enter the options table.
 * Returns null when no provider is selected (SMS disabled).
 */
export async function readSmsConfig(options: { get<T>(key: string, envValue: T | undefined, defaultValue: T): Promise<T> }): Promise<SmsConfig | null> {
  const provider = await options.get('sms_provider', process.env['SMS_PROVIDER'], '');
  if (!provider) return null;
  const signName = await options.get('sms_sign_name', process.env['SMS_SIGN_NAME'], '');
  const templateCode = await options.get('sms_template_code', process.env['SMS_TEMPLATE_CODE'], '');
  return {
    provider: provider as SmsConfig['provider'],
    signName: signName || undefined,
    templateCode: templateCode || undefined,
    accessKeyId: process.env['ALIBABA_CLOUD_ACCESS_KEY_ID'] || undefined,
    accessKeySecret: process.env['ALIBABA_CLOUD_ACCESS_KEY_SECRET'] || undefined,
    accountSid: process.env['TWILIO_ACCOUNT_SID'] || undefined,
    authToken: process.env['TWILIO_AUTH_TOKEN'] || undefined,
    fromNumber: process.env['TWILIO_FROM_NUMBER'] || undefined,
  };
}

/**
 * Tenant suspension gate (G/R1) — fail-closed check run INSIDE issueTokenPair
 * so every issuance path (login/ldap/webauthn/oauth/saml/magic/mfa/
 * change-password) inherits it. Throws a tagged error that the global error
 * handler renders as 403 {code:'AUTH_TENANT_001'}; callers with swallowing
 * catch blocks rethrow it (see catch sites in this file).
 */
export async function assertTenantActive(user?: { tenantId?: string } | null): Promise<void> {
  const tenantId = user?.tenantId ?? DEFAULT_TENANT;
  // Fail-open on lookup ERROR (log + allow): only a confirmed suspended row
  // blocks. Mirrors the rate-limit skipOnError fail-open discipline — a PG
  // blip must not 403/500 every login. DB-down already fails login earlier.
  let tenant;
  try {
    tenant = await (await getTenantManager()).findById(tenantId);
  } catch (err) {
    logger.warn({ err }, 'Tenant status lookup failed — allowing (fail-open)');
    tenant = null;
  }
  if (tenant && tenant.status === 'suspended') {
    const err: Error & { code?: string; statusCode?: number } = new Error('Access denied');
    err.code = 'AUTH_TENANT_001';
    err.statusCode = 403;
    throw err;
  }
}

/** Issue access JWT + refresh token — shared by login (non-MFA) and /mfa/verify */
export async function issueTokenPair(
  app: FastifyInstance,
  sessionManager: SessionManager,
  request: { ip: string; headers: Record<string, unknown> },
  user: { id: string; email: string; status?: string; tenantId?: string; tokenVersion?: number },
) {
  await assertTenantActive(user);
  const accessToken = app.jwt.sign(
    // status claim rides along so authenticate can re-check it (P0; absent on legacy tokens → allowed)
    { sub: user.id, email: user.email, status: user.status, tenantId: user.tenantId ?? DEFAULT_TENANT, tokenVersion: user.tokenVersion },
    { expiresIn: '15m' },
  );
  const { refreshToken } = await sessionManager.issueRefreshToken(
    crypto.randomUUID(),
    user.id,
    {
      ip: request.ip,
      userAgent:
        (request.headers['user-agent'] as string | undefined) ?? 'unknown',
    },
  );
  return { accessToken, refreshToken };
}

/**
 * Real [{id,name}] role list for a user (login + /me share this projection).
 * tenantId comes from the request context; callers on public issuance paths
 * omit it and the default-tenant fallback applies.
 */
export async function rolesOf(roleManager: RoleManager, userId: string, tenantId?: string): Promise<{ id: string; name: string }[]> {
  const roles = await roleManager.getUserRoles(userId, tenantId ?? DEFAULT_TENANT);
  return roles.map((r) => ({ id: r.id, name: r.name }));
}
/** Effective 'resource:action' codes for /auth/me (frontend menu/route gating) */
export async function permissionsOf(permissionManager: PermissionManager, userId: string, tenantId?: string): Promise<string[]> {
  const perms = await permissionManager.getUserEffectivePermissions(userId, tenantId ?? DEFAULT_TENANT);
  return perms.map((p) => `${p.resource}:${p.action}`);
}

// AUDIT FIX security.md 19.12 baseline (min 12 + 4 classes) is now the
// 'password-change' callsite default of the options-driven policy (C2);
// failures keep the 400 VALIDATION_001 + 'newPassword: ...' contract.
export function policyErrorMessage(message: string): string {
  return `newPassword: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

/** Lockout/FlowToken redis seam: absent client in test env, fallible
 * getRedisClient elsewhere (verbatim safeRedis closure from the monolith). */
export function safeRedis() {
  try {
    return getRedisClient();
  } catch {
    return undefined;
  }
}
