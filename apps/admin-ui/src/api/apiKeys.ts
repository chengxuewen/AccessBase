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
/** T3: server-side pagination — envelope gains total/page/pageSize siblings (events.ts precedent). */
export async function listApiKeys(params?: { page?: number; pageSize?: number }): Promise<{
  data: ApiKey[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await client.get<ApiEnvelope<ApiKey[]> & { total?: number; page?: number; pageSize?: number }>(
    `/v1/auth/api-keys${suffix}`,
  );
  const d = data as unknown as { data: ApiKey[]; total?: number; page?: number; pageSize?: number };
  return { data: d.data ?? [], total: d.total ?? (d.data?.length ?? 0), page: d.page ?? 1, pageSize: d.pageSize ?? 20 };
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
