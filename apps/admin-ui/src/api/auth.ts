import client from './client';
import type { ApiEnvelope } from './types';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export interface ChangePasswordPayload {
  oldPassword: string;
  newPassword: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Change password — returns fresh token pair (all other sessions were revoked) */
export async function changePassword(payload: ChangePasswordPayload): Promise<TokenPair> {
  const { data } = await client.post<ApiEnvelope<TokenPair>>('/v1/auth/change-password', payload);
  // Server envelope (routes/auth.ts:436): { success, data: { accessToken, refreshToken, expiresIn } }
  const pair: TokenPair | undefined = data?.data;
  if (typeof pair?.accessToken !== 'string' || typeof pair?.refreshToken !== 'string') {
    throw new Error('change-password response missing token pair');
  }
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
}

/** Revoke all other sessions, keeping the one tied to the current refresh token */
export async function revokeOtherSessions(refreshToken: string): Promise<void> {
  await client.post('/v1/auth/sessions/revoke-others', { refreshToken });
}

export interface OAuthLink {
  provider: string;
  providerAccountId: string;
}

/** List OAuth providers linked to the current user */
export async function getOAuthLinks(): Promise<OAuthLink[]> {
  const { data } = await client.get<ApiEnvelope<OAuthLink[]>>('/v1/auth/oauth/links');
  return data.data;
}

/** Unlink an OAuth provider from the current user */
export async function unlinkOAuthProvider(provider: string): Promise<void> {
  await client.delete(`/v1/auth/oauth/${provider}`);
}

/** Configured OAuth provider names for the login page (public endpoint) */
export async function listOAuthProviders(): Promise<string[]> {
  const { data } = await client.get<ApiEnvelope<{ providers: string[] }>>('/v1/auth/oauth/providers');
  return data.data.providers;
}

/** SAML login-page probe: is SAML SP configured (strict gate — no fallback) */
export async function fetchSamlStatus(): Promise<boolean> {
  const { data } = await client.get<ApiEnvelope<{ enabled: boolean }>>('/v1/auth/saml/status');
  return data.data.enabled === true;
}

export interface ExchangeUser {
  id: string;
  email: string;
  name: string;
  roles: { id: string; name: string }[];
}

export interface SamlExchangeResult {
  mfaRequired?: boolean;
  flowToken?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: ExchangeUser | null;
}

/** SAML/magic exchange union shape — same contract as oauth exchange */
type ExchangePayload = SamlExchangeResult;

/** Consume a SAML one-time code → session (token pair or MFA step-up) */
export async function exchangeSamlCode(code: string): Promise<ExchangePayload> {
  const { data } = await client.post<ApiEnvelope<ExchangePayload>>('/v1/auth/saml/exchange', { code });
  if (!data.success) throw new Error(data.error?.message ?? 'SAML exchange failed');
  return data.data;
}

/** Request a magic sign-in link. Enumeration-safe: always 202 with a fixed message */
export async function requestMagicLink(email: string): Promise<string> {
  const { data } = await client.post<ApiEnvelope<{ message: string }>>('/v1/auth/magic/request', { email });
  return data.data.message;
}

/** Magic link consume union shape — same contract as saml exchange */
export type MagicConsumeResult = SamlExchangeResult;

/** Consume a magic link token → session (token pair or MFA step-up) */
export async function consumeMagicLink(token: string): Promise<MagicConsumeResult> {
  const { data } = await client.post<ApiEnvelope<MagicConsumeResult>>('/v1/auth/magic/consume', { token });
  if (!data.success) throw new Error(data.error?.message ?? 'Magic link sign-in failed');
  return data.data;
}

export interface SafeSessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  /** true = this is the session issuing the request (self-revocation guard) */
  current: boolean;
}

/** List active sessions for the current user; refreshToken marks the caller's own session as current */
export async function getSessions(refreshToken?: string): Promise<SafeSessionInfo[]> {
  const { data } = await client.get<ApiEnvelope<SafeSessionInfo[]>>('/v1/auth/sessions', {
    params: refreshToken ? { refreshToken } : undefined,
  });
  return data.data;
}

/** Revoke one session by id */
export async function revokeSession(sessionId: string): Promise<void> {
  await client.post('/v1/auth/sessions/revoke', { sessionId });
}

export interface PasskeyCredential {
  id: string;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** List registered passkeys for the current user */
export async function getPasskeys(): Promise<PasskeyCredential[]> {
  const { data } = await client.get<ApiEnvelope<PasskeyCredential[]>>('/v1/auth/webauthn/credentials');
  return data.data;
}

/** Delete a registered passkey */
export async function deletePasskey(id: string): Promise<void> {
  await client.delete(`/v1/auth/webauthn/credentials/${id}`);
}

export interface WebAuthnOptionsPayload {
  options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
  flowToken: string;
}

/** Get WebAuthn registration options + single-use challenge token (auth flow) */
export async function getWebAuthnRegisterOptions(): Promise<WebAuthnOptionsPayload> {
  const { data } = await client.post<ApiEnvelope<WebAuthnOptionsPayload>>('/v1/auth/webauthn/register/options', {});
  return data.data;
}

/** Verify a browser registration ceremony result and store the passkey */
export async function verifyWebAuthnRegistration(flowToken: string, response: unknown): Promise<void> {
  await client.post('/v1/auth/webauthn/register/verify', { flowToken, response });
}

/** Get discoverable (usernameless) login options + challenge token */
export async function getWebAuthnLoginOptions(): Promise<WebAuthnOptionsPayload> {
  const { data } = await client.post<ApiEnvelope<WebAuthnOptionsPayload>>('/v1/auth/webauthn/login/options', {});
  return data.data;
}

/** Verify a browser assertion and establish a session (returns login-shaped envelope) */
export async function verifyWebAuthnLogin(
  flowToken: string,
  response: unknown,
): Promise<{ accessToken: string; refreshToken: string; user: unknown }> {
  const { data } = await client.post<ApiEnvelope<{ accessToken: string; refreshToken: string; user: unknown }>>('/v1/auth/webauthn/login/verify', { flowToken, response });
  return data.data;
}

/** Q1-f2: forgot-password request. Enumeration-safe server arm returns no
message body (rev.2 F2) — the page renders its own static success text. */
export async function requestPasswordReset(email: string): Promise<void> {
  await client.post('/v1/auth/forgot-password', { email });
}

/** Q1-f2: consume a /reset-password link token with the new password. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await client.post('/v1/auth/reset-password', { token, newPassword });
}

export interface RegisterResult {
  id: string;
  email: string;
  name: string;
  status: string;
}

/** Q1-f2: self-service registration — server creates a PENDING account. */
export async function registerUser(payload: {
  email: string;
  name: string;
  password: string;
}): Promise<RegisterResult> {
  const { data } = await client.post<ApiEnvelope<RegisterResult>>('/v1/auth/register', payload);
  return data.data;
}

/** Q1-f2: SMS OTP login-page probe (strict gate, saml/status pattern). */
export async function fetchSmsStatus(): Promise<boolean> {
  const { data } = await client.get<ApiEnvelope<{ enabled: boolean }>>('/v1/auth/sms/status');
  return data.data.enabled === true;
}

/** Q1-f2: request an OTP; resolves with the flow token the verify step needs
 * (wire-chain fix — the token only exists in the response since Q1-b1). */
export async function requestSmsOtp(phone: string): Promise<string> {
  const { data } = await client.post<ApiEnvelope<{ message: string; token: string }>>(
    '/v1/auth/sms-otp/request',
    { phone },
  );
  return data.data.token;
}

export interface SmsVerifyResult {
  accessToken?: string;
  refreshToken?: string;
  mfaRequired?: boolean;
  flowToken?: string;
}

export async function verifySmsOtp(token: string, code: string): Promise<SmsVerifyResult> {
  const { data } = await client.post<ApiEnvelope<SmsVerifyResult>>('/v1/auth/sms-otp/verify', {
    token,
    code,
  });
  return data.data;
}

/** Q1-f2: send a verification email to the authenticated user's own address. */
export async function requestEmailVerify(): Promise<void> {
  await client.post('/v1/auth/verify-email/request');
}

/** Q1-f2: public consume of an email-verification link token. */
export async function verifyEmailToken(token: string): Promise<void> {
  await client.post('/v1/auth/verify-email', { token });
}