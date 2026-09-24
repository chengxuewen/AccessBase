/**
 * SCIM 2.0 protocol routes (Batch H).
 *
 * Mounted at /api/v1/scim/v2. S2S provisioning protocol: IdPs (Azure AD,
 * Okta, Google Workspace) authenticate with an API key scoped to ['scim']
 * (R1/R2) — NOT the shared JWT authenticate decorator. Auth is a
 * plugin-scoped preHandler that reads the bearer directly via
 * ApiKeyManager.findByHash; valid keys inject key.tenantId into
 * request.tenantId (R3) so downstream handlers never fall back to
 * DEFAULT_TENANT.
 *
 * User provisioning CRUD (Task 2): SCIM User resource ↔ users table via
 * UserManager. userName ↔ email (lower/trim normalized, R8); name absent →
 * userName (R9). Filtering supports only `userName eq` / `id eq` (SQL
 * push-down via scim2-parse-filter AST); anything else → 400 invalidFilter.
 *
 * ALL responses use the SCIM error/list shape ({schemas: [...], ...}) —
 * never our {success,data} envelope (RFC 7644 wire contract).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SafeApiKey } from '@accessbase/identity';
import { ApiKeyManager, UserManager, SessionManager, GroupManager, hashApiKey } from '@accessbase/identity';
import { assertPasswordPolicy, readPasswordPolicy } from '@accessbase/identity';
import type { User, Group } from '@accessbase/identity';
import { parse as parseFilter } from 'scim2-parse-filter';
import { getApiKeyManager } from './api-keys.js';
import { getOptionsManager } from './options.js';

const SCIM_MEDIA_TYPE = 'application/scim+json';

const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
// Mirror of the identity guard tag literal (conflict-mapper precedent: route
// tests mock '@accessbase/identity' and must not depend on it exposing consts).
const LAST_ADMIN_GUARD_TAG = 'LAST_ADMIN_GUARD';

/** RFC 7644 §3.7.3: list page size default/cap — mirrored in SPC filter.maxResults. */
const PAGE_SIZE_DEFAULT = 100;
const PAGE_SIZE_MAX = 200;

/** RFC 7644 §3.12 error envelope. */
function scimError(
  reply: FastifyReply,
  status: number,
  scimType: string | undefined,
  detail: string,
): void {
  reply.status(status).header('content-type', SCIM_MEDIA_TYPE).send({
    schemas: [ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  });
}

/** Content type on every SCIM response, SCIM shape or not. */
function scimSend(reply: FastifyReply, status: number, body: Record<string, unknown>): void {
  reply.status(status).header('content-type', SCIM_MEDIA_TYPE).send(body);
}

/** R8: SCIM userName matching is case-insensitive; PG varchar unique is not. */
function normalizeUserName(userName: unknown): string | undefined {
  if (typeof userName !== 'string' || userName.trim() === '') return undefined;
  return userName.trim().toLowerCase();
}

/**
 * DB user row → SCIM User resource (RFC 7643 §4.3 + §7 meta).
 * location mirrors the public mount path (front proxy keeps /api prefix).
 */
function toScimUser(user: User): Record<string, unknown> {
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    userName: user.email,
    ...(user.name ? { name: { formatted: user.name } } : {}),
    emails: [{ value: user.email, primary: true }],
    active: user.status === 'active',
    meta: {
      resourceType: 'User',
      location: `/api/v1/scim/v2/Users/${user.id}`,
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

/**
 * SCIM filter AST → manager query. Only single-clause `userName eq` /
 * `id eq` push down to SQL; any other shape is rejected (400 invalidFilter)
 * rather than silently broadening the match.
 * Returns emailExact (userName, exact lowercase email match) or id filter.
 */
function filterToQuery(filterStr: string): { search?: string; id?: string; emailExact?: string } | null {
  let ast: ReturnType<typeof parseFilter>;
  try {
    ast = parseFilter(filterStr);
  } catch {
    return null;
  }
  if (ast.op !== 'eq') return null;
  const value = typeof ast.compValue === 'string' ? ast.compValue : undefined;
  if (value === undefined) return null;
  if (ast.attrPath.toLowerCase() === 'username') {
    const normalized = normalizeUserName(value);
    return normalized ? { emailExact: normalized } : null;
  }
  if (ast.attrPath.toLowerCase() === 'id') return { id: value };
  return null;
}
/** SCIM filter AST → group query: only `displayName eq` / `id eq` push down. */
function filterToGroupQuery(filterStr: string): { displayName?: string; id?: string } | null {
  let ast: ReturnType<typeof parseFilter>;
  try {
    ast = parseFilter(filterStr);
  } catch {
    return null;
  }
  if (ast.op !== 'eq') return null;
  const value = typeof ast.compValue === 'string' ? ast.compValue : undefined;
  if (value === undefined) return null;
  const attr = ast.attrPath.toLowerCase();
  if (attr === 'displayname') return { displayName: value };
  if (attr === 'id') return { id: value };
  return null;
}

/** Group resource (RFC 7643 §4.3). externalId is accepted-and-ignored: the
 * groups table carries no such column (ponytail: add the column when a real
 * IdP correlation round-trip demands it). */
function toScimGroup(
  g: Group,
  members?: Array<{ userId: string; email: string; name: string }>,
): Record<string, unknown> {
  return {
    schemas: [GROUP_SCHEMA],
    id: g.id,
    displayName: g.name,
    ...(members ? { members: members.map((m) => ({ value: m.userId, display: m.email })) } : {}),
    meta: {
      resourceType: 'Group',
      location: `/api/v1/scim/v2/ScimGroups/${g.id}`,
      created: g.createdAt.toISOString(),
      lastModified: g.updatedAt.toISOString(),
    },
  };
}

/** members/PATCH value → user-id refs (array, single object, or bare string). */
function memberRefIds(members: unknown): string[] {
  if (members === undefined || members === null) return [];
  const list = Array.isArray(members) ? members : [members];
  const out: string[] = [];
  for (const m of list) {
    if (typeof m === 'string' && m !== '') {
      out.push(m);
      continue;
    }
    if (typeof m === 'object' && m !== null) {
      const v = (m as { value?: unknown }).value;
      if (typeof v === 'string' && v !== '') out.push(v);
    }
  }
  return out;
}

/** PATCH path `members[value eq "u"]` → the single filtered user id. */
function memberFilterId(path: string): string | undefined {
  const m = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path);
  return m?.[1];
}

export async function scimRoutes(app: FastifyInstance): Promise<void> {
  // Scoped managers (users.ts route-module precedent).
  const userManager = new UserManager();
  // Q4b ScimGroups provisioning (same scoped auth/parser/error-handler apply).
  const groupManager = new GroupManager();
  // Lazy singleton: a per-request SessionManager would pile up pg Pools
  // (users.ts getSessionManager precedent). Only DELETE touches it.
  let sessionManager: SessionManager | null = null;

  // M1 (T1 review carry-over): scoped error handler. Parser failures and
  // validation errors → 400 SCIM Error (invalidSyntax); anything else in
  // this subtree → SCIM-shaped 500. Never the global {success,data} envelope.
  app.setErrorHandler((err, _request, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    const isSyntax = status === 400 || status === 422;
    scimError(
      reply,
      status,
      isSyntax ? 'invalidSyntax' : undefined,
      err.message || 'Request could not be processed',
    );
  });

  // R5: scoped parser, registered UNCONDITIONALLY — Fastify 4 has no
  // application/scim+json parser, so Azure AD's constant media type would 415.
  // Scoped to this plugin's encapsulation context (saml.ts:27 precedent);
  // app.ts must NOT gain any global addContentTypeParser (static invariant).
  app.addContentTypeParser(
    SCIM_MEDIA_TYPE,
    { parseAs: 'string' },
    (_req, body, done: (err: Error | null, result?: unknown) => void) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        // statusCode=400 routes the failure to the scoped error handler
        // (raw SyntaxError would fall through to Fastify's default 500).
        const err: Error & { statusCode?: number } = new Error('Request body is not valid JSON');
        err.statusCode = 400;
        done(err);
      }
    },
  );

  // Plugin-scoped bearer auth (spec H2): ab_ API keys only; the key's scopes
  // must include 'scim'. Injects key.tenantId (R3). JWTs and missing headers
  // get a SCIM-shaped 401.
  // NOTE: hooks must return undefined. Returning `reply` from an async
  // preHandler makes Fastify 4 treat the settled Reply as the handler's
  // resolution — the request then never completes (inject hang).
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    if (!bearer) {
      scimError(reply, 401, undefined, 'Authentication required: provide a Bearer token');
      return;
    }
    const key: SafeApiKey | null = await getApiKeyManager().findByHash(hashApiKey(bearer));
    if (!key || key.revokedAt !== null || ApiKeyManager.isExpired(key.expiresAt)) {
      scimError(reply, 401, undefined, 'Invalid or revoked token');
      return;
    }
    // ApiKeyRow.scopes is an untyped jsonb (unknown) — narrow before use.
    const scopes = Array.isArray(key.scopes) ? (key.scopes as string[]) : [];
    if (!scopes.includes('scim')) {
      scimError(reply, 403, undefined, "Token scope does not permit SCIM provisioning (requires 'scim')");
      return;
    }
    request.tenantId = key.tenantId;
  });

  // --- Discovery endpoints (RFC 7644 §4/§5) — static docs, no DB ---

  app.get('/ServiceProviderConfig', async (_req, reply) => {
    scimSend(reply, 200, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
      patch: { supported: true },
      filter: { supported: true, maxResults: PAGE_SIZE_MAX },
      // L1 (T1 review): RFC 7644 §5 requires the bulk block on SPC.
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'AccessBase API key (scopes: ["scim"]) passed as a bearer token',
          primary: true,
        },
      ],
      meta: {
        resourceType: 'ServiceProviderConfig',
        location: '/api/v1/scim/v2/ServiceProviderConfig',
      },
    });
  });

  app.get('/Schemas', async (_req, reply) => {
    scimSend(reply, 200, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [
        {
          id: 'urn:ietf:params:scim:schemas:core:2.0:User',
          name: 'User',
          description: 'User Account',
          attributes: [
            { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'externalId', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'name', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', subAttributes: [
              { name: 'familyName', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
              { name: 'givenName', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            ] },
            { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', subAttributes: [
              { name: 'value', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
              { name: 'primary', type: 'boolean', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            ] },
          ],
          meta: { resourceType: 'Schema', location: '/api/v1/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User' },
        },
      ],
      startIndex: 1,
      itemsPerPage: 1,
    });
  });

  app.get('/ResourceTypes', async (_req, reply) => {
    scimSend(reply, 200, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      Resources: [
        {
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'User Account',
          schema: USER_SCHEMA,
          schemaExtensions: [],
          meta: { resourceType: 'ResourceType', location: '/api/v1/scim/v2/ResourceTypes/User' },
        },
        {
          id: 'Group',
          name: 'Group',
          endpoint: '/ScimGroups',
          description: 'Group',
          schema: GROUP_SCHEMA,
          schemaExtensions: [],
          meta: { resourceType: 'ResourceType', location: '/api/v1/scim/v2/ResourceTypes/Group' },
        },
      ],
      startIndex: 1,
      itemsPerPage: 2,
    });
  });

  // --- User provisioning CRUD (Task 2) ---

  /**
   * GET /Users — ListResponse with optional filter + startIndex/count paging.
   * startIndex is 1-based (SCIM) → page is 1-based in findAll; count caps at
   * PAGE_SIZE_MAX (mirrors SPC filter.maxResults, L1 alignment).
   */
  app.get('/Users', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');

    const query = request.query as { filter?: string; startIndex?: string; count?: string };

    let search: string | undefined;
    let id: string | undefined;
    let emailExact: string | undefined;
    if (query.filter) {
      const mapped = filterToQuery(query.filter);
      if (!mapped) return scimError(reply, 400, 'invalidFilter', 'Unsupported or malformed filter');
      search = mapped.search;
      id = mapped.id;
      emailExact = mapped.emailExact;
    }

    const startIndex = Math.max(1, Number.parseInt(query.startIndex ?? '1', 10) || 1);
    const countRaw = Number.parseInt(query.count ?? String(PAGE_SIZE_DEFAULT), 10);
    const count = Number.isNaN(countRaw) ? PAGE_SIZE_DEFAULT : Math.min(Math.max(1, countRaw), PAGE_SIZE_MAX);

    // id eq → direct lookup, list response with 0/1 result.
    if (id) {
      const user = await userManager.findById(id, tenantId);
      return scimSend(reply, 200, {
        schemas: [LIST_RESPONSE_SCHEMA],
        totalResults: user ? 1 : 0,
        startIndex,
        itemsPerPage: user ? 1 : 0,
        Resources: user ? [toScimUser(user)] : [],
      });
    }

    // H2: SCIM startIndex is a 1-based ROW OFFSET; findAll's page is 1-based
    // PAGES. startIndex=11&count=10 → page 2, not page 11.
    const page = Math.max(1, Math.ceil(startIndex / count));
    const result = await userManager.findAll({ page, pageSize: count, search, emailExact }, tenantId);
    return scimSend(reply, 200, {
      schemas: [LIST_RESPONSE_SCHEMA],
      totalResults: result.total,
      startIndex,
      itemsPerPage: result.data.length,
      Resources: result.data.map(toScimUser),
    });
  });

  app.get('/Users/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    const user = await userManager.findById(id, tenantId);
    if (!user) return scimError(reply, 404, 'notFound', `User ${id} not found`);
    return scimSend(reply, 200, toScimUser(user));
  });

  /**
   * POST /Users — find-or-create.
   * emails[0].value vs userName: when both present and they differ, emails[0]
   * wins as the account email and userName is recorded verbatim in name
   * (fallback, R9) — the email claim is the stronger SCIM attribute.
   */
  app.post('/Users', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const body = (request.body ?? {}) as Record<string, unknown>;

    const emails = Array.isArray(body['emails']) ? body['emails'] : [];
    const firstEmail = emails.length > 0 && typeof emails[0] === 'object' && emails[0] !== null
      ? (emails[0] as { value?: unknown }).value
      : undefined;
    const userName = normalizeUserName(body['userName']) ?? normalizeUserName(firstEmail);
    if (!userName) {
      return scimError(reply, 400, 'invalidValue', 'userName is required');
    }
    // emails[0].value, when present, wins over userName as the account email.
    const email = normalizeUserName(firstEmail) ?? userName;

    const scimName =
      typeof body['name'] === 'object' && body['name'] !== null
        ? (body['name'] as { formatted?: unknown }).formatted
        : undefined;
    // R9: users.name is NOT NULL; fall back to the provided userName/email.
    const name =
      typeof scimName === 'string' && scimName.trim() !== ''
        ? scimName
        : (typeof body['userName'] === 'string' ? body['userName'] : email);

    const externalId = typeof body['externalId'] === 'string' ? body['externalId'] : undefined;

    // Find-or-create: 409 uniqueness on an existing account (R8 normalized).
    const existing = await userManager.findByEmail(email);
    if (existing) {
      return scimError(reply, 409, 'uniqueness', `User already exists: ${email}`);
    }

    const password = typeof body['password'] === 'string' && body['password'] !== '' ? body['password'] : undefined;
    if (password) {
      const policy = await readPasswordPolicy(getOptionsManager().get.bind(getOptionsManager()), 'register');
      const verdict = assertPasswordPolicy(password, policy);
      if (!verdict.ok) {
        return scimError(reply, 400, 'invalidValue', verdict.message ?? 'Password does not meet policy');
      }
    }

    const created = await userManager.create(
      {
        email,
        name,
        ...(password ? { password } : {}),
        ...(externalId ? { metadata: { scimExternalId: externalId } } : {}),
        isActive: true,
      },
      tenantId,
    );
    const location = `/api/v1/scim/v2/Users/${created.id}`;
    return reply.status(201).header('content-type', SCIM_MEDIA_TYPE).header('location', location).send(
      toScimUser(created),
    );
  });

  /**
   * PUT /Users/:id — full replace of mutable attributes (name/emails/active).
   * Immutable: id, userName (email) — a differing userName → 400 invalidValue.
   */
  app.put('/Users/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    const current = await userManager.findById(id, tenantId);
    if (!current) return scimError(reply, 404, 'notFound', `User ${id} not found`);

    const bodyUserName = normalizeUserName(body['userName']);
    if (bodyUserName && bodyUserName !== current.email.toLowerCase()) {
      return scimError(reply, 400, 'invalidValue', 'userName is immutable');
    }

    const scimName =
      typeof body['name'] === 'object' && body['name'] !== null
        ? (body['name'] as { formatted?: unknown }).formatted
        : undefined;
    const name =
      typeof scimName === 'string' && scimName.trim() !== ''
        ? scimName
        : current.name;

    const emails = Array.isArray(body['emails']) ? body['emails'] : [];
    const firstEmail = emails.length > 0 && typeof emails[0] === 'object' && emails[0] !== null
      ? (emails[0] as { value?: unknown }).value
      : undefined;
    const emailFromEmails = normalizeUserName(firstEmail);
    if (emailFromEmails && emailFromEmails !== current.email.toLowerCase()) {
      return scimError(reply, 400, 'invalidValue', 'emails[0].value is immutable (matches userName)');
    }

    // active=false → suspension parity (batch A): revoke all sessions so the
    // deactivation is immediate. active=true only un-suspends.
    if (body['active'] === false) {
      await userManager.changeStatus(id, 'suspended', tenantId);
      sessionManager ??= new SessionManager();
      await sessionManager.revokeAllUserSessions(id);
    } else if (body['active'] === true && current.status !== 'active') {
      await userManager.changeStatus(id, 'active', tenantId);
    }

    if (name !== current.name) await userManager.update(id, { name }, tenantId);

    // H1: re-read after the active-toggle block — `current` is a stale
    // snapshot once changeStatus/update have run, and the response must
    // reflect the persisted row, not the pre-write read.
    const finalUser = await userManager.findById(id, tenantId);
    if (!finalUser) return scimError(reply, 500, undefined, `User ${id} disappeared during update`);
    return scimSend(reply, 200, toScimUser(finalUser));
  });

  /**
   * DELETE /Users/:id — soft delete: suspend + revoke sessions (batch A
   * parity, users.ts changeStatus precedent). 204 empty per RFC 7644 §3.6.2.
   */
  app.delete('/Users/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    const current = await userManager.findById(id, tenantId);
    if (!current) return scimError(reply, 404, 'notFound', `User ${id} not found`);
    await userManager.changeStatus(id, 'suspended', tenantId);
    sessionManager ??= new SessionManager();
    await sessionManager.revokeAllUserSessions(id);
    return reply.status(204).send();
  });
  /**
   * PATCH /Users/:id (RFC 7644 §3.5.2) — sequential Operations (R7): each
   * attribute maps to its own Manager call. Unknown attribute or op → 400
   * invalidPath (IdP misconfig must surface, not be swallowed); emails →
   * 400 (immutable, PUT parity); remove active → 400 (required attribute).
   * Response is a FRESH re-read (T2 H1 discipline) — never a pre-write snapshot.
   */
  app.patch('/Users/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    // PatchOp envelope validation → 400 invalidValue (RFC 7644 §3.5.2).
    const operations = Array.isArray(body['Operations']) ? body['Operations'] : undefined;
    if (!operations || operations.length === 0) {
      return scimError(reply, 400, 'invalidValue', 'Patch body must carry a non-empty Operations array');
    }

    // Pre-check BEFORE processing: an unknown id must 404 without writes.
    if (!(await userManager.findById(id, tenantId))) {
      return scimError(reply, 404, 'notFound', `User ${id} not found`);
    }

    for (const rawOp of operations) {
      const op = (typeof rawOp === 'object' && rawOp !== null ? rawOp : {}) as {
        op?: unknown;
        path?: unknown;
        value?: unknown;
      };
      // Azure AD sends capitalized op names — case-insensitive per RFC 7644.
      const kind = typeof op.op === 'string' ? op.op.toLowerCase() : '';
      const path = typeof op.path === 'string' ? op.path.trim().toLowerCase() : '';

      if (kind !== 'add' && kind !== 'replace' && kind !== 'remove') {
        return scimError(reply, 400, 'invalidPath', `Unsupported patch op: ${String(op.op)}`);
      }
      if (path === 'active') {
        if (kind === 'remove') {
          return scimError(reply, 400, 'invalidPath', 'active is required and cannot be removed');
        }
        if (typeof op.value !== 'boolean') {
          return scimError(reply, 400, 'invalidPath', 'active requires a boolean value');
        }
        if (op.value === false) {
          await userManager.changeStatus(id, 'suspended', tenantId);
          sessionManager ??= new SessionManager();
          await sessionManager.revokeAllUserSessions(id);
        } else {
          await userManager.changeStatus(id, 'active', tenantId);
        }
      } else if (path === 'name' || path === 'name.formatted') {
        if (kind === 'remove' || typeof op.value !== 'string' || op.value.trim() === '') {
          return scimError(reply, 400, 'invalidPath', 'name requires a non-empty string value');
        }
        await userManager.update(id, { name: op.value }, tenantId);
      } else if (path === 'emails' || path.startsWith('emails')) {
        return scimError(reply, 400, 'invalidPath', 'emails is immutable (matches userName)');
      } else {
        // R7: unknown attributes are explicitly rejected, never ignored.
        return scimError(reply, 400, 'invalidPath', `Unsupported patch path: ${op.path === undefined ? '(missing)' : String(op.path)}`);
      }
    }

    // T2 H1 carry-over: fresh re-read after ALL writes — the response must
    // reflect the persisted row, not any pre-write snapshot.
    const finalUser = await userManager.findById(id, tenantId);
    if (!finalUser) return scimError(reply, 500, undefined, `User ${id} disappeared during update`);
    return scimSend(reply, 200, toScimUser(finalUser));
  });
  // --- Q4b ScimGroups provisioning (Users-resource template, RFC 7643 §4.3) ---

  /** Map GroupManager error tags to SCIM shapes; true = handled. */
  function scimGroupError(reply: FastifyReply, err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'GROUP_NOT_FOUND') {
      scimError(reply, 404, 'notFound', 'Group not found');
      return true;
    }
    if (message === 'GROUP_NAME_EXISTS') {
      scimError(reply, 409, 'uniqueness', 'A group with this displayName already exists');
      return true;
    }
    if (message === 'GROUP_MEMBER_TENANT_MISMATCH') {
      scimError(reply, 400, 'invalidValue', 'Member user does not belong to this tenant');
      return true;
    }
    if (message.startsWith(LAST_ADMIN_GUARD_TAG)) {
      scimError(reply, 403, 'invalidValue', 'Operation would leave the tenant with no active administrator');
      return true;
    }
    return false;
  }

  /** R4 lock: SCIM must never mutate an isSystem-bound group (IdP compromise
   * could otherwise strip the tenant's last admin). */
  async function systemBoundBlock(groupId: string, reply: FastifyReply): Promise<boolean> {
    if (await groupManager.grantsSystemRole(groupId)) {
      scimError(
        reply,
        403,
        'invalidValue',
        'Group is bound to a protected administrator role and cannot be modified via SCIM',
      );
      return true;
    }
    return false;
  }

  app.get('/ScimGroups', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const query = request.query as { filter?: string; startIndex?: string; count?: string };
    let rows = await groupManager.list(tenantId);
    if (query.filter) {
      const mapped = filterToGroupQuery(query.filter);
      if (!mapped) return scimError(reply, 400, 'invalidFilter', 'Unsupported or malformed filter');
      if (mapped.id !== undefined) rows = rows.filter((r) => r.id === mapped.id);
      if (mapped.displayName !== undefined) {
        const needle = mapped.displayName.toLowerCase();
        rows = rows.filter((r) => r.name.toLowerCase() === needle);
      }
    }
    const startIndex = Math.max(1, Number.parseInt(query.startIndex ?? '1', 10) || 1);
    const countRaw = Number.parseInt(query.count ?? String(PAGE_SIZE_DEFAULT), 10);
    const count = Number.isNaN(countRaw) ? PAGE_SIZE_DEFAULT : Math.min(Math.max(1, countRaw), PAGE_SIZE_MAX);
    // ponytail: list-all-then-slice; per-tenant group counts are dozens. Add a
    // paginated manager query if a tenant ever approaches PAGE_SIZE_MAX.
    const offset = Math.max(0, startIndex - 1);
    const page = rows.slice(offset, offset + count);
    return scimSend(reply, 200, {
      schemas: [LIST_RESPONSE_SCHEMA],
      totalResults: rows.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page.map((g) => toScimGroup(g)),
    });
  });

  app.get('/ScimGroups/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    const group = await groupManager.findById(id, tenantId);
    if (!group) return scimError(reply, 404, 'notFound', `Group ${id} not found`);
    const members = await groupManager.listMembers(id, tenantId);
    return scimSend(reply, 200, toScimGroup(group, members));
  });

  app.post('/ScimGroups', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const displayName =
      typeof body['displayName'] === 'string' && body['displayName'].trim() !== ''
        ? body['displayName'].trim()
        : undefined;
    if (!displayName) return scimError(reply, 400, 'invalidValue', 'displayName is required');
    const refs = memberRefIds(body['members']);
    // Validate ALL refs before create (no half-baked groups on a bad batch).
    for (const ref of refs) {
      if (!(await userManager.findById(ref, tenantId))) {
        return scimError(reply, 400, 'invalidValue', `Member user ${ref} not found`);
      }
    }
    let group: Group;
    try {
      group = await groupManager.create({ name: displayName }, tenantId);
      for (const ref of refs) await groupManager.addMember(group.id, ref, tenantId);
    } catch (err) {
      if (scimGroupError(reply, err)) return;
      throw err;
    }
    const members = await groupManager.listMembers(group.id, tenantId);
    return reply
      .status(201)
      .header('content-type', SCIM_MEDIA_TYPE)
      .header('location', `/api/v1/scim/v2/ScimGroups/${group.id}`)
      .send(toScimGroup(group, members));
  });

  /** Full replacement: displayName + exact member set (role bindings are NOT
   * touched — SCIM has no roles concept; bindings stay on the admin surface). */
  app.put('/ScimGroups/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    if (!(await groupManager.findById(id, tenantId))) {
      return scimError(reply, 404, 'notFound', `Group ${id} not found`);
    }
    if (await systemBoundBlock(id, reply)) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const displayName =
      typeof body['displayName'] === 'string' && body['displayName'].trim() !== ''
        ? body['displayName'].trim()
        : undefined;
    if (!displayName) return scimError(reply, 400, 'invalidValue', 'displayName is required');
    const refs = memberRefIds(body['members']);
    for (const ref of refs) {
      if (!(await userManager.findById(ref, tenantId))) {
        return scimError(reply, 400, 'invalidValue', `Member user ${ref} not found`);
      }
    }
    try {
      await groupManager.update(id, { name: displayName }, tenantId);
      const current = await groupManager.listMembers(id, tenantId);
      const wanted = new Set(refs);
      for (const m of current) {
        if (!wanted.has(m.userId)) await groupManager.removeMember(id, m.userId, tenantId);
      }
      for (const ref of refs) {
        if (!current.some((m) => m.userId === ref)) await groupManager.addMember(id, ref, tenantId);
      }
    } catch (err) {
      if (scimGroupError(reply, err)) return;
      throw err;
    }
    const finalGroup = await groupManager.findById(id, tenantId);
    if (!finalGroup) return scimError(reply, 500, undefined, `Group ${id} disappeared during update`);
    const members = await groupManager.listMembers(id, tenantId);
    return scimSend(reply, 200, toScimGroup(finalGroup, members));
  });

  app.patch('/ScimGroups/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const operations = Array.isArray(body['Operations']) ? body['Operations'] : undefined;
    if (!operations || operations.length === 0) {
      return scimError(reply, 400, 'invalidValue', 'Patch body must carry a non-empty Operations array');
    }
    if (!(await groupManager.findById(id, tenantId))) {
      return scimError(reply, 404, 'notFound', `Group ${id} not found`);
    }
    if (await systemBoundBlock(id, reply)) return;
    try {
      for (const rawOp of operations) {
        const op = (typeof rawOp === 'object' && rawOp !== null ? rawOp : {}) as {
          op?: unknown;
          path?: unknown;
          value?: unknown;
        };
        const kind = typeof op.op === 'string' ? op.op.toLowerCase() : '';
        const rawPath = typeof op.path === 'string' ? op.path.trim() : '';
        const path = rawPath.toLowerCase();
        if (kind !== 'add' && kind !== 'replace' && kind !== 'remove') {
          return scimError(reply, 400, 'invalidPath', `Unsupported patch op: ${String(op.op)}`);
        }
        if (path === 'displayname') {
          if (kind !== 'replace' || typeof op.value !== 'string' || op.value.trim() === '') {
            return scimError(reply, 400, 'invalidPath', 'displayName requires a replace with a non-empty string');
          }
          await groupManager.update(id, { name: op.value.trim() }, tenantId);
          continue;
        }
        const filtered = memberFilterId(rawPath);
        if (path === 'members' || path.startsWith('members[')) {
          if (filtered !== undefined) {
            // members[value eq "u"] — a single-member selector (Okta/Azure style)
            if (kind === 'remove') await groupManager.removeMember(id, filtered, tenantId);
            else await groupManager.addMember(id, filtered, tenantId);
            continue;
          }
          const refs = memberRefIds(op.value);
          for (const ref of refs) {
            if (!(await userManager.findById(ref, tenantId))) {
              return scimError(reply, 400, 'invalidValue', `Member user ${ref} not found`);
            }
          }
          if (kind === 'add') {
            for (const ref of refs) await groupManager.addMember(id, ref, tenantId);
          } else if (kind === 'remove') {
            const targets = refs.length > 0 ? refs : (await groupManager.listMembers(id, tenantId)).map((m) => m.userId);
            for (const ref of targets) await groupManager.removeMember(id, ref, tenantId);
          } else {
            const current = await groupManager.listMembers(id, tenantId);
            const wanted = new Set(refs);
            for (const m of current) {
              if (!wanted.has(m.userId)) await groupManager.removeMember(id, m.userId, tenantId);
            }
            for (const ref of refs) {
              if (!current.some((m) => m.userId === ref)) await groupManager.addMember(id, ref, tenantId);
            }
          }
          continue;
        }
        return scimError(reply, 400, 'invalidPath', `Unsupported patch path: ${op.path === undefined ? '(missing)' : String(op.path)}`);
      }
    } catch (err) {
      if (scimGroupError(reply, err)) return;
      throw err;
    }
    const finalGroup = await groupManager.findById(id, tenantId);
    if (!finalGroup) return scimError(reply, 500, undefined, `Group ${id} disappeared during update`);
    const members = await groupManager.listMembers(id, tenantId);
    return scimSend(reply, 200, toScimGroup(finalGroup, members));
  });

  app.delete('/ScimGroups/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return scimError(reply, 500, undefined, 'Tenant context missing');
    const { id } = request.params as { id: string };
    if (!(await groupManager.findById(id, tenantId))) {
      return scimError(reply, 404, 'notFound', `Group ${id} not found`);
    }
    if (await systemBoundBlock(id, reply)) return;
    try {
      await groupManager.delete(id, tenantId);
    } catch (err) {
      if (scimGroupError(reply, err)) return;
      throw err;
    }
    return reply.status(204).send();
  });
}
