import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ACME_ID = '550e8400-e29b-41d4-a716-446655440010';
const OTHER_ID = '550e8400-e29b-41d4-a716-446655440099';

const activeTenant = {
  id: ACME_ID,
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  isDefault: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockTenantFindById = vi.fn((id: string) =>
  id === ACME_ID
    ? Promise.resolve(activeTenant)
    : id === '00000000-0000-0000-0000-0000000000ff'
      ? Promise.resolve(null)
      : Promise.resolve({ ...activeTenant, id, status: 'suspended' }),
);
const mockRoleCreate = vi.fn().mockResolvedValue({ id: 'role-admin-1', name: 'admin' });
const mockAssign = vi.fn().mockResolvedValue(undefined);
const mockUserCreate = vi.fn().mockResolvedValue({ id: 'user-1', email: 'root@acme.test' });
const mockHasPermission = vi.fn().mockResolvedValue(true);
const mockBindPermissions = vi.fn().mockResolvedValue(undefined);
const mockGetUserRoles = vi.fn().mockResolvedValue([{ id: 'role-admin-1', name: 'admin' }]);

// The setup-guard fast-path looks up the configured platform admin on EVERY
// request (queryAdminExists). Route that email to a truthy user so the guard
// short-circuits and never dials the real DB; everything else per-test.
let emailLookup: (email: string) => Promise<unknown> = () => Promise.resolve(null);
const mockFindByEmail = vi.fn((email: string) =>
  email === 'admin@accessbase.local'
    ? Promise.resolve({ id: 'admin-1', email, tenantId: DEFAULT_TENANT_ID })
    : emailLookup(email),
);

function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.returning = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.then = vi.fn(
    (resolve?: ((v: unknown) => unknown) | null, reject?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(resolve, reject),
  );
  return chain;
}

// Fake seed-db handle: records the isSystem stamp UPDATE (bindPermissions is
// module-mocked, so this handle only ever sees the stamp).
const stampChain = makeChain(undefined);
const fakeSeedDb = {
  update: vi.fn(() => stampChain),
  select: vi.fn(() => makeChain([{ id: 'admin-1' }])),
};

vi.mock('@accessbase/identity/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity/db')>()),
  createDb: vi.fn(() => fakeSeedDb),
}));

vi.mock('../routes/permissions-seed.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../routes/permissions-seed.js')>()),
  bindPermissions: mockBindPermissions,
}));

vi.mock('@accessbase/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@accessbase/identity')>()),
  TenantManager: vi.fn().mockImplementation(() => ({
    findById: mockTenantFindById,
    findAll: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
  UserManager: vi.fn().mockImplementation(() => ({
    transaction: (fn: (d: unknown) => unknown) => fn(fakeSeedDb), // Q2c routeTx seam (direct tx.update in bootstrap)
    findByEmail: mockFindByEmail,
    create: mockUserCreate,
    findById: vi.fn().mockResolvedValue(null),
  })),
  RoleManager: vi.fn().mockImplementation(() => ({
    create: mockRoleCreate,
    assignToUser: mockAssign,
    // L″ D1: replay arm hinges on admin membership; default = holder HAS the
    // admin role (the replay cases below). Plain-user test overrides once.
    getUserRoles: mockGetUserRoles,
  })),
  
  PermissionManager: vi.fn().mockImplementation(() => ({
    hasPermission: mockHasPermission,
  })),
  SessionManager: vi.fn().mockImplementation(() => ({ revokeAllUserSessions: vi.fn() })),
}));

// Options seam so readPasswordPolicy('user_create') runs the DEFAULTS profile.
import type { OptionsManager } from '@accessbase/identity';
const { setOptionsManager } = await import('../routes/options.js');
setOptionsManager({
  get: <T,>(_key: string, _env: T | undefined, def: T) => Promise.resolve(def),
} as unknown as OptionsManager);

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let platformToken: string;
let tenantToken: string;

beforeAll(async () => {
  app = await buildApp();
  platformToken = app.jwt.sign({ sub: 'admin-1', email: 'admin@accessbase.local' });
  tenantToken = app.jwt.sign({
    sub: 'ta-1',
    email: 'admin@acme.test',
    tenantId: ACME_ID,
  });
});

afterAll(async () => {
  await app.close();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const GOOD_PW = 'Passw0rd!x';

function resetMocks() {
  emailLookup = () => Promise.resolve(null);
  mockTenantFindById.mockClear();
  mockRoleCreate.mockClear();
  mockAssign.mockClear();
  mockUserCreate.mockClear().mockResolvedValue({ id: 'user-1', email: 'root@acme.test' });
  mockBindPermissions.mockClear().mockResolvedValue(undefined);
  fakeSeedDb.update.mockClear();
  mockGetUserRoles.mockClear().mockResolvedValue([{ id: 'role-admin-1', name: 'admin' }]);
  fakeSeedDb.update.mockClear();
}

describe('POST /api/v1/tenants/:id/bootstrap — happy path (fresh tenant)', () => {
  it('creates stamped admin role + strict-binds 9 codes + creates and assigns the user, in order', async () => {
    resetMocks();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${ACME_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'root@acme.test', name: 'Acme Root', password: GOOD_PW },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      data: {
        userId: 'user-1',
        roleId: 'role-admin-1',
        tenantId: ACME_ID,
        alreadyBootstrapped: false,
      },
    });
    // role find-or-create IN the target tenant with isSystem input (D2-6)
    expect(mockRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin', isSystem: true }),
      ACME_ID,
      expect.anything(), // Q2c tx handle
    );
    // unconditional idempotent stamp via direct SQL
    expect(fakeSeedDb.update).toHaveBeenCalledTimes(1);
    expect(stampChain.set).toHaveBeenCalledWith({ isSystem: true });
    // strict bind of EXACTLY the tenant-bindable partition to the new role
    const { TENANT_BINDABLE_PERMISSIONS } = await import('@accessbase/identity');
    expect(mockBindPermissions).toHaveBeenCalledTimes(1);
    expect(mockBindPermissions.mock.calls[0]?.[1]).toBe('role-admin-1');
    expect(mockBindPermissions.mock.calls[0]?.[2]).toBe(TENANT_BINDABLE_PERMISSIONS);
    // user created in the TARGET tenant, then membership assigned
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'root@acme.test', name: 'Acme Root' }),
      ACME_ID,
      expect.anything(), // Q2c tx handle
    );
    expect(mockAssign).toHaveBeenCalledWith('user-1', 'role-admin-1', ACME_ID, expect.anything());
  });

  it('strict-bind failure aborts BEFORE any user creation (X4 ordering)', async () => {
    resetMocks();
    mockBindPermissions.mockRejectedValueOnce(new Error('bindPermissions: shortfall'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${ACME_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'root@acme.test', password: GOOD_PW },
    });
    expect(res.statusCode).toBe(500);
    expect(mockUserCreate).not.toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

describe('POST bootstrap — guards', () => {
  it('belt FIRST: non-platform caller gets 403 without any tenant state lookup (B7a)', async () => {
    resetMocks();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${OTHER_ID}/bootstrap`,
      headers: auth(tenantToken),
      payload: { email: 'x@y.test', password: GOOD_PW },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('TENANT_PLATFORM_ONLY');
    expect(mockTenantFindById).not.toHaveBeenCalled();
  });

  it('default tenant target → 409 (wizard owns it)', async () => {
    resetMocks();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${DEFAULT_TENANT_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'x@y.test', password: GOOD_PW },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TENANT_PROTECTED');
  });

  it('unknown tenant → 404 NOT_FOUND', async () => {
    resetMocks();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/00000000-0000-0000-0000-0000000000ff/bootstrap',
      headers: auth(platformToken),
      payload: { email: 'x@y.test', password: GOOD_PW },
    });
    expect(res.statusCode).toBe(404);
  });

  it('suspended target → 409', async () => {
    resetMocks();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${OTHER_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'x@y.test', password: GOOD_PW },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TENANT_PROTECTED');
  });

  it('email held by ANOTHER tenant → 409 EMAIL_EXISTS, no writes', async () => {
    resetMocks();
    emailLookup = () => Promise.resolve({ id: 'u-other', email: 'dup@x.test', tenantId: OTHER_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${ACME_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'dup@x.test', password: GOOD_PW },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_EXISTS');
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it('weak password → 400 WEAK_PASSWORD before any role/user write (R2)', async () => {
    resetMocks();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${ACME_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'root@acme.test', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEAK_PASSWORD');
    expect(mockRoleCreate).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
  });
});

describe('POST bootstrap — idempotent replay arm (R4)', () => {
  it('same-tenant email holder converges to 200 alreadyBootstrapped, re-running bind+assign, no new user', async () => {
    resetMocks();
    emailLookup = () =>
      Promise.resolve({ id: 'u-exist', email: 'root@acme.test', tenantId: ACME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${ACME_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'root@acme.test', password: 'ignored-on-replay' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: {
        userId: 'u-exist',
        roleId: 'role-admin-1',
        tenantId: ACME_ID,
        alreadyBootstrapped: true,
      },
    });
    expect(mockUserCreate).not.toHaveBeenCalled();
    expect(mockBindPermissions).toHaveBeenCalledTimes(1);
    expect(mockAssign).toHaveBeenCalledWith('u-exist', 'role-admin-1', ACME_ID, expect.anything());
  });

  it('replay mints no credential → password policy skipped (weak pw still 200)', async () => {
    resetMocks();
    emailLookup = () =>
      Promise.resolve({ id: 'u-exist', email: 'root@acme.test', tenantId: ACME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${ACME_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'root@acme.test', password: 'x' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// L″ D1: same-tenant email that does NOT hold the admin role is an ordinary
// conflict — the bootstrap must never silently promote a plain user.
describe('POST bootstrap — plain same-tenant user is not promoted (L″ D1)', () => {
  it('same-tenant email WITHOUT admin membership → 409 EMAIL_EXISTS, zero writes', async () => {
    resetMocks();
    emailLookup = () =>
      Promise.resolve({ id: 'u-plain', email: 'root@acme.test', tenantId: ACME_ID });
    mockGetUserRoles.mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${ACME_ID}/bootstrap`,
      headers: auth(platformToken),
      payload: { email: 'root@acme.test', password: GOOD_PW },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_EXISTS');
    expect(mockBindPermissions).not.toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
  });
});

describe('platform belt on tenants mutations (B3)', () => {
  const mutating = [
    { method: 'POST' as const, url: '/api/v1/tenants', payload: { name: 'T', slug: 't' } },
    { method: 'PUT' as const, url: `/api/v1/tenants/${ACME_ID}`, payload: { name: 'X' } },
    { method: 'DELETE' as const, url: `/api/v1/tenants/${ACME_ID}`, payload: undefined },
  ];
  for (const m of mutating) {
    it(`${m.method} ${m.url} — non-platform caller 403 TENANT_PLATFORM_ONLY`, async () => {
      resetMocks();
      const res = await app.inject({
        method: m.method,
        url: m.url,
        headers: auth(tenantToken),
        payload: m.payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('TENANT_PLATFORM_ONLY');
    });
  }

  it('platform caller still reaches the managers (no regression on the happy path)', async () => {
    resetMocks();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: auth(platformToken),
      payload: { name: 'Newco', slug: 'newco' },
    });
    expect(res.statusCode).toBe(201);
  });
});
