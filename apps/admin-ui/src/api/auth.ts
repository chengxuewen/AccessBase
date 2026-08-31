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
