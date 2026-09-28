/**
 * routes/auth split (batch R2, DG-5 pure move): the per-app-registration
 * instance + closure surface shared by every auth sub-route module. The façade
 * (routes/auth.ts) constructs these EXACTLY as the monolith did — same
 * lifecycle (one set per app registration), same root-scoped registration
 * (sub-modules are plain functions called with the root instance, NO
 * app.register sub-hierarchy, so authenticate preHandlers and schema
 * behaviour are byte-identical) — and threads them through this context.
 */
import type { FastifyReply } from 'fastify';
import type {
  SessionManager,
  RoleManager,
  PermissionManager,
  LockoutService,
  FlowTokenService,
} from '@accessbase/identity';

export interface LoginBody {
  email: string;
  password: string;
}

export interface RegisterBody {
  email: string;
  name: string;
  password: string;
}

export interface AuthContext {
  sessionManager: SessionManager;
  roleManager: RoleManager;
  permissionManager: PermissionManager;
  lockout: LockoutService;
  flowTokens: FlowTokenService;
  /** Q3E-CIDR network admission on the public auth surface (deny wins). */
  cidrGate(request: { ip: string }, reply: {
    status: (c: number) => { send: (b: unknown) => unknown };
  }): Promise<boolean>;
  /** Issue access JWT + refresh token (fail-closed tenant gate inside). */
  issueTokenPair(
    request: { ip: string; headers: Record<string, unknown> },
    user: { id: string; email: string; status?: string; tenantId?: string; tokenVersion?: number },
  ): Promise<{ accessToken: string; refreshToken: string }>;
  /** Tenant suspension gate (G/R1) — tagged AUTH_TENANT_001 throw. */
  assertTenantActive(user?: { tenantId?: string } | null): Promise<void>;
  /** Real [{id,name}] role list (login + /me + magic/sms/ldap share it). */
  rolesOf(userId: string, tenantId?: string): Promise<{ id: string; name: string }[]>;
  /** Effective 'resource:action' codes for /auth/me (menu/route gating). */
  permissionsOf(userId: string, tenantId?: string): Promise<string[]>;
  /** Manual-decorator sentinel for the mfa dual-channel lanes. */
  replySent(reply: FastifyReply): boolean;
}
