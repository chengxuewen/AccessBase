import client from './client';
import type { ApiEnvelope } from './types';

/** Safe client row — mirrors server OidcClientListRow (never carries secret material) */
export interface OidcClient {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  scope: string;
  tokenAuthMethod: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClientPayload {
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  scope: string;
  tokenAuthMethod?: string;
}

/** GET /v1/clients — list clients (no secret material) */
export async function listClients(): Promise<OidcClient[]> {
  const { data } = await client.get<ApiEnvelope<OidcClient[]>>('/v1/clients');
  return data.data;
}

/** POST /v1/clients — create; response carries the plaintext secret ONCE */
export async function createClient(payload: CreateClientPayload): Promise<OidcClient & { clientSecret: string }> {
  const { data } = await client.post<ApiEnvelope<OidcClient & { clientSecret: string }>>('/v1/clients', payload);
  return data.data;
}

/** POST /v1/clients/:clientId/rotate-secret — new plaintext secret ONCE */
export async function rotateClientSecret(clientId: string): Promise<{ clientId: string; clientSecret: string }> {
  const { data } = await client.post<ApiEnvelope<{ clientId: string; clientSecret: string }>>(
    `/v1/clients/${clientId}/rotate-secret`,
  );
  return data.data;
}

/** DELETE /v1/clients/:clientId — 204 on success */
export async function deleteClient(clientId: string): Promise<void> {
  await client.delete(`/v1/clients/${clientId}`);
}
