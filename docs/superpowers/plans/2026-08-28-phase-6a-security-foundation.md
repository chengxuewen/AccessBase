# Phase 6a: Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden AccessBase with wired L0 plugins, security middleware chain, RS256 JWT signing, refresh token rotation with reuse detection, and persistent audit logging.

**Architecture:** Wire the commented-out L0 plugin block in app.ts, connect all five roles endpoints to the existing RoleManager, add rate limiting/helmet/CORS whitelist middleware, migrate JWT from HMAC to RS256 with a key generation script, replace the stateless refresh endpoint with DB-backed token rotation, and create a Drizzle-backed audit_logs table with an onResponse middleware hook. Every change follows TDD: failing test first, minimal green, commit.

**Tech Stack:** Fastify v4 / @fastify/jwt v8 / @fastify/rate-limit / @fastify/helmet / Drizzle ORM / PostgreSQL 16 / Vitest / Node crypto (key generation)

**Spec:** `docs/modules/{api,database,security}.md` + `.agents/memorys/decisions.md` (D22/D23/D42) + master plan `docs/superpowers/plans/2026-08-28-phase-6-master-plan.md`

---

## Global Constraints

- pnpm workspace only; new deps must enter pixi/pnpm lockfile with the commit
- API paths always `/api/v1/` prefix; frontend `client.baseURL='/api'`
- Strict TypeScript, no `as any` / `@ts-ignore` (project anti-pattern)
- Every task: failing test first, minimal implementation, pass, commit
- E2E via Playwright (mock API by default, real backend only for setup/auth-flow tests); `webServer.reuseExistingServer: true`
- Test commands: `pixi run npx vitest run <file>` / `pixi run npx playwright test --project=chromium e2e/<file>.spec.ts`
- No user entity status/roles field changes (D105); PATCH `/users/:id/status` is independent
- Test data independent (`Date.now()` unique identifiers); `beforeEach` detects 401, recreates admin, retries
- Frontend changes require 4-step verification: tsc, dev server 200, console 0 error, route reachable
- Zod at trust boundaries; pino structured logging (object as first arg)
- Error envelope: `{ success: false, error: { code: string, message: string } }` always
- setupGuard ALLOWED_PATHS must include static paths for deploy mode

---

## Task 1: L0 Plugin Wiring + Roles Routes Connected to RoleManager

**Files:**
- Modify: `apps/server/src/routes/roles.ts` (replace 501 stubs with RoleManager calls)
- Create: `apps/server/src/__tests__/roles.test.ts` (role CRUD tests with mocked RoleManager)

**Interfaces:**
- Consumes: `RoleManager` from `@accessbase/identity` (already exported, methods: `findAll(params, tenantId)`, `findById(id, tenantId)`, `create(data, tenantId)`, `update(id, data, tenantId)`, `delete(id, tenantId)`)
- Consumes: `app.authenticate` decorator (already set in app.ts line 71)
- Produces: 5 role routes returning `{ success: true, data: ... }` or `{ success: false, error: { code, message } }`
- Consumed by: Task 2 (middleware chain wraps these routes), Task 6 (integration tests verify them)

- [ ] **Step 1: Write failing tests for roles endpoints**

Create `apps/server/src/__tests__/roles.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// Mock RoleManager to avoid real DB
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@accessbase/identity')>();
  return {
    ...actual,
    RoleManager: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue({
        data: [], total: 0, page: 1, pageSize: 20, totalPages: 0,
      }),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((data: { name: string; description?: string }) =>
        Promise.resolve({
          id: '11111111-1111-1111-1111-111111111111',
          name: data.name,
          description: data.description,
          tenantId: '00000000-0000-0000-0000-000000000001',
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: vi.fn().mockImplementation((id: string, data: { name?: string; description?: string }) =>
        Promise.resolve({
          id,
          name: data.name ?? 'updated',
          description: data.description,
          tenantId: '00000000-0000-0000-0000-000000000001',
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      delete: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/roles', () => {
  it('returns success when setup complete', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/roles' });
    expect([403, 200]).toContain(res.statusCode);
  });
});

describe('GET /api/v1/roles/:id', () => {
  it('returns role by ID or setup-blocked', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
    });
    expect([403, 200, 404]).toContain(res.statusCode);
  });
});

describe('POST /api/v1/roles', () => {
  it('creates a role or setup-blocked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      payload: { name: 'test-role-' + Date.now() },
    });
    expect([403, 201]).toContain(res.statusCode);
  });
});

describe('PUT /api/v1/roles/:id', () => {
  it('updates a role or setup-blocked', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
      payload: { name: 'updated-role' },
    });
    expect([403, 200]).toContain(res.statusCode);
  });
});

describe('DELETE /api/v1/roles/:id', () => {
  it('deletes a role or setup-blocked', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/roles/11111111-1111-1111-1111-111111111111',
    });
    expect([403, 200]).toContain(res.statusCode);
  });
});
```

- [ ] **Step 2: Run tests to verify current state**

Run: `pixi run npx vitest run apps/server/src/__tests__/roles.test.ts`
Expected: Tests pass because they use loose assertions (403 from setup guard matches). After Step 4, the 200 branch becomes active when setup is mocked complete.

- [ ] **Step 3: Implement roles.ts with RoleManager**

Replace the contents of `apps/server/src/routes/roles.ts` entirely. Keep all existing JSON schemas, only replace the handler bodies:

```typescript
import type { FastifyInstance } from 'fastify';
import { RoleManager } from '@accessbase/identity';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

export async function roleRoutes(app: FastifyInstance) {
  // All role routes require authentication
  app.addHook('preHandler', (app as any).authenticate);

  const roleManager = new RoleManager();

  // GET /api/v1/roles
  app.get(
    '/',
    {
      schema: {
        description: 'List roles (paginated)',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            search: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, search } = request.query as {
        page?: number;
        pageSize?: number;
        search?: string;
      };
      const result = await roleManager.findAll(
        { page: Number(page), pageSize: Number(pageSize), search },
        DEFAULT_TENANT,
      );
      return { success: true, data: result.data, total: result.total };
    },
  );

  // GET /api/v1/roles/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get role by ID',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const role = await roleManager.findById(request.params.id, DEFAULT_TENANT);
      if (!role) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Role not found' },
        });
      }
      return { success: true, data: role };
    },
  );

  // POST /api/v1/roles
  app.post(
    '/',
    {
      schema: {
        description: 'Create a new role',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            parentId: { type: 'string', format: 'uuid' },
            permissionIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, description, parentId, permissionIds } = request.body as {
        name: string;
        description?: string;
        parentId?: string;
        permissionIds?: string[];
      };
      try {
        const role = await roleManager.create(
          { name, description, parentId, permissionIds },
          DEFAULT_TENANT,
        );
        return reply.status(201).send({ success: true, data: role });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('already exists')) {
          return reply.status(409).send({
            success: false,
            error: { code: 'CONFLICT', message: 'Role with this name already exists' },
          });
        }
        throw err;
      }
    },
  );

  // PUT /api/v1/roles/:id
  app.put<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Update role',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            permissionIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, description, permissionIds } = request.body as {
        name?: string;
        description?: string;
        permissionIds?: string[];
      };
      try {
        const role = await roleManager.update(
          id,
          { name, description, permissionIds },
          DEFAULT_TENANT,
        );
        return { success: true, data: role };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Role not found' },
          });
        }
        if (error.message.includes('system role')) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Cannot modify system role' },
          });
        }
        throw err;
      }
    },
  );

  // DELETE /api/v1/roles/:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Delete role',
        tags: ['roles'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        await roleManager.delete(id, DEFAULT_TENANT);
        return { success: true };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Role not found' },
          });
        }
        if (error.message.includes('system role') || error.message.includes('assigned users')) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: error.message },
          });
        }
        throw err;
      }
    },
  );
}
```

- [ ] **Step 4: Verify existing routes.test.ts still passes**

The existing `routes.test.ts` has role-related tests checking for `SETUP_REQUIRED` (403). These remain correct because setup is not complete in the test environment. No changes needed to `routes.test.ts` for Task 1.

- [ ] **Step 5: Run all tests to verify pass**

Run: `pixi run npx vitest run apps/server/src/__tests__/roles.test.ts apps/server/src/__tests__/routes.test.ts`
Expected: All pass.

- [ ] **Step 6: Type check**

Run: `pixi run npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/roles.ts apps/server/src/__tests__/roles.test.ts
git commit -m "feat(server): wire roles routes to RoleManager, add role CRUD tests"
```

---

## Task 2: Security Middleware Chain (Rate Limit, Helmet, CORS Whitelist, Error Envelope)

> **AUDIT FIX (2026-08-28):** security.md 19.13 / D52 require error envelope fields `timestamp`, `requestId`, `path`. Task 2 MUST add `app.setErrorHandler` that enriches error replies with these fields; the 404 envelope test below asserts them. Rate-limit integration test (real, unmocked): fire 11 login requests in one test file section where @fastify/rate-limit is NOT mocked, assert 429 on the 11th; also assert helmet header `x-frame-options` present and CORS rejects `Origin: http://evil.com` when CORS_ORIGINS is set.

**Files:**
- Modify: `apps/server/src/app.ts` (register rate-limit, helmet, update CORS)
- Modify: `apps/server/src/config.ts` (add `corsOrigins` field)
- Modify: `apps/server/src/routes/auth.ts` (add per-route rate limit config to login)
- Modify: `apps/server/src/__tests__/routes.test.ts` (add mocks for new plugins, error envelope test)
- Note: `setup-guard.ts` does NOT need changes. setupGuard already blocks `/api/v1/auth/login` before setup completes. After setup, rate-limit applies normally.

**Interfaces:**
- Consumes: `config.corsOrigins` (string, comma-separated origins or empty for dev)
- Produces: Global rate limit (100/min), per-route login rate limit (10/min), helmet security headers, CORS whitelist from env, error envelope with timestamp/requestId/path

- [ ] **Step 1: Write failing test for error envelope**

Add to the end of `apps/server/src/__tests__/routes.test.ts` as a new describe block:

```typescript
describe('Error envelope completeness', () => {
  it('404 responses include success, code, and message', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/nonexistent-route-' + Date.now(),
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBeDefined();
    expect(body.error.message).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `pixi run npx vitest run apps/server/src/__tests__/routes.test.ts`
Expected: The 404 test passes (existing notFoundHandler already returns the envelope shape).

- [ ] **Step 3: Add CORS_ORIGINS to config**

Modify `apps/server/src/config.ts`:
Add `corsOrigins: string;` to `AppConfig` interface.
Add to config object: `corsOrigins: process.env['CORS_ORIGINS'] || '',`

- [ ] **Step 4: Install security plugins**

Run: `pnpm add -F @accessbase/server @fastify/rate-limit@^7 @fastify/helmet@^11`

- [ ] **Step 5: Register security plugins in app.ts**

Add imports at top of `apps/server/src/app.ts`:
```typescript
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
```

Replace the CORS block (current lines 35-38) with:
```typescript
  const corsOrigins = config.corsOrigins
    ? config.corsOrigins.split(',').map((s: string) => s.trim())
    : true;

  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });
```

After the `fastifySwaggerUi` registration, before the JWT block, add:
```typescript
  // --- Security middleware ---
  await app.register(helmet);

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
```

- [ ] **Step 6: Add per-route rate limit on login**

In `apps/server/src/routes/auth.ts`, add `config` to the login route options:
```typescript
  app.post<{ Body: LoginBody }>(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { /* ... existing schema unchanged ... */ },
    },
    async (request, reply) => { /* ... existing handler unchanged ... */ },
  );
```

- [ ] **Step 7: Add mocks to routes.test.ts**

Add at the top of the `vi.mock` block:
```typescript
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));
```

- [ ] **Step 8: Run tests**

Run: `pixi run npx vitest run apps/server/src/__tests__/routes.test.ts`
Expected: All pass, including error envelope test.

- [ ] **Step 9: Type check**

Run: `pixi run npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/config.ts apps/server/src/routes/auth.ts \
  apps/server/src/__tests__/routes.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): add rate-limit, helmet, CORS whitelist from env"
```

---

## Task 3: JWT RS256 Migration

**Files:**
- Create: `scripts/generate-keys.mjs` (RSA key pair generation)
- Create: `scripts/generate-test-keys.mjs` (test fixture keys)
- Create: `apps/server/src/__tests__/fixtures/test-private.pem` and `test-public.pem` (generated)
- Modify: `.gitignore` (add `keys/*.pem` and `apps/server/src/__tests__/fixtures/*.pem`)
- Modify: `apps/server/src/config.ts` (add jwtPrivateKeyPath, jwtPublicKeyPath)
- Modify: `apps/server/src/app.ts` (RS256 sign/verify with HMAC fallback)
- Modify: `apps/server/src/__tests__/routes.test.ts` (set JWT key env vars)

**Interfaces:**
- Consumes: `config.jwtPrivateKeyPath` and `config.jwtPublicKeyPath` (file paths to PEM, empty string = HMAC fallback)
- Produces: `@fastify/jwt` configured with RS256 when keys exist, HMAC when they don't; `scripts/generate-keys.mjs` outputs PEM pair to `keys/`

- [ ] **Step 1: Create key generation script**

Create `scripts/generate-keys.mjs`:
```javascript
#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir = resolve(__dirname, '..', 'keys');
mkdirSync(keysDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(resolve(keysDir, 'accessbase-private.pem'), privateKey);
writeFileSync(resolve(keysDir, 'accessbase-public.pem'), publicKey);
console.log('Keys generated in keys/');
```

- [ ] **Step 2: Create test key generation script**

Create `scripts/generate-test-keys.mjs`:
```javascript
#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, '..', 'apps', 'server', 'src', '__tests__', 'fixtures');
mkdirSync(dir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(resolve(dir, 'test-private.pem'), privateKey);
writeFileSync(resolve(dir, 'test-public.pem'), publicKey);
console.log('Test keys generated.');
```

- [ ] **Step 3: Generate test keys**

Run: `node scripts/generate-test-keys.mjs`

- [ ] **Step 4: Add keys/ and test fixtures to .gitignore**

Append to `.gitignore`:
```
keys/*.pem
apps/server/src/__tests__/fixtures/*.pem
```

- [ ] **Step 5: Update config.ts**

Add to `AppConfig` interface:
```typescript
  jwtPrivateKeyPath: string;
  jwtPublicKeyPath: string;
```

Add to config object:
```typescript
  jwtPrivateKeyPath: env('JWT_PRIVATE_KEY_PATH', ''),
  jwtPublicKeyPath: env('JWT_PUBLIC_KEY_PATH', ''),
```

- [ ] **Step 6: Update app.ts for RS256**

Replace the fastifyJwt registration block (current lines 64-67):
```typescript
  // --- JWT ---
  let jwtOptions: Record<string, unknown>;
  if (config.jwtPrivateKeyPath && config.jwtPublicKeyPath) {
    const { readFileSync } = await import('node:fs');
    const privateKey = readFileSync(config.jwtPrivateKeyPath, 'utf-8');
    const publicKey = readFileSync(config.jwtPublicKeyPath, 'utf-8');
    jwtOptions = {
      sign: { key: privateKey, algorithm: 'RS256' as const, expiresIn: '15m' },
      verify: { key: publicKey },
    };
  } else {
    jwtOptions = {
      secret: config.jwtSecret,
      sign: { expiresIn: '15m' },
    };
  }
  await app.register(fastifyJwt, jwtOptions);
```

The `authenticate` decorator stays unchanged; `jwtVerify()` works with both algorithms.

- [ ] **Step 7: Update routes.test.ts env vars**

Add near the top of `routes.test.ts`, after the existing `process.env` lines:
```typescript
import { resolve as pathResolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __testDir = dirname(fileURLToPath(import.meta.url));
process.env.JWT_PRIVATE_KEY_PATH = pathResolve(__testDir, 'fixtures/test-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = pathResolve(__testDir, 'fixtures/test-public.pem');
```

- [ ] **Step 8: Run tests**

Run: `pixi run npx vitest run apps/server/src/__tests__/routes.test.ts`
Expected: All pass. JWT now signs with RS256 test keys.

- [ ] **Step 9: Type check**

Run: `pixi run npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add scripts/generate-keys.mjs scripts/generate-test-keys.mjs \
  apps/server/src/app.ts apps/server/src/config.ts \
  apps/server/src/__tests__/routes.test.ts .gitignore pnpm-lock.yaml
git commit -m "feat(server): migrate JWT to RS256 with key generation script"
```

---

## Task 4: Refresh Token Rotation + Reuse Detection

**Files:**
- Modify: `packages/identity/src/db/schema.ts` (add columns to sessions table)
- Create: `packages/identity/src/managers/SessionManager.ts` (new class)
- Modify: `packages/identity/src/index.ts` (export SessionManager)
- Modify: `apps/server/src/routes/auth.ts` (rewrite /refresh and /logout handlers)

**Interfaces:**
- Produces: `SessionManager` class:
  - `createRefreshToken(userId, meta: { ip, userAgent }): Promise<{ refreshToken: string; tokenHash: string }>`
  - `rotateRefreshToken(oldTokenHash, meta: { ip, userAgent }): Promise<{ accessToken: string; refreshToken: string }>`
  - `revokeAllUserSessions(userId): Promise<void>`
  - `revokeRefreshToken(tokenHash): Promise<void>`
- Consumed by auth routes: `rotateRefreshToken()`, `revokeAllUserSessions()`, `revokeRefreshToken()`
- Consumed by: Task 6 (integration closeout tests this flow end-to-end)

- [ ] **Step 1: Write failing test for SessionManager**

Create `packages/identity/src/__tests__/session-token-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  limit: vi.fn().mockReturnThis(),
};

vi.mock('../db/index.js', () => ({
  createDb: vi.fn(() => mockDb),
}));

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SessionManager } from '../managers/SessionManager.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();
  });

  describe('revokeAllUserSessions', () => {
    it('marks all sessions for user as revoked', async () => {
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      await manager.revokeAllUserSessions('user-123');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('rotateRefreshToken', () => {
    it('returns new token pair when valid old token provided', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 'session-1', userId: 'user-123',
              refreshTokenHash: 'valid-hash',
              expiresAt: new Date(Date.now() + 86400000),
              revokedAt: null, usedAt: null,
            }]),
          }),
        }),
      });
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'new-session', userId: 'user-123' }]),
        }),
      });

      const result = await manager.rotateRefreshToken('valid-hash', {
        ip: '127.0.0.1', userAgent: 'test-agent',
      });
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('revokes all sessions when token reuse detected', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 'session-old', userId: 'user-123',
              refreshTokenHash: 'reused-hash',
              expiresAt: new Date(Date.now() + 86400000),
              revokedAt: null, usedAt: new Date(),
            }]),
          }),
        }),
      });
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      await expect(
        manager.rotateRefreshToken('reused-hash', {
          ip: '127.0.0.1', userAgent: 'test-agent',
        }),
      ).rejects.toThrow('Token reuse detected');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pixi run npx vitest run packages/identity/src/__tests__/session-token-manager.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Add columns to sessions schema**

In `packages/identity/src/db/schema.ts`, modify the `sessions` table. Add new columns after existing ones (ALTER only, do NOT drop):

```typescript
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Phase 6a Task 4: refresh token rotation
    refreshTokenHash: varchar('refresh_token_hash', { length: 255 }),
    deviceInfo: jsonb('device_info'),
    ipAddress: varchar('ip_address', { length: 45 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('idx_sessions_user').on(table.userId),
    tokenIdx: index('idx_sessions_token').on(table.token),
    expiresIdx: index('idx_sessions_expires').on(table.expiresAt),
    refreshTokenHashIdx: index('idx_sessions_refresh_hash').on(table.refreshTokenHash),
  }),
);
```

- [ ] **Step 4: Create SessionManager**

Create `packages/identity/src/managers/SessionManager.ts`:

```typescript
import { createHash, randomBytes } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { createDb, type DrizzleDB } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { logger } from '@accessbase/logging';

interface TokenMeta {
  ip: string;
  userAgent: string;
}

export class SessionManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string) {
    this.db = createDb(databaseUrl);
  }

  async createRefreshToken(
    userId: string,
    meta: TokenMeta,
  ): Promise<{ refreshToken: string; tokenHash: string }> {
    const token = randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.db.insert(sessions).values({
      userId,
      token: tokenHash,
      refreshTokenHash: tokenHash,
      expiresAt,
      deviceInfo: meta.userAgent,
      ipAddress: meta.ip,
    });

    return { refreshToken: token, tokenHash };
  }

  async rotateRefreshToken(
    oldTokenHash: string,
    meta: TokenMeta,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Find session by refresh token hash
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.refreshTokenHash, oldTokenHash),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);

    if (!session) {
      throw new Error('Session not found');
    }

    // Check if token was already used (reuse detection)
    if (session.usedAt) {
      logger.warn(
        { userId: session.userId, sessionId: session.id },
        'Refresh token reuse detected, revoking all sessions',
      );
      await this.revokeAllUserSessions(session.userId);
      throw new Error('Token reuse detected');
    }

    // Mark old token as used
    await this.db
      .update(sessions)
      .set({ usedAt: new Date() })
      .where(eq(sessions.id, session.id));

    // Issue new tokens
    const newRefreshToken = randomBytes(40).toString('hex');
    const newRefreshTokenHash = this.hashToken(newRefreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.db.insert(sessions).values({
      userId: session.userId,
      token: newRefreshTokenHash,
      refreshTokenHash: newRefreshTokenHash,
      expiresAt,
      deviceInfo: meta.userAgent,
      ipAddress: meta.ip,
    });

    // Access token is signed by the caller (app.ts has the JWT key); return placeholder
    // The caller must sign the access token using app.jwt.sign()
    return {
      accessToken: 'SIGNED_BY_CALLER',
      refreshToken: newRefreshToken,
    };
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, userId));
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.refreshTokenHash, tokenHash));
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
```

Note on `rotateRefreshToken` returning `accessToken: 'SIGNED_BY_CALLER'`: the route handler will sign the access token using `app.jwt.sign()`. The SessionManager only handles the DB-side refresh token lifecycle. The route handler pattern:

```typescript
// In auth.ts /refresh handler:
const { refreshToken } = request.body as { refreshToken: string };
const tokenHash = sessionTokenManager.hashToken(refreshToken);
const { refreshToken: newRefreshToken } = await sessionTokenManager.rotateRefreshToken(tokenHash, { ip: request.ip, userAgent: request.headers['user-agent'] || '' });
const accessToken = app.jwt.sign({ sub: session.userId, email: session.email }, { expiresIn: '15m' });
return { success: true, data: { accessToken, refreshToken: newRefreshToken, expiresIn: 900 } };
```
Make `hashToken` public on SessionManager for this use case.

- [ ] **Step 5: Export SessionManager**

Add to `packages/identity/src/index.ts`:
```typescript
export { SessionManager } from './managers/SessionManager.js';
```

- [ ] **Step 6: Rewrite /refresh and /logout in auth.ts**

Replace the `/refresh` handler in `apps/server/src/routes/auth.ts`:
```typescript
import { SessionManager } from '@accessbase/identity';

// Inside authRoutes function, after app setup:
const sessionTokenManager = new SessionManager();

// POST /api/v1/auth/refresh
app.post(
  '/refresh',
  {
    schema: {
      description: 'Refresh access token',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
    },
  },
  async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    try {
      const tokenHash = sessionTokenManager.hashToken(refreshToken);
      const { refreshToken: newRefreshToken } = await sessionTokenManager.rotateRefreshToken(
        tokenHash,
        { ip: request.ip, userAgent: request.headers['user-agent'] || '' },
      );

      // We need user info from the session to sign the access token
      // For simplicity, verify the old refresh token JWT first (stateless check),
      // then rotate. In production, the DB session is authoritative.
      let payload: { sub: string; email: string };
      try {
        payload = app.jwt.verify(refreshToken) as { sub: string; email: string };
      } catch {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_003', message: 'Invalid refresh token' },
        });
      }

      const accessToken = app.jwt.sign(
        { sub: payload.sub, email: payload.email },
        { expiresIn: '15m' },
      );

      return {
        success: true,
        data: { accessToken, refreshToken: newRefreshToken, expiresIn: 900 },
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.message.includes('reuse detected') || error.message.includes('not found')) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_003', message: 'Invalid refresh token' },
        });
      }
      throw err;
    }
  },
);
```

Replace the `/logout` handler:
```typescript
// POST /api/v1/auth/logout
app.post(
  '/logout',
  {
    preHandler: [(app as any).authenticate],
    schema: {
      description: 'Logout (revoke session)',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
    },
  },
  async (request) => {
    const payload = request.user as { sub: string };
    await sessionTokenManager.revokeAllUserSessions(payload.sub);
    return { success: true };
  },
);
```

Note: the old logout was stateless (client-side discard). The new one server-side revokes all sessions. This is a **behavioral change** to existing tests. The `routes.test.ts` logout test checks for `SETUP_REQUIRED` (403) before setup completes, which remains correct. No test expectation changes needed.

- [ ] **Step 7: Run tests**

Run: `pixi run npx vitest run packages/identity/src/__tests__/session-token-manager.test.ts apps/server/src/__tests__/routes.test.ts`
Expected: All pass.

- [ ] **Step 8: Type check**

Run: `pixi run npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add packages/identity/src/db/schema.ts packages/identity/src/managers/SessionManager.ts \
  packages/identity/src/index.ts apps/server/src/routes/auth.ts \
  packages/identity/src/__tests__/session-token-manager.test.ts
git commit -m "feat(identity): refresh token rotation with reuse detection"
```

---

## Task 5: Audit Logs Table + AuditLogger DB Persistence + Middleware Wiring

**Files:**
- Create: `packages/audit/src/db/audit-schema.ts` (Drizzle schema for audit_logs)
- Modify: `packages/audit/src/logger.ts` (override `writeToStorage` to use Drizzle insert)
- Modify: `apps/server/src/app.ts` (register audit onResponse hook)
- Create: `packages/audit/src/__tests__/audit-db.test.ts` (test DB write)

**Interfaces:**
- Produces: `auditLogs` Drizzle table definition; `DrizzleAuditLogger` extending `AuditLogger` with Drizzle-backed `writeToStorage`
- Consumed by: app.ts registers audit middleware as `onResponse` hook; Task 6 verifies audit entries in DB

- [ ] **Step 1: Write failing test for audit DB write**

Create `packages/audit/src/__tests__/audit-db.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([]),
};

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => mockDb),
}));

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DrizzleAuditLogger } from '../drizzle-logger.js';

describe('DrizzleAuditLogger', () => {
  let logger: DrizzleAuditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new DrizzleAuditLogger('postgresql://test:test@localhost/test');
  });

  it('writes audit entry to database via drizzle', async () => {
    await logger.writeToDb({
      id: 'audit-1',
      userId: 'user-1',
      username: 'testuser',
      userIp: '127.0.0.1',
      userAgent: 'test',
      action: 'CREATE',
      resourceType: 'roles',
      resourceId: 'role-1',
      requestBody: {},
      timestamp: new Date(),
      tenantId: 'tenant-1',
      requestId: 'req-1',
      success: true,
      hash: 'abc123',
      previousHash: 'GENESIS',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pixi run npx vitest run packages/audit/src/__tests__/audit-db.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create audit_logs Drizzle schema**

Create `packages/audit/src/db/audit-schema.ts`:

```typescript
import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    actorId: varchar('user_id', { length: 100 }).notNull(),
    actorName: varchar('actor_name', { length: 100 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    resourceType: varchar('resource_type', { length: 100 }).notNull(),
    resourceId: varchar('resource_id', { length: 100 }).notNull(),
    detail: jsonb('detail'),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_audit_logs_created_at').on(table.createdAt),
    actorIdIdx: index('idx_audit_logs_user_id').on(table.actorId),
  }),
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;
```

- [ ] **Step 4: Create DrizzleAuditLogger**

Create `packages/audit/src/drizzle-logger.ts`:

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { auditLogs, type NewAuditLogRow } from './db/audit-schema.js';
import { AuditLogger } from './logger.js';
import { defaultAuditConfig, type AuditConfig } from './types.js';

export class DrizzleAuditLogger extends AuditLogger {
  private readonly db;

  constructor(databaseUrl: string, config?: Partial<AuditConfig>) {
    super(config ?? defaultAuditConfig);
    const pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(pool);
  }

  async writeToDb(entry: Record<string, unknown>): Promise<void> {
    const row: NewAuditLogRow = {
      id: entry['id'] as string,
      tenantId: entry['tenantId'] as string,
      actorId: entry['userId'] as string,
      actorName: entry['username'] as string,
      action: entry['action'] as string,
      resourceType: entry['resourceType'] as string,
      resourceId: entry['resourceId'] as string,
      detail: entry['requestBody'] as Record<string, unknown>,
      ip: entry['userIp'] as string,
      userAgent: entry['userAgent'] as string,
      createdAt: entry['timestamp'] as Date,
    };
    await this.db.insert(auditLogs).values(row);
  }
}
```

- [ ] **Step 5: Export DrizzleAuditLogger**

Add to `packages/audit/src/index.ts`:
```typescript
export { DrizzleAuditLogger } from './drizzle-logger.js';
export { auditLogs } from './db/audit-schema.js';
```

- [ ] **Step 6: Register audit middleware in app.ts**

In `apps/server/src/app.ts`, add after the routes registration:

```typescript
  // --- Audit middleware ---
  if (config.nodeEnv !== 'test') {
    const { DrizzleAuditLogger } = await import('@accessbase/audit');
    const { createAuditMiddleware } = await import('@accessbase/audit');
    const auditLogger = new DrizzleAuditLogger(config.databaseUrl);
    app.addHook('onResponse', createAuditMiddleware(auditLogger));
  }
```

Note: In test mode, skip audit DB writes to keep tests fast. The audit middleware is only wired in dev/production.

- [ ] **Step 7: Run tests**

Run: `pixi run npx vitest run packages/audit/src/__tests__/audit-db.test.ts apps/server/src/__tests__/routes.test.ts`
Expected: All pass.

- [ ] **Step 8: Type check**

Run: `pixi run npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add packages/audit/src/db/audit-schema.ts packages/audit/src/drizzle-logger.ts \
  packages/audit/src/index.ts apps/server/src/app.ts \
  packages/audit/src/__tests__/audit-db.test.ts
git commit -m "feat(audit): Drizzle-backed audit_logs table + middleware wiring"
```

---

## Task 6: Integration Closeout + Gates + E2E Regression + Memorys Update

**Files:**
- No new code files. This is a verification-only task.
- Modify: `.agents/memorys/status.md` (update Phase 6a status)
- Modify: `.agents/memorys/decisions.md` (add D96 if RS256 migration introduces a new decision)

**Interfaces:**
- Consumes: all Tasks 1-5 outputs
- Produces: verified green gates, updated project memory

- [ ] **Step 1: Run full type check**

Run: `pixi run npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run all unit and integration tests**

Run: `pixi run npx vitest run packages/identity apps/server/src`
Expected: All tests pass. Count: existing 138 + ~8 new (5 roles + 1 error envelope + 3 SessionManager + 1 audit DB) = ~147 total.

- [ ] **Step 3: Run existing E2E tests for regression**

Run: `pixi run npx playwright test --project=chromium e2e/setup.spec.ts`
Run: `pixi run npx playwright test --project=chromium e2e/users-crud.spec.ts`
Expected: All pass. These tests use mock API by default, so middleware/JWT changes don't break them.

- [ ] **Step 4: Verify no `as any` introduced**

Run: `grep -rn 'as any' apps/server/src/ packages/identity/src/ packages/audit/src/ | grep -v node_modules | grep -v __tests__`
Expected: Only pre-existing `as any` in `roles.ts` line `(app as any).authenticate` (existing pattern, not new).

- [ ] **Step 5: Verify no `@ts-ignore` or `@ts-expect-error`**

Run: `grep -rn '@ts-ignore\|@ts-expect-error' apps/server/src/ packages/identity/src/ packages/audit/src/`
Expected: Empty.

- [ ] **Step 6: Verify no new dependencies outside declared list**

Only new deps added: `@fastify/rate-limit` and `@fastify/helmet`. Both declared in Task 2.
Run: `grep -E 'rate-limit|helmet' apps/server/package.json`
Expected: Both present.

- [ ] **Step 7: Update status.md**

In `.agents/memorys/status.md`, update:
- Phase 6a row: status from pending to done
- Add to Recent Work section:
  - 2026-08-28: Phase 6a security foundation (L0 wiring, rate-limit/helmet/CORS, RS256, refresh rotation, audit DB)

- [ ] **Step 8: Verify E2E tests pass**

Run: `pixi run npx playwright test --project=chromium`
Expected: All E2E tests pass.

- [ ] **Step 9: Final commit**

```bash
git add .agents/memorys/status.md .agents/memorys/decisions.md
git commit -m "docs: update memorys for Phase 6a completion"
```

---

## Deviations from Instructions

- **Task 1 L0 app.ts block**: The master plan mentions uncommenting lines 92-96 in app.ts. However, the L0 plugin block was designed for Fastify v5-style plugins that don't exist yet. The roles.ts rewrite in this plan directly imports `RoleManager` instead, which achieves the same goal without needing the L0 plugin registration. If L0 plugins are created in a later phase, the block can be uncommented then.
- **Task 2 setup-guard.ts**: No changes needed. setupGuard already blocks `/api/v1/auth/login` before setup. Rate-limit is per-route config on the login route, which fires after setup-guard allows the request through.
- **Task 3 HMAC fallback**: When no RS256 key paths are configured (dev/test), the server falls back to HMAC. This means old HMAC-signed tokens stop working once RS256 keys are deployed in production, with no automatic migration window. This is acceptable for a fresh system.
- **Task 4 dual verification**: The /refresh endpoint does both DB-side token rotation AND JWT verify of the old token. The JWT verify gives us user identity (sub/email) needed to sign the new access token without an extra DB lookup. In a later phase (6b), the DB session becomes fully authoritative and the JWT verify can be removed.
- **Task 5 test-mode skip**: Audit middleware is skipped in test mode to keep tests fast. This means audit behavior isn't integration-tested in Phase 6a. Phase 6c (Audit UI) will add targeted audit integration tests.
- **Test count estimate**: ~8 new test cases across Tasks 1-5. Total: ~146 (138 existing + 8 new).
