import client from './client';
import type { ApiEnvelope } from './types';

export interface MfaSetupData {
  /** otpauth:// URI for manual entry in authenticator apps */
  otpauthUrl: string;
  /** PNG data-URL ready for <img src> (server-side QRCode.toDataURL) */
  qrDataUrl: string;
  /** One-time recovery codes — display immediately, never persist client-side */
  recoveryCodes: string[];
}

/** Start TOTP setup: generates secret + recovery codes (AUTH_MFA_002 on failure) */
export async function setupMfa(): Promise<MfaSetupData> {
  const { data } = await client.post<ApiEnvelope<MfaSetupData>>('/v1/auth/mfa/setup', {});
  return data.data;
}

/** Confirm setup with a live 6-8 digit TOTP code (AUTH_MFA_003 on wrong code) */
export async function enableMfa(code: string): Promise<void> {
  await client.post('/v1/auth/mfa/enable', { code });
}

/** Disable MFA after password re-verification (AUTH_MFA_004 on bad password) */
export async function disableMfa(password: string): Promise<void> {
  await client.post('/v1/auth/mfa/disable', { password });
}
