import client from './client';
import type { ApiEnvelope, PaginatedEnvelope } from './types';

/** Role entity — server wire shape (RoleManager.mapToRole): the detail
 * (GET /roles/:id) carries full `permissions` objects; there is no
 * `permissionIds` field on the wire. */
export interface Role {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  tenantId?: string;
  permissions?: Permission[];
  createdAt: string;
  updatedAt: string;
}

/** Permission entity — matches GET /api/v1/permissions response */
export interface Permission {
  id: string;
  resource: string;
  action: string;
  description?: string;
  createdAt?: string;
}

export interface PaginatedRoles {
  data: Role[];
  total: number;
}

export interface ListRolesParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

/** List roles (paginated) */
export async function listRoles(params: ListRolesParams = {}): Promise<PaginatedRoles> {
  const { data } = await client.get<PaginatedEnvelope<Role>>('/v1/roles', { params });
  return { data: data.data, total: data.total };
}

/** Get role by ID */
export async function getRole(id: string): Promise<Role> {
  const { data } = await client.get<ApiEnvelope<Role>>(`/v1/roles/${id}`);
  return data.data;
}

/** Create a role */
export async function createRole(payload: {
  name: string;
  description?: string;
  parentId?: string;
  permissionIds?: string[];
}): Promise<Role> {
  const { data } = await client.post<ApiEnvelope<Role>>('/v1/roles', payload);
  return data.data;
}

/** Update a role */
export async function updateRole(
  id: string,
  payload: { name?: string; description?: string; permissionIds?: string[] },
): Promise<Role> {
  const { data } = await client.put<ApiEnvelope<Role>>(`/v1/roles/${id}`, payload);
  return data.data;
}

/** Delete a role */
export async function deleteRole(id: string): Promise<void> {
  await client.delete(`/v1/roles/${id}`);
}

/** List permissions (for role permission assignment) */
export async function listPermissions(params: {
  page?: number;
  pageSize?: number;
} = {}): Promise<{ data: Permission[]; total: number }> {
  const { data } = await client.get<PaginatedEnvelope<Permission>>('/v1/permissions', { params });
  return { data: data.data, total: data.total };
}
