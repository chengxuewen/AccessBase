import client from './client';
import type { ApiEnvelope, PaginatedEnvelope } from './types';

/** User entity — matches @accessbase/types User; roles/roleIds optional from detail views */
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  isActive: boolean;
  status?: 'active' | 'suspended' | 'pending';
  emailVerified?: boolean;
  tenantId: string;
  tokenVersion: number;
  createdAt: string;
  updatedAt: string;
  roles?: { id: string; name: string }[];
  roleIds?: string[];
}

export interface PaginatedUsers {
  data: User[];
  total: number;
}

export interface ListUsersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'active' | 'suspended' | 'pending';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** List users (paginated) */
export async function listUsers(params: ListUsersParams = {}): Promise<PaginatedUsers> {
  const { data } = await client.get<PaginatedEnvelope<User>>('/v1/users', { params });
  return { data: data.data, total: data.total };
}

/** Get current user profile */
export async function getCurrentUser(): Promise<User> {
  const { data } = await client.get<ApiEnvelope<User>>('/v1/users/me');
  return data.data;
}

/** Get user by ID */
export async function getUser(id: string): Promise<User> {
  const { data } = await client.get<ApiEnvelope<User>>(`/v1/users/${id}`);
  return data.data;
}

/** Create a new user */
export async function createUser(payload: {
  email: string;
  name: string;
  password?: string;
  avatarUrl?: string;
  isActive?: boolean;
  roleIds?: string[];
}): Promise<User> {
  const { data } = await client.post<ApiEnvelope<User>>('/v1/users', payload);
  return data.data;
}

/** Update user */
export async function updateUser(
  id: string,
  payload: { name?: string; avatarUrl?: string },
): Promise<User> {
  const { data } = await client.put<ApiEnvelope<User>>(`/v1/users/${id}`, payload);
  return data.data;
}

/** Change user status */
export async function changeUserStatus(
  id: string,
  status: 'active' | 'suspended' | 'pending',
): Promise<User> {
  const { data } = await client.patch<ApiEnvelope<User>>(`/v1/users/${id}/status`, { status });
  return data.data;
}

/** Delete user */
export async function deleteUser(id: string): Promise<void> {
  await client.delete(`/v1/users/${id}`);
}

/** Import report — dry-run or commit result (matches POST /v1/users/import). */
export interface ImportReport {
  valid?: number;
  created?: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

/** Two-phase import: omit commit for dry-run report. */
export async function importUsers(
  rows: Array<{ email: string; name: string; password: string }>,
  commit = false,
): Promise<ImportReport> {
  const { data } = await client.post<ApiEnvelope<ImportReport>>('/v1/users/import', {
    rows,
    ...(commit ? { commit: true } : {}),
  });
  return data.data;
}

/** Force logout — revoke every session of the user. */
export async function forceLogoutUser(id: string): Promise<void> {
  await client.post(`/v1/users/${id}/force-logout`);
}

/** Export users CSV — resolves with a Blob for browser download. */
export async function exportUsersCsv(): Promise<void> {
  const res = await client.get('/v1/users/export', { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
