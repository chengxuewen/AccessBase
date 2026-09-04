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
