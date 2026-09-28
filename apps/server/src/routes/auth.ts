/**
 * Auth routes façade (batch R2, DG-5 pure move of the 2085-line monolith).
 * Keeps the per-registration instance construction + closure helpers EXACTLY
 * as before and registers the split sub-route modules (routes/auth/*) in the
 * original route order (the passwordless lane interleaves exactly where
 * the monolith had it). Sub-modules run against the root instance (no
 * app.register sub-hierarchy) so preHandlers/schemas behave identically.
 */
import type { FastifyInstance } from 'fastify';
import {
  FlowTokenService,
  LockoutService,
  PermissionManager,
  RoleManager,
  SessionManager,
} from '@accessbase/identity';
import { getRedis } from '../utils/redis.js';
import { config } from '../config.js';
import type { AuthContext } from './auth/context.js';
import {
  assertTenantActive as assertTenantActiveShared,
  cidrGate as cidrGateShared,
  issueTokenPair as issueTokenPairShared,
  permissionsOf as permissionsOfShared,
  rolesOf as rolesOfShared,
  safeRedis,
} from './auth/shared.js';
import {
  loginRoutes,
  registerRoutes,
  verifyEmailRequestRoutes,
  verifyEmailConsumeRoutes,
} from './auth/login.js';
import {
  meRoutes,
  logoutRoutes,
  revokeOthersRoutes,
  sessionsListRoutes,
  revokeSessionRoutes,
  refreshRoutes,
} from './auth/core.js';
import {
  changePasswordRoutes,
  forgotPasswordRoutes,
  resetPasswordRoutes,
} from './auth/password.js';
import {
  magicRequestRoutes,
  magicConsumeRoutes,
  smsOtpRequestRoutes,
  captchaRoutes,
  smsOtpVerifyRoutes,
} from './auth/passwordless.js';
import {
  mfaSetupRoutes,
  mfaEnableRoutes,
  mfaVerifyRoutes,
  mfaDisableRoutes,
} from './auth/mfa.js';
import { ldapLoginRoutes } from './auth/ldap.js';

// Test seam (sms-otp/verify-email/magic-login suites import it through this
// façade path): H′3 one-time host-fallback warn latch reset.
export { _resetHostFallbackWarnForTest } from './auth/shared.js';
// Public surface of the pre-split module — kept importable from app code.
export { getSmtpMailer, resolvePublicOrigin } from './auth/shared.js';

export async function authRoutes(app: FastifyInstance) {
  const sessionManager = new SessionManager(undefined, await getRedis());
  const roleManager = new RoleManager();
  // One manager per app registration — same convention as permissionRoutes.
  const permissionManager = new PermissionManager();

  const lockout = new LockoutService({
    redis: config.nodeEnv === 'test' ? undefined : safeRedis(),
    maxFailures: config.lockoutMaxFailures,
    windowSeconds: config.lockoutWindowSeconds,
  });
  const flowTokens = new FlowTokenService(
    config.nodeEnv === 'test' ? undefined : safeRedis(),
  );

  const ctx: AuthContext = {
    sessionManager,
    roleManager,
    permissionManager,
    lockout,
    flowTokens,
    cidrGate: cidrGateShared,
    issueTokenPair: (request, user) => issueTokenPairShared(app, sessionManager, request, user),
    assertTenantActive: assertTenantActiveShared,
    rolesOf: (userId, tenantId) => rolesOfShared(roleManager, userId, tenantId),
    permissionsOf: (userId, tenantId) => permissionsOfShared(permissionManager, userId, tenantId),
    replySent: (reply) => reply.sent,
  };

  // Order == pre-split monolith registration order.
  await loginRoutes(app, ctx);
  await registerRoutes(app, ctx);
  await verifyEmailRequestRoutes(app, ctx);
  await verifyEmailConsumeRoutes(app, ctx);
  await meRoutes(app, ctx);
  await logoutRoutes(app, ctx);
  await revokeOthersRoutes(app, ctx);
  await sessionsListRoutes(app, ctx);
  await revokeSessionRoutes(app, ctx);
  await refreshRoutes(app, ctx);
  await changePasswordRoutes(app, ctx);
  await forgotPasswordRoutes(app, ctx);
  await magicRequestRoutes(app, ctx);
  await magicConsumeRoutes(app, ctx);
  await smsOtpRequestRoutes(app, ctx);
  await captchaRoutes(app, ctx);
  await smsOtpVerifyRoutes(app, ctx);
  await resetPasswordRoutes(app, ctx);
  await mfaSetupRoutes(app, ctx);
  await mfaEnableRoutes(app, ctx);
  await mfaVerifyRoutes(app, ctx);
  await mfaDisableRoutes(app, ctx);
  await ldapLoginRoutes(app, ctx);
}
