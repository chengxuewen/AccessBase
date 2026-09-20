import client from './client';
import type { ApiEnvelope, PaginatedEnvelope } from './types';

/** Tenant entity — matches routes/tenants.ts projection. isDefault is
 * backend-computed (spec D5): the page never embeds the UUID literal. */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListTenantsParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

/** POST /v1/tenants body (route schema: slug ^[a-z0-9]+(?:-[a-z0-9]+)*$) */
export interface CreateTenantPayload {
  name: string;
  slug: string;
}

/** PUT /v1/tenants/:id body — name/slug/status all optional */
export interface UpdateTenantPayload {
  name?: string;
  slug?: string;
  status?: 'active' | 'suspended';
}

/** POST /v1/tenants/:id/bootstrap body (spec D2) */
export interface BootstrapTenantPayload {
  email: string;
  name: string;
  password: string;
}

/** Bootstrap result: 201 on first run, 200 with alreadyBootstrapped on replay */
export interface BootstrapTenantResult {
  userId: string;
  roleId: string;
  tenantId: string;
  alreadyBootstrapped: boolean;
}

/** List tenants (paginated) */
export async function fetchTenants(params: ListTenantsParams = {}): Promise<{ data: Tenant[]; total: number }> {
  const { data } = await client.get<PaginatedEnvelope<Tenant>>('/v1/tenants', { params });
  return { data: data.data, total: data.total };
}

/** POST /v1/tenants — create (201 envelope) */
export async function createTenant(payload: CreateTenantPayload): Promise<Tenant> {
  const { data } = await client.post<ApiEnvelope<Tenant>>('/v1/tenants', payload);
  return data.data;
}

/** PUT /v1/tenants/:id — rename / re-slug / suspend / activate */
export async function updateTenant(id: string, payload: UpdateTenantPayload): Promise<Tenant> {
  const { data } = await client.put<ApiEnvelope<Tenant>>(`/v1/tenants/${id}`, payload);
  return data.data;
}

/** DELETE /v1/tenants/:id — soft delete (server suspends via manager) */
export async function deleteTenant(id: string): Promise<Tenant> {
  const { data } = await client.delete<ApiEnvelope<Tenant>>(`/v1/tenants/${id}`);
  return data.data;
}

/** POST /v1/tenants/:id/bootstrap — first tenant admin (spec D2 bootstrap) */
export async function bootstrapTenant(
  id: string,
  payload: BootstrapTenantPayload,
): Promise<BootstrapTenantResult> {
  const { data } = await client.post<ApiEnvelope<BootstrapTenantResult>>(
    `/v1/tenants/${id}/bootstrap`,
    payload,
  );
  return data.data;
}
