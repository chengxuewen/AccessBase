import client from './client';

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
