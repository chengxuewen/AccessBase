import client from './client';
import type { ApiEnvelope } from './types';

/** Safe API key row — mirrors server SafeApiKey (never carries hash material) */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

/** POST 201 payload — plaintext is revealed exactly once */
export interface CreateApiKeyResponse extends ApiKey {
  plaintext: string;
}

export interface CreateApiKeyPayload {
  name: string;
  expiresAt?: string;
}

/** GET /v1/auth/api-keys — list keys (no hash material) */
export async function listApiKeys(): Promise<ApiKey[]> {
  const { data } = await client.get<ApiEnvelope<ApiKey[]>>('/v1/auth/api-keys');
  return data.data;
}

/** POST /v1/auth/api-keys — create; response carries the plaintext ONCE */
export async function createApiKey(payload: CreateApiKeyPayload): Promise<CreateApiKeyResponse> {
  const { data } = await client.post<ApiEnvelope<CreateApiKeyResponse>>('/v1/auth/api-keys', payload);
  return data.data;
}

/** DELETE /v1/auth/api-keys/:id — revoke (200 envelope) */
export async function revokeApiKey(id: string): Promise<void> {
  await client.delete(`/v1/auth/api-keys/${id}`);
}
