/**
 * Q4b admin groups route tests (/api/v1/groups).
 *
 * Factory-mock style (roles.test.ts precedent): GroupManager is a mock class,
 * requirePermission allow-by-default, UserManager guard fast-path stub with a
 * transaction seam (routeTx). Covers the CRUD + members + roles surface and
 * the full error-mapping matrix: GROUP_NOT_FOUND→404, GROUP_NAME_EXISTS→409,
 * LAST_ADMIN_GUARD→409 (conflict-mapper), tenant-mismatch→400, and the
 * PUT /roles transaction threading.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { IdentityService } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const GID = '11111111-1111-1111-1111-111111111111';
const UID = '22222222-2222-2222-2222-222222222222';
const RID1 = '33333333-3333-3333-3333-333333333333';
const RID2 = '44444444-4444-4444-4444-444444444444';
// id used by the 404-probe route hits (well-formed uuid, store misses it)
const NONE = '99999999-9999-9999-9999-999999999999';

const group = (overrides: Record<string, unknown> = {}) => ({
  id: GID,
  tenantId: TENANT,
  name: 'Eng',
  description: undefined,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const groupInstance = {
  list: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  getGroupRoles: vi.fn(),
  setGroupRoles: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

/** Arm exactly one funnel to reject (once) with a manager error tag. */
function armFail(method: keyof typeof groupInstance, message: string): void {
  (groupInstance[method] as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(message));
}

vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    GroupManager: vi.fn().mockImplementation(() => groupInstance),
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'admin-u1', email: 'admin@accessbase.local' }),
      transaction: (fn: (d: unknown) => unknown) => fn({}),
    })),
    RoleManager: vi.fn().mockImplementation(() => ({})),
    PermissionManager: vi.fn().mockImplementation(() => ({
      hasPermission: vi.fn().mockResolvedValue(true),
    })),
  };
});

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;
const AUTH = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: UID, tenantId: TENANT });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  groupInstance.list.mockResolvedValue([{ ...group(), memberCount: 2, roleCount: 1 }]);
  groupInstance.findById.mockResolvedValue(group());
  groupInstance.create.mockResolvedValue(group({ name: 'New' }));
  groupInstance.update.mockResolvedValue(group({ name: 'Renamed' }));
  groupInstance.delete.mockResolvedValue(undefined);
  groupInstance.listMembers.mockResolvedValue([{ userId: UID, email: 'a@b.c', name: 'A' }]);
  groupInstance.addMember.mockResolvedValue(undefined);
  groupInstance.removeMember.mockResolvedValue(undefined);
  groupInstance.getGroupRoles.mockResolvedValue([RID1]);
  groupInstance.setGroupRoles.mockResolvedValue(undefined);
});

describe('groups CRUD', () => {
  it('GET / → list with counts, tenant-scoped', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/groups', headers: AUTH() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ name: 'Eng', memberCount: 2, roleCount: 1 });
    expect(groupInstance.list).toHaveBeenCalledWith(TENANT);
  });

  it('GET /:id → 200 with the group', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/groups/${GID}`, headers: AUTH() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: GID, name: 'Eng' });
    expect(groupInstance.findById).toHaveBeenCalledWith(GID, TENANT);
  });

  it('GET /:id → 404 when the group is not found (findById returns null)', async () => {
    groupInstance.findById.mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'GET', url: `/api/v1/groups/${NONE}`, headers: AUTH() });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('GROUP_NOT_FOUND');
  });

  it('POST / → 201 create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: AUTH(),
      payload: { name: 'New' },
    });
    expect(res.statusCode).toBe(201);
    expect(groupInstance.create).toHaveBeenCalledWith({ name: 'New', description: undefined }, TENANT);
  });

  it('POST / → 409 on GROUP_NAME_EXISTS', async () => {
    armFail('create', 'GROUP_NAME_EXISTS');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: AUTH(),
      payload: { name: 'Dup' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('GROUP_NAME_EXISTS');
  });

  it('PUT /:id → 200 update', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${GID}`,
      headers: AUTH(),
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(groupInstance.update).toHaveBeenCalledWith(GID, { name: 'Renamed' }, TENANT);
  });

  it('DELETE /:id → 409 on LAST_ADMIN_GUARD (conflict-mapper)', async () => {
    armFail('delete', 'LAST_ADMIN_GUARD: group is the only admin source of the tenant');
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/groups/${GID}`, headers: AUTH() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LAST_ADMIN_GUARD');
  });

  it('DELETE /:id → 200 happy', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/groups/${GID}`, headers: AUTH() });
    expect(res.statusCode).toBe(200);
    expect(groupInstance.delete).toHaveBeenCalledWith(GID, TENANT);
  });
});

describe('groups membership', () => {
  it('GET /:id/members → list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GID}/members`,
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ userId: UID, email: 'a@b.c', name: 'A' }]);
  });

  it('POST /:id/members → 400 on GROUP_MEMBER_TENANT_MISMATCH (R5)', async () => {
    armFail('addMember', 'GROUP_MEMBER_TENANT_MISMATCH');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GID}/members`,
      headers: AUTH(),
      payload: { userId: UID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('GROUP_MEMBER_TENANT_MISMATCH');
  });

  it('POST /:id/members → 200 happy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GID}/members`,
      headers: AUTH(),
      payload: { userId: UID },
    });
    expect(res.statusCode).toBe(200);
    expect(groupInstance.addMember).toHaveBeenCalledWith(GID, UID, TENANT);
  });

  it('DELETE /:id/members/:userId → 200', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${GID}/members/${UID}`,
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    expect(groupInstance.removeMember).toHaveBeenCalledWith(GID, UID, TENANT);
  });

  it('DELETE /:id/members/:userId → 409 on LAST_ADMIN_GUARD (sole-admin member removal)', async () => {
    armFail('removeMember', "LAST_ADMIN_GUARD: would remove the tenant's last administrator");
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${GID}/members/${UID}`,
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LAST_ADMIN_GUARD');
  });
});

describe('groups role bindings', () => {
  it('GET /:id/roles → id list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GID}/roles`,
      headers: AUTH(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([RID1]);
  });

  it('PUT /:id/roles → setGroupRoles threaded through routeTx (4th arg)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${GID}/roles`,
      headers: AUTH(),
      payload: { roleIds: [RID1, RID2] },
    });
    expect(res.statusCode).toBe(200);
    // tx handle is the 4th positional arg (Q2b routeTx discipline).
    expect(groupInstance.setGroupRoles).toHaveBeenCalledWith(GID, [RID1, RID2], TENANT, expect.anything());
  });

  it('PUT /:id/roles → 400 on GROUP_ROLE_TENANT_MISMATCH', async () => {
    armFail('setGroupRoles', 'GROUP_ROLE_TENANT_MISMATCH');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${GID}/roles`,
      headers: AUTH(),
      payload: { roleIds: [RID1] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('GROUP_ROLE_TENANT_MISMATCH');
  });

  it('PUT /:id/roles → 409 on LAST_ADMIN_GUARD (unbinding orphan census, R2)', async () => {
    armFail('setGroupRoles', 'LAST_ADMIN_GUARD: unbinding group roles would orphan the tenant');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${GID}/roles`,
      headers: AUTH(),
      payload: { roleIds: [] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LAST_ADMIN_GUARD');
  });
});

describe('groups guards', () => {
  it('unauthenticated → 401 (authenticate preHandler)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/groups' });
    expect(res.statusCode).toBe(401);
  });

  it('requirePermission maps groups paths via the routePermissions prefix mechanism', async () => {
    const { getRequiredPermission } = await import('@accessbase/identity');
    expect(getRequiredPermission('GET', '/api/v1/groups')).toBe('groups:read');
    expect(getRequiredPermission('POST', `/api/v1/groups/${GID}/members`)).toBe('groups:write');
    expect(getRequiredPermission('PUT', `/api/v1/groups/${GID}/roles`)).toBe('groups:write');
    expect(getRequiredPermission('DELETE', `/api/v1/groups/${GID}/members/${UID}`)).toBe('groups:delete');
    expect(getRequiredPermission('DELETE', `/api/v1/groups/${GID}`)).toBe('groups:delete');
  });
});
