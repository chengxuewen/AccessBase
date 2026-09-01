import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Set env before importing config-dependent modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock plugins that require fastify@5 but fastify@4 is installed.
vi.mock('@fastify/cors', () => ({
  default: async () => {},
}));
vi.mock('@fastify/swagger', () => ({
  default: async () => {},
}));
vi.mock('@fastify/swagger-ui', () => ({
  default: async () => {},
}));

// Mock @accessbase/identity to avoid needing a real DB
const mockUser = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  email: 'test@example.com',
  name: 'Test User',
  isActive: true,
  tenantId: '00000000-0000-0000-0000-000000000001',
  tokenVersion: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockUser2 = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  email: 'admin@example.com',
  name: 'Admin User',
  isActive: true,
  tenantId: '00000000-0000-0000-0000-000000000001',
  tokenVersion: 0,
  createdAt: new Date('2026-01-02'),
  updatedAt: new Date('2026-01-02'),
};

const mockFindAll = vi.fn().mockResolvedValue({
  data: [mockUser, mockUser2],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
});

const mockFindById = vi.fn().mockImplementation((id: string) => {
  if (id === mockUser.id) return Promise.resolve(mockUser);
  if (id === '00000000-0000-0000-0000-000000000000') return Promise.resolve(null);
  return Promise.resolve(null);
});

const mockFindByEmail = vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' });

const mockCreate = vi.fn().mockImplementation((data: { email: string; name: string }) => {
  if (data.email === 'existing@example.com') {
    return Promise.reject(new Error('unique constraint violation'));
  }
  return Promise.resolve({
    ...mockUser,
    id: '550e8400-e29b-41d4-a716-446655440099',
    email: data.email,
    name: data.name,
  });
});

const mockUpdate = vi.fn().mockImplementation((id: string, data: { name?: string }) => {
  if (id === '00000000-0000-0000-0000-000000000000') {
    return Promise.reject(new Error('User not found'));
  }
  return Promise.resolve({ ...mockUser, ...data });
});

const mockChangeStatus = vi.fn().mockImplementation((id: string, status: string) => {
  if (id === '00000000-0000-0000-0000-000000000000') {
    return Promise.reject(new Error('User not found'));
  }
  return Promise.resolve({
    ...mockUser,
    isActive: status === 'active',
  });
});

const mockDelete = vi.fn().mockImplementation((id: string) => {
  if (id === '00000000-0000-0000-0000-000000000000') {
    return Promise.reject(new Error('User not found'));
  }
  return Promise.resolve();
});

// Spread actual so later-added identity exports (FlowTokenService, MfaManager,
// getRedisClient) keep resolving; the explicit mocks below override the managers.
vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  UserManager: vi.fn().mockImplementation(() => ({
    findAll: mockFindAll,
    findById: mockFindById,
    findByEmail: mockFindByEmail,
    create: mockCreate,
    update: mockUpdate,
    changeStatus: mockChangeStatus,
    delete: mockDelete,
  })),
  // roles.ts (wired in Phase 6a Task 1) imports RoleManager; mock it too
  RoleManager: vi.fn().mockImplementation(() => ({
    findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
  // auth.ts (Phase 6a Task 4) imports SessionManager; mock it too
  SessionManager: vi.fn().mockImplementation(() => ({
    rotateRefreshToken: vi.fn(),
    findSessionByToken: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn(),
    revokeAllUserSessions: vi.fn(),
  })),
}));

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: mockUser.id, email: mockUser.email });
});

afterAll(async () => {
  await app.close();
});

const authHeaders = () => ({ Authorization: `Bearer ${token}` });

describe('GET /api/v1/users', () => {
  it('returns paginated user list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toHaveProperty('isActive');
  });
});

describe('GET /api/v1/users/me', () => {
  it('returns current user profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('email');
    expect(body.data).toHaveProperty('name');
    expect(body.data).toHaveProperty('isActive');
    expect(body.data).not.toHaveProperty('roles');
  });
});

describe('GET /api/v1/users/:id', () => {
  it('returns user by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(mockUser.id);
    expect(body.data.email).toBe(mockUser.email);
  });

  it('returns 404 for nonexistent user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/users', () => {
  it('creates a new user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(),
      payload: { email: 'new@example.com', name: 'New User', password: 'password123' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('id');
    expect(body.data.email).toBe('new@example.com');
  });

  it('returns 409 on duplicate email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(),
      payload: { email: 'existing@example.com', name: 'Dup User' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });
});

describe('PUT /api/v1/users/:id', () => {
  it('updates user', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
      payload: { name: 'Updated Name' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Updated Name');
  });
});

describe('PATCH /api/v1/users/:id/status', () => {
  it('changes user status', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${mockUser.id}/status`,
      headers: authHeaders(),
      payload: { status: 'suspended' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('isActive');
  });

  it('returns 404 for nonexistent user', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000/status',
      headers: authHeaders(),
      payload: { status: 'suspended' },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
  });
});

describe('DELETE /api/v1/users/:id', () => {
  it('deletes user', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${mockUser.id}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
  });
});

describe('GET /api/v1/users (search)', () => {
  it('passes search params to UserManager', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?search=test&page=2&pageSize=10',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'test', page: 2, pageSize: 10 }),
      expect.any(String),
    );
  });
});
