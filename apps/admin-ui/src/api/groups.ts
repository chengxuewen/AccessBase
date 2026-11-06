import client from './client';
import type { ApiEnvelope } from './types';

/** Group classification (data-scope batch): kind='department' groups are the row-scope
 * source for users with a 'dept' binding; plain groups stay 'group'. */
export type GroupKind = 'group' | 'department';

/** Group entity — matches routes/groups.ts projection. The list view adds
 * memberCount/roleCount; the detail view carries only the base fields. */
export interface Group {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  kind: GroupKind;
  createdAt: string;
  updatedAt: string;
}

export interface GroupListItem extends Group {
  memberCount: number;
  roleCount: number;
}

/** Group member row — GET /v1/groups/:id/members */
export interface GroupMember {
  userId: string;
  email: string;
  name: string;
}

/** POST /v1/groups body (route schema: name required, description/kind optional) */
export interface CreateGroupPayload {
  name: string;
  description?: string;
  kind?: GroupKind;
}

/** PUT /v1/groups/:id body — all fields optional */
export interface UpdateGroupPayload {
  name?: string;
  description?: string;
  kind?: GroupKind;
}

/** List groups (plain array envelope, tenant-scoped server-side) */
export interface GroupPage {
  data: GroupListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** T3: server-side pagination + name search (the envelope adds total/page/pageSize siblings). */
export async function fetchGroups(params?: {
  page?: number;
  pageSize?: number;
  name?: string;
}): Promise<GroupPage> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params?.name) qs.set('name', params.name);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await client.get<
    ApiEnvelope<GroupListItem[]> & { total?: number; page?: number; pageSize?: number }
  >(`/v1/groups${suffix}`);
  // T3 compat: new envelope {data,total,...} OR legacy plain-array data (older mocks/clients)
  const payload = data as unknown as
    { data?: GroupListItem[]; total?: number; page?: number; pageSize?: number } | GroupListItem[];
  const arr = Array.isArray(payload) ? payload : (payload.data ?? []);
  return {
    data: arr,
    total: Array.isArray(payload) ? arr.length : (payload.total ?? arr.length),
    page: Array.isArray(payload) ? 1 : (payload.page ?? 1),
    pageSize: Array.isArray(payload) ? arr.length : (payload.pageSize ?? 20),
  };
}

/** POST /v1/groups — create (201 envelope); 409 GROUP_NAME_EXISTS */
export async function createGroup(payload: CreateGroupPayload): Promise<Group> {
  const { data } = await client.post<ApiEnvelope<Group>>('/v1/groups', payload);
  return data.data;
}

/** PUT /v1/groups/:id — rename / re-describe */
export async function updateGroup(id: string, payload: UpdateGroupPayload): Promise<Group> {
  const { data } = await client.put<ApiEnvelope<Group>>(`/v1/groups/${id}`, payload);
  return data.data;
}

/** DELETE /v1/groups/:id — cascade membership + bindings; 409 LAST_ADMIN_GUARD */
export async function deleteGroup(id: string): Promise<void> {
  await client.delete<ApiEnvelope<null>>(`/v1/groups/${id}`);
}

/** List group members */
export async function fetchGroupMembers(id: string): Promise<GroupMember[]> {
  const { data } = await client.get<ApiEnvelope<GroupMember[]>>(`/v1/groups/${id}/members`);
  return data.data;
}

/** Add a member; 400 GROUP_MEMBER_TENANT_MISMATCH */
export async function addGroupMember(id: string, userId: string): Promise<void> {
  await client.post<ApiEnvelope<null>>(`/v1/groups/${id}/members`, { userId });
}

/** Remove a member; 409 LAST_ADMIN_GUARD */
export async function removeGroupMember(id: string, userId: string): Promise<void> {
  await client.delete<ApiEnvelope<null>>(`/v1/groups/${id}/members/${userId}`);
}

/** List bound role ids */
export async function fetchGroupRoles(id: string): Promise<string[]> {
  const { data } = await client.get<ApiEnvelope<string[]>>(`/v1/groups/${id}/roles`);
  return data.data;
}

/** Replace role bindings; 400 GROUP_ROLE_TENANT_MISMATCH; 409 LAST_ADMIN_GUARD */
export async function setGroupRoles(id: string, roleIds: string[]): Promise<void> {
  await client.put<ApiEnvelope<null>>(`/v1/groups/${id}/roles`, { roleIds });
}
