import client from './client';

/** User entity — matches @accessbase/types User (no roles field) */
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  isActive: boolean;
  tenantId: string;
  tokenVersion: number;
  createdAt: string;
  updatedAt: string;
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
  const { data } = await client.get('/v1/users', { params });
  return { data: data.data, total: data.total };
}

/** Get current user profile */
export async function getCurrentUser(): Promise<User> {
  const { data } = await client.get('/v1/users/me');
  return data.data;
}

/** Get user by ID */
export async function getUser(id: string): Promise<User> {
  const { data } = await client.get(`/v1/users/${id}`);
  return data.data;
}

/** Create a new user */
export async function createUser(payload: {
  email: string;
  name: string;
  password?: string;
  avatarUrl?: string;
}): Promise<User> {
  const { data } = await client.post('/v1/users', payload);
  return data.data;
}

/** Update user */
export async function updateUser(
  id: string,
  payload: { name?: string; avatarUrl?: string },
): Promise<User> {
  const { data } = await client.put(`/v1/users/${id}`, payload);
  return data.data;
}

/** Change user status */
export async function changeUserStatus(
  id: string,
  status: 'active' | 'suspended' | 'pending',
): Promise<User> {
  const { data } = await client.patch(`/v1/users/${id}/status`, { status });
  return data.data;
}

/** Delete user */
export async function deleteUser(id: string): Promise<void> {
  await client.delete(`/v1/users/${id}`);
}
