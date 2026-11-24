/**
 * 4A T3 — AuthZEN route wire locks (D-4=B): plugin-local machine-only gate,
 * scope handling (missing scopes DENY — sec M-3), batch cap, per-key rate
 * limit, X-Request-ID echo, decision stash (PH-9), discovery shape. Scripted
 * resolution deps — no DB, no RBAC state.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  authzenRoutes,
  setAuthZenDepsForTest,
  resetAuthZenDepsForTest,
  resetAuthZenRateLimitForTest,
} from '../routes/authzen.js';
import type { AuthZenResolutionDeps } from '../utils/authzen-resolve.js';

process.env.NODE_ENV = 'test';

const SCRIPTED: AuthZenResolutionDeps = {
  findSubject: async (id) => (id === 'u-alice' ? { id } : null),
  hasPermission: async () => true,
  getUserDataScope: async () => 'all',
  getDepartmentIdsForUser: async () => [],
  isWithinScope: async () => true,
  knownCodes: new Set(['users:read']),
};

interface Auth {
  type?: string;
  scopes?: string[];
  sub?: string;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('authenticate', async () => {});
  const current = { auth: { type: 'apikey', scopes: ['authzen:evaluate'], sub: 'key-1' } as Auth };
  (app as unknown as { currentAuth: typeof current }).currentAuth = current;
  const lastStash: { value: unknown } = { value: undefined };
  (app as unknown as { lastStash: typeof lastStash }).lastStash = lastStash;
  app.addHook('onRequest', async (req) => {
    const a = (app as unknown as { currentAuth: typeof current }).currentAuth.auth;
    (req as unknown as { user?: unknown }).user = a.sub
      ? { sub: a.sub, type: a.type, scopes: a.scopes }
      : undefined;
    (req as unknown as { tenantId?: string }).tenantId = 't1';
  });
  // capture the LAST decision stash (PH-9) — hooks must be registered pre-ready
  app.addHook('onSend', async (req) => {
    lastStash.value = (req as unknown as { auditDecision?: unknown }).auditDecision;
  });
  await app.register(authzenRoutes, { prefix: '/api/v1/authzen' });
  await app.ready();
  return app;
}

let app: FastifyInstance;
let currentAuth: Auth;

beforeEach(async () => {
  resetAuthZenDepsForTest();
  resetAuthZenRateLimitForTest();
  setAuthZenDepsForTest(SCRIPTED);
  app ??= await buildApp();
  currentAuth = (app as unknown as { currentAuth: { auth: Auth } }).currentAuth.auth;
  currentAuth.type = 'apikey';
  currentAuth.scopes = ['authzen:evaluate'];
  currentAuth.sub = 'key-1';
});

afterAll(async () => {
  await app?.close();
});

const post = (url: string, payload?: unknown): ReturnType<FastifyInstance['inject']> =>
  app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    payload,
  });

describe('plugin-local caller gate (machine-only, sec M-3)', () => {
  it('JWT-lane caller → 403 AUTHZEN_001 (never a user-token oracle)', async () => {
    currentAuth.type = undefined; // JWT-shaped (no type field)
    const res = await post('/api/v1/authzen/access/v1/evaluation', {
      subject: { id: 'u-alice' },
      resource: { type: 'users' },
      action: { name: 'read' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTHZEN_001');
  });

  it('apikey with MISSING scopes array → 403 (no ?? ["*"] default at THIS gate)', async () => {
    currentAuth.scopes = undefined;
    const res = await post('/api/v1/authzen/access/v1/evaluation', {
      subject: { id: 'u-alice' },
      resource: { type: 'users' },
      action: { name: 'read' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTHZEN_002');
  });

  it('apikey with a wrong scope → 403 AUTHZEN_002', async () => {
    currentAuth.scopes = ['scim'];
    const res = await post('/api/v1/authzen/access/v1/evaluation', {
      subject: { id: 'u-alice' },
      resource: { type: 'users' },
      action: { name: 'read' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTHZEN_002');
  });

  it("'*' keys retain access (documented posture — decision stashed for audit)", async () => {
    currentAuth.scopes = ['*'];
    const res = await post('/api/v1/authzen/access/v1/evaluation', {
      subject: { id: 'u-alice' },
      resource: { type: 'users' },
      action: { name: 'read' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe(true);
    const lastStash = (app as unknown as { lastStash: { value: unknown } }).lastStash;
    expect(lastStash.value).toEqual({ decision: 'allow', matchedCode: 'authzen:evaluate' });
  });
});

describe('evaluation wire (PH-9 stash + X-Request-ID + deny semantics)', () => {
  it('unknown subject → decision:false 200 (AuthZEN answers, never 4xx-fakes)', async () => {
    const res = await post('/api/v1/authzen/access/v1/evaluation', {
      subject: { id: 'u-ghost' },
      resource: { type: 'users' },
      action: { name: 'read' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe(false);
    // deny-cause never leaves the server
    expect(JSON.stringify(res.json())).not.toContain('unknown-subject');
  });

  it('missing required fields → 400 AUTHZEN_004', async () => {
    const res = await post('/api/v1/authzen/access/v1/evaluation', { subject: { id: 'u-alice' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTHZEN_004');
  });

  it('X-Request-ID echoed on every response', async () => {
    const res = await post('/api/v1/authzen/access/v1/evaluation', {
      subject: { id: 'u-alice' },
      resource: { type: 'users' },
      action: { name: 'read' },
    });
    expect(res.headers['x-request-id']).toBeDefined();
  });
});

describe('batch (F-15 cap + order)', () => {
  it('batch over 50 → 400 AUTHZEN_005 (hard cap)', async () => {
    const items = Array.from({ length: 51 }, () => ({
      resource: { type: 'users' },
      action: { name: 'read' },
    }));
    const res = await post('/api/v1/authzen/access/v1/evaluations', {
      subject: { id: 'u-alice' },
      evaluations: items,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTHZEN_005');
  });

  it('batch preserves request order (mixed allow/deny)', async () => {
    const res = await post('/api/v1/authzen/access/v1/evaluations', {
      subject: { id: 'u-alice' },
      evaluations: [
        { resource: { type: 'users' }, action: { name: 'read' } },
        { resource: { type: 'users' }, action: { name: 'delete' } }, // unknown code → deny
        { resource: { type: 'roles' }, action: { name: 'read' } }, // unknown code → deny
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().evaluations.map((e: { decision: boolean }) => e.decision)).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe('per-key rate limit (F-15 — numbers land with the surface)', () => {
  it('121st request within the window → 429 AUTHZEN_003', async () => {
    const payload = {
      subject: { id: 'u-alice' },
      resource: { type: 'users' },
      action: { name: 'read' },
    };
    let last = 200;
    for (let i = 0; i < 121; i += 1) {
      last = (await post('/api/v1/authzen/access/v1/evaluation', payload)).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('discovery (D-4=B real URLs + F-15 freshness disclosure)', () => {
  it('advertises the real nested endpoints + cache freshness', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/authzen/.well-known/authzen-configuration',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const base = `${config.oauthRedirectBase}/api/v1/authzen`;
    expect(body.authzen_evaluation_endpoint).toBe(`${base}/access/v1/evaluation`);
    expect(body.authzen_evaluations_endpoint).toBe(`${base}/access/v1/evaluations`);
    expect(body.policy_cache_freshness_seconds).toBe(30);
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
