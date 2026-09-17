import client from './client';
import type { PaginatedEnvelope } from './types';

/** Tenant entity — matches routes/tenants.ts list projection */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface ListTenantsParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

/** List tenants (paginated) */
export async function fetchTenants(params: ListTenantsParams = {}): Promise<{ data: Tenant[]; total: number }> {
  const { data } = await client.get<PaginatedEnvelope<Tenant>>('/v1/tenants', { params });
  return { data: data.data, total: data.total };
}
