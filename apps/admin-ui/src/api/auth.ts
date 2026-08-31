import client from './client';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export interface ChangePasswordPayload {
  oldPassword: string;
  newPassword: string;
}

/** Change password — returns fresh token pair (all other sessions were revoked) */
export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await client.post('/v1/auth/change-password', payload);
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
  const { data } = await client.get('/v1/auth/oauth/links');
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
}

/** List active sessions for the current user */
export async function getSessions(): Promise<SafeSessionInfo[]> {
  const { data } = await client.get('/v1/auth/sessions');
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
  const { data } = await client.get('/v1/auth/webauthn/credentials');
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
  const { data } = await client.post('/v1/auth/webauthn/register/options', {});
  return data.data;
}

/** Verify a browser registration ceremony result and store the passkey */
export async function verifyWebAuthnRegistration(flowToken: string, response: unknown): Promise<void> {
  await client.post('/v1/auth/webauthn/register/verify', { flowToken, response });
}

/** Get discoverable (usernameless) login options + challenge token */
export async function getWebAuthnLoginOptions(): Promise<WebAuthnOptionsPayload> {
  const { data } = await client.post('/v1/auth/webauthn/login/options', {});
  return data.data;
}

/** Verify a browser assertion and establish a session (returns login-shaped envelope) */
export async function verifyWebAuthnLogin(
  flowToken: string,
  response: unknown,
): Promise<{ accessToken: string; refreshToken: string; user: unknown }> {
  const { data } = await client.post('/v1/auth/webauthn/login/verify', { flowToken, response });
  return data.data;
  return data.data;
}
