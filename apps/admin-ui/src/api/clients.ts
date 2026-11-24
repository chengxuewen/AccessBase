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
  /** Operator-visible config (routes/clients.ts list/create echo it; null when unset). */
  backchannelLogoutUri?: string | null;
  /** 4A T1: CAEP/RISC SET push endpoint (create-only; attempt trail lives in caep_deliveries). */
  caepEndpointUri?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClientPayload {
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  scope: string;
  tokenAuthMethod?: string;
  /** Optional back-channel logout endpoint; server keeps it only when http(s)-prefixed. */
  backchannelLogoutUri?: string;
  /** 4A T1: optional CAEP/RISC SET receiver; https STRICT + SSRF-gated route-side. */
  caepEndpointUri?: string;
}

/** GET /v1/clients — list clients (no secret material) */
/** T3: server-side pagination — envelope gains total/page/pageSize siblings (events.ts precedent). */
export async function listClients(params?: { page?: number; pageSize?: number }): Promise<{
  data: OidcClient[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await client.get<
    ApiEnvelope<OidcClient[]> & { total?: number; page?: number; pageSize?: number }
  >(`/v1/clients${suffix}`);
  // T3 compat: new envelope {data,total,...} OR legacy plain-array data (older mocks/clients)
  const payload = data as unknown as
    { data?: OidcClient[]; total?: number; page?: number; pageSize?: number } | OidcClient[];
  const arr = Array.isArray(payload) ? payload : (payload.data ?? []);
  return {
    data: arr,
    total: Array.isArray(payload) ? arr.length : (payload.total ?? arr.length),
    page: Array.isArray(payload) ? 1 : (payload.page ?? 1),
    pageSize: Array.isArray(payload) ? arr.length : (payload.pageSize ?? 20),
  };
}

/** POST /v1/clients — create; response carries the plaintext secret ONCE */
export async function createClient(
  payload: CreateClientPayload,
): Promise<OidcClient & { clientSecret: string }> {
  const { data } = await client.post<ApiEnvelope<OidcClient & { clientSecret: string }>>(
    '/v1/clients',
    payload,
  );
  return data.data;
}

/** POST /v1/clients/:clientId/rotate-secret — new plaintext secret ONCE */
export async function rotateClientSecret(
  clientId: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const { data } = await client.post<ApiEnvelope<{ clientId: string; clientSecret: string }>>(
    `/v1/clients/${clientId}/rotate-secret`,
  );
  return data.data;
}

/** DELETE /v1/clients/:clientId — 204 on success */
export async function deleteClient(clientId: string): Promise<void> {
  await client.delete(`/v1/clients/${clientId}`);
}
