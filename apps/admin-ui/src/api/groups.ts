import client from './client';
import type { ApiEnvelope } from './types';

/** Group entity — matches routes/groups.ts projection. The list view adds
 * memberCount/roleCount; the detail view carries only the base fields. */
export interface Group {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
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

/** POST /v1/groups body (route schema: name required, description optional) */
export interface CreateGroupPayload {
  name: string;
  description?: string;
}

/** PUT /v1/groups/:id body — both fields optional */
export interface UpdateGroupPayload {
  name?: string;
  description?: string;
}

/** List groups (plain array envelope, tenant-scoped server-side) */
export async function fetchGroups(): Promise<GroupListItem[]> {
  const { data } = await client.get<ApiEnvelope<GroupListItem[]>>('/v1/groups');
  return data.data;
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
